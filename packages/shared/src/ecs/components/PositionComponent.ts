import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

export class PositionComponent extends Component {
  x: number;
  y: number;

  constructor(entityId: EntityId, x = 0, y = 0) {
    super(entityId);
    this.x = x;
    this.y = y;
  }
}
