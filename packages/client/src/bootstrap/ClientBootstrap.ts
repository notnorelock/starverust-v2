import { Opcode, PROTOCOL_VERSION, encodeHello, type RejectionReason } from '@starve/protocol';
import { EntityType } from '@starve/shared';
import { createClientWorld } from '../world/ClientWorldFactory';
import { CanvasContext2DProvider } from '../render/CanvasContext2DProvider';
import { Renderer } from '../render/Renderer';
import { RenderSystem } from '../render/systems/RenderSystem';
import { EntityRenderer } from '../render/renderers/EntityRenderer';
import { PlayerRenderer } from '../render/renderers/PlayerRenderer';
import { Camera2D } from '../camera/Camera2D';
import { SnapshotBuffer } from '../network/SnapshotBuffer';
import { EntityTypeRegistry } from '../network/EntityTypeRegistry';
import { NicknameRegistry } from '../network/NicknameRegistry';
import { ChatBubbleStore } from '../network/ChatBubbleStore';
import { NetworkClient } from '../network/NetworkClient';
import { PacketHandlerRegistry } from '../network/PacketHandlerRegistry';
import { KeyboardInputSource } from '../input/KeyboardInputSource';
import { MouseAngleInputSource } from '../input/MouseAngleInputSource';
import { DebugOverlay } from '../debug/DebugOverlay';
import { GameClient } from '../core/GameClient';
import { LocalPlayerDataStore } from '../core/LocalPlayerDataStore';
import { CANVAS_PROVIDER, CAMERA_SERVICE, SNAPSHOT_BUFFER, NETWORK_CLIENT, LOCAL_PLAYER_DATA } from '../core/ServiceKeys';

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
  const snapshotBuffer = new SnapshotBuffer();
  const entityTypes = new EntityTypeRegistry();
  const nicknames = new NicknameRegistry();
  const chatBubbles = new ChatBubbleStore();
  const localPlayer = new LocalPlayerDataStore();

  world.services.register(CANVAS_PROVIDER, canvasProvider);
  world.services.register(CAMERA_SERVICE, camera);
  world.services.register(SNAPSHOT_BUFFER, snapshotBuffer);
  world.services.register(LOCAL_PLAYER_DATA, localPlayer);

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
  const renderers = new Map<EntityType, EntityRenderer>([
    [EntityType.Player, new PlayerRenderer(canvasProvider, nicknames, chatBubbles)],
  ]);

  const keyboardInput = new KeyboardInputSource();
  // localPlayer.screenPosition is written by RenderSystem every frame (it's the one place
  // that already computes screen positions via Camera2D) — read lazily here via a closure
  // rather than injecting Camera2D/localPlayer position math directly into this input
  // source, keeping MouseAngleInputSource ignorant of rendering entirely.
  const mouseAngleInput = new MouseAngleInputSource(() => localPlayer.screenPosition);

  // RenderSystem also reads mouseAngleInput directly (not just GameClient) so the local
  // player's own facing is drawn from the live mouse angle instead of the network-
  // interpolated one every remote player uses — see RenderSystem's own doc comment.
  const renderSystem = new RenderSystem(
    canvasProvider,
    renderer,
    camera,
    snapshotBuffer,
    entityTypes,
    localPlayer,
    renderers,
    mouseAngleInput,
    chatBubbles,
  );
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

  const handlers = new PacketHandlerRegistry();
  const networkClient = new NetworkClient({
    url: resolveWebSocketUrl(),
    handlers,
    onClose: () => notifySessionChange(false),
  });
  world.services.register(NETWORK_CLIENT, networkClient);

  const debugOverlay = new DebugOverlay(mountPoint);

  const gameClient = new GameClient(
    world,
    networkClient,
    keyboardInput,
    mouseAngleInput,
    snapshotBuffer,
    debugOverlay,
    localPlayer,
    chatBubbles,
  );
  gameClient.start();

  handlers.on(Opcode.Handshake, (packet) => {
    localPlayer.entityId = packet.assignedEntityId;
    localPlayer.pid = packet.assignedPid;
    camera.setBounds({
      minX: packet.worldMinX,
      maxX: packet.worldMaxX,
      minY: packet.worldMinY,
      maxY: packet.worldMaxY,
    });
    notifySessionChange(true);
  });

  // Sent once, right after connecting — seeds initial render state for every entity that
  // already existed, before this connection's first (spatially-filtered) EntityUpdate
  // arrives. See PlayerSession.onHelloReceived / SnapshotBuffer.seed(). Also
  // self-contained for entityType and nickname (unlike EntityUpdatePacket) so this doesn't
  // depend on the separate EntityInsert/PlayerJoin catch-up loops having already run first
  // — see WorldSnapshotEntity's own doc comment for why nickname is embedded here too.
  handlers.on(Opcode.WorldSnapshot, (packet) => {
    snapshotBuffer.seed(packet);
    for (const entity of packet.entities) {
      entityTypes.insert(entity.entityId, entity.entityType as EntityType);
      if (entity.nickname) {
        nicknames.insert(entity.ownerPid, entity.entityId, entity.nickname);
      }
    }
  });

  // The recurring, per-connection, spatially-filtered stream — see InterestManagementSystem.
  handlers.on(Opcode.EntityUpdate, (packet) => {
    snapshotBuffer.push(packet);
    gameClient.onServerTick(packet.serverTick);
  });

  // Entity lifecycle: broadcast once when an entity is created (including, for a freshly
  // connected client, once per entity that already existed — see PlayerSession) or
  // destroyed. entityType is carried on this and on WorldSnapshotPacket, never on the
  // high-frequency EntityUpdatePacket — RenderSystem reads it from entityTypes when it
  // first spawns an entity's visual (see RenderSystem.ensureInterpolatedEntity), so future
  // NPC/mob types can render distinctly instead of every entity defaulting to the player's
  // appearance.
  handlers.on(Opcode.EntityInsert, (packet) => {
    entityTypes.insert(packet.entityId, packet.entityType as EntityType);
  });

  handlers.on(Opcode.EntityDestroy, (packet) => {
    world.entities.destroyEntity(packet.entityId);
    snapshotBuffer.remove(packet.entityId);
    entityTypes.remove(packet.entityId);
    chatBubbles.remove(packet.entityId);
  });

  // Player identity lifecycle — pid+nickname, separate from the generic entity lifecycle
  // above (see PlayerJoinPacket/PlayerLeftPacket's own doc comments for why). Feeds
  // NicknameRegistry, which PlayerRenderer reads when drawing the name label.
  handlers.on(Opcode.PlayerJoin, (packet) => {
    nicknames.insert(packet.pid, packet.entityId, packet.nickname);
  });

  handlers.on(Opcode.PlayerLeft, (packet) => {
    nicknames.remove(packet.pid);
  });

  // Round-trip latency measurement — see PingPacket/PongPacket's own doc comments and
  // GameClient's sendPing()/onPong().
  handlers.on(Opcode.Pong, (packet) => {
    gameClient.onPong(packet.clientSendTime);
  });

  // ChatBroadcastPacket carries only pid (see its own doc comment) — resolve to entityId via
  // NicknameRegistry (already pid-keyed internally) so the bubble attaches to the right
  // player. Silently dropped if the pid isn't known yet (e.g. a race with PlayerJoin), same
  // as PlayerRenderer already silently omitting a nickname it hasn't learned yet. The
  // sender's own message is NOT pushed here — GameClient echoes it locally the instant it's
  // sent (see sendChatMessage()), same as the reference client's immediate local echo,
  // rather than waiting for this broadcast to round-trip back to the sender too.
  handlers.on(Opcode.ChatBroadcast, (packet) => {
    if (packet.pid === localPlayer.pid) {
      return;
    }
    const entityId = nicknames.entityIdForPid(packet.pid);
    if (entityId !== undefined) {
      chatBubbles.push(entityId, packet.text);
    }
  });

  function connect(nickname: string, onRejected: (reason: RejectionReason) => void): void {
    handlers.on(Opcode.ConnectionRejected, (packet) => {
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
