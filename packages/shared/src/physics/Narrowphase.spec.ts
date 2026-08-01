import { describe, expect, it } from 'vitest';
import { testCircleCircle, testRectRect, testCircleRect } from './Narrowphase';
import { circle, rect } from './Shapes';

describe('testCircleCircle', () => {
  it('returns null when circles are far apart', () => {
    expect(testCircleCircle(0, 0, circle(1), 10, 10, circle(1))).toBeNull();
  });

  it('returns null when circles exactly touch (no overlap)', () => {
    expect(testCircleCircle(0, 0, circle(1), 2, 0, circle(1))).toBeNull();
  });

  it('detects overlap with correct normal and depth', () => {
    const manifold = testCircleCircle(0, 0, circle(1), 1, 0, circle(1));
    expect(manifold).not.toBeNull();
    expect(manifold!.normal.x).toBeCloseTo(1, 5);
    expect(manifold!.normal.y).toBeCloseTo(0, 5);
    expect(manifold!.depth).toBeCloseTo(1, 5); // radii sum 2, distance 1 -> depth 1
  });

  it('normal points from a toward b', () => {
    const manifold = testCircleCircle(5, 5, circle(2), 3, 5, circle(2));
    expect(manifold!.normal.x).toBeCloseTo(-1, 5);
    expect(manifold!.normal.y).toBeCloseTo(0, 5);
  });

  it('handles exactly coincident centers without dividing by zero', () => {
    const manifold = testCircleCircle(3, 3, circle(1), 3, 3, circle(1));
    expect(manifold).not.toBeNull();
    expect(Number.isFinite(manifold!.normal.x)).toBe(true);
    expect(Number.isFinite(manifold!.normal.y)).toBe(true);
    expect(manifold!.depth).toBeCloseTo(2, 5);
  });
});

describe('testRectRect', () => {
  it('returns null when rects are far apart', () => {
    expect(testRectRect(0, 0, rect(2, 2), 10, 10, rect(2, 2))).toBeNull();
  });

  it('returns null when rects exactly touch (no overlap)', () => {
    expect(testRectRect(0, 0, rect(2, 2), 2, 0, rect(2, 2))).toBeNull();
  });

  it('resolves along the smaller-overlap axis (x)', () => {
    // a: [-1,1]x[-1,1], b centered at (1.5,0): [0.5,2.5]x[-1,1] -> x-overlap 0.5, y-overlap 2
    const manifold = testRectRect(0, 0, rect(2, 2), 1.5, 0, rect(2, 2));
    expect(manifold).not.toBeNull();
    expect(manifold!.normal.y).toBe(0);
    expect(manifold!.normal.x).toBeCloseTo(1, 5);
    expect(manifold!.depth).toBeCloseTo(0.5, 5);
  });

  it('resolves along the smaller-overlap axis (y)', () => {
    const manifold = testRectRect(0, 0, rect(2, 2), 0, 1.5, rect(2, 2));
    expect(manifold).not.toBeNull();
    expect(manifold!.normal.x).toBe(0);
    expect(manifold!.normal.y).toBeCloseTo(1, 5);
    expect(manifold!.depth).toBeCloseTo(0.5, 5);
  });
});

describe('testCircleRect', () => {
  it('returns null when circle is far from the rect', () => {
    expect(testCircleRect(10, 10, circle(1), 0, 0, rect(2, 2))).toBeNull();
  });

  it('detects overlap when circle center is outside the rect', () => {
    // rect spans [-1,1]x[-1,1]; circle centered at (2,0) radius 1.5 reaches x=0.5, inside the rect's edge at x=1
    const manifold = testCircleRect(2, 0, circle(1.5), 0, 0, rect(2, 2));
    expect(manifold).not.toBeNull();
    // Normal points from the circle (first shape, A) toward the rect (second shape, B):
    // the rect sits to the LEFT of the circle here, so the A->B normal points -x.
    expect(manifold!.normal.x).toBeCloseTo(-1, 5);
    expect(manifold!.normal.y).toBeCloseTo(0, 5);
    expect(manifold!.depth).toBeCloseTo(0.5, 5); // closest point (1,0), distance 1, radius 1.5
  });

  it('detects overlap when circle center is deep inside the rect', () => {
    const manifold = testCircleRect(0, 0, circle(0.5), 0, 0, rect(4, 4));
    expect(manifold).not.toBeNull();
    expect(manifold!.depth).toBeGreaterThan(0);
    expect(Number.isFinite(manifold!.normal.x)).toBe(true);
    expect(Number.isFinite(manifold!.normal.y)).toBe(true);
  });

  it('returns null when circle exactly touches the rect boundary', () => {
    expect(testCircleRect(2, 0, circle(1), 0, 0, rect(2, 2))).toBeNull();
  });
});
