import type { CircleShape, RectShape } from './Shapes';
import type { CollisionManifold } from './Manifold';

/**
 * Narrowphase collision tests: given two shapes' exact world-space positions, determine
 * whether they overlap and, if so, the manifold (normal + penetration depth) resolution
 * needs. All rects here are axis-aligned (no rotation) — this game is top-down 2D with no
 * need for oriented boxes, so this deliberately skips SAT/rotation math entirely.
 *
 * Every function returns `null` for "not colliding" rather than throwing/allocating a
 * zero-manifold, so the hot broadphase-iteration loop in CollisionSystem can skip
 * non-colliding pairs with a single null check.
 */

export function testCircleCircle(
  ax: number,
  ay: number,
  a: CircleShape,
  bx: number,
  by: number,
  b: CircleShape,
): CollisionManifold | null {
  const dx = bx - ax;
  const dy = by - ay;
  const distanceSquared = dx * dx + dy * dy;
  const radiusSum = a.radius + b.radius;

  if (distanceSquared >= radiusSum * radiusSum) {
    return null;
  }

  const distance = Math.sqrt(distanceSquared);
  if (distance === 0) {
    // Exactly coincident centers — pick an arbitrary separation axis rather than divide by zero.
    return { normal: { x: 1, y: 0 }, depth: radiusSum };
  }

  return {
    normal: { x: dx / distance, y: dy / distance },
    depth: radiusSum - distance,
  };
}

export function testRectRect(
  ax: number,
  ay: number,
  a: RectShape,
  bx: number,
  by: number,
  b: RectShape,
): CollisionManifold | null {
  const dx = bx - ax;
  const dy = by - ay;
  const overlapX = a.halfWidth + b.halfWidth - Math.abs(dx);
  const overlapY = a.halfHeight + b.halfHeight - Math.abs(dy);

  if (overlapX <= 0 || overlapY <= 0) {
    return null;
  }

  // Minimum translation vector: separate along whichever axis has the smaller overlap.
  if (overlapX < overlapY) {
    return { normal: { x: dx < 0 ? -1 : 1, y: 0 }, depth: overlapX };
  }
  return { normal: { x: 0, y: dy < 0 ? -1 : 1 }, depth: overlapY };
}

/**
 * Circle vs. axis-aligned rect. Finds the closest point on the rect to the circle's
 * center (clamping the center into the rect's bounds), then treats that closest point
 * like a zero-radius circle for the standard circle-circle distance test — the closest
 * point handles both "circle center outside the rect" (the common case) and "circle
 * center inside the rect" (deep penetration) correctly.
 */
export function testCircleRect(
  cx: number,
  cy: number,
  c: CircleShape,
  rx: number,
  ry: number,
  r: RectShape,
): CollisionManifold | null {
  const minX = rx - r.halfWidth;
  const maxX = rx + r.halfWidth;
  const minY = ry - r.halfHeight;
  const maxY = ry + r.halfHeight;

  const closestX = clampNumber(cx, minX, maxX);
  const closestY = clampNumber(cy, minY, maxY);

  // dx/dy here point from the rect's closest point TO the circle center — i.e. from the
  // rect (B, the second shape) toward the circle (A, the first shape). Every manifold
  // this module returns must point from A toward B instead (see the module doc comment
  // and Manifold.ts), so the normal below is negated relative to this raw dx/dy.
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distanceSquared = dx * dx + dy * dy;

  if (distanceSquared >= c.radius * c.radius) {
    return null;
  }

  if (distanceSquared === 0) {
    // Circle center is exactly on the rect boundary/inside with zero offset from the
    // closest point (can happen when the center is deep inside the rect) — the shortest
    // escape route is along whichever axis requires the least push. That escape
    // direction is from the RECT (B) toward the CIRCLE (A) — e.g. pushLeft is smallest
    // when the circle sits nearest the rect's left edge, so the circle should escape
    // further left, meaning B->A points left and this module's required A->B normal
    // points the opposite way, right (+1, 0).
    const pushLeft = cx - minX;
    const pushRight = maxX - cx;
    const pushUp = cy - minY;
    const pushDown = maxY - cy;
    const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown);

    if (minPush === pushLeft) return { normal: { x: 1, y: 0 }, depth: pushLeft + c.radius };
    if (minPush === pushRight) return { normal: { x: -1, y: 0 }, depth: pushRight + c.radius };
    if (minPush === pushUp) return { normal: { x: 0, y: 1 }, depth: pushUp + c.radius };
    return { normal: { x: 0, y: -1 }, depth: pushDown + c.radius };
  }

  const distance = Math.sqrt(distanceSquared);
  return {
    normal: { x: -dx / distance, y: -dy / distance },
    depth: c.radius - distance,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
