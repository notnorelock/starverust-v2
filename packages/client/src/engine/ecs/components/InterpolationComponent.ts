import { Component, type EntityId } from '@starve/shared';

/**
 * Holds the render-frame-interpolated position and facing angle for an entity, recomputed
 * each frame by SnapshotBuffer.sample(). Kept separate from PositionComponent so a future
 * client-prediction stage can own PositionComponent as "predicted local state" without
 * colliding with this. `angle` is passed straight through from the network (see
 * SnapshotBuffer's own doc comment on why it isn't chase-and-snapped like x/y).
 */
export class InterpolationComponent extends Component {
  x: number;
  y: number;
  angle: number;

  constructor(entityId: EntityId, x = 0, y = 0, angle = 0) {
    super(entityId);
    this.x = x;
    this.y = y;
    this.angle = angle;
  }
}
