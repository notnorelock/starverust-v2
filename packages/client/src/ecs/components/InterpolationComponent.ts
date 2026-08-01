import { Component, type EntityId } from '@starve/shared';

/**
 * Holds the render-frame-interpolated position for an entity, recomputed each frame
 * by SnapshotBuffer.interpolate() from the two straddling server snapshots. Kept
 * separate from PositionComponent so a future client-prediction stage can own
 * PositionComponent as "predicted local state" without colliding with this.
 */
export class InterpolationComponent extends Component {
  x: number;
  y: number;

  constructor(entityId: EntityId, x = 0, y = 0) {
    super(entityId);
    this.x = x;
    this.y = y;
  }
}
