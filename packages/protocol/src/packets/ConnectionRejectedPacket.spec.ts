import { describe, expect, it } from 'vitest';
import {
  encodeConnectionRejected,
  decodeConnectionRejected,
  RejectionReason,
  type ConnectionRejectedPacket,
} from './ConnectionRejectedPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: ConnectionRejectedPacket): ConnectionRejectedPacket {
  const buffer = encodeConnectionRejected(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeConnectionRejected();
  endRead();
  return result;
}

describe('ConnectionRejectedPacket', () => {
  it('round-trips VersionMismatch', () => {
    const result = roundTrip({ reason: RejectionReason.VersionMismatch });
    expect(result.reason).toBe(RejectionReason.VersionMismatch);
  });

  it('round-trips InvalidNickname', () => {
    const result = roundTrip({ reason: RejectionReason.InvalidNickname });
    expect(result.reason).toBe(RejectionReason.InvalidNickname);
  });

  it('produces a header with the correct opcode and payload length', () => {
    const buffer = encodeConnectionRejected({ reason: RejectionReason.VersionMismatch });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.ConnectionRejected);
    expect(header.length).toBe(1);
  });
});
