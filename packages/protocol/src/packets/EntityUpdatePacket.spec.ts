import { describe, expect, it } from 'vitest';
import { encodeEntityUpdate, decodeEntityUpdate, type EntityUpdatePacket } from './EntityUpdatePacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: EntityUpdatePacket): EntityUpdatePacket {
  const buffer = encodeEntityUpdate(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeEntityUpdate();
  endRead();
  return result;
}

describe('EntityUpdatePacket', () => {
  it('round-trips with zero entities', () => {
    const packet: EntityUpdatePacket = { serverTick: 100, entities: [] };
    expect(roundTrip(packet)).toEqual(packet);
  });

  it('round-trips with a single entity', () => {
    const packet: EntityUpdatePacket = {
      serverTick: 100,
      entities: [{ entityId: 7, x: 12.5, y: -3.25, speed: 200 }],
    };
    const result = roundTrip(packet);
    expect(result.serverTick).toBe(100);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.entityId).toBe(7);
    expect(result.entities[0]!.x).toBeCloseTo(12.5, 5);
    expect(result.entities[0]!.y).toBeCloseTo(-3.25, 5);
    expect(result.entities[0]!.speed).toBeCloseTo(200, 5);
  });

  it('round-trips with many entities preserving order', () => {
    const entities = Array.from({ length: 50 }, (_, i) => ({
      entityId: i,
      x: i * 1.5,
      y: -i * 0.5,
      speed: i % 2 === 0 ? 200 : 350,
    }));
    const packet: EntityUpdatePacket = { serverTick: 999, entities };
    const result = roundTrip(packet);
    expect(result.entities).toHaveLength(50);
    result.entities.forEach((entity, i) => {
      expect(entity.entityId).toBe(i);
      expect(entity.x).toBeCloseTo(i * 1.5, 4);
      expect(entity.y).toBeCloseTo(-i * 0.5, 4);
      expect(entity.speed).toBeCloseTo(i % 2 === 0 ? 200 : 350, 4);
    });
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodeEntityUpdate({
      serverTick: 0,
      entities: [{ entityId: 1, x: 0, y: 0, speed: 0 }],
    });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.EntityUpdate);
    expect(header.length).toBe(6 + 16);
  });
});
