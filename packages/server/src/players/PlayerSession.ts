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
  encodePlayerJoin,
  encodePlayerLeft,
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
 * Entity lifecycle (EntityInsertPacket/EntityDestroyPacket, any entity type) and player
 * identity lifecycle (PlayerJoinPacket/PlayerLeftPacket, pid+nickname specifically) are
 * two separate broadcasts, not folded into one — most entities (world geometry, future
 * NPCs) have no nickname/pid at all, so EntityInsertPacket stays generic while
 * PlayerJoinPacket carries the player-specific identity data on the side. The new player's
 * own entity+identity are broadcast to every already-connected client (they'd otherwise
 * never learn about it until InterestManagementSystem's next tick happened to put it in
 * range), and the new connection itself is sent one of each for every entity/player that
 * already existed before it connected — it has no other way to learn about them otherwise.
 *
 * WorldSnapshotPacket itself is sent once here, right after the catch-up loops, carrying
 * every existing entity's initial position/speed — this seeds the new connection's
 * client-side render state before its first (spatially-filtered, so possibly sparse)
 * EntityUpdatePacket arrives a tick later.
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
  connection.nickname = nickname;

  // Sent before this connection's own entity is created, so neither loop duplicates it.
  for (const entityId of world.entities.query(PositionComponent, EntityTypeComponent)) {
    const position = world.entities.getComponent(entityId, PositionComponent)!;
    const entityType = world.entities.getComponent(entityId, EntityTypeComponent)!;
    const ownerPid = world.entities.getComponent(entityId, EntityOwnerComponent)?.ownerPid ?? NO_OWNER_PID;
    connection.send(
      encodeEntityInsert({ entityId, entityType: entityType.entityType, ownerPid, x: position.x, y: position.y }),
    );
  }
  for (const other of connections.all()) {
    if (other === connection || other.pid === undefined || other.entityId === undefined || !other.nickname) {
      continue;
    }
    connection.send(encodePlayerJoin({ pid: other.pid, entityId: other.entityId, nickname: other.nickname }));
  }
  connection.send(serializeWorldSnapshot(world, 0, (pid) => nicknameForPid(connections, pid)));

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
  network.broadcast(encodePlayerJoin({ pid, entityId, nickname }));

  logger.info(
    `Player session established: connection=${connection.connectionId} entity=${entityId} pid=${pid} nickname=${nickname}`,
  );
}

/**
 * Resolves a connected player's nickname from their pid — used to embed nicknames directly
 * into WorldSnapshotPacket (see serializeWorldSnapshot) rather than relying solely on the
 * separate PlayerJoinPacket catch-up loop above. Linear scan over live connections rather
 * than a dedicated pid index: this only runs once per new connection's own catch-up
 * snapshot, not per tick, so the O(connections) cost here is negligible.
 */
function nicknameForPid(connections: ConnectionRegistry, pid: number): string | undefined {
  for (const connection of connections.all()) {
    if (connection.pid === pid) {
      return connection.nickname;
    }
  }
  return undefined;
}

export function onConnectionClosed(connection: ClientConnection, world: World, network: NetworkService): void {
  if (connection.entityId !== undefined) {
    world.entities.destroyEntity(connection.entityId);
    network.broadcast(encodeEntityDestroy({ entityId: connection.entityId }));
  }
  if (connection.pid !== undefined) {
    network.broadcast(encodePlayerLeft({ pid: connection.pid }));
  }
}
