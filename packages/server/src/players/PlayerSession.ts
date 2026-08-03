import {
  Logger,
  PositionComponent,
  EntityTypeComponent,
  EntityType,
  EntityOwnerComponent,
  type World,
  type WorldBounds,
} from '@starve/shared';
import {
  PROTOCOL_VERSION,
  RejectionReason,
  NO_OWNER_PID,
  encodeHandshake,
  encodeEntityInsert,
  encodeEntityDestroy,
  encodeConnectionRejected,
  type HelloPacket,
} from '@starve/protocol';
import type { ClientConnection } from '../network/ClientConnection';
import type { NetworkService } from '../network/NetworkService';
import type { ConnectionRegistry } from '../network/ConnectionRegistry';
import type { IPlayerRepository } from '../database/repositories/IPlayerRepository';
import { createPlayerEntity } from '../entities/PlayerEntityFactory';
import { serializeWorldSnapshot } from '../serialization/SnapshotSerializer';
import type { WorldConfig } from '../world/WorldConfig';

const logger = new Logger('PlayerSession');

const MIN_NICKNAME_LENGTH = 3;
const MAX_NICKNAME_LENGTH = 16;

/** True if `nickname` passes server-side validation — never trust the client's own checks alone. */
export function isValidNickname(nickname: string): boolean {
  const trimmed = nickname.trim();
  return trimmed.length >= MIN_NICKNAME_LENGTH && trimmed.length <= MAX_NICKNAME_LENGTH;
}

/**
 * Orchestrates what happens once a connection's HelloPacket arrives — the first and only
 * client->server packet the server will act on before a player entity exists (see
 * PacketRouter's onHello callback). A raw socket `open` alone creates no player and sends
 * nothing; only a valid Hello does. Two things can reject a Hello outright, each ending
 * with a ConnectionRejectedPacket followed by closing the socket, no player entity ever
 * created: a protocolVersion that doesn't match this build's PROTOCOL_VERSION (see
 * ConnectionRejectedPacket's own doc comment for why that check exists), or a nickname
 * that fails isValidNickname().
 *
 * Once past validation: proves the persistence layer end-to-end with the player's chosen
 * nickname (real auth is a later stage — this is still effectively a guest account, just
 * named by the player instead of auto-generated), spawns the player's entity in the World,
 * and sends the Handshake packet assigning it.
 *
 * Entity lifecycle is explicit, not inferred from packet presence — see
 * EntityInsertPacket/EntityDestroyPacket. Two things follow from that here: the new
 * player's own entity is broadcast as an EntityInsert to every already-connected client
 * (they'd otherwise never learn about it until InterestManagementSystem's next tick
 * happened to put it in range, which isn't guaranteed the way "you always learn about
 * every entity that exists" was under the old broadcast-everything model), and the new
 * connection itself is sent an EntityInsert for every entity that already existed before
 * it connected (world geometry, other players) — it has no other way to learn about them
 * otherwise, since neither InterestManagementSystem's recurring EntityUpdatePacket nor a
 * one-time WorldSnapshotPacket carries entityType.
 *
 * WorldSnapshotPacket itself is sent once here, right after the EntityInsert catch-up
 * loop, carrying every existing entity's initial position/speed — this seeds the new
 * connection's client-side render state before its first (spatially-filtered, so possibly
 * sparse) EntityUpdatePacket arrives a tick later.
 */
export async function onHelloReceived(
  connection: ClientConnection,
  hello: HelloPacket,
  world: World,
  playerRepository: IPlayerRepository,
  tickRate: number,
  worldConfig: WorldConfig,
  worldBounds: WorldBounds,
  network: NetworkService,
  connections: ConnectionRegistry,
): Promise<void> {
  if (connection.entityId !== undefined) {
    return; // Already spawned for this connection — ignore a duplicate/replayed Hello.
  }

  if (hello.protocolVersion !== PROTOCOL_VERSION) {
    logger.warn(
      `Rejecting connection=${connection.connectionId}: protocolVersion=${hello.protocolVersion}, expected ${PROTOCOL_VERSION}`,
    );
    connection.send(encodeConnectionRejected({ reason: RejectionReason.VersionMismatch }));
    connection.close();
    return;
  }

  const nickname = hello.nickname.trim();
  if (!isValidNickname(nickname)) {
    logger.warn(`Rejecting connection=${connection.connectionId}: invalid nickname "${hello.nickname}"`);
    connection.send(encodeConnectionRejected({ reason: RejectionReason.InvalidNickname }));
    connection.close();
    return;
  }

  try {
    await playerRepository.create(nickname);
  } catch (error) {
    logger.warn(`Failed to persist player record for "${nickname}"`, error);
  }

  const pid = connections.assignPid(connection);

  // Sent before this connection's own entity is created, so neither loop duplicates it.
  for (const entityId of world.entities.query(PositionComponent, EntityTypeComponent)) {
    const position = world.entities.getComponent(entityId, PositionComponent)!;
    const entityType = world.entities.getComponent(entityId, EntityTypeComponent)!;
    const ownerPid = world.entities.getComponent(entityId, EntityOwnerComponent)?.ownerPid ?? NO_OWNER_PID;
    connection.send(
      encodeEntityInsert({ entityId, entityType: entityType.entityType, ownerPid, x: position.x, y: position.y }),
    );
  }
  connection.send(serializeWorldSnapshot(world, 0));

  const entityId = createPlayerEntity(world, worldConfig.spawnX, worldConfig.spawnY, pid);
  connection.entityId = entityId;

  connection.send(
    encodeHandshake({
      assignedEntityId: entityId,
      assignedPid: pid,
      tickRate,
      worldMinX: worldBounds.minX,
      worldMaxX: worldBounds.maxX,
      worldMinY: worldBounds.minY,
      worldMaxY: worldBounds.maxY,
    }),
  );

  network.broadcast(
    encodeEntityInsert({
      entityId,
      entityType: EntityType.Player,
      ownerPid: pid,
      x: worldConfig.spawnX,
      y: worldConfig.spawnY,
    }),
  );

  logger.info(
    `Player session established: connection=${connection.connectionId} entity=${entityId} pid=${pid} nickname=${nickname}`,
  );
}

export function onConnectionClosed(connection: ClientConnection, world: World, network: NetworkService): void {
  if (connection.entityId !== undefined) {
    world.entities.destroyEntity(connection.entityId);
    network.broadcast(encodeEntityDestroy({ entityId: connection.entityId }));
  }
}
