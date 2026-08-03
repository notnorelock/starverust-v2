import { beginWrite, writeF64, endWrite } from '../io/BufferWriter';
import { readF64 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Server -> Client: the immediate reply to a PingPacket, echoing `clientSendTime` back
 * verbatim and unmodified (see PingPacket's own doc comment) — the server does no clock
 * work of its own here, it's purely a round-trip bounce. On receipt, the client computes
 * `performance.now() - clientSendTime` for its round-trip time; see GameClient's Pong
 * handler.
 */
export interface PongPacket {
  clientSendTime: number;
}

// Payload layout (8 bytes):
// [0..7] f64 clientSendTime (echoed unmodified from the triggering PingPacket)
const PAYLOAD_SIZE = 8;

export function encodePong(packet: PongPacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.Pong, flags: 0, length: PAYLOAD_SIZE });
  writeF64(packet.clientSendTime);
  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodePong(): PongPacket {
  const clientSendTime = readF64();
  return { clientSendTime };
}
