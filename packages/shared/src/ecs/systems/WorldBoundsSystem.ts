import { System } from '../core/System';
import type { World } from '../core/World';
import type { ComponentType } from '../core/ComponentType';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import type { WorldBounds } from '../../math/WorldBounds';
import { clamp } from '../../math/MathUtils';

/**
 * Pipeline step 3 (Physics/Collision, simplified for Stage 1): clamps every positioned
 * entity to the world's outer bounds and zeroes out velocity carrying it further past
 * the edge, so nothing can be pushed outside the playable area. Authoritative — runs on
 * the server only; the client never runs this and simply renders whatever position the
 * server reports.
 *
 * Bounds are injected, not imported as a constant — different regional server instances
 * (or, later, a map loaded from an editor export) can each configure their own world size
 * by constructing this system with a different WorldBounds, no shared-package change needed.
 */
export class WorldBoundsSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [PositionComponent];

  constructor(private readonly bounds: WorldBounds) {
    super();
  }

  override onFixedUpdate(_fixedDt: number, world: World): void {
    for (const entityId of world.entities.query(PositionComponent)) {
      const position = world.entities.getComponent(entityId, PositionComponent);
      if (!position) {
        continue;
      }

      const clampedX = clamp(position.x, this.bounds.minX, this.bounds.maxX);
      const clampedY = clamp(position.y, this.bounds.minY, this.bounds.maxY);

      if (clampedX === position.x && clampedY === position.y) {
        continue;
      }

      const hitXBound = clampedX !== position.x;
      const hitYBound = clampedY !== position.y;
      position.x = clampedX;
      position.y = clampedY;

      const velocity = world.entities.getComponent(entityId, VelocityComponent);
      if (velocity) {
        if (hitXBound) velocity.vx = 0;
        if (hitYBound) velocity.vy = 0;
      }
    }
  }
}
