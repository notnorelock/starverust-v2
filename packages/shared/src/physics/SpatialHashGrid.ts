import type { EntityId } from '../ecs/core/EntityId';

/**
 * Uniform spatial hash grid for broadphase collision — bucket entities by which grid
 * cell(s) their AABB overlaps, so narrowphase only runs on pairs that share a cell
 * instead of every possible pair (O(n^2) -> roughly O(n) for evenly-distributed entities).
 *
 * Reused across ticks rather than reallocated: `clear()` empties the existing bucket Maps
 * in place (Map.clear(), not a new Map) so CollisionSystem can call clear()+insert() every
 * tick without growing the GC's workload — the "avoid allocations in the hot path"
 * requirement applies especially hard here since this runs once per tick for every entity.
 */
export class SpatialHashGrid {
  private readonly buckets = new Map<string, EntityId[]>();

  constructor(private readonly cellSize: number) {}

  clear(): void {
    for (const bucket of this.buckets.values()) {
      bucket.length = 0;
    }
  }

  /** Inserts an entity into every cell its AABB (given by world-space bounds) overlaps. */
  insert(entityId: EntityId, minX: number, minY: number, maxX: number, maxY: number): void {
    const cellMinX = Math.floor(minX / this.cellSize);
    const cellMinY = Math.floor(minY / this.cellSize);
    const cellMaxX = Math.floor(maxX / this.cellSize);
    const cellMaxY = Math.floor(maxY / this.cellSize);

    for (let cy = cellMinY; cy <= cellMaxY; cy += 1) {
      for (let cx = cellMinX; cx <= cellMaxX; cx += 1) {
        this.bucketFor(cx, cy).push(entityId);
      }
    }
  }

  /**
   * Calls `visit` once for every pair of entities that share at least one cell. A pair
   * spanning multiple shared cells is deduplicated by the caller-supplied `visited` set
   * (CollisionSystem owns that set so it can also be reused across ticks) — this method
   * itself doesn't dedupe, since it has no way to cheaply hash an unordered id pair
   * without allocating a string/tuple per pair.
   */
  forEachPair(visit: (a: EntityId, b: EntityId) => void): void {
    for (const bucket of this.buckets.values()) {
      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          visit(bucket[i]!, bucket[j]!);
        }
      }
    }
  }

  private bucketFor(cellX: number, cellY: number): EntityId[] {
    const key = `${cellX},${cellY}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    return bucket;
  }
}
