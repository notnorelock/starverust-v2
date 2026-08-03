import { beginWrite, writeU32, writeString, writerLength, endWrite } from '../io/BufferWriter';
import { readU32, readString } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Server -> Client, broadcast once when a player's entity is created (see
 * PlayerSession.onHelloReceived — sent alongside, not instead of, the generic
 * EntityInsertPacket that same entity also gets). Carries player-specific identity data
 * (pid, nickname) that EntityInsertPacket deliberately doesn't, since EntityInsertPacket
 * covers every entity type (world geometry, future NPCs) and most of those have no
 * nickname or pid at all. Also sent once per already-connected player to a newly-joining
 * client, the same catch-up reasoning EntityInsertPacket's own loop uses (see
 * PlayerSession) — a new client otherwise has no way to learn existing players' nicknames.
 */
export interface PlayerJoinPacket {
  pid: number;
  entityId: number;
  nickname: string;
}

// Payload layout (variable length):
// [0..3] u32 pid
// [4..7] u32 entityId
// [8..]  string nickname (u16 length prefix + UTF-8 bytes — see writeString/readString)
//
// Two-pass encode for the same reason as HelloPacket (see that file's doc comment):
// the payload's length must be known before the header is written, but the nickname's
// byte length isn't known until it's actually encoded.
export function encodePlayerJoin(packet: PlayerJoinPacket): ArrayBuffer {
  beginWrite();
  writeU32(packet.pid);
  writeU32(packet.entityId);
  writeString(packet.nickname);
  const payloadSize = writerLength();
  endWrite();

  beginWrite(HEADER_SIZE + payloadSize);
  writeHeader({ opcode: Opcode.PlayerJoin, flags: 0, length: payloadSize });
  writeU32(packet.pid);
  writeU32(packet.entityId);
  writeString(packet.nickname);

  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodePlayerJoin(): PlayerJoinPacket {
  const pid = readU32();
  const entityId = readU32();
  const nickname = readString();
  return { pid, entityId, nickname };
}
