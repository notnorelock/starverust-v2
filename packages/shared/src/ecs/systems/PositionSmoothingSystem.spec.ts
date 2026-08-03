import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { ServiceContainer } from '../../di/ServiceContainer';
import { PositionSmoothingSystem } from './PositionSmoothingSystem';
import { PositionComponent } from '../components/PositionComponent';
import { RenderPositionComponent } from '../components/RenderPositionComponent';
import { RENDER_POSITION_CHASE_SPEED } from '../../constants/GameConstants';

function createWorld(): World {
  const world = new World({ services: new ServiceContainer() });
  world.registerSystem(new PositionSmoothingSystem());
  world.init();
  return world;
}

describe('PositionSmoothingSystem', () => {
  it('seeds RenderPositionComponent exactly at the target on the first tick, no easing-in from zero', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 50, 25));

    world.fixedUpdate(1 / 30);

    const render = world.entities.getComponent(entity.id, RenderPositionComponent)!;
    expect(render.x).toBe(50);
    expect(render.y).toBe(25);
  });

  it('chases the target by a fixed step per tick rather than jumping straight to it', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    const target = new PositionComponent(entity.id, 0, 0);
    world.entities.addComponent(entity.id, PositionComponent, target);

    world.fixedUpdate(1 / 30); // seeds render position at (0,0)

    target.x = 1000; // target jumps far away in one throttled MovementSystem step
    world.fixedUpdate(1 / 30);

    const render = world.entities.getComponent(entity.id, RenderPositionComponent)!;
    const expectedStep = RENDER_POSITION_CHASE_SPEED * (1 / 30);
    expect(render.x).toBeCloseTo(expectedStep, 5);
    expect(render.x).toBeLessThan(1000);
  });

  it('snaps to the target once within one tick step of it, instead of overshooting', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    const target = new PositionComponent(entity.id, 0, 0);
    world.entities.addComponent(entity.id, PositionComponent, target);

    world.fixedUpdate(1 / 30); // seeds render position at (0,0)

    target.x = 0.001; // much closer than one tick's chase step
    world.fixedUpdate(1 / 30);

    const render = world.entities.getComponent(entity.id, RenderPositionComponent)!;
    expect(render.x).toBe(0.001);
  });

  it('converges to a stationary target over several ticks', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    const target = new PositionComponent(entity.id, 0, 0);
    world.entities.addComponent(entity.id, PositionComponent, target);

    world.fixedUpdate(1 / 30); // seed
    target.x = 5;

    for (let i = 0; i < 60; i += 1) {
      world.fixedUpdate(1 / 30);
    }

    const render = world.entities.getComponent(entity.id, RenderPositionComponent)!;
    expect(render.x).toBeCloseTo(5, 5);
    expect(render.y).toBe(0);
  });
});
