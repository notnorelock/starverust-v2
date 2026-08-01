import type { VelocityComponent } from '../ecs/components/VelocityComponent';

/**
 * Applies an instantaneous velocity impulse away from a source point — the shared
 * primitive behind both collision-response knockback (CollisionSystem, for
 * fast/heavy-object impacts) and future combat knockback (a later stage's CombatSystem
 * calling this on hit). Kept here rather than inlined in CollisionSystem so both callers
 * share one implementation instead of duplicating "normalize direction, scale by force."
 */
export function applyKnockback(
  velocity: VelocityComponent,
  targetX: number,
  targetY: number,
  sourceX: number,
  sourceY: number,
  force: number,
): void {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance === 0) {
    // Coincident points — knock in an arbitrary fixed direction rather than divide by zero.
    velocity.vx += force;
    return;
  }

  velocity.vx += (dx / distance) * force;
  velocity.vy += (dy / distance) * force;
}
