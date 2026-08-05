import { Opcode } from '@starve/protocol';
import { EntityType, type World } from '@starve/shared';
import type { Camera2D } from '../../engine/camera/Camera2D';
import { packetHandlerRegistry } from '../../engine/network/PacketHandlerRegistry';
import { snapshotBuffer } from '../network/SnapshotBuffer';
import { entityTypeRegistry } from '../network/EntityTypeRegistry';
import { nicknameRegistry } from '../network/NicknameRegistry';
import { chatBubbleStore } from '../network/ChatBubbleStore';
import type { GameClient } from '../core/GameClient';
import { localPlayer } from '../core/LocalPlayerDataStore';

export interface PacketHandlerBindingsDeps {
  world: World;
  camera: Camera2D;
  gameClient: GameClient;
  notifySessionChange: (active: boolean) => void;
}

/**
 * Registers every inbound-packet handler against packetHandlerRegistry() — split out of
 * ClientBootstrap purely to keep that file's construction/wiring sequence readable;
 * these bindings are still logically part of bootstrap (they close over the same
 * dependencies bootstrapClient() constructs) and have exactly one call site.
 *
 * ConnectionRejected is deliberately NOT registered here — it's re-registered on every
 * connect() call with that call's own `onRejected` callback (see ClientBootstrap), so it
 * stays alongside connect() instead of here.
 */
export function registerPacketHandlers(deps: PacketHandlerBindingsDeps): void {
  const { world, camera, gameClient, notifySessionChange } = deps;
  const handlers = packetHandlerRegistry();

  handlers.on(Opcode.Handshake, (packet) => {
    localPlayer().entityId = packet.assignedEntityId;
    localPlayer().pid = packet.assignedPid;
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
    snapshotBuffer().seed(packet);
    for (const entity of packet.entities) {
      entityTypeRegistry().insert(entity.entityId, entity.entityType as EntityType);
      if (entity.nickname) {
        nicknameRegistry().insert(entity.ownerPid, entity.entityId, entity.nickname);
      }
    }
  });

  // The recurring, per-connection, spatially-filtered stream — see InterestManagementSystem.
  handlers.on(Opcode.EntityUpdate, (packet) => {
    snapshotBuffer().push(packet);
    gameClient.onServerTick(packet.serverTick);
  });

  // Entity lifecycle: broadcast once when an entity is created (including, for a freshly
  // connected client, once per entity that already existed — see PlayerSession) or
  // destroyed. entityType is carried on this and on WorldSnapshotPacket, never on the
  // high-frequency EntityUpdatePacket — RenderSystem reads it from entityTypeRegistry()
  // when it first spawns an entity's visual (see RenderSystem.ensureInterpolatedEntity), so
  // future NPC/mob types can render distinctly instead of every entity defaulting to the
  // player's appearance.
  handlers.on(Opcode.EntityInsert, (packet) => {
    entityTypeRegistry().insert(packet.entityId, packet.entityType as EntityType);
  });

  handlers.on(Opcode.EntityDestroy, (packet) => {
    world.entities.destroyEntity(packet.entityId);
    snapshotBuffer().remove(packet.entityId);
    entityTypeRegistry().remove(packet.entityId);
    chatBubbleStore().remove(packet.entityId);
  });

  // Player identity lifecycle — pid+nickname, separate from the generic entity lifecycle
  // above (see PlayerJoinPacket/PlayerLeftPacket's own doc comments for why). Feeds
  // NicknameRegistry, which PlayerRenderer reads when drawing the name label.
  handlers.on(Opcode.PlayerJoin, (packet) => {
    nicknameRegistry().insert(packet.pid, packet.entityId, packet.nickname);
  });

  handlers.on(Opcode.PlayerLeft, (packet) => {
    nicknameRegistry().remove(packet.pid);
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
    if (packet.pid === localPlayer().pid) {
      return;
    }
    const entityId = nicknameRegistry().entityIdForPid(packet.pid);
    if (entityId !== undefined) {
      chatBubbleStore().push(entityId, packet.text);
    }
  });
}
