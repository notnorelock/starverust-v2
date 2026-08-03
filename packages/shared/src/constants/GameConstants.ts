/** Default authoritative simulation rate; overridable server-side via TICK_RATE env var. */
export const DEFAULT_TICK_RATE = 20;

/** Movement speed in world units/second applied by InputApplicationSystem. */
export const PLAYER_MOVE_SPEED = 200;

/**
 * Movement speed in world units/second applied instead of PLAYER_MOVE_SPEED while
 * InputFlag.Sprint is held (see InputApplicationSystem). The client's own chase speed
 * (see SnapshotBuffer) doesn't need to know this constant directly — it reads each
 * entity's actual current speed off WorldSnapshotPacket instead, which is what lets the
 * render position keep pace during a sprint without hardcoding the multiplier client-side.
 */
export const PLAYER_SPRINT_SPEED = 350;

/**
 * How often MovementSystem advances PositionComponent (the movement target), in ticks —
 * matches a reference implementation's 120ms movement throttle (roughly 2 ticks at that
 * project's ~61ms tick), ported as a tick count rather than a wall-clock duration so it
 * scales correctly with this server's own TICK_RATE instead of assuming a specific rate.
 */
export const MOVEMENT_TARGET_INTERVAL_TICKS = 2;

/**
 * Constant speed, in world units/second, at which RenderPositionComponent (the
 * broadcast-facing position) chases PositionComponent (the target) every tick — see
 * PositionSmoothingSystem. Ported from the reference implementation's lerp() step size,
 * but scaled well above PLAYER_MOVE_SPEED (not just barely above it) specifically so the
 * chase always has slack to fully close the gap between one throttled target jump and the
 * next, even right after an input direction change — a chase speed only marginally faster
 * than the target's own advance leaves near-zero margin, which reads as small stutters
 * whenever the target's direction changes mid-chase.
 */
export const RENDER_POSITION_CHASE_SPEED = 900;

/**
 * World-unit distance threshold (client-side) beyond which a newly-received snapshot
 * position is treated as a teleport rather than normal movement — the rendered position
 * snaps straight to it instead of chasing it at PLAYER_MOVE_SPEED, which would otherwise
 * look like a slow slide across the map. Ported from the reference client's
 * `CLIENT.LAG_DISTANCE` (200), used the same way: compared against the distance between
 * the entity's currently-rendered position and its newly-received network position.
 */
export const CLIENT_POSITION_SNAP_DISTANCE = 200;
