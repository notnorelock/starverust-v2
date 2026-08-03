import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

/**
 * Bit flags for an entity's current action, composed with `|=`/`-=` the same way
 * PlayerInputPacket's direction bitmask is — see the protocol networking notes for that
 * pattern. Ported from a reference implementation's `b.action` field, where WALK/IDLE
 * were toggled based on whether the render position still needed to catch up to its
 * movement target.
 */
export enum ActionState {
  Idle = 1 << 0,
  Walk = 1 << 1,
}

/**
 * Tracks which ActionState flags are currently set on an entity. PositionSmoothingSystem
 * toggles Idle/Walk each tick based on whether RenderPositionComponent has fully caught
 * up to PositionComponent (the movement target) — see that system for the toggling logic.
 */
export class EntityActionStateComponent extends Component {
  action: number;

  constructor(entityId: EntityId, action: number = ActionState.Idle) {
    super(entityId);
    this.action = action;
  }
}
