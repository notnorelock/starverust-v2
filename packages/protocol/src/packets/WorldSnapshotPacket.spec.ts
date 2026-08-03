import { describe, expect, it } from 'vitest';
import { encodeWorldSnapshot, decodeWorldSnapshot, type WorldSnapshotPacket } from './WorldSnapshotPacket';
import { NO_OWNER_PID } from './EntityInsertPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: WorldSnapshotPacket): WorldSnapshotPacket {
  const buffer = encodeWorldSnapshot(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeWorldSnapshot();
  endRead();
  return result;
}

describe('WorldSnapshotPacket', () => {
  it('round-trips with zero entities', () => {
    const packet: WorldSnapshotPacket = { serverTick: 100, entities: [] };
    expect(roundTrip(packet)).toEqual(packet);
  });

  it('round-trips with a single entity, including entityType and ownerPid', () => {
    const packet: WorldSnapshotPacket = {
      serverTick: 100,
      entities: [{ entityId: 7, entityType: 1, ownerPid: 3, x: 12.5, y: -3.25, speed: 200 }],
    };
    const result = roundTrip(packet);
    expect(result.serverTick).toBe(100);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.entityId).toBe(7);
    expect(result.entities[0]!.entityType).toBe(1);
    expect(result.entities[0]!.ownerPid).toBe(3);
    expect(result.entities[0]!.x).toBeCloseTo(12.5, 5);
    expect(result.entities[0]!.y).toBeCloseTo(-3.25, 5);
    expect(result.entities[0]!.speed).toBeCloseTo(200, 5);
  });

  it('round-trips NO_OWNER_PID for unowned entities', () => {
    const packet: WorldSnapshotPacket = {
      serverTick: 0,
      entities: [{ entityId: 1, entityType: 1, ownerPid: NO_OWNER_PID, x: 0, y: 0, speed: 0 }],
    };
    const result = roundTrip(packet);
    expect(result.entities[0]!.ownerPid).toBe(NO_OWNER_PID);
  });

  it('round-trips with many entities preserving order and per-entity entityType/ownerPid', () => {
    const entities = Array.from({ length: 50 }, (_, i) => ({
      entityId: i,
      entityType: i % 2,
      ownerPid: i % 3 === 0 ? NO_OWNER_PID : i,
      x: i * 1.5,
      y: -i * 0.5,
      speed: i % 2 === 0 ? 200 : 350,
    }));
    const packet: WorldSnapshotPacket = { serverTick: 999, entities };
    const result = roundTrip(packet);
    expect(result.entities).toHaveLength(50);
    result.entities.forEach((entity, i) => {
      expect(entity.entityId).toBe(i);
      expect(entity.entityType).toBe(i % 2);
      expect(entity.ownerPid).toBe(i % 3 === 0 ? NO_OWNER_PID : i);
      expect(entity.x).toBeCloseTo(i * 1.5, 4);
      expect(entity.y).toBeCloseTo(-i * 0.5, 4);
      expect(entity.speed).toBeCloseTo(i % 2 === 0 ? 200 : 350, 4);
    });
  });

  it('preserves f32 precision within expected epsilon for random positions', () => {
    const entities = Array.from({ length: 20 }, (_, i) => ({
      entityId: i,
      entityType: 0,
      ownerPid: NO_OWNER_PID,
      x: (Math.random() - 0.5) * 100000,
      y: (Math.random() - 0.5) * 100000,
      speed: Math.random() * 500,
    }));
    const packet: WorldSnapshotPacket = { serverTick: 1, entities };
    const result = roundTrip(packet);
    result.entities.forEach((entity, i) => {
      expect(entity.x).toBeCloseTo(entities[i]!.x, 0);
      expect(entity.y).toBeCloseTo(entities[i]!.y, 0);
      expect(entity.speed).toBeCloseTo(entities[i]!.speed, 0);
    });
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodeWorldSnapshot({
      serverTick: 0,
      entities: [{ entityId: 1, entityType: 0, ownerPid: NO_OWNER_PID, x: 0, y: 0, speed: 0 }],
    });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.WorldSnapshot);
    expect(header.length).toBe(6 + 21);
  });
});
