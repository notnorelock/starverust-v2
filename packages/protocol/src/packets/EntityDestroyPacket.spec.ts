import { describe, expect, it } from 'vitest';
import { encodeEntityDestroy, decodeEntityDestroy, type EntityDestroyPacket } from './EntityDestroyPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: EntityDestroyPacket): EntityDestroyPacket {
  const buffer = encodeEntityDestroy(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeEntityDestroy();
  endRead();
  return result;
}

describe('EntityDestroyPacket', () => {
  it('round-trips entityId', () => {
    const packet: EntityDestroyPacket = { entityId: 123 };
    const result = roundTrip(packet);
    expect(result.entityId).toBe(123);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodeEntityDestroy({ entityId: 0 });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.EntityDestroy);
    expect(header.length).toBe(4);
  });
});
