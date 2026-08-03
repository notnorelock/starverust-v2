import { System } from '../core/System';
import type { World } from '../core/World';
import type { ComponentType } from '../core/ComponentType';
import { PositionComponent } from '../components/PositionComponent';
import { RenderPositionComponent } from '../components/RenderPositionComponent';
import { EntityActionStateComponent, ActionState } from '../components/EntityActionStateComponent';
import { RENDER_POSITION_CHASE_SPEED } from '../../constants/GameConstants';

/**
 * Eases each entity's RenderPositionComponent toward its PositionComponent (the movement
 * target — see MovementSystem) at a constant speed every tick, snapping once within one
 * tick's step of it. Ported from a reference implementation's per-tick lerp(): moving a
 * fixed distance per tick toward the target, not an exponential/eased approach — this is
 * what turns MovementSystem's coarse, throttled target jumps into continuous motion.
 * SnapshotSerializer broadcasts this component, not the raw target, so clients never see
 * the target's own stepping.
 *
 * Also toggles EntityActionStateComponent's Walk/Idle flags — Walk while the render
 * position still has ground to cover to reach the target, Idle once it's caught up —
 * mirroring the reference implementation's `b.action` bit toggling around the same
 * distance check.
 *
 * Runs last in the pipeline, after MovementSystem and CollisionSystem (world edges
 * included — see WorldBoundaryFactory) have fully resolved the target position for the
 * tick — see TickPipeline for registration order.
 */
export class PositionSmoothingSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [PositionComponent];

  override onFixedUpdate(fixedDt: number, world: World): void {
    const step = RENDER_POSITION_CHASE_SPEED * fixedDt;

    for (const entityId of world.entities.query(PositionComponent)) {
      const target = world.entities.getComponent(entityId, PositionComponent);
      if (!target) {
        continue;
      }

      let render = world.entities.getComponent(entityId, RenderPositionComponent);
      if (!render) {
        // First tick this entity has a target — start the render position exactly at it
        // rather than easing in from (0,0), mirroring how the reference implementation's
        // pos.r is seeded from pos in the constructor instead of defaulting separately.
        world.entities.addComponent(
          entityId,
          RenderPositionComponent,
          new RenderPositionComponent(entityId, target.x, target.y),
        );
        continue;
      }

      const dx = target.x - render.x;
      const dy = target.y - render.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const action = world.entities.getComponent(entityId, EntityActionStateComponent);

      if (distance <= step || distance === 0) {
        render.x = target.x;
        render.y = target.y;
        if (action) {
          action.action &= ~ActionState.Walk;
          action.action |= ActionState.Idle;
        }
      } else {
        render.x += (dx / distance) * step;
        render.y += (dy / distance) * step;
        if (action) {
          action.action &= ~ActionState.Idle;
          action.action |= ActionState.Walk;
        }
      }
    }
  }
}
