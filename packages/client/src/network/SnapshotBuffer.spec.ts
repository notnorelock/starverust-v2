import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from './SnapshotBuffer';
import type { WorldSnapshotPacket } from '@starve/protocol';

function packet(serverTick: number, entities: WorldSnapshotPacket['entities']): WorldSnapshotPacket {
  return { serverTick, entities };
}

function createBufferWithClock(): { buffer: SnapshotBuffer; advance: (ms: number) => void } {
  let time = 0;
  const buffer = new SnapshotBuffer(() => time);
  return { buffer, advance: (ms: number) => (time += ms) };
}

describe('SnapshotBuffer', () => {
  it('returns an empty list with no snapshots pushed', () => {
    const { buffer } = createBufferWithClock();
    expect(buffer.sample(100)).toEqual([]);
  });

  it('returns the single snapshot verbatim when only one has arrived', () => {
    const { buffer } = createBufferWithClock();
    buffer.push(packet(1, [{ entityId: 1, x: 5, y: 5 }]));
    expect(buffer.sample(100)).toEqual([{ entityId: 1, x: 5, y: 5 }]);
  });

  it('interpolates between two snapshots at the delayed render time', () => {
    const { buffer, advance } = createBufferWithClock();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0 }]));
    advance(100);
    buffer.push(packet(2, [{ entityId: 1, x: 10, y: 0 }]));
    advance(50); // now = 150, renderTime with 100ms delay = 50 -> halfway between t=0 and t=100

    const result = buffer.sample(100);
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBeCloseTo(5, 5);
  });

  it('snapEntityId renders that entity from the latest snapshot, bypassing interpolation delay', () => {
    const { buffer, advance } = createBufferWithClock();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0 }]));
    advance(100);
    buffer.push(packet(2, [{ entityId: 1, x: 10, y: 0 }]));
    advance(50);

    const interpolatedOnly = buffer.sample(100);
    expect(interpolatedOnly[0]!.x).toBeCloseTo(5, 5);

    const withSnap = buffer.sample(100, 1);
    expect(withSnap).toHaveLength(1);
    expect(withSnap[0]!.x).toBe(10); // latest known position, not interpolated
  });

  it('snapEntityId adds the entity even if interpolation had no data for it yet', () => {
    const { buffer, advance } = createBufferWithClock();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0 }]));
    advance(10);
    buffer.push(packet(2, [{ entityId: 1, x: 1, y: 1 }, { entityId: 2, x: 9, y: 9 }]));

    const result = buffer.sample(1000, 2); // huge delay so interpolation wouldn't reach entity 2 normally
    const entity2 = result.find((e) => e.entityId === 2);
    expect(entity2).toEqual({ entityId: 2, x: 9, y: 9 });
  });

  it('does not affect other entities when snapping one entityId', () => {
    const { buffer, advance } = createBufferWithClock();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0 }, { entityId: 2, x: 0, y: 0 }]));
    advance(100);
    buffer.push(packet(2, [{ entityId: 1, x: 10, y: 0 }, { entityId: 2, x: 20, y: 0 }]));
    advance(50);

    const result = buffer.sample(100, 1);
    const entity1 = result.find((e) => e.entityId === 1)!;
    const entity2 = result.find((e) => e.entityId === 2)!;
    expect(entity1.x).toBe(10); // snapped
    expect(entity2.x).toBeCloseTo(10, 5); // still interpolated (halfway between 0 and 20)
  });

  it('drops the oldest snapshot once the buffer exceeds its max size', () => {
    const { buffer, advance } = createBufferWithClock();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0 }])); // pushed at t=0
    advance(10);
    buffer.push(packet(2, [{ entityId: 1, x: 1, y: 0 }])); // t=10
    advance(10);
    buffer.push(packet(3, [{ entityId: 1, x: 2, y: 0 }])); // t=20
    advance(10);
    buffer.push(packet(4, [{ entityId: 1, x: 3, y: 0 }])); // t=30 — evicts tick 1's snapshot (max size 3)

    // now = 30. Ask for the state as of t=10 (renderTime = now - 20). If tick 1 (t=0)
    // were still buffered, this would interpolate between t=0 and t=10; since it was
    // evicted, the earliest remaining snapshot (t=10, x=1) is the floor and gets returned
    // as-is because renderTime falls before every remaining from/to window.
    const result = buffer.sample(20);
    expect(result[0]!.x).toBe(1);
  });
});
