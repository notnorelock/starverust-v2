import { Opcode, PROTOCOL_VERSION, encodeHello, type RejectionReason } from '@starve/protocol';
import { EntityType } from '@starve/shared';
import { listSpriteAssets } from '@starve/assets';
import { createClientWorld } from '../world/ClientWorldFactory';
import { registerPacketHandlers } from './PacketHandlerBindings';
import { WebGLCanvasProvider } from '../../engine/render/WebGLCanvasProvider';
import { SpriteRenderer } from '../../engine/render/SpriteRenderer';
import { ColorQuadRenderer } from '../../engine/render/ColorQuadRenderer';
import { TextTextureCache } from '../../engine/render/TextTextureCache';
import { EntityRenderer } from '../../engine/render/renderers/EntityRenderer';
import { loadSequentially, type LoadProgress } from '../../engine/loading/AssetLoader';
import { textureLoadTasks } from '../../engine/loading/TextureLoadTasks';
import { fontLoadTasks, type FontAsset } from '../../engine/loading/FontLoader';
import { Camera2D } from '../../engine/camera/Camera2D';
import { NetworkClient } from '../../engine/network/NetworkClient';
import { packetHandlerRegistry } from '../../engine/network/PacketHandlerRegistry';
import { MouseInputSource } from '../../engine/input/MouseInputSource';
import { DebugOverlay } from '../../engine/debug/DebugOverlay';
import { RenderSystem } from '../render/systems/RenderSystem';
import { PlayerRenderer, type PlayerTextures, type PlayerVariant } from '../render/renderers/PlayerRenderer';
import { GameClient } from '../core/GameClient';
import { localPlayer } from '../core/LocalPlayerDataStore';
import { CANVAS_PROVIDER, CAMERA_SERVICE, NETWORK_CLIENT } from '../core/ServiceKeys';

/**
 * No day/night cycle system exists yet (see CLAUDE.md's "documented insertion points, not
 * placeholder no-op systems" convention) — the day variant is hardcoded here rather than
 * computed from real game time; whatever later builds a day/night cycle swaps this
 * constant for a computed PlayerVariant instead of adding branching before that system
 * actually exists.
 */
const PLAYER_VARIANT: PlayerVariant = 'day';

/**
 * No custom web fonts exist in this project yet (see CLAUDE.md's "documented insertion
 * points, not placeholder no-op systems" convention) — everything today uses system font
 * stacks (see client/src/styles/global.scss). Left empty rather than omitted so the loading
 * screen's font phase, and fontLoadTasks() itself, are already wired in and start actually
 * loading/reporting progress the moment a real FontAsset is added here, with no other
 * changes needed.
 */
const FONTS: readonly FontAsset[] = [];

/** part name (see @starve/assets's SpriteAsset) -> which PlayerTextures field it fills. */
const PLAYER_PART_FIELD: Record<string, keyof PlayerTextures> = {
  default_head: 'head',
  default_left_arm: 'leftArm',
  default_right_arm: 'rightArm',
};

/**
 * Loads every asset @starve/assets bundles — every entity type, every variant, not just the
 * one PlayerVariant currently rendered — plus any declared custom fonts (see FONTS above),
 * sequentially with progress reporting (see AssetLoader). This is deliberately NOT filtered
 * down to "only what's currently wired to a renderer": @starve/assets today only has player
 * sprites, but listSpriteAssets() already auto-discovers whatever's added under its src/ (see
 * that package's own doc comment) — filtering this loader to a hardcoded entityType/variant
 * would silently stop loading (and stop showing progress for) any future entity type/variant
 * added there until someone remembered to update this file too, defeating the whole point of
 * that auto-discovery. Assets with no current consumer (e.g. the 'night' player variant, or a
 * future non-player entity type with no renderer yet) still load and report progress — the
 * loading screen's total legitimately reflects everything @starve/assets contains, not just
 * what's on screen today — they're just never assigned into `textures` below since nothing
 * reads a slot for them yet.
 *
 * Returns PlayerTextures for the active PLAYER_VARIANT once every task has settled (or
 * thrown, if any failed — see loadSequentially's AggregateError behavior) so the caller can
 * start actually showing the game only once assets are ready, instead of drawing untextured/
 * blank sprites for the first few frames.
 */
async function loadGameAssets(
  gl: WebGL2RenderingContext,
  activePlayerVariant: PlayerVariant,
  onProgress: (progress: LoadProgress) => void,
): Promise<PlayerTextures> {
  const textures: PlayerTextures = { head: undefined, leftArm: undefined, rightArm: undefined };

  const tasks = [
    ...textureLoadTasks(gl, listSpriteAssets(), (asset, texture) => {
      if (asset.entityType !== 'player' || asset.variant !== activePlayerVariant) {
        return;
      }
      const field = PLAYER_PART_FIELD[asset.part];
      if (field) {
        textures[field] = texture;
      }
    }),
    ...fontLoadTasks(FONTS),
  ];

  await loadSequentially(tasks, onProgress);
  return textures;
}

function resolveWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8081`;
}

export interface ClientBootstrap {
  gameClient: GameClient;
  /**
   * Loads every game asset (player sprite textures, any declared custom fonts — see
   * loadGameAssets()) sequentially, invoking `onProgress` after each one settles so a caller
   * (see client/src/index.ts) can drive a loading screen. Resolves once every asset has been
   * attempted (whether or not any individual one failed — see loadSequentially's
   * AggregateError behavior, which this rethrows). Player sprite textures render as soon as
   * they're loaded regardless of whether this has been called — PlayerRenderer already
   * tolerates undefined textures for a few frames (see its own doc comment) — this exists
   * purely to give the loading screen something real to report progress against before the
   * welcome overlay appears.
   */
  loadAssets: (onProgress: (progress: LoadProgress) => void) => Promise<void>;
  /**
   * Opens the WebSocket and sends HelloPacket once it's open, carrying `nickname`.
   * `onRejected` is invoked if the server refuses the connection (protocol version
   * mismatch or invalid nickname — see RejectionReason) instead of ever sending a
   * Handshake; the caller (see client/src/index.ts) is expected to show the reason in the
   * welcome overlay again and may call connect() again with a new nickname to retry — the
   * render stack built by bootstrapClient() is untouched by a rejection, only the network
   * connection itself.
   */
  connect: (nickname: string, onRejected: (reason: RejectionReason) => void) => void;
  /**
   * Registers `listener` to be called with `true` once Handshake assigns this client a
   * player (a real, playable session — not just a raw open socket, which a Hello/Handshake
   * round-trip hasn't necessarily completed for yet) and `false` whenever the socket
   * subsequently closes. Used by client/src/index.ts to gate ChatBox's `enabled` prop, so
   * chat can't be opened (and is force-closed if already open) while there's no session to
   * actually send a message through — see GameClient.sendChatMessage()'s own isConnected
   * guard, which this is a UI-visible complement to rather than a replacement for.
   */
  onSessionChange: (listener: (active: boolean) => void) => void;
}

/**
 * Wires up the full client stack and starts local simulation/rendering/input immediately
 * — GameClient.start() runs here, so the canvas renders (an empty world, camera at its
 * default position) the instant this is called, before any nickname exists or connection
 * is attempted. Opening the actual network connection is a separate step: call the
 * returned `connect()` once the player has submitted a nickname via the welcome overlay.
 * The server itself mirrors this split — it creates no player entity and sends nothing
 * back until HelloPacket arrives (see PlayerSession.onHelloReceived) — so nothing here can
 * render a real entity before Handshake arrives regardless of when connect() is called.
 */
export function bootstrapClient(mountPoint: HTMLElement): ClientBootstrap {
  const world = createClientWorld();

  const canvasProvider = new WebGLCanvasProvider(mountPoint);
  const camera = new Camera2D(window.innerWidth, window.innerHeight);

  world.services.register(CANVAS_PROVIDER, canvasProvider);
  world.services.register(CAMERA_SERVICE, camera);

  // WebGLCanvasProvider resizes the canvas element itself on window resize (see its own
  // constructor), but knows nothing about Camera2D — without this, worldToScreen()'s
  // viewport-centering math and follow()'s boundary clamp would keep using the stale
  // dimensions the camera was constructed with, drifting out of sync with the actual
  // (now-resized) canvas and visibly misplacing every rendered entity relative to the
  // player.
  window.addEventListener('resize', () => camera.resize(window.innerWidth, window.innerHeight));

  // Exactly one instance of each per canvas — shared by every EntityRenderer (see the
  // renderers map below) AND by RenderSystem itself (see its own doc comment for why this
  // must be the SAME instance in both places: two separate SpriteRenderers would compile
  // two separate GL programs, and a renderer's draw() calls would then target whichever
  // program RenderSystem's beginFrame() last bound — a different one from the renderer's
  // own uniform locations, which is invalid).
  const sprites = new SpriteRenderer(canvasProvider.gl);
  const colorQuads = new ColorQuadRenderer(canvasProvider.gl);
  const textCache = new TextTextureCache(canvasProvider.gl);

  // Texture loading (see TextureLoader) is inherently async — the images have to actually
  // download/decode before they exist as GPU data — so PlayerRenderer receives a getter
  // closure rather than a PlayerTextures value it could read before loadGameAssets()'s
  // promise resolves. It draws nothing for any part still missing (nickname/chat text
  // still draw regardless) until each resolves, rather than bootstrapClient() blocking
  // startup on every texture load finishing first — matching this file's own doc comment
  // that GameClient.start() runs immediately, before any nickname/connection exists. The
  // caller (see client/src/index.ts) additionally calls the returned loadAssets() to drive a
  // loading screen, but this mutable binding is what PlayerRenderer's closure actually reads
  // from every frame regardless of whether/when that's been called.
  let playerTextures: PlayerTextures = { head: undefined, leftArm: undefined, rightArm: undefined };

  async function loadAssets(onProgress: (progress: LoadProgress) => void): Promise<void> {
    playerTextures = await loadGameAssets(canvasProvider.gl, PLAYER_VARIANT, onProgress);
  }

  // One EntityRenderer per EntityType RenderSystem might encounter — see EntityRenderer's
  // own doc comment for why this dispatch-by-type exists instead of one system doing every
  // entity's drawing inline. WorldGeometry has no renderer yet (nothing draws it today,
  // matching the pre-split behavior) — add one here when it needs a visual.
  const renderers = new Map<EntityType, EntityRenderer>([
    [EntityType.Player, new PlayerRenderer(sprites, textCache, () => playerTextures)],
  ]);

  // localPlayer().screenPosition is written by RenderSystem every frame (it's the one
  // place that already computes screen positions via Camera2D) — read lazily here via a
  // closure rather than injecting Camera2D position math directly into this input source,
  // keeping MouseInputSource (src/engine) ignorant of rendering and of game-specific state
  // (LocalPlayerDataStore lives in src/game) entirely.
  const mouseInput = new MouseInputSource(() => localPlayer().screenPosition);

  // RenderSystem also reads mouseInput directly (not just GameClient) so the local
  // player's own facing is drawn from the live mouse angle instead of the network-
  // interpolated one every remote player uses — see RenderSystem's own doc comment.
  const renderSystem = new RenderSystem(canvasProvider, camera, renderers, mouseInput, sprites, colorQuads);
  world.registerSystem(renderSystem);

  // Plain callback list rather than a full pub/sub abstraction — onSessionChange has exactly
  // one consumer today (client/src/index.ts, gating ChatBox's `enabled` prop) and this
  // mirrors the rest of this file's style (packet handlers as plain closures) rather than
  // introducing a generic event-bus dependency for a single signal.
  const sessionChangeListeners: Array<(active: boolean) => void> = [];
  function notifySessionChange(active: boolean): void {
    for (const listener of sessionChangeListeners) {
      listener(active);
    }
  }

  const networkClient = new NetworkClient({
    url: resolveWebSocketUrl(),
    handlers: packetHandlerRegistry(),
    onClose: () => notifySessionChange(false),
  });
  world.services.register(NETWORK_CLIENT, networkClient);

  const debugOverlay = new DebugOverlay(mountPoint);

  const gameClient = new GameClient(world, networkClient, mouseInput, debugOverlay);
  gameClient.start();

  registerPacketHandlers({ world, camera, gameClient, notifySessionChange });

  function connect(nickname: string, onRejected: (reason: RejectionReason) => void): void {
    packetHandlerRegistry().on(Opcode.ConnectionRejected, (packet) => {
      onRejected(packet.reason);
    });
    networkClient.connect(() => {
      networkClient.send(encodeHello({ protocolVersion: PROTOCOL_VERSION, nickname }));
    });
  }

  function onSessionChange(listener: (active: boolean) => void): void {
    sessionChangeListeners.push(listener);
  }

  return { gameClient, loadAssets, connect, onSessionChange };
}
