import { System } from '../core/System';
import type { World } from '../core/World';
import type { ComponentType } from '../core/ComponentType';
import { PositionComponent } from '../components/PositionComponent';
import { RenderPositionComponent } from '../components/RenderPositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
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
 * Also toggles EntityActionStateComponent's Walk/Idle flags — Walk while the entity is
 * still receiving movement input for the current throttle window, Idle once both the
 * render position has caught up AND there's no more movement coming this window.
 *
 * The naive version of this check (Walk only while `distance > step` this tick) doesn't
 * work at this project's tuning: RENDER_POSITION_CHASE_SPEED (900 units/sec) is
 * deliberately fast enough to always fully close MovementSystem's throttled per-jump
 * distance (see that constant's own doc comment) within a single tick — so
 * `distance <= step` is true on every tick, even while an entity is continuously moving,
 * and Walk would never actually get set. Instead, Walk also stays set whenever
 * VelocityComponent is nonzero (movement input is currently held, so MovementSystem will
 * advance the target again within this throttle window even though render has already
 * caught up to the last jump) — only entities with both zero velocity and a fully-caught-up
 * render position are Idle. VelocityComponent is optional here (not every PositionComponent
 * entity has one, e.g. static world geometry), so its absence is treated as "no velocity."
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

      const caughtUp = distance <= step || distance === 0;
      if (caughtUp) {
        render.x = target.x;
        render.y = target.y;
      } else {
        render.x += (dx / distance) * step;
        render.y += (dy / distance) * step;
      }

      const action = world.entities.getComponent(entityId, EntityActionStateComponent);
      if (action) {
        const velocity = world.entities.getComponent(entityId, VelocityComponent);
        const isMoving = velocity !== undefined && (velocity.vx !== 0 || velocity.vy !== 0);

        if (caughtUp && !isMoving) {
          action.action &= ~ActionState.Walk;
          action.action |= ActionState.Idle;
        } else {
          action.action &= ~ActionState.Idle;
          action.action |= ActionState.Walk;
        }
      }
    }
  }
}
