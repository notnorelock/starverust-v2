import type { CollisionManifold } from './Manifold';

export interface ResolutionTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Separates two overlapping bodies along the manifold normal, splitting the correction
 * by inverse mass (heavier bodies move less) — a static body has "infinite" mass, so it
 * doesn't move at all and the dynamic body absorbs the full correction. Mutates `a`/`b`
 * in place (their x/y) rather than returning new objects — called once per colliding pair
 * per tick from CollisionSystem's hot loop, so this avoids an allocation per collision.
 */
export function separate(a: ResolutionTarget, aInverseMass: number, b: ResolutionTarget, bInverseMass: number, manifold: CollisionManifold): void {
  const totalInverseMass = aInverseMass + bInverseMass;
  if (totalInverseMass === 0) {
    return; // both bodies are static/infinite-mass — nothing can move to resolve this.
  }

  const aRatio = aInverseMass / totalInverseMass;
  const bRatio = bInverseMass / totalInverseMass;

  a.x -= manifold.normal.x * manifold.depth * aRatio;
  a.y -= manifold.normal.y * manifold.depth * aRatio;
  b.x += manifold.normal.x * manifold.depth * bRatio;
  b.y += manifold.normal.y * manifold.depth * bRatio;
}

/**
 * Removes the velocity component pointing INTO the collision normal while preserving the
 * component tangential to it — this is what produces "sliding along a wall" instead of
 * an abrupt full stop when a moving body hits a surface at an angle. `normal` must point
 * away from the surface being slid along (from the other body toward `target`).
 */
export function slideAlongNormal(target: ResolutionTarget, normalX: number, normalY: number): void {
  const velocityIntoNormal = target.vx * normalX + target.vy * normalY;
  if (velocityIntoNormal >= 0) {
    return; // already moving away from (or parallel to) the surface — nothing to remove.
  }
  target.vx -= velocityIntoNormal * normalX;
  target.vy -= velocityIntoNormal * normalY;
}

export function inverseMass(mass: number, isStatic: boolean): number {
  if (isStatic || mass <= 0) {
    return 0;
  }
  return 1 / mass;
}
