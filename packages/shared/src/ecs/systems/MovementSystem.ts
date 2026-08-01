import { System } from '../core/System';
import type { World } from '../core/World';
import type { ComponentType } from '../core/ComponentType';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';

/**
 * Pipeline step 2 (Movement): integrates velocity into position. Runs identically on
 * server (authoritative) — the client does not run this in Stage 1, it only interpolates
 * positions received from server snapshots.
 */
export class MovementSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [PositionComponent, VelocityComponent];

  override onFixedUpdate(fixedDt: number, world: World): void {
    for (const entityId of world.entities.query(PositionComponent, VelocityComponent)) {
      const position = world.entities.getComponent(entityId, PositionComponent);
      const velocity = world.entities.getComponent(entityId, VelocityComponent);
      if (!position || !velocity) {
        continue;
      }
      position.x += velocity.vx * fixedDt;
      position.y += velocity.vy * fixedDt;
    }
  }
}
