import {
  PositionComponent,
  RenderPositionComponent,
  EntityActionStateComponent,
  EntityTypeComponent,
  EntityType,
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
  // Seeded at the spawn point up front (rather than left for PositionSmoothingSystem's
  // first-tick seeding to create lazily) so the very first broadcast snapshot — even one
  // sent before this entity's first fixedUpdate — already has a RenderPositionComponent
  // to read, matching how the reference implementation seeds pos.r = pos in the
  // constructor rather than defaulting it to (0,0).
  world.entities.addComponent(
    entity.id,
    RenderPositionComponent,
    new RenderPositionComponent(entity.id, spawnX, spawnY),
  );
  world.entities.addComponent(entity.id, EntityActionStateComponent, new EntityActionStateComponent(entity.id));
  world.entities.addComponent(
    entity.id,
    EntityTypeComponent,
    new EntityTypeComponent(entity.id, EntityType.Player),
  );
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
