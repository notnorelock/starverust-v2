# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A from-scratch, server-authoritative Survival MMO 2D built for the browser. No game
engine/framework is used anywhere — rendering is raw `CanvasRenderingContext2D`, the
ECS is hand-rolled, and the network protocol is a hand-rolled binary format over
WebSocket (never JSON for game packets). The project is being built in stages; the
current stage is a minimal end-to-end vertical slice (server tick loop + binary
protocol + client rendering with interpolation), not full gameplay.

## Commands

All commands run from the repo root via Bun workspaces.

```bash
bun install                 # install all workspace packages
bun run typecheck           # tsc --build across all packages (project references)
bun run test                # vitest run, THEN bun test for bun:sqlite-dependent specs
bun run test:watch          # vitest in watch mode (excludes the bun:sqlite spec — see below)
bun run test:bun            # runs only PlayerRepository.spec.ts under native `bun test`
bun run lint                # eslint . --ext .ts
bun run format              # prettier --write .
bun run dev                 # server + client concurrently (concurrently, colored output)
bun run dev:server          # server only — bun --watch src/index.ts, WS on :8081
bun run dev:client          # client only — webpack serve, http://localhost:8080
bun run build                # typecheck, then production client bundle
bun run db:migrate          # applies Kysely migrations to packages/server/data/dev.sqlite
```

Run a single Vitest spec: `bun x vitest run path/to/File.spec.ts`.
Run a single Bun-native spec: `bun test path/to/File.spec.ts`.

### Why tests are split across two runners

Vitest always executes specs inside Node worker processes (even when the `vitest` CLI
itself is invoked via `bun x vitest`), and Node's ESM loader cannot resolve Bun-only
builtins like `bun:sqlite`. Any spec that needs a real `bun:sqlite` connection
(currently `PlayerRepository.spec.ts`) is excluded from `vitest.config.ts` and instead
runs under native `bun test`, which does have `bun:sqlite`. Everything else — protocol
codecs, ECS core, buffer read/write — runs under Vitest. If you add a new spec that
imports `bun:sqlite` (or any other `bun:*` builtin), exclude it in `vitest.config.ts`
and add it to the `test:bun` script, following the existing pattern.

## Architecture

### Monorepo layout

Bun workspaces (`bunfig.toml` sets `install.linker = "hoisted"` — required on Windows,
where creating the per-package symlinks Bun normally uses needs elevated/Developer Mode
permissions that may not be available; hoisted linking avoids that requirement).

- `packages/protocol` — binary wire format. Zero dependencies on other packages.
- `packages/shared` — the ECS/engine core, DI container, math, time. Zero dependencies
  on other packages besides `protocol` being a sibling (shared does not depend on it).
  Used by both `server` and `client`.
- `packages/server` — Bun runtime, authoritative simulation, WebSocket gateway, database.
- `packages/client` — browser bundle (Webpack 5), Canvas 2D rendering, WebSocket client.
- `packages/assets`, `packages/tools`, `packages/editor` — placeholder packages for
  future stages (asset pipeline, codegen/build tooling, world/map editor). Each just
  exports `{}` today — do not build these out unless the task specifically calls for it.
- `configs/webpack`, `configs/eslint`, `configs/prettier` — shared build/lint config,
  consumed by name (`@starve/webpack-config` etc.) as workspace packages, not copy-pasted
  into each package.

TypeScript project references wire the dependency graph: `tsconfig.json` at root is an
orchestrator only (`files: []`, references every package); each package's own
`tsconfig.json` extends `tsconfig.base.json` and declares `references` to the packages
it actually imports (e.g. `server`/`client` reference `shared` and `protocol`). Running
`bun run typecheck` is `tsc --build` and is the authoritative check for cross-package
type errors — Webpack's `ts-loader`/`fork-ts-checker` deliberately do *not* do this (see
below), so a green `dev:client` compile does not mean typecheck is clean.

### The rootDir split: `tsconfig.json` vs `tsconfig.webpack.json` (client only)

`packages/client/tsconfig.json` has `rootDir: "src"` (needed for correct `tsc --build`
project-reference behavior). But Webpack's module graph reaches into sibling workspace
packages' source (`shared/src/...`, `protocol/src/...`), which `ts-loader` would reject
as "not under rootDir" if pointed at that same tsconfig. `packages/client/tsconfig.webpack.json`
is a second, `rootDir`-relaxed config used *only* by `ts-loader`/`fork-ts-checker-webpack-plugin`
inside `configs/webpack/webpack.common.js` — it does no meaningful type-checking of its
own (that's `bun run typecheck`'s job), it just needs to not reject cross-package
imports during bundling. If you add a new client-consumed export from `shared` or
`protocol`, this split is why the dev server doesn't break — don't try to unify the two
configs.

### ECS core (`packages/shared/src/ecs/core`)

Deliberately Unity-style: extensible via inheritance/interfaces, not a single closed
implementation.

- `Component` — abstract base; concrete components (`PositionComponent`,
  `VelocityComponent`, client-only `RenderableComponent`/`InterpolationComponent`) are
  plain data classes extending it. Behavior belongs in Systems, not Components.
- `System` — abstract base implementing `IInitializable`/`IFixedUpdatable`/`IDestructible`
  with no-op defaults, plus an *optional* `onUpdate` (only implemented by systems that
  run on the variable-rate frame loop, e.g. the client's `RenderSystem`). Concrete
  systems override only the hooks they need.
- `EntityRegistry` — owns entity identity and all component storage (`ComponentStore<T>`
  per component type); `World.entities` is the only way systems touch component data.
  `query(...types)` iterates the smallest matching store and filters, not a full scan.
- `World` — orchestrator: `registerSystem()` (registration order = execution order for
  both `fixedUpdate()` and `update()`), `init()`, `fixedUpdate(fixedDt)` (the tick
  pipeline), `update(dt)` (render-loop pass). Both server and client construct their own
  `World` instance from the same `shared` class — what differs is which systems get
  registered into each (see `ServerWorldFactory`/`ClientWorldFactory`), not the
  orchestration logic.
- `ServiceContainer` (`packages/shared/src/di`) — minimal symbol-keyed service locator,
  not a full IoC framework. Bootstrap code (`ServerBootstrap`/`ClientBootstrap`)
  registers concrete instances once at startup; systems receive dependencies via
  constructor injection at registration time, not by reaching into `world.services`
  mid-update. Server-only keys live in `server/src/core/ServiceKeys.ts`, client-only keys
  in `client/src/core/ServiceKeys.ts` — only truly shared services (`CLOCK_SERVICE`) are
  keyed in `shared`.

### World bounds — per-instance config, not a shared constant

World size is **not** a hardcoded constant in `shared` — it's per-`GameServer`-instance
configuration, because different regional server instances (and, later, different maps)
need different sizes. The pieces:

- `server/src/world/WorldConfig.ts` — `WorldConfig` (`width`, `height`, `spawnX`,
  `spawnY`) is the shape a future map editor would export; `boundsFromConfig()` derives a
  `WorldBounds` rectangle (`minX/maxX/minY/maxY`, centered on origin) from it.
  `DEFAULT_WORLD_CONFIG` (50x50, spawn at origin) is Stage 1's only config, loaded by
  `ServerBootstrap` — swapping in a map-file loader later only touches that one call site.
- `shared/src/math/WorldBounds.ts` — the generic `WorldBounds` interface, shared so both
  `WorldBoundsSystem` and the client's `Camera2D` can consume it without either depending
  on `server`'s `WorldConfig` type.
- `WorldBoundsSystem` (`shared/src/ecs/systems`, registered server-side only — see
  `TickPipeline`) takes `WorldBounds` as a **constructor parameter**, not an import.
  `GameServer` computes it once from its own `WorldConfig` and passes it through
  `buildTickPipeline(services, worldBounds)`. It clamps every positioned entity to the
  rectangle each tick and zeroes velocity on whichever axis hit a bound; this stands in
  for Stage 1's simplified Physics/Collision pipeline step (full broadphase/narrowphase
  collision is a later stage). Bounds enforcement is server-authoritative only — the
  client never clamps entity positions itself, only its camera (see below).
- The client learns the bounds **over the wire**, not from a constant: `HandshakePacket`
  carries `worldMinX/MaxX/MinY/MaxY` (f32 each), and `ClientBootstrap`'s Handshake handler
  calls `camera.setBounds(...)` with them. Before the handshake arrives, `Camera2D`
  defaults to unbounded (`±Infinity`) rather than guessing a size.

If you add a system, packet, or client feature that needs the world size, thread
`WorldBounds`/`WorldConfig` through as a parameter the same way — don't reintroduce a
shared constant, since that's exactly what this design replaced.

### Physics & collision engine (`shared/src/physics`, `shared/src/ecs/systems/{PhysicsSystem,CollisionSystem}.ts`)

Hand-rolled, no external physics/collision library — `shared/src/physics` is pure
computation (shapes, narrowphase math, spatial hashing, resolution, knockback, CCD
sub-stepping), completely independent of ECS or rendering; the two systems are the only
things that wire it into components. Server-authoritative only — the client never runs
either system, it just renders whatever position the server reports.

**Component split**: `VelocityComponent` (already existed) holds current vx/vy.
`PhysicsBodyComponent` (new) holds the *forces acting on* velocity — pending acceleration
(`ax`/`ay`, applied then zeroed each tick), `mass`, `friction`, `drag`, and `bodyType`
(`'dynamic'` | `'static'`). `CircleColliderComponent`/`RectColliderComponent` hold pure
shape data (radius, or half-width/half-height), centered on the entity's
`PositionComponent` — there's no separate collider-offset/transform concept, colliders
are always centered on the entity. An entity needs `PositionComponent` +
`PhysicsBodyComponent` to participate in `PhysicsSystem`, and `PositionComponent` + either
collider component to participate in `CollisionSystem`'s broadphase — the two systems'
entity sets overlap but aren't identical (e.g. a collider-only static wall has no
`VelocityComponent` to integrate).

**`PhysicsBodyComponent`'s constructor requires `initialX`/`initialY` for any entity not
spawning at the origin.** These seed `prevX`/`prevY` (the position at the start of the
entity's first tick). Omitting them for an off-origin spawn makes `CollisionSystem`'s
continuous-collision pass see a false "huge displacement" from `(0,0)` to the real spawn
point on the very first tick and try to sweep the entity across the map — this exact bug
was caught and fixed during implementation (see `PlayerEntityFactory`'s
`initialX: spawnX, initialY: spawnY` for the pattern to follow). After the first tick,
`PhysicsSystem` keeps `prevX`/`prevY` current automatically.

**Pipeline order**: `PhysicsSystem` is registered BEFORE `MovementSystem` in
`TickPipeline.ts`, despite the conceptual step numbers (2. Movement, 3. Physics) —
`PhysicsSystem` must record `prevX`/`prevY` and turn acceleration into velocity before
`MovementSystem` integrates that velocity into position; the reverse order would make
`prevX`/`prevY` already reflect the current tick's movement, breaking CCD's displacement
check. `CollisionSystem` runs after both, then `WorldBoundsSystem` runs last as a final
world-edge catch-all clamp.

**Narrowphase normal direction contract** (`shared/src/physics/Narrowphase.ts` /
`Manifold.ts`): every `test*` function returns a manifold whose `normal` points from the
FIRST shape argument (A) toward the SECOND (B). This sounds obvious but is easy to get
backward in `testCircleRect`'s "circle center deep inside the rect" branch specifically
(the zero-distance case) — the intuitive "push the circle out this way" direction is
B→A, the *opposite* of what this function must return. If you touch narrowphase code,
add a test asserting the normal's direction against a scenario where A and B are offset
along a known axis, not just that a manifold exists — a sign-flip bug here silently
inverts collision resolution direction while still "detecting" every collision correctly.

**Continuous collision (CCD) is conservative sub-stepping, not full swept-shape math**
(`shared/src/physics/ContinuousCollision.ts`): if a tick's displacement exceeds half a
dynamic entity's own collider radius, `CollisionSystem` walks it from its pre-movement
position to its post-movement position in several smaller steps, testing narrowphase
against every other collider at each step and stopping (zeroing velocity) at the first
step that overlaps something. This is deliberately cheaper than a true swept-circle
solver and sufficient at this game's speed/scale — it reuses the same narrowphase
functions rather than needing separate swept-shape geometry.

**Broadphase** (`shared/src/physics/SpatialHashGrid.ts`) is a reusable-across-ticks
uniform grid — `clear()` empties existing bucket arrays in place (`.length = 0`, not a
new `Map`) so `CollisionSystem` doesn't allocate a fresh grid every tick.
`CollisionSystem` owns the pair-deduplication `Set` (entities spanning multiple shared
cells would otherwise be visited more than once) for the same reason — the grid itself
doesn't dedupe, since hashing an unordered id pair cheaply would need an allocation the
grid's own hot loop shouldn't pay for.

`applyKnockback()` (`shared/src/physics/Knockback.ts`) is a shared primitive — an
instantaneous velocity impulse away from a source point — used by nothing yet in Stage 1,
but deliberately factored out so a future `CombatSystem` (hit knockback) and
`CollisionSystem` (impact-response knockback, not yet wired in) share one implementation
instead of each reimplementing "normalize direction, scale by force."

### Camera easing (`client/src/camera/Camera2D.ts`)

Follows the locally-controlled entity using `Ease2D`/`easeOutQuad` over a fixed 0.4s
duration (`shared/src/math/Easing.ts`) rather than snapping directly to the target
position — call `follow(x, y)` once per frame to update the target, then `update(dt)` to
advance the ease; `x`/`y` getters read the current eased position. The follow target is
also clamped to the world bounds before being handed to the ease, so the camera never
shows space outside the playable area — this is a client-side visual-only clamp,
independent of and secondary to the server's authoritative `WorldBoundsSystem`. The
`Easing` module's free functions (`easeOutQuad`, `easeOutCubic`, `easeInOutQuad`, etc.)
and the generic `Ease`/`Ease2D` tween classes are reusable for any future eased value
(UI transitions, hit-flash, etc.), not camera-specific.

### Server tick pipeline (`packages/server/src/core/TickPipeline.ts`)

Maps to a 12-step conceptual pipeline (Input → Movement → Physics → Collision → AI →
Combat → Crafting → Inventory → Projectiles → Environment → Networking → Snapshot).
Actual registration order in `buildTickPipeline()`: `InputApplicationSystem` →
`PhysicsSystem` → `MovementSystem` → `CollisionSystem` → `WorldBoundsSystem` →
`SnapshotBroadcastSystem` — note `PhysicsSystem` runs before `MovementSystem` despite the
conceptual step numbers (see the "Physics & collision engine" section above for why; the
registration-order comment in `TickPipeline.ts` explains it inline too). The remaining
unimplemented steps (AI, Combat, Crafting, Inventory, Projectiles, Environment) are
documented, ordered insertion points in that file's comments, not placeholder no-op
systems — adding a later-stage system is one `registerSystem()` call inserted at the
matching position, not a restructure of `World` or this function.
`World.fixedUpdate()`'s system-array iteration order *is* the pipeline; there's no
separate pipeline data structure.

The tick loop itself (`shared/src/time/FixedTimestepLoop.ts`) uses an accumulator with
an injectable clock/scheduler specifically so it's unit-testable without real timers.
Don't replace it with a bare `setInterval` — accumulator drift-correction is why it
exists.

### Networking (`packages/protocol`, `server/src/network`, `client/src/network`)

Every packet: `opcode (u8) + flags (u8) + length (u16 LE) + payload`, `HEADER_SIZE = 4`.
Each packet type has its own file under `protocol/src/packets/` colocating the TS
interface, byte-layout comment, and `encode*`/`decode*` function pair, so both client and
server import the *same* encode/decode logic (not just the same types) and can't drift
apart. `PlayerInputPacket` carries direction as a raw `InputFlag` bitmask
(`Up | Down | Left | Right`, composed with `|=`), not four booleans — mirror this bitmask
pattern for future multi-flag fields rather than adding more boolean fields to packets.

**`BufferWriter`/`BufferReader` are function modules over a single module-scoped cursor —
no state object, no argument to pass at all.** `beginWrite(capacity)`/`beginRead(source)`
reset one shared `{ bytes, cursor }` pair private to each module; every operation
(`writeU8()`, `readF32()`, etc.) takes **zero arguments**, reading/writing that shared
cursor directly and advancing it — `endWrite()` returns the final bytes, `endRead()`
releases the reader. No class instantiation, no prototype-chain dispatch, and no
per-call/per-packet state argument or allocation at all, matching "avoid
allocations/indirection in the hot path."

**This is safe only for strictly sequential encode/decode — never nested or
interleaved.** Each module tracks an `inProgress` guard: calling `beginWrite()`/`beginRead()`
again before the previous one finished throws `WriteInProgressError`/`ReadInProgressError`
immediately, rather than silently corrupting both operations by sharing one cursor. Every
call site in this codebase already fits that shape — one packet's `encode*()` runs
`beginWrite()` → `write*()` calls → `endWrite()` to completion before anything else
touches the writer; `decodeAny()` wraps its `beginRead()`/`readHeader()`/`decode*()` in a
`try/finally` specifically so `endRead()` always runs even if decoding throws partway
through (bad opcode, truncated payload) — otherwise the guard would stay stuck and every
later `decodeAny()` call anywhere in the process would fail. **If a future need requires
decoding multiple packets concurrently or re-entrantly (not just sequentially, one at a
time), this design breaks and needs to go back to an explicit state object passed
per-call** — don't try to patch around it with more global state.

Multi-byte reads/writes are **manual little-endian bit composition on the underlying
`Uint8Array`, not `DataView`** — `DataView`'s per-call bounds-checking and endianness
handling measurably loses to direct byte-array access for the small, frequent field
reads/writes a binary game protocol does. u16/u32 use bit-shift/OR (`bytes[c] | (bytes[c+1] << 8)`
etc.); f32 uses a shared, reused `Float32Array`/`Uint8Array` pair aliasing the same
4-byte `ArrayBuffer` (write the float through the `Float32Array` view, read the same
bytes through the `Uint8Array` view) — a raw bit reinterpretation, not `DataView`'s call
overhead and not a hand-decomposed IEEE-754 sign/exponent/mantissa approach (which is
correct but pays for `Math.log2`/`Math.pow` on every call). Strings (`writeString`/
`readString`) are hand-rolled UTF-8 codecs too — no `TextEncoder`/`TextDecoder` — manually
walking UTF-16 code units (`charCodeAt`/`String.fromCharCode`) and composing/decomposing
1-4 byte UTF-8 sequences, including surrogate-pair handling for characters outside the
Basic Multilingual Plane (emoji, etc.). If you add a new primitive type to the protocol,
follow this same pattern — plain zero-argument function reading/writing the shared
cursor, explicit LE bit composition, no built-in codec object.

**Every wire packet is checksummed and XOR-obfuscated before it leaves the process.**
`protocol/src/security/PacketFraming.ts` wraps a fully-encoded frame (header + payload)
with `protect()` before it's sent and unwraps it with `unprotect()` before decoding:
- *Integrity*: an additive u16 checksum is appended after the frame and verified first;
  `unprotect()` throws `ChecksumMismatchError` for a corrupted or hand-crafted frame
  **before** any packet-specific decoding runs — this is what "validate packets" means at
  the transport layer, on top of the gameplay-level validation packet handlers still do.
- *Obfuscation*: the frame bytes are XORed against a fixed, compiled-in key before the
  checksum is computed. This is explicitly **not** cryptographic security — the key is a
  shared constant in both the client bundle and the server, so it stops passive network
  sniffing from reading the protocol's literal byte layout, not a determined attacker
  willing to extract the key from the client. Real auth/anti-cheat is a later stage.

This is wired in centrally, not per packet type: `finalizeForWire()` (re-exported from
`PacketCodec.ts`) calls `protect()` and is the last step before a frame reaches a socket
— `ClientConnection.send()`, `NetworkClient.send()`, and `WebSocketGateway.broadcast()`
(which protects once and reuses the result for every recipient, rather than redoing
identical work per connection) are the only call sites. `decodeAny()` calls `unprotect()`
first, then dispatches by opcode — so every inbound frame is integrity-checked
unconditionally before its opcode is even read. Packet-level `encode*()`/`decode*()`
functions know nothing about either concern; don't reach for `protect`/`unprotect`
inside a packet file, and don't skip `finalizeForWire()` when adding a new send call
site — an unprotected frame will fail the receiving side's checksum check.

**Input is event-driven, not sent on a fixed timer.** `KeyboardInputSource` tracks held
keys and calls its `onDirectionChange` listeners only when the composed bitmask actually
changes (a key transitions pressed/released) — `GameClient` sends a `PlayerInputPacket`
from that callback, not from a `setInterval`. There is deliberately no fixed-rate resend/
heartbeat: WebSocket is TCP-based, so packets aren't dropped in transit the way UDP
packets can be, and there's nothing new to tell the server between key transitions. On
the server, `ClientConnection.getLatestInput()` is a plain getter — the last-received
input persists across ticks rather than being cleared after one read, so
`InputApplicationSystem` keeps re-applying the same direction every tick until a new
packet arrives, which is what keeps movement continuous between the (now infrequent)
input packets instead of the entity stopping the instant a tick doesn't have a fresh one.

`codec/PacketCodec.ts`'s `decodeAny()`
is the single dispatch point both `server/network/PacketRouter.ts` and
`client/network/PacketHandlerRegistry.ts` route through; adding a packet type touches
exactly 3 files (opcode enum entry, packet file, `decodeAny` switch case).

Uses **`Bun.serve()`'s native WebSocket**, not standalone `uWebSockets.js` — Bun's own
WS implementation already wraps uSockets (the same engine uWebSockets.js wraps
separately), so this avoids an extra native binary dependency while keeping first-party
TypeScript support. Don't add `uWebSockets.js` as a dependency; extend
`WebSocketGateway` instead.

The client connects directly to the game server's WebSocket port (`ws://<host>:8081`,
see `client/src/bootstrap/ClientBootstrap.ts`'s `resolveWebSocketUrl()`) rather than
through a webpack-dev-server proxy. Don't add a dev-server proxy on `/ws` (or any path
webpack-dev-server's own HMR client might use) — webpack-dev-server's HMR WebSocket
defaults to `/ws`, and a proxy there previously hijacked every HMR reconnect attempt
into the game server's binary protocol, failing with "Invalid frame header".

### Client interpolation (`client/src/network/SnapshotBuffer.ts`)

The render loop (`requestAnimationFrame`, variable rate) and the input-send loop (fixed
interval, independent `setInterval`) are intentionally decoupled from each other and
from the server's tick rate. `SnapshotBuffer` buffers the last few `WorldSnapshotPacket`s
with arrival timestamps; `RenderSystem.onUpdate` samples it at `now - interpolationDelay`
and linearly interpolates between the two straddling snapshots, writing results into the
client-only `InterpolationComponent` (kept separate from `PositionComponent` so a future
client-prediction stage can treat `PositionComponent` as "predicted local state" without
colliding with interpolated remote state). This is snapshot interpolation only — there is
no client-side prediction/reconciliation yet; if you add it, it plugs in between input
sampling and `SnapshotBuffer` without needing to touch `RenderSystem` or the transport.

**The locally-controlled entity is exempt from interpolation delay.** `SnapshotBuffer.sample()`
takes an optional `snapEntityId` — `RenderSystem` passes `this.localEntityId` — and that
one entity is rendered from the single latest snapshot instead of the interpolated
(delayed) result. Without this, the local player's own movement looks laggy/glitchy on
every direction change: since its input is already instantaneous client-side, animating
it toward an always-slightly-stale interpolation target (the same ~interpolationDelay
remote entities use to smooth 30Hz updates) fights visually with the player's own input.
If you touch `SnapshotBuffer.sample()`, keep this distinction — remote entities need
interpolation to look smooth, the local entity needs to not have it.

### Database (`packages/server/src/database`)

`bun:sqlite` wrapped in a **hand-rolled Kysely `Dialect`** (`BunSqliteDialect.ts`), not a
community `kysely-bun-sqlite` package. Reuses Kysely's own `SqliteQueryCompiler`/
`SqliteAdapter`/`SqliteIntrospector` (the SQL dialect itself doesn't change) and supplies
only a `bun:sqlite`-flavored `Driver`, because `bun:sqlite`'s `Statement` lacks the
`reader` flag Kysely's built-in `SqliteDriver` (written for `better-sqlite3`) relies on
to distinguish SELECTs from writes — this driver instead checks the compiled query's
operation node (`SelectQueryNode.is(query)` or presence of a `returning` clause) to
decide whether to call `stmt.all()` vs `stmt.run()`. If `INSERT ... RETURNING` starts
throwing `NoResultError`, this is the first place to check — it means a write query with
a `.returning()`/`.returningAll()` clause isn't being classified as row-returning.

All SQL lives behind repository classes (`PlayerRepository` implementing
`IPlayerRepository`) — game/session logic never imports Kysely directly. This is what
makes the eventual SQLite → PostgreSQL swap (dev vs. prod, per the project's stated
direction) a matter of swapping the `Dialect` passed to `Kysely`'s constructor, not
rewriting call sites. Migrations are statically registered in
`database/migrations/index.ts` (`StaticMigrationProvider`) rather than Kysely's
directory-scanning `FileMigrationProvider`, so they work under Bun/bundlers without
relying on dynamic `import()` of a directory listing — add new migrations by importing
them into that file, following the numbered-filename convention.

### Regional server instances

`GameServer` (`server/src/core/GameServer.ts`) deliberately holds no module-level
singleton state — every dependency is constructed and owned by one `GameServer`
instance. This is intentional groundwork for eventually running multiple independent
regional game server instances behind a separate master/matchmaking service; don't
introduce global/static state into the server package that would prevent two
`GameServer` instances from running side by side in the same process.

### Production build & obfuscation

`configs/webpack/webpack.prod.js` runs full Terser property mangling (not just variable
mangling) using `configs/webpack/domprops.cjs` — a generated reserve-list of DOM/Web API
property names (from terser's own `tools/domprops.js`) — as the `mangle.properties.reserved`
list. This means **any object property name not in that reserved list gets renamed in
the production bundle.** Consequences for how code must be written:
- Never rely on property names as strings in logic (`obj['propertyName']`, `JSON.stringify`
  keyed access, `Object.keys()` for anything semantically meaningful) in client code —
  this is already consistent with using the binary protocol instead of JSON for all
  wire data, so it should stay a non-issue in practice.
- If a legitimate DOM/Web API property mangling breaks something, add it to
  `domprops.cjs` rather than disabling property mangling — regenerate from
  `https://raw.githubusercontent.com/terser/terser/master/tools/domprops.js` if it needs
  a refresh, converting the ESM `export var domprops` to `module.exports`.

**Prod deliberately does NOT code-split (`splitChunks: false`, `runtimeChunk: false`) —
this is required for property mangling to be safe, not a size/caching tradeoff made
lightly.** Terser's `mangle.properties` runs per emitted asset. Webpack 5 injects a
chunk-loading bootstrap (`__webpack_require__` and its internal runtime methods — short
auto-generated names like `.e`/`.O`) into *every* chunk file, and when TerserPlugin
mangles each chunk separately, it can assign a different replacement name to the same
webpack-internal property in different chunks — this broke the build with
`TypeError: t.vn is not a function` (webpack's own chunk-loading callback calling a
property Terser renamed inconsistently between the numbered async chunk and the runtime
chunk). This is a **documented Terser limitation with module bundlers**, not something
fixable via webpack config on the chunking side — Terser's own README warns against
combining property mangling with a bundler for this exact reason, and webpack's
maintainers have confirmed (in response to the identical symptom reported against
webpack itself) that it isn't fixable on their end either. Excluding just the runtime
chunk from the minimizer does **not** work — the vulnerable chunk-loading wrapper is
injected into every chunk, not only the dedicated runtime chunk. Keeping everything in
one file means Terser mangles the whole program in a single pass, so there's no
cross-file inconsistency possible. If bundle size or route-based code splitting becomes
a real need later, reintroducing `splitChunks` requires either dropping
`mangle.properties` entirely or moving property obfuscation to a pre-bundle,
scoped-to-your-own-source step (e.g. a TypeScript AST transform run before webpack sees
the code) instead of Terser's whole-bundle property mangling.

### Webpack config composition: don't merge in duplicate `module.rules`

`webpack-merge` **concatenates** `module.rules` arrays across configs rather than
replacing them by test pattern. `webpack.prod.js` used to define its own SCSS rules
(with `MiniCssExtractPlugin.loader` in place of dev's `style-loader`) and merge them on
top of `webpack.common.js`'s SCSS rules — every `.scss`/`.module.scss` file then matched
*both* rules and got run through two independent loader chains, and the second chain's
`sass-loader` would choke trying to parse the first chain's already-CSS-Modules-compiled
JS output ("expected `{`" on `export default {...}`). The fix: `createCommonConfig`
(`configs/webpack/webpack.common.js`) takes a `styleLoader` option (defaults to
`'style-loader'`) instead of `webpack.dev.js`/`webpack.prod.js` each defining their own
SCSS rules; `webpack.prod.js` passes `MiniCssExtractPlugin.loader` through that option
and only `merge()`s in genuinely new config (optimization, output filenames, the
`MiniCssExtractPlugin` plugin itself) — never a second set of rules matching a pattern
`webpack.common.js` already handles. If you need per-environment loader behavior for a
new file type, extend this same options-parameter pattern rather than adding a
`module.rules` entry via `merge()`. The `.ts` rule follows the identical pattern via
`postTsLoaders` (an array of extra loaders spliced in *before* `ts-loader` in the `use`
array — webpack loaders run right-to-left, so they end up processing `ts-loader`'s
output) — unused today (no prod-only `.ts` loader is applied), but if one is ever needed,
it goes through this option rather than a second `.ts` rule.

## Testing conventions

Spec files are colocated with source (`Foo.ts` + `Foo.spec.ts`), not in a parallel
`__tests__` tree. Protocol packet tests assert exact byte layout (including explicit
little-endian byte-order checks) and round-trip every field combination, not just the
happy path. ECS tests assert *ordering* (registration order = execution order) via
spy/recording systems, not just final state.
