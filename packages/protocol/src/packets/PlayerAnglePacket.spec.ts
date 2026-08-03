import { describe, expect, it } from 'vitest';
import { encodePlayerAngle, decodePlayerAngle, type PlayerAnglePacket } from './PlayerAnglePacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: PlayerAnglePacket): PlayerAnglePacket {
  const buffer = encodePlayerAngle(packet);
  beginRead(buffer);
  readHeader();
  const result = decodePlayerAngle();
  endRead();
  return result;
}

describe('PlayerAnglePacket', () => {
  it('round-trips a positive angle', () => {
    const result = roundTrip({ angle: Math.PI / 2 });
    expect(result.angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('round-trips a negative angle', () => {
    const result = roundTrip({ angle: -Math.PI });
    expect(result.angle).toBeCloseTo(-Math.PI, 5);
  });

  it('round-trips zero', () => {
    const result = roundTrip({ angle: 0 });
    expect(result.angle).toBe(0);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodePlayerAngle({ angle: 0 });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.PlayerAngle);
    expect(header.length).toBe(4);
  });
});
