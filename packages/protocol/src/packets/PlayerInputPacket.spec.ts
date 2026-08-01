import { describe, expect, it } from 'vitest';
import { encodePlayerInput, decodePlayerInput, InputFlag, type PlayerInputPacket } from './PlayerInputPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: PlayerInputPacket): PlayerInputPacket {
  const buffer = encodePlayerInput(packet);
  beginRead(buffer);
  readHeader();
  const result = decodePlayerInput();
  endRead();
  return result;
}

describe('PlayerInputPacket', () => {
  const directionCombos = [
    0,
    InputFlag.Up,
    InputFlag.Down,
    InputFlag.Left,
    InputFlag.Right,
    InputFlag.Up | InputFlag.Left, // diagonal
    InputFlag.Down | InputFlag.Right, // diagonal
    InputFlag.Up | InputFlag.Down | InputFlag.Left | InputFlag.Right, // all pressed
  ];

  it.each(directionCombos)('round-trips direction bitmask 0b%s', (direction) => {
    const packet: PlayerInputPacket = { tick: 1234, sequence: 42, direction };
    expect(roundTrip(packet)).toEqual(packet);
  });

  it('composes flags with |= the way the client input source will', () => {
    let direction = 0;
    direction |= InputFlag.Up;
    direction |= InputFlag.Right;
    const packet: PlayerInputPacket = { tick: 0, sequence: 0, direction };
    const result = roundTrip(packet);
    expect((result.direction & InputFlag.Up) !== 0).toBe(true);
    expect((result.direction & InputFlag.Right) !== 0).toBe(true);
    expect((result.direction & InputFlag.Down) !== 0).toBe(false);
    expect((result.direction & InputFlag.Left) !== 0).toBe(false);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodePlayerInput({ tick: 0, sequence: 0, direction: 0 });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.PlayerInput);
    expect(header.length).toBe(7);
  });
});
