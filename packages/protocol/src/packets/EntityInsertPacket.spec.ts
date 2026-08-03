import { describe, expect, it } from 'vitest';
import { encodeEntityInsert, decodeEntityInsert, type EntityInsertPacket } from './EntityInsertPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: EntityInsertPacket): EntityInsertPacket {
  const buffer = encodeEntityInsert(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeEntityInsert();
  endRead();
  return result;
}

describe('EntityInsertPacket', () => {
  it('round-trips entityId, entityType, and position', () => {
    const packet: EntityInsertPacket = { entityId: 7, entityType: 0, x: 12.5, y: -3.25 };
    const result = roundTrip(packet);
    expect(result.entityId).toBe(7);
    expect(result.entityType).toBe(0);
    expect(result.x).toBeCloseTo(12.5, 5);
    expect(result.y).toBeCloseTo(-3.25, 5);
  });

  it('round-trips a non-default entityType', () => {
    const packet: EntityInsertPacket = { entityId: 42, entityType: 1, x: 0, y: 0 };
    const result = roundTrip(packet);
    expect(result.entityType).toBe(1);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodeEntityInsert({ entityId: 0, entityType: 0, x: 0, y: 0 });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.EntityInsert);
    expect(header.length).toBe(13);
  });
});
