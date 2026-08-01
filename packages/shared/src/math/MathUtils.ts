export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp: given a value between a and b, returns its 0..1 fraction. */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) {
    return 0;
  }
  return (value - a) / (b - a);
}
