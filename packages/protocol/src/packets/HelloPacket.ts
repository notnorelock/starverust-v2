import { beginWrite, writeU16, writeString, writerLength, endWrite } from '../io/BufferWriter';
import { readU16, readString } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Client -> Server, the very first packet sent after the WebSocket opens — before this
 * arrives, the server does nothing (no player entity, no Handshake reply; see
 * PlayerSession.onHelloReceived). Carries the client's protocolVersion (checked against
 * this build's PROTOCOL_VERSION — see ProtocolVersion.ts — before any player state is
 * created) and the player's chosen nickname (validated server-side; never trust the
 * client's own validation alone).
 */
export interface HelloPacket {
  protocolVersion: number;
  nickname: string;
}

// Payload layout (variable length):
// [0..1] u16 protocolVersion
// [2..]  string nickname (u16 length prefix + UTF-8 bytes — see writeString/readString)
//
// The payload's total length isn't known until the (variable-length) nickname is encoded,
// but the packet header's length field precedes the payload on the wire — so this encodes
// the payload fields once to measure their byte length, then re-encodes them into a second
// pass that writes the now-known-length header first. BufferWriter's module-scoped cursor
// only supports one beginWrite()...endWrite() cycle at a time (nesting throws
// WriteInProgressError — see BufferWriter's own doc comment), so this must be two
// sequential passes, not a nested/spliced one.
export function encodeHello(packet: HelloPacket): ArrayBuffer {
  beginWrite();
  writeU16(packet.protocolVersion);
  writeString(packet.nickname);
  const payloadSize = writerLength();
  endWrite();

  beginWrite(HEADER_SIZE + payloadSize);
  writeHeader({ opcode: Opcode.Hello, flags: 0, length: payloadSize });
  writeU16(packet.protocolVersion);
  writeString(packet.nickname);

  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodeHello(): HelloPacket {
  const protocolVersion = readU16();
  const nickname = readString();
  return { protocolVersion, nickname };
}
