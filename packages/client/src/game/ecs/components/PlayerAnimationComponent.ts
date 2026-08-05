import { Component, type EntityId, PLAYER_MOVE_SPEED, ActionState } from '@starve/shared';
import { LinearAnimation } from '../../../engine/core/LinearAnimation';

/**
 * Idle/walk/sprint arm-position oscillators for one player entity — ported from the
 * reference client's `this.idle`/`this.walk` (see client-old.js, `Utils.LinearAnimation`):
 * an asymmetric triangle wave, not a sine curve, bouncing between fixed min/max bounds at
 * independent rise/fall rates. Exactly one of `idle`/`walk` advances per frame (mutually
 * exclusive, matching the reference's `if (IDLE) idle.update() else if (WALK) walk.update()`
 * branch) — the other holds whatever value it was last left at, frozen, so switching
 * between idle and walking mid-cycle doesn't reset or snap the arm position.
 *
 * The reference has no distinct sprint state or animation at all (only one fixed `speed`
 * per unit, no speed-tier concept) — `walk`'s rise/fall rates are scaled up by the entity's
 * actual speed ratio (current speed / PLAYER_MOVE_SPEED) while sprinting, so a sprinting
 * player's arms swing visibly faster/more energetically than a normal walk instead of
 * playing the identical walk curve at the identical rate regardless of movement speed.
 *
 * Persisted per-entity (like InterpolationComponent) rather than recreated per draw call —
 * a LinearAnimation's `value`/`rising` state must survive across frames to keep advancing
 * smoothly, the same reason InterpolationComponent exists instead of RenderSystem
 * recomputing interpolated position from scratch every frame.
 */
export class PlayerAnimationComponent extends Component {
  readonly idle = new LinearAnimation(true, 0, 2.25, -1.5, 3.75, 7.5);
  readonly walk = new LinearAnimation(true, 0, 7.5, -3, 22.5, 33.75);

  constructor(entityId: EntityId) {
    super(entityId);
  }

  /**
   * Advances the appropriate oscillator based on `action` (the server's own authoritative
   * ActionState bitmask — see EntityActionStateComponent, shared) rather than guessing
   * idle-vs-walk from `speed` alone, and returns the resulting (x, y) arm-position offset —
   * `idle.v` feeds `x`, `walk.v` feeds `y`, matching the reference's own (admittedly
   * non-obvious) variable pairing where `x = this.idle.v` and `y = this.walk.v` regardless
   * of which one is actually moving. `speed` is still used, but only to scale the walk
   * curve's rate for sprinting — see the class doc comment.
   */
  update(dt: number, action: number, speed: number): { x: number; y: number } {
    if ((action & ActionState.Walk) !== 0) {
      // Scales the walk curve's rate by how much faster than a normal walk this entity is
      // currently moving — sprinting (PLAYER_SPRINT_SPEED) plays the same curve shape at
      // 1.75x speed (350/200) rather than an unrelated new animation.
      const speedRatio = speed / PLAYER_MOVE_SPEED;
      this.walk.update(dt * speedRatio);
    } else {
      this.idle.update(dt);
    }

    return { x: this.idle.v, y: this.walk.v };
  }
}
