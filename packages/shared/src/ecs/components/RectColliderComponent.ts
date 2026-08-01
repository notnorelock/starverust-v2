import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

/** Axis-aligned rectangular collision shape centered on the entity's PositionComponent. */
export class RectColliderComponent extends Component {
  halfWidth: number;
  halfHeight: number;

  constructor(entityId: EntityId, width: number, height: number) {
    super(entityId);
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
  }
}
