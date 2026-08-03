import { describe, expect, it } from 'vitest';
import { encodeChatMessage, decodeChatMessage, type ChatMessagePacket } from './ChatMessagePacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: ChatMessagePacket): ChatMessagePacket {
  const buffer = encodeChatMessage(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeChatMessage();
  endRead();
  return result;
}

describe('ChatMessagePacket', () => {
  it('round-trips message text', () => {
    const result = roundTrip({ text: 'hello world' });
    expect(result.text).toBe('hello world');
  });

  it('round-trips an empty string', () => {
    const result = roundTrip({ text: '' });
    expect(result.text).toBe('');
  });

  it('round-trips non-ASCII characters', () => {
    const result = roundTrip({ text: 'héllo wörld 世界 😀' });
    expect(result.text).toBe('héllo wörld 世界 😀');
  });

  it('produces a header with the correct opcode and a length matching the actual encoded payload', () => {
    const buffer = encodeChatMessage({ text: 'hi' });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.ChatMessage);
    // u16 string length prefix (2) + 'hi' UTF-8 bytes (2)
    expect(header.length).toBe(2 + 2);
  });
});
