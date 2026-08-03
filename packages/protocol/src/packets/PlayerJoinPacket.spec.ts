import { describe, expect, it } from 'vitest';
import { encodePlayerJoin, decodePlayerJoin, type PlayerJoinPacket } from './PlayerJoinPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: PlayerJoinPacket): PlayerJoinPacket {
  const buffer = encodePlayerJoin(packet);
  beginRead(buffer);
  readHeader();
  const result = decodePlayerJoin();
  endRead();
  return result;
}

describe('PlayerJoinPacket', () => {
  it('round-trips pid, entityId, and nickname', () => {
    const packet: PlayerJoinPacket = { pid: 3, entityId: 7, nickname: 'Survivor' };
    const result = roundTrip(packet);
    expect(result.pid).toBe(3);
    expect(result.entityId).toBe(7);
    expect(result.nickname).toBe('Survivor');
  });

  it('round-trips a nickname with non-ASCII characters', () => {
    const packet: PlayerJoinPacket = { pid: 1, entityId: 1, nickname: 'héllo wörld' };
    const result = roundTrip(packet);
    expect(result.nickname).toBe('héllo wörld');
  });

  it('produces a header with the correct opcode and a length matching the actual encoded payload', () => {
    const buffer = encodePlayerJoin({ pid: 0, entityId: 0, nickname: 'Survivor' });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.PlayerJoin);
    // u32 pid (4) + u32 entityId (4) + u16 string length prefix (2) + 'Survivor' UTF-8 bytes (8)
    expect(header.length).toBe(4 + 4 + 2 + 8);
  });
});
