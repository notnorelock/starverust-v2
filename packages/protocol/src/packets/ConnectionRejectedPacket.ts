import { beginWrite, writeU8, endWrite } from '../io/BufferWriter';
import { readU8 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/** Why the server refused a HelloPacket — see ConnectionRejectedPacket. */
export enum RejectionReason {
  VersionMismatch = 0,
  InvalidNickname = 1,
}

/**
 * Server -> Client: sent once in response to an invalid HelloPacket (wrong
 * protocolVersion, or a nickname that fails server-side validation — see
 * PlayerSession.onHelloReceived), immediately followed by the server closing the
 * connection. No player entity is ever created for a rejected connection. The client
 * shows `reason` in the welcome overlay rather than silently disconnecting.
 */
export interface ConnectionRejectedPacket {
  reason: RejectionReason;
}

// Payload layout (1 byte):
// [0] u8 reason (see RejectionReason)
const PAYLOAD_SIZE = 1;

export function encodeConnectionRejected(packet: ConnectionRejectedPacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.ConnectionRejected, flags: 0, length: PAYLOAD_SIZE });
  writeU8(packet.reason);
  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodeConnectionRejected(): ConnectionRejectedPacket {
  const reason = readU8();
  return { reason };
}
