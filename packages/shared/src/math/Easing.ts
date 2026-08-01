/** Pure t -> t easing curves, t in [0, 1]. Used by Ease/Ease2D and any hand-driven tween. */
export type EasingFunction = (t: number) => number;

export const easeOutQuad: EasingFunction = (t) => t * (2 - t);
export const easeOutCubic: EasingFunction = (t) => --t * t * t + 1;
export const easeInOutQuad: EasingFunction = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
export const easeInOutCubic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
export const easeInOutQuart: EasingFunction = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t;
export const easeOutQuart: EasingFunction = (t) => 1 - --t * t * t * t;
export const easeOutQuint: EasingFunction = (t) => 1 + --t * t * t * t * t;

/**
 * Drives a single scalar toward a target value over a fixed duration using an easing
 * curve. Call `setTarget()` when the destination changes, `update(dt)` once per frame/tick.
 */
export class Ease {
  private startValue: number;
  private targetValue: number;
  private elapsed = 0;

  constructor(
    private currentValue: number,
    private readonly duration: number,
    private readonly fn: EasingFunction = easeOutQuad,
  ) {
    this.startValue = currentValue;
    this.targetValue = currentValue;
  }

  get value(): number {
    return this.currentValue;
  }

  setTarget(target: number): void {
    if (target === this.targetValue) {
      return;
    }
    this.startValue = this.currentValue;
    this.targetValue = target;
    this.elapsed = 0;
  }

  update(dt: number): void {
    if (this.currentValue === this.targetValue) {
      return;
    }
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.currentValue = this.targetValue;
      return;
    }
    const t = this.fn(this.elapsed / this.duration);
    this.currentValue = this.startValue + (this.targetValue - this.startValue) * t;
  }
}

/** Two-dimensional counterpart of Ease — eases x/y toward a target point together. */
export class Ease2D {
  private startX: number;
  private startY: number;
  private targetX: number;
  private targetY: number;
  private elapsed = 0;

  constructor(
    private currentX: number,
    private currentY: number,
    private readonly duration: number,
    private readonly fn: EasingFunction = easeOutQuad,
  ) {
    this.startX = currentX;
    this.startY = currentY;
    this.targetX = currentX;
    this.targetY = currentY;
  }

  get x(): number {
    return this.currentX;
  }

  get y(): number {
    return this.currentY;
  }

  setTarget(x: number, y: number): void {
    if (x === this.targetX && y === this.targetY) {
      return;
    }
    this.startX = this.currentX;
    this.startY = this.currentY;
    this.targetX = x;
    this.targetY = y;
    this.elapsed = 0;
  }

  update(dt: number): void {
    if (this.currentX === this.targetX && this.currentY === this.targetY) {
      return;
    }
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.currentX = this.targetX;
      this.currentY = this.targetY;
      return;
    }
    const t = this.fn(this.elapsed / this.duration);
    this.currentX = this.startX + (this.targetX - this.startX) * t;
    this.currentY = this.startY + (this.targetY - this.startY) * t;
  }
}
