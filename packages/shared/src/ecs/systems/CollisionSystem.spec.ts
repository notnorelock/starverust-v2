import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { ServiceContainer } from '../../di/ServiceContainer';
import { CollisionSystem } from './CollisionSystem';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import { PhysicsBodyComponent } from '../components/PhysicsBodyComponent';
import { CircleColliderComponent } from '../components/CircleColliderComponent';
import { RectColliderComponent } from '../components/RectColliderComponent';
import { CollisionLayer } from '../../physics/CollisionLayer';

function createWorld(cellSize = 8): World {
  const world = new World({ services: new ServiceContainer() });
  world.registerSystem(new CollisionSystem(cellSize));
  world.init();
  return world;
}

function addDynamicCircle(world: World, x: number, y: number, radius: number, mass = 1) {
  const entity = world.entities.createEntity();
  world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, x, y));
  world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0, 0));
  world.entities.addComponent(
    entity.id,
    PhysicsBodyComponent,
    new PhysicsBodyComponent(entity.id, { mass, initialX: x, initialY: y }),
  );
  world.entities.addComponent(entity.id, CircleColliderComponent, new CircleColliderComponent(entity.id, radius));
  return entity.id;
}

function addStaticRect(world: World, x: number, y: number, width: number, height: number) {
  const entity = world.entities.createEntity();
  world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, x, y));
  world.entities.addComponent(
    entity.id,
    PhysicsBodyComponent,
    new PhysicsBodyComponent(entity.id, { bodyType: 'static', initialX: x, initialY: y }),
  );
  world.entities.addComponent(entity.id, RectColliderComponent, new RectColliderComponent(entity.id, width, height));
  return entity.id;
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

describe('CollisionSystem', () => {
  it('does not touch entities that are not overlapping', () => {
    const world = createWorld();
    const a = addDynamicCircle(world, 0, 0, 1);
    const b = addDynamicCircle(world, 10, 0, 1);

    world.fixedUpdate(1 / 30);

    expect(world.entities.getComponent(a, PositionComponent)!.x).toBe(0);
    expect(world.entities.getComponent(b, PositionComponent)!.x).toBe(10);
  });

  it('separates two overlapping equal-mass dynamic circles symmetrically', () => {
    const world = createWorld();
    const a = addDynamicCircle(world, 0, 0, 1);
    const b = addDynamicCircle(world, 1, 0, 1); // overlap depth 1

    world.fixedUpdate(1 / 30);

    const posA = world.entities.getComponent(a, PositionComponent)!;
    const posB = world.entities.getComponent(b, PositionComponent)!;
    // Total separation along x should restore them to non-overlapping (distance >= radius sum = 2).
    expect(posB.x - posA.x).toBeCloseTo(2, 4);
  });

  it('pushes only the dynamic body away from an immovable static body', () => {
    const world = createWorld();
    const wall = addStaticRect(world, 5, 0, 2, 10); // spans x in [4,6]
    const ball = addDynamicCircle(world, 4.5, 0, 1); // overlaps the wall's left edge

    world.fixedUpdate(1 / 30);

    const wallPos = world.entities.getComponent(wall, PositionComponent)!;
    const ballPos = world.entities.getComponent(ball, PositionComponent)!;
    expect(wallPos.x).toBe(5); // static — never moves
    expect(ballPos.x).toBeLessThan(4.5); // pushed away from the wall
  });

  it('removes velocity driving a dynamic body into a static wall (no bounce-through)', () => {
    const world = createWorld();
    addStaticRect(world, 5, 0, 2, 10); // spans x in [4,6]
    const ball = addDynamicCircle(world, 4.5, 0, 1);
    const velocity = world.entities.getComponent(ball, VelocityComponent)!;
    velocity.vx = 50; // moving hard into the wall

    world.fixedUpdate(1 / 30);

    expect(velocity.vx).toBeLessThanOrEqual(0);
  });

  it('two static bodies overlapping are left untouched', () => {
    const world = createWorld();
    const a = addStaticRect(world, 0, 0, 4, 4);
    const b = addStaticRect(world, 1, 0, 4, 4);

    world.fixedUpdate(1 / 30);

    expect(world.entities.getComponent(a, PositionComponent)!.x).toBe(0);
    expect(world.entities.getComponent(b, PositionComponent)!.x).toBe(1);
  });

  it('continuous collision prevents a fast-moving small circle from tunneling through a thin static wall', () => {
    const world = createWorld(50); // large cell size so the whole scene fits in one broadphase cell
    // A thin wall at x=10, spanning a wide y range, thin along x (half-width 0.1).
    addStaticRect(world, 10, 0, 0.2, 20);

    const ball = addDynamicCircle(world, 0, 0, 0.3);
    const body = world.entities.getComponent(ball, PhysicsBodyComponent)!;
    // Simulate PhysicsSystem's bookkeeping: prevX/prevY at the tick's start...
    body.prevX = 0;
    body.prevY = 0;
    // ...and MovementSystem having already moved it far past the wall this tick (discrete
    // position update alone would have tunneled straight through the thin wall).
    const position = world.entities.getComponent(ball, PositionComponent)!;
    position.x = 20;
    position.y = 0;

    world.fixedUpdate(1 / 30);

    // The ball must have been stopped at/before the wall, not left on the far side of it.
    expect(position.x).toBeLessThan(10);
  });

  it('does not sub-step (CCD) for normal, slow movement', () => {
    const world = createWorld();
    const ball = addDynamicCircle(world, 0, 0, 1);
    const body = world.entities.getComponent(ball, PhysicsBodyComponent)!;
    body.prevX = 0;
    body.prevY = 0;
    const position = world.entities.getComponent(ball, PositionComponent)!;
    position.x = 0.05; // tiny displacement relative to radius 1

    world.fixedUpdate(1 / 30);

    // No obstacles in the scene — position should be completely unaffected by CCD sweeping.
    expect(position.x).toBe(0.05);
  });

  describe('collision layers/masks', () => {
    it('lets two overlapping Player-layer circles pass through each other (no separation)', () => {
      const world = createWorld();
      const a = addPlayerLikeCircle(world, 0, 0, 1);
      const b = addPlayerLikeCircle(world, 1, 0, 1); // overlap depth 1, same as the plain-circle separation test

      world.fixedUpdate(1 / 30);

      const posA = world.entities.getComponent(a, PositionComponent)!;
      const posB = world.entities.getComponent(b, PositionComponent)!;
      expect(posA.x).toBe(0);
      expect(posB.x).toBe(1);
    });

    it('still resolves a Player-layer circle against World-layer static geometry', () => {
      const world = createWorld();
      const wall = addStaticRect(world, 5, 0, 2, 10); // spans x in [4,6], default layer is World
      const player = addPlayerLikeCircle(world, 4.5, 0, 1); // overlaps the wall's left edge

      world.fixedUpdate(1 / 30);

      const wallPos = world.entities.getComponent(wall, PositionComponent)!;
      const playerPos = world.entities.getComponent(player, PositionComponent)!;
      expect(wallPos.x).toBe(5); // static — never moves
      expect(playerPos.x).toBeLessThan(4.5); // pushed away from the wall
    });

    it('CCD sweep does not stop a fast Player-layer circle on another Player-layer circle', () => {
      const world = createWorld(50);
      addPlayerLikeCircle(world, 10, 0, 0.3); // stationary "other player" directly in the path

      const mover = addPlayerLikeCircle(world, 0, 0, 0.3);
      const body = world.entities.getComponent(mover, PhysicsBodyComponent)!;
      body.prevX = 0;
      body.prevY = 0;
      const position = world.entities.getComponent(mover, PositionComponent)!;
      position.x = 20;
      position.y = 0;

      world.fixedUpdate(1 / 30);

      // Should sweep straight through the other player to its actual destination, unobstructed.
      expect(position.x).toBe(20);
    });
  });
});
