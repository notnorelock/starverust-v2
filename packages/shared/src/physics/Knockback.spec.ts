import { describe, expect, it } from 'vitest';
import { applyKnockback } from './Knockback';
import { VelocityComponent } from '../ecs/components/VelocityComponent';

describe('applyKnockback', () => {
  it('adds an impulse pointing away from the source', () => {
    const velocity = new VelocityComponent(1, 0, 0);
    applyKnockback(velocity, 10, 0, 0, 0, 5); // target at (10,0), source at origin -> push +x
    expect(velocity.vx).toBeCloseTo(5, 5);
    expect(velocity.vy).toBeCloseTo(0, 5);
  });

  it('scales the impulse by force regardless of distance (direction is normalized)', () => {
    const near = new VelocityComponent(1, 0, 0);
    const far = new VelocityComponent(2, 0, 0);
    applyKnockback(near, 1, 0, 0, 0, 5);
    applyKnockback(far, 100, 0, 0, 0, 5);
    expect(near.vx).toBeCloseTo(far.vx, 5);
  });

  it('adds to existing velocity rather than replacing it', () => {
    const velocity = new VelocityComponent(1, 2, 3);
    applyKnockback(velocity, 10, 0, 0, 0, 5);
    expect(velocity.vx).toBeCloseTo(7, 5);
    expect(velocity.vy).toBeCloseTo(3, 5);
  });

  it('handles coincident target/source without dividing by zero', () => {
    const velocity = new VelocityComponent(1, 0, 0);
    applyKnockback(velocity, 5, 5, 5, 5, 3);
    expect(Number.isFinite(velocity.vx)).toBe(true);
    expect(Number.isFinite(velocity.vy)).toBe(true);
  });

  it('points diagonally when the source is at an angle', () => {
    const velocity = new VelocityComponent(1, 0, 0);
    applyKnockback(velocity, 1, 1, 0, 0, 10);
    expect(velocity.vx).toBeCloseTo(10 * Math.SQRT1_2, 4);
    expect(velocity.vy).toBeCloseTo(10 * Math.SQRT1_2, 4);
  });
});
