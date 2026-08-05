import { Component, type EntityId } from '@starve/shared';

/**
 * Holds the render-frame-interpolated position, facing angle, broadcast speed, and
 * broadcast action state for an entity, recomputed each frame by SnapshotBuffer.sample().
 * Kept separate from PositionComponent so a future client-prediction stage can own
 * PositionComponent as "predicted local state" without colliding with this. `angle` is
 * passed straight through from the network (see SnapshotBuffer's own doc comment on why it
 * isn't chase-and-snapped like x/y). `speed` is likewise passed straight through (see
 * SnapshotBuffer.InterpolatedEntity.speed) — used only for the sprint-rate multiplier now
 * that `action` (see EntityActionStateComponent, shared) is the authoritative idle/walk
 * selector. `action` is the server's own ActionState bitmask, also passed straight through
 * unmodified (see SnapshotBuffer.InterpolatedEntity.action) — not itself interpolated, since
 * it's a discrete flag set rather than a continuous value.
 */
export class InterpolationComponent extends Component {
  x: number;
  y: number;
  angle: number;
  speed: number;
  action: number;

  constructor(entityId: EntityId, x = 0, y = 0, angle = 0, speed = 0, action = 0) {
    super(entityId);
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = speed;
    this.action = action;
  }
}
