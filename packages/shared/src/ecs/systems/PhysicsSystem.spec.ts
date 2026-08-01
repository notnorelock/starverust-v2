import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { ServiceContainer } from '../../di/ServiceContainer';
import { PhysicsSystem } from './PhysicsSystem';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import { PhysicsBodyComponent } from '../components/PhysicsBodyComponent';

function createWorld(): World {
  const world = new World({ services: new ServiceContainer() });
  world.registerSystem(new PhysicsSystem());
  world.init();
  return world;
}

describe('PhysicsSystem', () => {
  it('integrates acceleration into velocity and resets acceleration to zero', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0, 0));
    const body = world.entities.addComponent(entity.id, PhysicsBodyComponent, new PhysicsBodyComponent(entity.id, { friction: 0, drag: 0 }));
    body.ax = 10;
    body.ay = 0;

    world.fixedUpdate(1);

    const velocity = world.entities.getComponent(entity.id, VelocityComponent)!;
    expect(velocity.vx).toBeCloseTo(10, 5);
    expect(body.ax).toBe(0);
    expect(body.ay).toBe(0);
  });

  it('decays velocity by friction and drag over time', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 10, 0));
    world.entities.addComponent(entity.id, PhysicsBodyComponent, new PhysicsBodyComponent(entity.id, { friction: 0.5, drag: 0 }));

    world.fixedUpdate(1 / 30);

    const velocity = world.entities.getComponent(entity.id, VelocityComponent)!;
    expect(velocity.vx).toBeLessThan(10);
    expect(velocity.vx).toBeGreaterThan(0);
  });

  it('snaps near-zero velocity to exactly zero instead of decaying forever', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0.001, 0));
    world.entities.addComponent(entity.id, PhysicsBodyComponent, new PhysicsBodyComponent(entity.id, { friction: 0.9, drag: 0 }));

    world.fixedUpdate(1 / 30);

    const velocity = world.entities.getComponent(entity.id, VelocityComponent)!;
    expect(velocity.vx).toBe(0);
    expect(velocity.vy).toBe(0);
  });

  it('never moves a static body regardless of its velocity/acceleration', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 5, 5));
    const body = world.entities.addComponent(
      entity.id,
      PhysicsBodyComponent,
      new PhysicsBodyComponent(entity.id, { bodyType: 'static' }),
    );
    body.ax = 100;

    world.fixedUpdate(1);

    const velocity = world.entities.getComponent(entity.id, VelocityComponent)!;
    expect(velocity.vx).toBe(5);
    expect(velocity.vy).toBe(5);
  });

  it('records prevX/prevY from the position BEFORE this tick moves it', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 7, 3));
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 100, 0));
    const body = world.entities.addComponent(
      entity.id,
      PhysicsBodyComponent,
      new PhysicsBodyComponent(entity.id, { friction: 0, drag: 0 }),
    );

    world.fixedUpdate(1 / 30);

    expect(body.prevX).toBe(7);
    expect(body.prevY).toBe(3);
  });
});
