import { describe, expect, it } from 'vitest';
import { decodeAny, finalizeForWire, UnknownOpcodeError } from './PacketCodec';
import { encodePlayerInput, InputFlag } from '../packets/PlayerInputPacket';
import { encodePlayerAngle } from '../packets/PlayerAnglePacket';
import { encodeWorldSnapshot } from '../packets/WorldSnapshotPacket';
import { encodeHandshake } from '../packets/HandshakePacket';
import { encodeHello } from '../packets/HelloPacket';
import { encodeConnectionRejected, RejectionReason } from '../packets/ConnectionRejectedPacket';
import { NO_OWNER_PID } from '../packets/EntityInsertPacket';
import { encodePlayerJoin } from '../packets/PlayerJoinPacket';
import { encodePlayerLeft } from '../packets/PlayerLeftPacket';
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

  it('dispatches PlayerAngle to the correct decoder', () => {
    const wire = finalizeForWire(encodePlayerAngle({ angle: Math.PI / 3 }));
    const result = decodeAny(wire);
    expect(result.opcode).toBe(Opcode.PlayerAngle);
    if (result.opcode === Opcode.PlayerAngle) {
      expect(result.packet.angle).toBeCloseTo(Math.PI / 3, 5);
    }
  });

  it('dispatches WorldSnapshot to the correct decoder', () => {
    const wire = finalizeForWire(
      encodeWorldSnapshot({
        serverTick: 5,
        entities: [{ entityId: 1, entityType: 0, ownerPid: NO_OWNER_PID, x: 1, y: 2, speed: 200, angle: 0 }],
      }),
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
        assignedPid: 7,
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
      expect(result.packet.assignedPid).toBe(7);
      expect(result.packet.tickRate).toBe(30);
    }
  });

  it('dispatches Hello to the correct decoder', () => {
    const wire = finalizeForWire(encodeHello({ protocolVersion: 1, nickname: 'Survivor' }));
    const result = decodeAny(wire);
    expect(result.opcode).toBe(Opcode.Hello);
    if (result.opcode === Opcode.Hello) {
      expect(result.packet.nickname).toBe('Survivor');
    }
  });

  it('dispatches ConnectionRejected to the correct decoder', () => {
    const wire = finalizeForWire(encodeConnectionRejected({ reason: RejectionReason.InvalidNickname }));
    const result = decodeAny(wire);
    expect(result.opcode).toBe(Opcode.ConnectionRejected);
    if (result.opcode === Opcode.ConnectionRejected) {
      expect(result.packet.reason).toBe(RejectionReason.InvalidNickname);
    }
  });

  it('dispatches PlayerJoin to the correct decoder', () => {
    const wire = finalizeForWire(encodePlayerJoin({ pid: 3, entityId: 7, nickname: 'Survivor' }));
    const result = decodeAny(wire);
    expect(result.opcode).toBe(Opcode.PlayerJoin);
    if (result.opcode === Opcode.PlayerJoin) {
      expect(result.packet.pid).toBe(3);
      expect(result.packet.entityId).toBe(7);
      expect(result.packet.nickname).toBe('Survivor');
    }
  });

  it('dispatches PlayerLeft to the correct decoder', () => {
    const wire = finalizeForWire(encodePlayerLeft({ pid: 3 }));
    const result = decodeAny(wire);
    expect(result.opcode).toBe(Opcode.PlayerLeft);
    if (result.opcode === Opcode.PlayerLeft) {
      expect(result.packet.pid).toBe(3);
    }
  });

  it('throws UnknownOpcodeError for an unregistered opcode', () => {
    beginWrite();
    writeHeader({ opcode: 0xff, flags: 0, length: 0 });
    const wire = finalizeForWire(endWrite());
    expect(() => decodeAny(wire)).toThrow(UnknownOpcodeError);
  });
});
