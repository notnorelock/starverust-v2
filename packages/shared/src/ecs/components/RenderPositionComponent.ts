import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

/**
 * The broadcast-facing position — chases PositionComponent (the authoritative movement
 * target) at a constant speed every tick, rather than being identical to it. Ported from
 * a reference implementation's `pos`/`pos.r` split: `PositionComponent` is the target,
 * updated by MovementSystem (throttled — see MovementSystem's doc comment); this
 * component is what PositionSmoothingSystem eases toward that target every single tick,
 * and it's what SnapshotSerializer actually puts on the wire. Separating the two is what
 * lets the target jump in coarse, infrequent steps while the value clients see still
 * glides continuously.
 */
export class RenderPositionComponent extends Component {
  x: number;
  y: number;

  constructor(entityId: EntityId, x = 0, y = 0) {
    super(entityId);
    this.x = x;
    this.y = y;
  }
}
