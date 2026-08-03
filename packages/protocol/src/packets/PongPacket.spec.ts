import { describe, expect, it } from 'vitest';
import { encodePong, decodePong, type PongPacket } from './PongPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: PongPacket): PongPacket {
  const buffer = encodePong(packet);
  beginRead(buffer);
  readHeader();
  const result = decodePong();
  endRead();
  return result;
}

describe('PongPacket', () => {
  it('round-trips a clientSendTime with full double precision', () => {
    const result = roundTrip({ clientSendTime: 123456.789012345 });
    expect(result.clientSendTime).toBeCloseTo(123456.789012345, 9);
  });

  it('round-trips zero', () => {
    const result = roundTrip({ clientSendTime: 0 });
    expect(result.clientSendTime).toBe(0);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodePong({ clientSendTime: 0 });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.Pong);
    expect(header.length).toBe(8);
  });
});
