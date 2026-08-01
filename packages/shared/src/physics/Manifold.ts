/**
 * Result of a narrowphase collision test between two shapes that ARE overlapping.
 * `normal` points from shape A toward shape B (unit vector); `depth` is how far they
 * overlap along that normal — resolution pushes A backward and B forward along `normal`
 * by (a fraction of) `depth` to separate them.
 */
export interface CollisionManifold {
  readonly normal: { readonly x: number; readonly y: number };
  readonly depth: number;
}

/** No allocation for the common "not colliding" case — callers check this sentinel. */
export const NO_COLLISION: CollisionManifold | null = null;
