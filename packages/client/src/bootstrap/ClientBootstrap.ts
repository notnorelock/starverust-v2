import { Opcode, PROTOCOL_VERSION, encodeHello, type RejectionReason } from '@starve/protocol';
import { EntityType } from '@starve/shared';
import { createClientWorld } from '../world/ClientWorldFactory';
import { registerPacketHandlers } from './PacketHandlerBindings';
import { CanvasContext2DProvider } from '../render/CanvasContext2DProvider';
import { Renderer } from '../render/Renderer';
import { RenderSystem } from '../render/systems/RenderSystem';
import { EntityRenderer } from '../render/renderers/EntityRenderer';
import { PlayerRenderer } from '../render/renderers/PlayerRenderer';
import { Camera2D } from '../camera/Camera2D';
import { NetworkClient } from '../network/NetworkClient';
import { packetHandlerRegistry } from '../network/PacketHandlerRegistry';
import { DebugOverlay } from '../debug/DebugOverlay';
import { GameClient } from '../core/GameClient';
import { CANVAS_PROVIDER, CAMERA_SERVICE, NETWORK_CLIENT } from '../core/ServiceKeys';

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

  const canvasProvider = new CanvasContext2DProvider(mountPoint);
  const renderer = new Renderer(canvasProvider);
  const camera = new Camera2D(window.innerWidth, window.innerHeight);

  world.services.register(CANVAS_PROVIDER, canvasProvider);
  world.services.register(CAMERA_SERVICE, camera);

  // CanvasContext2DProvider resizes the canvas element itself on window resize (see its own
  // constructor), but knows nothing about Camera2D — without this, worldToScreen()'s
  // viewport-centering math and follow()'s boundary clamp would keep using the stale
  // dimensions the camera was constructed with, drifting out of sync with the actual
  // (now-resized) canvas and visibly misplacing every rendered entity relative to the
  // player.
  window.addEventListener('resize', () => camera.resize(window.innerWidth, window.innerHeight));

  // One EntityRenderer per EntityType RenderSystem might encounter — see EntityRenderer's
  // own doc comment for why this dispatch-by-type exists instead of one system doing every
  // entity's drawing inline. WorldGeometry has no renderer yet (nothing draws it today,
  // matching the pre-split behavior) — add one here when it needs a visual.
  const renderers = new Map<EntityType, EntityRenderer>([[EntityType.Player, new PlayerRenderer(canvasProvider)]]);

  // RenderSystem also reads mouseInput() directly (not just GameClient) so the local
  // player's own facing is drawn from the live mouse angle instead of the network-
  // interpolated one every remote player uses — see RenderSystem's own doc comment.
  const renderSystem = new RenderSystem(canvasProvider, renderer, camera, renderers);
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

  const gameClient = new GameClient(world, networkClient, debugOverlay);
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
