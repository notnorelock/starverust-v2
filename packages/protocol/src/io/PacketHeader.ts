import { writeU8, writeU16 } from './BufferWriter';
import { readU8, readU16 } from './BufferReader';

/** opcode(u8) + flags(u8) + length(u16 LE) — length excludes the header itself. */
export const HEADER_SIZE = 4;

export interface PacketHeader {
  readonly opcode: number;
  readonly flags: number;
  readonly length: number;
}

export function writeHeader(header: PacketHeader): void {
  writeU8(header.opcode);
  writeU8(header.flags);
  writeU16(header.length);
}

export function readHeader(): PacketHeader {
  const opcode = readU8();
  const flags = readU8();
  const length = readU16();
  return { opcode, flags, length };
}
