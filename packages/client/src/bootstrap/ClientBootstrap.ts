import { Opcode, PROTOCOL_VERSION, encodeHello, type RejectionReason } from '@starve/protocol';
import { EntityType } from '@starve/shared';
import { createClientWorld } from '../world/ClientWorldFactory';
import { CanvasContext2DProvider } from '../render/CanvasContext2DProvider';
import { Renderer } from '../render/Renderer';
import { RenderSystem } from '../render/systems/RenderSystem';
import { Camera2D } from '../camera/Camera2D';
import { SnapshotBuffer } from '../network/SnapshotBuffer';
import { EntityTypeRegistry } from '../network/EntityTypeRegistry';
import { NetworkClient } from '../network/NetworkClient';
import { PacketHandlerRegistry } from '../network/PacketHandlerRegistry';
import { KeyboardInputSource } from '../input/KeyboardInputSource';
import { DebugOverlay } from '../debug/DebugOverlay';
import { GameClient } from '../core/GameClient';
import { CANVAS_PROVIDER, CAMERA_SERVICE, SNAPSHOT_BUFFER, NETWORK_CLIENT } from '../core/ServiceKeys';

function resolveWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8081`;
}

export interface BootstrapClientOptions {
  /** The player's chosen nickname, collected by the welcome overlay before this is called. */
  nickname: string;
  /**
   * Invoked if the server refuses the connection (protocol version mismatch or invalid
   * nickname — see RejectionReason) instead of ever sending a Handshake. The caller (see
   * client/src/index.ts) is expected to tear this bootstrap down and show the reason in
   * the welcome overlay again, since there is no game to run without an assigned entity.
   */
  onRejected: (reason: RejectionReason) => void;
}

/**
 * Wires up the full client stack and opens the connection. HelloPacket (carrying
 * PROTOCOL_VERSION and the player's nickname) is sent the instant the socket opens — the
 * server creates no player entity and sends nothing back until it arrives (see
 * PlayerSession.onHelloReceived) — so nothing here can render a real entity before
 * Handshake arrives regardless of when GameClient.start() happens to run.
 */
export function bootstrapClient(mountPoint: HTMLElement, options: BootstrapClientOptions): GameClient {
  const world = createClientWorld();

  const canvasProvider = new CanvasContext2DProvider(mountPoint);
  const renderer = new Renderer(canvasProvider);
  const camera = new Camera2D(window.innerWidth, window.innerHeight);
  const snapshotBuffer = new SnapshotBuffer();
  const entityTypes = new EntityTypeRegistry();

  world.services.register(CANVAS_PROVIDER, canvasProvider);
  world.services.register(CAMERA_SERVICE, camera);
  world.services.register(SNAPSHOT_BUFFER, snapshotBuffer);

  const renderSystem = new RenderSystem(canvasProvider, renderer, camera, snapshotBuffer, entityTypes);
  world.registerSystem(renderSystem);

  const handlers = new PacketHandlerRegistry();
  const networkClient = new NetworkClient({
    url: resolveWebSocketUrl(),
    handlers,
    onOpen: () => {
      networkClient.send(encodeHello({ protocolVersion: PROTOCOL_VERSION, nickname: options.nickname }));
    },
  });
  world.services.register(NETWORK_CLIENT, networkClient);

  const inputSource = new KeyboardInputSource();
  const debugOverlay = new DebugOverlay(mountPoint);

  const gameClient = new GameClient(world, networkClient, inputSource, snapshotBuffer, debugOverlay);

  handlers.on(Opcode.ConnectionRejected, (packet) => {
    options.onRejected(packet.reason);
  });

  handlers.on(Opcode.Handshake, (packet) => {
    renderSystem.localEntityId = packet.assignedEntityId;
    camera.setBounds({
      minX: packet.worldMinX,
      maxX: packet.worldMaxX,
      minY: packet.worldMinY,
      maxY: packet.worldMaxY,
    });
  });

  // Sent once, right after connecting — seeds initial render state for every entity that
  // already existed, before this connection's first (spatially-filtered) EntityUpdate
  // arrives. See PlayerSession.onConnectionEstablished / SnapshotBuffer.seed(). Also
  // self-contained for entityType (unlike EntityUpdatePacket) so this doesn't depend on
  // the separate EntityInsert catch-up loop having already run first.
  handlers.on(Opcode.WorldSnapshot, (packet) => {
    snapshotBuffer.seed(packet);
    for (const entity of packet.entities) {
      entityTypes.insert(entity.entityId, entity.entityType as EntityType);
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
  });

  return gameClient;
}
