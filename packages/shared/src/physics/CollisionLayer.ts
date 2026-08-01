/**
 * Bitmask collision layers/groups — standard "layer + mask" pattern (as used by Unity,
 * Box2D, etc.): each collider belongs to exactly one `layer` and declares which layers
 * it `collidesWith` via a bitwise-OR'd mask. Two colliders are tested against each other
 * only if each one's mask includes the other's layer — this is what lets, e.g., players
 * pass through each other while both still collide with world geometry, without a
 * special-cased "is this pair both players" check in CollisionSystem itself.
 *
 * Values are individual bits (1, 2, 4, 8...) so they compose with `|` into a mask.
 * Add new layers here as gameplay needs them (e.g. Projectile, Mob) rather than
 * introducing a separate ad-hoc flag on the collider components.
 */
export enum CollisionLayer {
  World = 1 << 0,
  Player = 1 << 1,
}

/** Every layer — the common case for static world geometry, which should collide with everything. */
export const ALL_LAYERS = 0xffffffff;

export function layersCollide(layerA: number, maskA: number, layerB: number, maskB: number): boolean {
  return (maskA & layerB) !== 0 && (maskB & layerA) !== 0;
}
