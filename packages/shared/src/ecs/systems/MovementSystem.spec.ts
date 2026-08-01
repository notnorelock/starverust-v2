import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { ServiceContainer } from '../../di/ServiceContainer';
import { MovementSystem } from './MovementSystem';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';

function createWorld(): World {
  const world = new World({ services: new ServiceContainer() });
  world.registerSystem(new MovementSystem());
  world.init();
  return world;
}

describe('MovementSystem', () => {
  it('integrates velocity into position over one fixed tick', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 0, 0));
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 10, 0));

    world.fixedUpdate(1 / 30);

    const position = world.entities.getComponent(entity.id, PositionComponent)!;
    expect(position.x).toBeCloseTo(10 * (1 / 30), 6);
    expect(position.y).toBe(0);
  });

  it('leaves entities without a VelocityComponent untouched', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 5, 5));

    world.fixedUpdate(1 / 30);

    const position = world.entities.getComponent(entity.id, PositionComponent)!;
    expect(position.x).toBe(5);
    expect(position.y).toBe(5);
  });

  it('accumulates position across multiple ticks', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 0, 0));
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0, 30));

    for (let i = 0; i < 30; i += 1) {
      world.fixedUpdate(1 / 30);
    }

    const position = world.entities.getComponent(entity.id, PositionComponent)!;
    expect(position.y).toBeCloseTo(30, 5);
  });
});
