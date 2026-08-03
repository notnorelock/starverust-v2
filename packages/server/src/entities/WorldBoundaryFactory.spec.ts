import { describe, expect, it } from 'vitest';
import {
  World,
  ServiceContainer,
  CollisionSystem,
  PhysicsSystem,
  MovementSystem,
  PositionComponent,
  VelocityComponent,
  PhysicsBodyComponent,
  CircleColliderComponent,
  RectColliderComponent,
  EntityTypeComponent,
  EntityType,
  CollisionLayer,
} from '@starve/shared';
import { createWorldBoundaryWalls } from './WorldBoundaryFactory';

function createWorld(): World {
  const world = new World({ services: new ServiceContainer() });
  world.registerSystem(new PhysicsSystem());
  world.registerSystem(new MovementSystem());
  world.registerSystem(new CollisionSystem(50));
  world.init();
  return world;
}

function addPlayerLikeCircle(world: World, x: number, y: number, radius: number) {
  const entity = world.entities.createEntity();
  world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, x, y));
  world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0, 0));
  world.entities.addComponent(
    entity.id,
    PhysicsBodyComponent,
    new PhysicsBodyComponent(entity.id, { mass: 1, initialX: x, initialY: y }),
  );
  world.entities.addComponent(
    entity.id,
    CircleColliderComponent,
    new CircleColliderComponent(entity.id, radius, {
      layer: CollisionLayer.Player,
      collidesWith: CollisionLayer.World,
    }),
  );
  return entity.id;
}

describe('createWorldBoundaryWalls', () => {
  it('creates four static RectColliderComponent walls on the World layer', () => {
    const world = createWorld();
    createWorldBoundaryWalls(world, { minX: -25, maxX: 25, minY: -25, maxY: 25 });

    const wallIds = [...world.entities.query(PositionComponent, RectColliderComponent)];
    expect(wallIds).toHaveLength(4);
    for (const id of wallIds) {
      const collider = world.entities.getComponent(id, RectColliderComponent)!;
      expect(collider.layer).toBe(CollisionLayer.World);
      const body = world.entities.getComponent(id, PhysicsBodyComponent)!;
      expect(body.bodyType).toBe('static');
      const entityType = world.entities.getComponent(id, EntityTypeComponent)!;
      expect(entityType.entityType).toBe(EntityType.WorldGeometry);
    }
  });

  it('keeps a player-layer entity from crossing the boundary (resolved as ordinary collision, no separate clamp)', () => {
    const world = createWorld();
    createWorldBoundaryWalls(world, { minX: -25, maxX: 25, minY: -25, maxY: 25 });

    const player = addPlayerLikeCircle(world, 24, 0, 0.5);
    const velocity = world.entities.getComponent(player, VelocityComponent)!;
    velocity.vx = 200; // driving hard into the right wall

    for (let i = 0; i < 30; i += 1) {
      world.fixedUpdate(1 / 30);
    }

    const position = world.entities.getComponent(player, PositionComponent)!;
    expect(position.x).toBeLessThanOrEqual(25);
  });

  it('the playable area matches WorldBounds exactly — walls extend outward, not inward', () => {
    const world = createWorld();
    createWorldBoundaryWalls(world, { minX: -25, maxX: 25, minY: -25, maxY: 25 });

    // Player radius 0.5, centered 1 unit inside the bound — its edge (24.5) sits exactly
    // at the wall's inner face (25 - 0.5 collider radius), not overlapping it.
    const player = addPlayerLikeCircle(world, 24, 0, 0.5);
    world.fixedUpdate(1 / 30);

    const position = world.entities.getComponent(player, PositionComponent)!;
    expect(position.x).toBeCloseTo(24, 5);
  });
});
