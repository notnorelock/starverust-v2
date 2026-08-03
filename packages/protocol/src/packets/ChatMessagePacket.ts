import { beginWrite, writeString, writerLength, endWrite } from '../io/BufferWriter';
import { readString } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Client -> Server: the player's chat message text, sent once when they press Enter to
 * submit an open chat box (see ChatBox, @starve/ui, and GameClient's chat open/close/send
 * flow — ported from the reference client's Enter-to-open/Enter-to-send toggle, see
 * client-old.js's `user.chat.run()`). The server is the sole authority on which connection
 * sent it (via ClientConnection, not a field on this packet) and re-broadcasts it to every
 * connection as ChatBroadcastPacket, carrying the sender's pid/entityId so clients can
 * attribute the message to the right player (see ChatBroadcastPacket).
 */
export interface ChatMessagePacket {
  text: string;
}

// Payload layout (variable length):
// [0..]  string text (u16 length prefix + UTF-8 bytes — see writeString/readString)
//
// Two-pass encode for the same reason as HelloPacket/PlayerJoinPacket (see those files'
// doc comments): the payload's length isn't known until the variable-length text is
// encoded, but the header's length field precedes the payload on the wire.
export function encodeChatMessage(packet: ChatMessagePacket): ArrayBuffer {
  beginWrite();
  writeString(packet.text);
  const payloadSize = writerLength();
  endWrite();

  beginWrite(HEADER_SIZE + payloadSize);
  writeHeader({ opcode: Opcode.ChatMessage, flags: 0, length: payloadSize });
  writeString(packet.text);

  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodeChatMessage(): ChatMessagePacket {
  const text = readString();
  return { text };
}
