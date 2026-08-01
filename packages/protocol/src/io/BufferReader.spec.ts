import { describe, expect, it } from 'vitest';
import { beginRead, endRead, readerRemaining, readU8, readU32, BufferUnderrunError } from './BufferReader';
import { beginWrite, writeU8, writeU32, endWrite } from './BufferWriter';

describe('BufferReader', () => {
  it('tracks remaining bytes as it reads', () => {
    beginWrite();
    writeU32(1);
    writeU8(2);
    beginRead(endWrite());
    expect(readerRemaining()).toBe(5);
    readU32();
    expect(readerRemaining()).toBe(1);
    readU8();
    expect(readerRemaining()).toBe(0);
    endRead();
  });

  it('throws BufferUnderrunError when reading past the end', () => {
    beginWrite();
    writeU8(1);
    beginRead(endWrite());
    readU8();
    expect(() => readU8()).toThrow(BufferUnderrunError);
    expect(() => readU32()).toThrow(BufferUnderrunError);
    endRead();
  });

  it('reads from a Uint8Array view with a non-zero byteOffset', () => {
    beginWrite();
    writeU32(0xdeadbeef);
    const written = new Uint8Array(endWrite());
    const padded = new Uint8Array(8);
    padded.set(written, 4);
    const view = padded.subarray(4);
    beginRead(view);
    expect(readU32()).toBe(0xdeadbeef);
    endRead();
  });
});
