import { describe, expect, it } from 'vitest';
import { encodeChatBroadcast, decodeChatBroadcast, type ChatBroadcastPacket } from './ChatBroadcastPacket';
import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

function roundTrip(packet: ChatBroadcastPacket): ChatBroadcastPacket {
  const buffer = encodeChatBroadcast(packet);
  beginRead(buffer);
  readHeader();
  const result = decodeChatBroadcast();
  endRead();
  return result;
}

describe('ChatBroadcastPacket', () => {
  it('round-trips pid and text', () => {
    const result = roundTrip({ pid: 3, text: 'hello world' });
    expect(result.pid).toBe(3);
    expect(result.text).toBe('hello world');
  });

  it('round-trips non-ASCII text', () => {
    const result = roundTrip({ pid: 1, text: 'héllo wörld 世界' });
    expect(result.text).toBe('héllo wörld 世界');
  });

  it('produces a header with the correct opcode and a length matching the actual encoded payload', () => {
    const buffer = encodeChatBroadcast({ pid: 0, text: 'hi' });
    beginRead(buffer);
    const header = readHeader();
    endRead();
    expect(header.opcode).toBe(Opcode.ChatBroadcast);
    // u32 pid (4) + u16 string length prefix (2) + 'hi' UTF-8 bytes (2)
    expect(header.length).toBe(4 + 2 + 2);
  });
});
