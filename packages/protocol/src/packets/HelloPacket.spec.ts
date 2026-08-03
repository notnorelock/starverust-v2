import { describe, expect, it } from 'vitest';
import { encodeHello, decodeHello, type HelloPacket } from './HelloPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: HelloPacket): HelloPacket {
  const buffer = encodeHello(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeHello();
  endRead();
  return result;
}

describe('HelloPacket', () => {
  it('round-trips protocolVersion and nickname', () => {
    const packet: HelloPacket = { protocolVersion: 1, nickname: 'Survivor' };
    const result = roundTrip(packet);
    expect(result.protocolVersion).toBe(1);
    expect(result.nickname).toBe('Survivor');
  });

  it('round-trips a nickname with non-ASCII characters', () => {
    const packet: HelloPacket = { protocolVersion: 3, nickname: 'héllo wörld' };
    const result = roundTrip(packet);
    expect(result.nickname).toBe('héllo wörld');
  });

  it('round-trips an empty nickname', () => {
    const packet: HelloPacket = { protocolVersion: 1, nickname: '' };
    const result = roundTrip(packet);
    expect(result.nickname).toBe('');
  });

  it('produces a header with the correct opcode and a length matching the actual encoded payload', () => {
    const buffer = encodeHello({ protocolVersion: 1, nickname: 'Survivor' });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.Hello);
    // u16 protocolVersion (2) + u16 string length prefix (2) + 'Survivor' UTF-8 bytes (8)
    expect(header.length).toBe(2 + 2 + 8);
  });

  it('produces a header length that grows correctly for a longer nickname', () => {
    const buffer = encodeHello({ protocolVersion: 1, nickname: 'A'.repeat(16) });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.length).toBe(2 + 2 + 16);
  });
});
