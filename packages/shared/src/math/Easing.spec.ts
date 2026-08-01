import { describe, expect, it } from 'vitest';
import { Ease, Ease2D, easeOutQuad, easeInOutCubic } from './Easing';

describe('easing functions', () => {
  it('easeOutQuad maps 0 -> 0 and 1 -> 1', () => {
    expect(easeOutQuad(0)).toBe(0);
    expect(easeOutQuad(1)).toBe(1);
  });

  it('easeInOutCubic maps 0 -> 0 and 1 -> 1', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });
});

describe('Ease', () => {
  it('starts at the initial value with no target change', () => {
    const ease = new Ease(5, 1, easeOutQuad);
    expect(ease.value).toBe(5);
    ease.update(0.5);
    expect(ease.value).toBe(5);
  });

  it('moves toward the target over the given duration and settles exactly on completion', () => {
    const ease = new Ease(0, 1, easeOutQuad);
    ease.setTarget(10);

    ease.update(0.5);
    expect(ease.value).toBeGreaterThan(0);
    expect(ease.value).toBeLessThan(10);

    ease.update(0.5);
    expect(ease.value).toBe(10);
  });

  it('clamps to the target if dt overshoots the duration', () => {
    const ease = new Ease(0, 1, easeOutQuad);
    ease.setTarget(10);
    ease.update(100);
    expect(ease.value).toBe(10);
  });

  it('re-targeting mid-flight restarts the ease from the current value', () => {
    const ease = new Ease(0, 1, easeOutQuad);
    ease.setTarget(10);
    ease.update(0.5);
    const midValue = ease.value;

    ease.setTarget(20);
    ease.update(0); // no time elapsed yet — should still read the same as before retarget
    expect(ease.value).toBe(midValue);
  });
});

describe('Ease2D', () => {
  it('eases both axes independently toward the target point', () => {
    const ease = new Ease2D(0, 0, 1, easeOutQuad);
    ease.setTarget(10, -10);

    ease.update(1);

    expect(ease.x).toBe(10);
    expect(ease.y).toBe(-10);
  });

  it('does nothing when the target equals the current position', () => {
    const ease = new Ease2D(5, 5, 1, easeOutQuad);
    ease.setTarget(5, 5);
    ease.update(0.5);
    expect(ease.x).toBe(5);
    expect(ease.y).toBe(5);
  });
});
