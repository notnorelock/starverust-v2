import {
  Logger,
  PositionComponent,
  EntityTypeComponent,
  EntityType,
  type World,
  type WorldBounds,
} from '@starve/shared';
import { encodeHandshake, encodeEntityInsert, encodeEntityDestroy } from '@starve/protocol';
import type { ClientConnection } from '../network/ClientConnection';
import type { NetworkService } from '../network/NetworkService';
import type { IPlayerRepository } from '../database/repositories/IPlayerRepository';
import { createPlayerEntity } from '../entities/PlayerEntityFactory';
import { serializeWorldSnapshot } from '../serialization/SnapshotSerializer';
import type { WorldConfig } from '../world/WorldConfig';

const logger = new Logger('PlayerSession');

/**
 * Orchestrates what happens when a connection joins: proves the persistence layer
 * end-to-end with a placeholder guest account (real auth is a later stage), spawns
 * the player's entity in the World, and sends the Handshake packet assigning it.
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
export async function onConnectionEstablished(
  connection: ClientConnection,
  world: World,
  playerRepository: IPlayerRepository,
  tickRate: number,
  worldConfig: WorldConfig,
  worldBounds: WorldBounds,
  network: NetworkService,
): Promise<void> {
  const username = `guest_${connection.connectionId}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    await playerRepository.create(username);
  } catch (error) {
    logger.warn(`Failed to persist guest player record for ${username}`, error);
  }

  // Sent before this connection's own entity is created, so neither loop duplicates it.
  for (const entityId of world.entities.query(PositionComponent, EntityTypeComponent)) {
    const position = world.entities.getComponent(entityId, PositionComponent)!;
    const entityType = world.entities.getComponent(entityId, EntityTypeComponent)!;
    connection.send(
      encodeEntityInsert({ entityId, entityType: entityType.entityType, x: position.x, y: position.y }),
    );
  }
  connection.send(serializeWorldSnapshot(world, 0));

  const entityId = createPlayerEntity(world, worldConfig.spawnX, worldConfig.spawnY);
  connection.entityId = entityId;

  connection.send(
    encodeHandshake({
      assignedEntityId: entityId,
      tickRate,
      worldMinX: worldBounds.minX,
      worldMaxX: worldBounds.maxX,
      worldMinY: worldBounds.minY,
      worldMaxY: worldBounds.maxY,
    }),
  );

  network.broadcast(
    encodeEntityInsert({ entityId, entityType: EntityType.Player, x: worldConfig.spawnX, y: worldConfig.spawnY }),
  );

  logger.info(`Player session established: connection=${connection.connectionId} entity=${entityId}`);
}

export function onConnectionClosed(connection: ClientConnection, world: World, network: NetworkService): void {
  if (connection.entityId !== undefined) {
    world.entities.destroyEntity(connection.entityId);
    network.broadcast(encodeEntityDestroy({ entityId: connection.entityId }));
  }
}
