import { describe, expect, it } from 'vitest';
import { encodePing, decodePing, type PingPacket } from './PingPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: PingPacket): PingPacket {
  const buffer = encodePing(packet);
  beginRead(buffer);
  readHeader();
  const result = decodePing();
  endRead();
  return result;
}

describe('PingPacket', () => {
  it('round-trips a clientSendTime with full double precision', () => {
    const result = roundTrip({ clientSendTime: 123456.789012345 });
    expect(result.clientSendTime).toBeCloseTo(123456.789012345, 9);
  });

  it('round-trips zero', () => {
    const result = roundTrip({ clientSendTime: 0 });
    expect(result.clientSendTime).toBe(0);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodePing({ clientSendTime: 0 });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.Ping);
    expect(header.length).toBe(8);
  });
});
