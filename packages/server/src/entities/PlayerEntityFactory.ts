import {
  PositionComponent,
  VelocityComponent,
  PhysicsBodyComponent,
  CircleColliderComponent,
  CollisionLayer,
  World,
  type EntityId,
} from '@starve/shared';

/** Player collision radius, in world units — matches the client's rendered circle radius. */
const PLAYER_COLLIDER_RADIUS = 0.5;

/** Creates the entity + component set backing a connected player, spawned at the world's configured spawn point. */
export function createPlayerEntity(world: World, spawnX: number, spawnY: number): EntityId {
  const entity = world.entities.createEntity();
  world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, spawnX, spawnY));
  world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0, 0));
  world.entities.addComponent(
    entity.id,
    PhysicsBodyComponent,
    new PhysicsBodyComponent(entity.id, { mass: 1, initialX: spawnX, initialY: spawnY }),
  );
  world.entities.addComponent(
    entity.id,
    CircleColliderComponent,
    new CircleColliderComponent(entity.id, PLAYER_COLLIDER_RADIUS, {
      layer: CollisionLayer.Player,
      collidesWith: CollisionLayer.World,
    }),
  );
  return entity.id;
}
