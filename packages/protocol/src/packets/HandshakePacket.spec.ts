import { describe, expect, it } from 'vitest';
import { encodeHandshake, decodeHandshake, type HandshakePacket } from './HandshakePacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: HandshakePacket): HandshakePacket {
  const buffer = encodeHandshake(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeHandshake();
  endRead();
  return result;
}

describe('HandshakePacket', () => {
  it('round-trips assignedEntityId, assignedPid, tickRate, and world bounds', () => {
    const packet: HandshakePacket = {
      assignedEntityId: 7,
      assignedPid: 3,
      tickRate: 30,
      worldMinX: -25,
      worldMaxX: 25,
      worldMinY: -25,
      worldMaxY: 25,
    };
    const result = roundTrip(packet);
    expect(result.assignedEntityId).toBe(7);
    expect(result.assignedPid).toBe(3);
    expect(result.tickRate).toBe(30);
    expect(result.worldMinX).toBeCloseTo(-25, 5);
    expect(result.worldMaxX).toBeCloseTo(25, 5);
    expect(result.worldMinY).toBeCloseTo(-25, 5);
    expect(result.worldMaxY).toBeCloseTo(25, 5);
  });

  it('round-trips a non-square, non-centered world', () => {
    const packet: HandshakePacket = {
      assignedEntityId: 1,
      assignedPid: 1,
      tickRate: 20,
      worldMinX: -10,
      worldMaxX: 200,
      worldMinY: 0,
      worldMaxY: 75.5,
    };
    const result = roundTrip(packet);
    expect(result.worldMinX).toBeCloseTo(-10, 4);
    expect(result.worldMaxX).toBeCloseTo(200, 4);
    expect(result.worldMinY).toBeCloseTo(0, 4);
    expect(result.worldMaxY).toBeCloseTo(75.5, 4);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodeHandshake({
      assignedEntityId: 0,
      assignedPid: 0,
      tickRate: 0,
      worldMinX: 0,
      worldMaxX: 0,
      worldMinY: 0,
      worldMaxY: 0,
    });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.Handshake);
    expect(header.length).toBe(26);
  });
});
