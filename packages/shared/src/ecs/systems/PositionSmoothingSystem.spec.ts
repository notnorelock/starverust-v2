import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { ServiceContainer } from '../../di/ServiceContainer';
import { PositionSmoothingSystem } from './PositionSmoothingSystem';
import { PositionComponent } from '../components/PositionComponent';
import { RenderPositionComponent } from '../components/RenderPositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import { EntityActionStateComponent, ActionState } from '../components/EntityActionStateComponent';
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

  describe('EntityActionStateComponent toggling', () => {
    it('sets Walk (not Idle) while VelocityComponent is nonzero, even though the render position fully catches up within one tick', () => {
      // Regression test: RENDER_POSITION_CHASE_SPEED is tuned fast enough that
      // MovementSystem's throttled per-jump distance is always fully closed within a
      // single tick (distance <= step is always true), so a naive "Walk only while
      // distance > step this tick" check can never observe Walk at all while an entity
      // moves continuously — this is exactly the bug that motivated also checking velocity.
      const world = createWorld();
      const entity = world.entities.createEntity();
      world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 0, 0));
      world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 200, 0));
      world.entities.addComponent(entity.id, EntityActionStateComponent, new EntityActionStateComponent(entity.id));

      world.fixedUpdate(1 / 30); // seeds render position at the target

      const target = world.entities.getComponent(entity.id, PositionComponent)!;
      target.x = 5; // a small throttled jump, well within one tick's chase step
      world.fixedUpdate(1 / 30);

      const render = world.entities.getComponent(entity.id, RenderPositionComponent)!;
      const action = world.entities.getComponent(entity.id, EntityActionStateComponent)!;
      expect(render.x).toBe(5); // render fully caught up this tick
      expect(action.action & ActionState.Walk).not.toBe(0);
      expect(action.action & ActionState.Idle).toBe(0);
    });

    it('sets Idle once both the render position has caught up and velocity is zero', () => {
      const world = createWorld();
      const entity = world.entities.createEntity();
      world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 0, 0));
      world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0, 0));
      world.entities.addComponent(entity.id, EntityActionStateComponent, new EntityActionStateComponent(entity.id, ActionState.Walk));

      world.fixedUpdate(1 / 30); // seeds RenderPositionComponent — no action toggling happens this tick
      world.fixedUpdate(1 / 30); // render is now caught up and velocity is zero — toggles to Idle

      const action = world.entities.getComponent(entity.id, EntityActionStateComponent)!;
      expect(action.action & ActionState.Idle).not.toBe(0);
      expect(action.action & ActionState.Walk).toBe(0);
    });

    it('stays Walk while the render position has not yet caught up, regardless of velocity', () => {
      const world = createWorld();
      const entity = world.entities.createEntity();
      const target = new PositionComponent(entity.id, 0, 0);
      world.entities.addComponent(entity.id, PositionComponent, target);
      world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 0, 0));
      world.entities.addComponent(entity.id, EntityActionStateComponent, new EntityActionStateComponent(entity.id));

      world.fixedUpdate(1 / 30); // seeds render position at (0,0)

      target.x = 1000; // far away — render cannot catch up in one tick
      world.fixedUpdate(1 / 30);

      const action = world.entities.getComponent(entity.id, EntityActionStateComponent)!;
      expect(action.action & ActionState.Walk).not.toBe(0);
      expect(action.action & ActionState.Idle).toBe(0);
    });

    it('does nothing to entities with no EntityActionStateComponent', () => {
      const world = createWorld();
      const entity = world.entities.createEntity();
      world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 0, 0));

      expect(() => world.fixedUpdate(1 / 30)).not.toThrow();
      expect(world.entities.hasComponent(entity.id, EntityActionStateComponent)).toBe(false);
    });
  });
});
