/**
 * Continuous collision detection for fast-moving small entities (e.g. projectiles) that
 * could otherwise "tunnel" through a thin/small collider entirely within one tick — a
 * discrete end-of-tick position check never sees the collision because the entity was on
 * one side of the obstacle at tick start and the other side at tick end, with no sample
 * point in between landing inside it.
 *
 * Approach: conservative sub-stepping, not full swept-shape/conservative-advancement CCD.
 * If a tick's displacement exceeds a fraction of the entity's own collision radius, the
 * movement is checked in N smaller sub-steps instead of one — cheap, no new geometry math
 * needed (reuses the same narrowphase tests at each sub-step), and sufficient for a top-down
 * 2D game's projectile speeds. A full swept-circle-vs-shape solver would be more precise for
 * extreme speeds but isn't needed at this game's scale.
 */

const CCD_SUBSTEP_FRACTION = 0.5; // require a sub-step whenever displacement exceeds half the collider's radius

/**
 * Returns how many sub-steps a tick's movement should be split into for a given collider
 * radius, so no single sub-step's displacement exceeds `CCD_SUBSTEP_FRACTION * radius`.
 * Returns 1 (no splitting needed) for normal-speed movement.
 */
export function computeSubstepCount(displacementX: number, displacementY: number, colliderRadius: number): number {
  if (colliderRadius <= 0) {
    return 1;
  }
  const displacement = Math.sqrt(displacementX * displacementX + displacementY * displacementY);
  const maxStepDistance = colliderRadius * CCD_SUBSTEP_FRACTION;
  if (displacement <= maxStepDistance) {
    return 1;
  }
  return Math.ceil(displacement / maxStepDistance);
}
