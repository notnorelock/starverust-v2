/**
 * Asymmetric triangle-wave oscillator — ported from the reference client's
 * `Utils.LinearAnimation` (see client-old.js): a value bounces between `min` and `max`,
 * rising at `riseSpeed` units/second and falling at `fallSpeed` units/second (the two
 * rates are independent, producing an asymmetric wave rather than a symmetric one — e.g.
 * the reference's walk-arm-swing rises at 22.5/s but falls at 33.75/s, so it snaps back
 * faster than it swings out). Deliberately a triangle wave, not `Math.sin`/`Math.cos` — the
 * reference never used a sinusoidal oscillator for this, and reproducing its exact visual
 * rhythm depends on the asymmetric linear rise/fall, not a smooth curve.
 *
 * Driven by wall-clock `dt` (seconds), not distance traveled or server ticks — matching
 * the reference's own `delta`-driven update, independent of how far the entity actually
 * moved that frame. Used for the player's idle/walk/sprint arm-position oscillation (see
 * PlayerAnimationComponent), but generic enough for any other bounded back-and-forth value
 * a future feature might need.
 */
export class LinearAnimation {
  private rising: boolean;
  private value: number;

  constructor(
    startRising: boolean,
    startValue: number,
    private readonly max: number,
    private readonly min: number,
    private readonly riseSpeed: number,
    private readonly fallSpeed: number,
  ) {
    this.rising = startRising;
    this.value = startValue;
  }

  get v(): number {
    return this.value;
  }

  update(dt: number): void {
    if (this.rising) {
      const next = this.value + dt * this.riseSpeed;
      if (next > this.max) {
        this.value = this.max;
        this.rising = false;
      } else {
        this.value = next;
      }
    } else {
      const next = this.value - dt * this.fallSpeed;
      if (next < this.min) {
        this.value = this.min;
        this.rising = true;
      } else {
        this.value = next;
      }
    }
  }
}
