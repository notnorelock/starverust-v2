import { beginWrite, writeF64, endWrite } from '../io/BufferWriter';
import { readF64 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Client -> Server, sent on a fixed interval (every 5s — see GameClient) purely to measure
 * round-trip latency. `clientSendTime` is an opaque timestamp the client alone assigns and
 * interprets (performance.now(), milliseconds since the page loaded); the server never
 * reads its value, only echoes it straight back verbatim in the matching PongPacket (see
 * that file) so the client can compute `now - clientSendTime` on receipt without needing
 * any clock-sync between client and server. Unlike every other packet in this protocol,
 * Ping/Pong carry no gameplay state at all — this is transport-layer instrumentation, not
 * simulation input.
 */
export interface PingPacket {
  clientSendTime: number;
}

// Payload layout (8 bytes):
// [0..7] f64 clientSendTime (opaque to the server — see doc comment above)
const PAYLOAD_SIZE = 8;

export function encodePing(packet: PingPacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.Ping, flags: 0, length: PAYLOAD_SIZE });
  writeF64(packet.clientSendTime);
  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodePing(): PingPacket {
  const clientSendTime = readF64();
  return { clientSendTime };
}
