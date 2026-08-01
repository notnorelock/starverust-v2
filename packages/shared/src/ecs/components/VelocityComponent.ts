import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

export class VelocityComponent extends Component {
  vx: number;
  vy: number;

  constructor(entityId: EntityId, vx = 0, vy = 0) {
    super(entityId);
    this.vx = vx;
    this.vy = vy;
  }
}
