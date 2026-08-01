/** Immutable-by-convention 2D vector value type and free-function math helpers. */
export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export function vec2(x: number, y: number): Vector2 {
  return { x, y };
}

export const ZERO: Vector2 = vec2(0, 0);

export function add(a: Vector2, b: Vector2): Vector2 {
  return vec2(a.x + b.x, a.y + b.y);
}

export function subtract(a: Vector2, b: Vector2): Vector2 {
  return vec2(a.x - b.x, a.y - b.y);
}

export function scale(v: Vector2, scalar: number): Vector2 {
  return vec2(v.x * scalar, v.y * scalar);
}

export function length(v: Vector2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function normalize(v: Vector2): Vector2 {
  const len = length(v);
  if (len === 0) {
    return ZERO;
  }
  return vec2(v.x / len, v.y / len);
}

export function lerp(a: Vector2, b: Vector2, t: number): Vector2 {
  return vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}
