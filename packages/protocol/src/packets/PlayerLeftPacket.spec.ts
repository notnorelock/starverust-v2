import { describe, expect, it } from 'vitest';
import { encodePlayerLeft, decodePlayerLeft, type PlayerLeftPacket } from './PlayerLeftPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: PlayerLeftPacket): PlayerLeftPacket {
  const buffer = encodePlayerLeft(packet);
  beginRead(buffer);
  readHeader();
  const result = decodePlayerLeft();
  endRead();
  return result;
}

describe('PlayerLeftPacket', () => {
  it('round-trips pid', () => {
    const result = roundTrip({ pid: 123 });
    expect(result.pid).toBe(123);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodePlayerLeft({ pid: 0 });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.PlayerLeft);
    expect(header.length).toBe(4);
  });
});
