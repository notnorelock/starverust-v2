import { Logger, type World, type WorldBounds } from '@starve/shared';
import { encodeHandshake } from '@starve/protocol';
import type { ClientConnection } from '../network/ClientConnection';
import type { IPlayerRepository } from '../database/repositories/IPlayerRepository';
import { createPlayerEntity } from '../entities/PlayerEntityFactory';
import type { WorldConfig } from '../world/WorldConfig';

const logger = new Logger('PlayerSession');

/**
 * Orchestrates what happens when a connection joins: proves the persistence layer
 * end-to-end with a placeholder guest account (real auth is a later stage), spawns
 * the player's entity in the World, and sends the Handshake packet assigning it.
 */
export async function onConnectionEstablished(
  connection: ClientConnection,
  world: World,
  playerRepository: IPlayerRepository,
  tickRate: number,
  worldConfig: WorldConfig,
  worldBounds: WorldBounds,
): Promise<void> {
  const username = `guest_${connection.connectionId}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    await playerRepository.create(username);
  } catch (error) {
    logger.warn(`Failed to persist guest player record for ${username}`, error);
  }

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
  logger.info(`Player session established: connection=${connection.connectionId} entity=${entityId}`);
}

export function onConnectionClosed(connection: ClientConnection, world: World): void {
  if (connection.entityId !== undefined) {
    world.entities.destroyEntity(connection.entityId);
  }
}
