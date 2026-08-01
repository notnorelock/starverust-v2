import { describe, expect, it } from 'vitest';
import { computeSubstepCount } from './ContinuousCollision';

describe('computeSubstepCount', () => {
  it('returns 1 for small displacement relative to collider radius', () => {
    expect(computeSubstepCount(0.1, 0, 1)).toBe(1);
  });

  it('returns 1 for zero displacement', () => {
    expect(computeSubstepCount(0, 0, 1)).toBe(1);
  });

  it('returns more than 1 when displacement exceeds half the collider radius', () => {
    const substeps = computeSubstepCount(10, 0, 1);
    expect(substeps).toBeGreaterThan(1);
  });

  it('scales substep count with displacement magnitude', () => {
    const small = computeSubstepCount(2, 0, 1);
    const large = computeSubstepCount(20, 0, 1);
    expect(large).toBeGreaterThan(small);
  });

  it('returns 1 for a zero or negative collider radius (avoids divide-by-zero)', () => {
    expect(computeSubstepCount(100, 100, 0)).toBe(1);
    expect(computeSubstepCount(100, 100, -1)).toBe(1);
  });

  it('accounts for diagonal displacement (both axes combined)', () => {
    const axisOnly = computeSubstepCount(5, 0, 1);
    const diagonal = computeSubstepCount(5, 5, 1);
    expect(diagonal).toBeGreaterThanOrEqual(axisOnly);
  });
});
