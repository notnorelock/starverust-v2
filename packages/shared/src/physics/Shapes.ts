/**
 * Collider shape data — plain value types, no behavior. A collider's shape is always
 * defined relative to its owning entity's PositionComponent (the shape's own x/y here
 * are a local offset, usually {0,0}), so narrowphase functions take the world-space
 * center/bounds explicitly rather than reading position off the shape itself.
 */
export interface CircleShape {
  readonly kind: 'circle';
  readonly radius: number;
}

export interface RectShape {
  readonly kind: 'rect';
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export type ColliderShape = CircleShape | RectShape;

export function circle(radius: number): CircleShape {
  return { kind: 'circle', radius };
}

export function rect(width: number, height: number): RectShape {
  return { kind: 'rect', halfWidth: width / 2, halfHeight: height / 2 };
}
