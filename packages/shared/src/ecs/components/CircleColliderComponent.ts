import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

/** Circular collision shape centered on the entity's PositionComponent. */
export class CircleColliderComponent extends Component {
  radius: number;

  constructor(entityId: EntityId, radius: number) {
    super(entityId);
    this.radius = radius;
  }
}
