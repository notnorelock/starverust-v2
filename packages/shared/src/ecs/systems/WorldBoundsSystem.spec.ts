import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { ServiceContainer } from '../../di/ServiceContainer';
import { WorldBoundsSystem } from './WorldBoundsSystem';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import type { WorldBounds } from '../../math/WorldBounds';

const TEST_BOUNDS: WorldBounds = { minX: -25, maxX: 25, minY: -25, maxY: 25 };

function createWorld(bounds: WorldBounds = TEST_BOUNDS): World {
  const world = new World({ services: new ServiceContainer() });
  world.registerSystem(new WorldBoundsSystem(bounds));
  world.init();
  return world;
}

describe('WorldBoundsSystem', () => {
  it('leaves a position inside the bounds untouched', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 0, 0));

    world.fixedUpdate(1 / 30);

    const position = world.entities.getComponent(entity.id, PositionComponent)!;
    expect(position.x).toBe(0);
    expect(position.y).toBe(0);
  });

  it('clamps a position past the max X/Y bound', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(
      entity.id,
      PositionComponent,
      new PositionComponent(entity.id, TEST_BOUNDS.maxX + 10, TEST_BOUNDS.maxY + 10),
    );

    world.fixedUpdate(1 / 30);

    const position = world.entities.getComponent(entity.id, PositionComponent)!;
    expect(position.x).toBe(TEST_BOUNDS.maxX);
    expect(position.y).toBe(TEST_BOUNDS.maxY);
  });

  it('clamps a position past the min X/Y bound', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(
      entity.id,
      PositionComponent,
      new PositionComponent(entity.id, TEST_BOUNDS.minX - 10, TEST_BOUNDS.minY - 10),
    );

    world.fixedUpdate(1 / 30);

    const position = world.entities.getComponent(entity.id, PositionComponent)!;
    expect(position.x).toBe(TEST_BOUNDS.minX);
    expect(position.y).toBe(TEST_BOUNDS.minY);
  });

  it('zeroes velocity on the axis that hit a bound, preserving the other axis', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(
      entity.id,
      PositionComponent,
      new PositionComponent(entity.id, TEST_BOUNDS.maxX + 5, 0),
    );
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 100, 50));

    world.fixedUpdate(1 / 30);

    const velocity = world.entities.getComponent(entity.id, VelocityComponent)!;
    expect(velocity.vx).toBe(0);
    expect(velocity.vy).toBe(50);
  });

  it('does not touch velocity when the entity is within bounds', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 0, 0));
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 10, -10));

    world.fixedUpdate(1 / 30);

    const velocity = world.entities.getComponent(entity.id, VelocityComponent)!;
    expect(velocity.vx).toBe(10);
    expect(velocity.vy).toBe(-10);
  });

  it('respects a different WorldBounds instance (e.g. a differently-sized regional server)', () => {
    const smallWorld: WorldBounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 };
    const world = createWorld(smallWorld);
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 100, -100));

    world.fixedUpdate(1 / 30);

    const position = world.entities.getComponent(entity.id, PositionComponent)!;
    expect(position.x).toBe(5);
    expect(position.y).toBe(-5);
  });
});
