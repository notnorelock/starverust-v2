import { describe, expect, it } from 'vitest';
import { SpatialHashGrid } from './SpatialHashGrid';

describe('SpatialHashGrid', () => {
  it('pairs entities inserted into the same cell', () => {
    const grid = new SpatialHashGrid(10);
    grid.insert(1, 0, 0, 1, 1);
    grid.insert(2, 0.5, 0.5, 1.5, 1.5);

    const pairs: Array<[number, number]> = [];
    grid.forEachPair((a, b) => pairs.push([a, b]));

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([1, 2]);
  });

  it('does not pair entities in cells far apart', () => {
    const grid = new SpatialHashGrid(10);
    grid.insert(1, 0, 0, 1, 1);
    grid.insert(2, 100, 100, 101, 101);

    const pairs: Array<[number, number]> = [];
    grid.forEachPair((a, b) => pairs.push([a, b]));

    expect(pairs).toHaveLength(0);
  });

  it('pairs entities whose AABBs span multiple cells and overlap at a boundary', () => {
    const grid = new SpatialHashGrid(10);
    // Entity 1 spans cells (0,0) and (1,0); entity 2 sits only in cell (1,0).
    grid.insert(1, 5, 0, 15, 1);
    grid.insert(2, 12, 0, 13, 1);

    const pairs: Array<[number, number]> = [];
    grid.forEachPair((a, b) => pairs.push([a, b]));

    expect(pairs).toHaveLength(1);
  });

  it('clear() empties all buckets so a stale pair is not reported after a re-insert cycle', () => {
    const grid = new SpatialHashGrid(10);
    grid.insert(1, 0, 0, 1, 1);
    grid.insert(2, 0, 0, 1, 1);

    grid.clear();
    grid.insert(1, 0, 0, 1, 1); // entity 2 not re-inserted this cycle

    const pairs: Array<[number, number]> = [];
    grid.forEachPair((a, b) => pairs.push([a, b]));

    expect(pairs).toHaveLength(0);
  });

  it('reports a pair multiple times if the entities share more than one cell (caller must dedupe)', () => {
    const grid = new SpatialHashGrid(10);
    // Both entities span the same two cells, so they'll be seen together in each cell's bucket.
    grid.insert(1, 5, 0, 15, 1);
    grid.insert(2, 5, 0, 15, 1);

    const pairs: Array<[number, number]> = [];
    grid.forEachPair((a, b) => pairs.push([a, b]));

    expect(pairs.length).toBeGreaterThanOrEqual(2);
  });

  describe('queryRegion', () => {
    it('returns entities whose cells overlap the queried region', () => {
      const grid = new SpatialHashGrid(10);
      grid.insert(1, 0, 0, 1, 1);
      grid.insert(2, 100, 100, 101, 101);

      const result = grid.queryRegion(-5, -5, 5, 5);

      expect(result).toEqual([1]);
    });

    it('returns an empty array when nothing overlaps the region', () => {
      const grid = new SpatialHashGrid(10);
      grid.insert(1, 100, 100, 101, 101);

      expect(grid.queryRegion(-5, -5, 5, 5)).toEqual([]);
    });

    it('deduplicates an entity spanning multiple cells within the queried region', () => {
      const grid = new SpatialHashGrid(10);
      grid.insert(1, 5, 0, 15, 1); // spans cells (0,0) and (1,0)

      const result = grid.queryRegion(-50, -50, 50, 50);

      expect(result).toEqual([1]);
    });
  });
});
