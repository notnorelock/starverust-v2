import { PositionComponent, VelocityComponent, World, type EntityId } from '@starve/shared';

/** Creates the entity + component set backing a connected player, spawned at the world's configured spawn point. */
export function createPlayerEntity(world: World, spawnX: number, spawnY: number): EntityId {
  const entity = world.entities.createEntity();
  world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, spawnX, spawnY));
  world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0, 0));
  return entity.id;
}
