import { System } from '../core/System';
import type { World } from '../core/World';
import type { ComponentType } from '../core/ComponentType';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import { MOVEMENT_TARGET_INTERVAL_TICKS } from '../../constants/GameConstants';

/**
 * Pipeline step 2 (Movement): integrates velocity into position, but only every
 * `MOVEMENT_TARGET_INTERVAL_TICKS` ticks rather than every tick — ported from a reference
 * implementation where the movement target advanced on its own throttled timer (~120ms),
 * separate from the tick that actually broadcast positions. PositionComponent here is a
 * coarse-stepping *target*, not the smoothed value clients see — PositionSmoothingSystem
 * (which runs after this) eases RenderPositionComponent toward it every tick regardless of
 * whether this system moved it that tick, which is what turns these infrequent, larger
 * jumps into continuous motion on the wire. Runs identically on server (authoritative) —
 * the client does not run this in Stage 1, it only interpolates positions received from
 * server snapshots.
 */
export class MovementSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [PositionComponent, VelocityComponent];

  private tickCounter = 0;

  override onFixedUpdate(fixedDt: number, world: World): void {
    this.tickCounter += 1;
    if (this.tickCounter % MOVEMENT_TARGET_INTERVAL_TICKS !== 0) {
      return;
    }
    // Elapsed time since this target last actually advanced, not just one tick's fixedDt —
    // otherwise throttling would also slow the entity down instead of just making its
    // target update in coarser, less frequent steps at the same overall speed.
    const throttledDt = fixedDt * MOVEMENT_TARGET_INTERVAL_TICKS;

    for (const entityId of world.entities.query(PositionComponent, VelocityComponent)) {
      const position = world.entities.getComponent(entityId, PositionComponent);
      const velocity = world.entities.getComponent(entityId, VelocityComponent);
      if (!position || !velocity) {
        continue;
      }
      position.x += velocity.vx * throttledDt;
      position.y += velocity.vy * throttledDt;
    }
  }
}
