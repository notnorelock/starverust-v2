import { Opcode, PROTOCOL_VERSION, encodeHello, type RejectionReason } from '@starve/protocol';
import { EntityType } from '@starve/shared';
import { spritePartUrl } from '@starve/assets';
import { createClientWorld } from '../world/ClientWorldFactory';
import { registerPacketHandlers } from './PacketHandlerBindings';
import { WebGLCanvasProvider } from '../../engine/render/WebGLCanvasProvider';
import { SpriteRenderer } from '../../engine/render/SpriteRenderer';
import { ColorQuadRenderer } from '../../engine/render/ColorQuadRenderer';
import { TextTextureCache } from '../../engine/render/TextTextureCache';
import { loadTexture } from '../../engine/render/TextureLoader';
import { EntityRenderer } from '../../engine/render/renderers/EntityRenderer';
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

/** Loads all three player part textures for `variant`, resolving once every part has loaded. */
async function loadPlayerTextures(gl: WebGL2RenderingContext, variant: PlayerVariant): Promise<PlayerTextures> {
  const [head, leftArm, rightArm] = await Promise.all([
    loadTexture(gl, spritePartUrl('player', variant, 'default_head')),
    loadTexture(gl, spritePartUrl('player', variant, 'default_left_arm')),
    loadTexture(gl, spritePartUrl('player', variant, 'default_right_arm')),
  ]);
  return { head, leftArm, rightArm };
}

function resolveWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8081`;
}

export interface ClientBootstrap {
  gameClient: GameClient;
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
  // closure rather than a PlayerTextures value it could read before loadPlayerTextures()'s
  // promise resolves. It draws nothing for any part still missing (nickname/chat text
  // still draw regardless) until each resolves, rather than bootstrapClient() blocking
  // startup on every texture load finishing first — matching this file's own doc comment
  // that GameClient.start() runs immediately, before any nickname/connection exists.
  let playerTextures: PlayerTextures = { head: undefined, leftArm: undefined, rightArm: undefined };
  void loadPlayerTextures(canvasProvider.gl, PLAYER_VARIANT).then((textures) => {
    playerTextures = textures;
  });

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

  return { gameClient, connect, onSessionChange };
}
