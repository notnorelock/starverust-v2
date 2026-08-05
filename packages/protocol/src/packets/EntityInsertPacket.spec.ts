import { describe, expect, it } from 'vitest';
import { encodeEntityInsert, decodeEntityInsert, NO_OWNER_PID, type EntityInsertPacket } from './EntityInsertPacket';
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
  it('round-trips entityId, entityType, ownerPid, and position', () => {
    const packet: EntityInsertPacket = { entityId: 7, entityType: 0, ownerPid: 3, x: 12.5, y: -3.25, action: 1 };
    const result = roundTrip(packet);
    expect(result.entityId).toBe(7);
    expect(result.entityType).toBe(0);
    expect(result.ownerPid).toBe(3);
    expect(result.x).toBeCloseTo(12.5, 5);
    expect(result.y).toBeCloseTo(-3.25, 5);
  });

  it('round-trips a non-default entityType', () => {
    const packet: EntityInsertPacket = { entityId: 42, entityType: 1, ownerPid: NO_OWNER_PID, x: 0, y: 0, action: 1 };
    const result = roundTrip(packet);
    expect(result.entityType).toBe(1);
  });

  it('round-trips NO_OWNER_PID for unowned entities (e.g. world geometry)', () => {
    const packet: EntityInsertPacket = { entityId: 5, entityType: 1, ownerPid: NO_OWNER_PID, x: 0, y: 0, action: 1 };
    const result = roundTrip(packet);
    expect(result.ownerPid).toBe(NO_OWNER_PID);
  });

  it('round-trips the action bitmask (see EntityActionStateComponent, shared)', () => {
    const packet: EntityInsertPacket = { entityId: 5, entityType: 0, ownerPid: NO_OWNER_PID, x: 0, y: 0, action: 2 };
    const result = roundTrip(packet);
    expect(result.action).toBe(2);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodeEntityInsert({ entityId: 0, entityType: 0, ownerPid: NO_OWNER_PID, x: 0, y: 0, action: 1 });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.EntityInsert);
    expect(header.length).toBe(18);
  });
});
