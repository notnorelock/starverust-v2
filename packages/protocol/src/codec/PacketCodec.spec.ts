import { describe, expect, it } from 'vitest';
import { decodeAny, finalizeForWire, UnknownOpcodeError } from './PacketCodec';
import { encodePlayerInput, InputFlag } from '../packets/PlayerInputPacket';
import { encodeWorldSnapshot } from '../packets/WorldSnapshotPacket';
import { encodeHandshake } from '../packets/HandshakePacket';
import { Opcode } from '../opcodes';
import { beginWrite, endWrite } from '../io/BufferWriter';
import { writeHeader } from '../io/PacketHeader';

describe('decodeAny', () => {
  it('dispatches PlayerInput to the correct decoder', () => {
    const wire = finalizeForWire(encodePlayerInput({ tick: 1, sequence: 1, direction: InputFlag.Up }));
    const result = decodeAny(wire);
    expect(result.opcode).toBe(Opcode.PlayerInput);
    if (result.opcode === Opcode.PlayerInput) {
      expect((result.packet.direction & InputFlag.Up) !== 0).toBe(true);
    }
  });

  it('dispatches WorldSnapshot to the correct decoder', () => {
    const wire = finalizeForWire(
      encodeWorldSnapshot({ serverTick: 5, entities: [{ entityId: 1, x: 1, y: 2, speed: 200 }] }),
    );
    const result = decodeAny(wire);
    expect(result.opcode).toBe(Opcode.WorldSnapshot);
    if (result.opcode === Opcode.WorldSnapshot) {
      expect(result.packet.entities).toHaveLength(1);
    }
  });

  it('dispatches Handshake to the correct decoder', () => {
    const wire = finalizeForWire(
      encodeHandshake({
        assignedEntityId: 42,
        tickRate: 30,
        worldMinX: -25,
        worldMaxX: 25,
        worldMinY: -25,
        worldMaxY: 25,
      }),
    );
    const result = decodeAny(wire);
    expect(result.opcode).toBe(Opcode.Handshake);
    if (result.opcode === Opcode.Handshake) {
      expect(result.packet.assignedEntityId).toBe(42);
      expect(result.packet.tickRate).toBe(30);
    }
  });

  it('throws UnknownOpcodeError for an unregistered opcode', () => {
    beginWrite();
    writeHeader({ opcode: 0xff, flags: 0, length: 0 });
    const wire = finalizeForWire(endWrite());
    expect(() => decodeAny(wire)).toThrow(UnknownOpcodeError);
  });
});
