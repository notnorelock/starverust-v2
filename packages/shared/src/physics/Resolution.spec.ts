import { describe, expect, it } from 'vitest';
import { separate, slideAlongNormal, inverseMass, type ResolutionTarget } from './Resolution';
import type { CollisionManifold } from './Manifold';

describe('inverseMass', () => {
  it('returns 1/mass for a dynamic body', () => {
    expect(inverseMass(2, false)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 for a static body regardless of mass', () => {
    expect(inverseMass(5, true)).toBe(0);
  });

  it('returns 0 for a non-positive mass', () => {
    expect(inverseMass(0, false)).toBe(0);
    expect(inverseMass(-1, false)).toBe(0);
  });
});

describe('separate', () => {
  const manifold: CollisionManifold = { normal: { x: 1, y: 0 }, depth: 2 };

  it('splits correction evenly between two equal-mass dynamic bodies', () => {
    const a: ResolutionTarget = { x: 0, y: 0, vx: 0, vy: 0 };
    const b: ResolutionTarget = { x: 1, y: 0, vx: 0, vy: 0 };
    separate(a, 1, b, 1, manifold);
    expect(a.x).toBeCloseTo(-1, 5);
    expect(b.x).toBeCloseTo(2, 5);
  });

  it('does not move a static body (inverseMass 0), fully corrects the dynamic one', () => {
    const a: ResolutionTarget = { x: 0, y: 0, vx: 0, vy: 0 };
    const b: ResolutionTarget = { x: 1, y: 0, vx: 0, vy: 0 };
    separate(a, 0, b, 1, manifold);
    expect(a.x).toBe(0);
    expect(b.x).toBeCloseTo(3, 5);
  });

  it('does nothing when both bodies are static (total inverse mass 0)', () => {
    const a: ResolutionTarget = { x: 0, y: 0, vx: 0, vy: 0 };
    const b: ResolutionTarget = { x: 1, y: 0, vx: 0, vy: 0 };
    separate(a, 0, b, 0, manifold);
    expect(a.x).toBe(0);
    expect(b.x).toBe(1);
  });

  it('gives a heavier body (smaller inverse mass) a smaller share of the correction', () => {
    const a: ResolutionTarget = { x: 0, y: 0, vx: 0, vy: 0 }; // heavy: inverseMass 0.25 (mass 4)
    const b: ResolutionTarget = { x: 1, y: 0, vx: 0, vy: 0 }; // light: inverseMass 1 (mass 1)
    separate(a, 0.25, b, 1, manifold);
    const aMovement = Math.abs(a.x - 0);
    const bMovement = Math.abs(b.x - 1);
    expect(aMovement).toBeLessThan(bMovement);
  });
});

describe('slideAlongNormal', () => {
  it('removes velocity moving into the normal, preserves tangential component', () => {
    const target: ResolutionTarget = { x: 0, y: 0, vx: -5, vy: 3 };
    slideAlongNormal(target, 1, 0); // wall normal pointing +x, entity moving -x into it
    expect(target.vx).toBeCloseTo(0, 5);
    expect(target.vy).toBeCloseTo(3, 5); // tangential component untouched
  });

  it('does not change velocity already moving away from the surface', () => {
    // normal (1,0) points away from the surface toward +x; vx=5 is moving further in
    // that same direction (away from the surface), so nothing should be removed.
    const target: ResolutionTarget = { x: 0, y: 0, vx: 5, vy: 0 };
    slideAlongNormal(target, 1, 0);
    expect(target.vx).toBe(5);
    expect(target.vy).toBe(0);
  });

  it('handles a diagonal normal correctly', () => {
    const normalX = Math.SQRT1_2;
    const normalY = Math.SQRT1_2;
    const target: ResolutionTarget = { x: 0, y: 0, vx: -normalX * 10, vy: -normalY * 10 };
    slideAlongNormal(target, normalX, normalY);
    expect(target.vx).toBeCloseTo(0, 4);
    expect(target.vy).toBeCloseTo(0, 4);
  });
});
