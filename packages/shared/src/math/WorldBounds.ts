/**
 * A rectangular world boundary, in world units. Deliberately generic/data-only — the
 * actual numbers come from a per-instance source (server's WorldConfig today, a map
 * editor export later), never a hardcoded constant, so different regional server
 * instances can run differently-sized worlds without a shared package change.
 */
export interface WorldBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}
