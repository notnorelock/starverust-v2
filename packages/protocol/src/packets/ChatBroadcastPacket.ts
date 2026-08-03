import { beginWrite, writeU32, writeString, writerLength, endWrite } from '../io/BufferWriter';
import { readU32, readString } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Server -> Client, broadcast to every connection once a ChatMessagePacket is validated
 * (see the server-side chat handler) — carries only `pid`, the sender's player-networking
 * identity (see ClientConnection.pid's own doc comment for why pid, not entityId, is the
 * canonical "which player" reference elsewhere in this protocol, e.g. PlayerJoinPacket/
 * PlayerLeftPacket). The client resolves pid -> entityId itself via NicknameRegistry
 * (already pid-keyed internally, see that class) to attach the message as a speech bubble
 * above the right player's entity — see the reference client's per-entity `text`/
 * `text_effect`/`label` bubble queues in client-old.js — rather than this packet carrying
 * entityId redundantly.
 */
export interface ChatBroadcastPacket {
  pid: number;
  text: string;
}

// Payload layout (variable length):
// [0..3] u32 pid
// [4..]  string text (u16 length prefix + UTF-8 bytes — see writeString/readString)
export function encodeChatBroadcast(packet: ChatBroadcastPacket): ArrayBuffer {
  beginWrite();
  writeU32(packet.pid);
  writeString(packet.text);
  const payloadSize = writerLength();
  endWrite();

  beginWrite(HEADER_SIZE + payloadSize);
  writeHeader({ opcode: Opcode.ChatBroadcast, flags: 0, length: payloadSize });
  writeU32(packet.pid);
  writeString(packet.text);

  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodeChatBroadcast(): ChatBroadcastPacket {
  const pid = readU32();
  const text = readString();
  return { pid, text };
}
