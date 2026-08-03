import { describe, expect, it } from 'vitest';
import { beginWrite, writeU8, writeU16, writeU32, writeI16, writeF32, writeF64, writeString, endWrite } from './BufferWriter';
import { beginRead, endRead, readU8, readU16, readU32, readI16, readF32, readF64, readString } from './BufferReader';

describe('BufferWriter', () => {
  it('writes and round-trips u8 values including edges', () => {
    beginWrite();
    writeU8(0);
    writeU8(255);
    writeU8(42);
    beginRead(endWrite());
    expect(readU8()).toBe(0);
    expect(readU8()).toBe(255);
    expect(readU8()).toBe(42);
    endRead();
  });

  it('writes u16 in little-endian byte order', () => {
    beginWrite();
    writeU16(0x1234);
    const bytes = new Uint8Array(endWrite());
    expect(Array.from(bytes)).toEqual([0x34, 0x12]);
  });

  it('round-trips u16 edge values', () => {
    beginWrite();
    writeU16(0);
    writeU16(65535);
    beginRead(endWrite());
    expect(readU16()).toBe(0);
    expect(readU16()).toBe(65535);
    endRead();
  });

  it('round-trips u32 edge values', () => {
    beginWrite();
    writeU32(0);
    writeU32(4294967295);
    beginRead(endWrite());
    expect(readU32()).toBe(0);
    expect(readU32()).toBe(4294967295);
    endRead();
  });

  it('round-trips i16 negative values', () => {
    beginWrite();
    writeI16(-1);
    writeI16(-32768);
    writeI16(32767);
    beginRead(endWrite());
    expect(readI16()).toBe(-1);
    expect(readI16()).toBe(-32768);
    expect(readI16()).toBe(32767);
    endRead();
  });

  it('round-trips f32 values within float precision', () => {
    beginWrite();
    writeF32(3.14159);
    writeF32(-100.5);
    writeF32(0);
    beginRead(endWrite());
    expect(readF32()).toBeCloseTo(3.14159, 4);
    expect(readF32()).toBeCloseTo(-100.5, 4);
    expect(readF32()).toBe(0);
    endRead();
  });

  it('round-trips f64 values with full double precision, unlike f32', () => {
    beginWrite();
    writeF64(performance.timeOrigin + 123.456789012345);
    writeF64(-100.5);
    writeF64(0);
    beginRead(endWrite());
    expect(readF64()).toBeCloseTo(performance.timeOrigin + 123.456789012345, 9);
    expect(readF64()).toBe(-100.5);
    expect(readF64()).toBe(0);
    endRead();
  });

  it('round-trips strings including empty and multi-byte UTF-8', () => {
    beginWrite();
    writeString('');
    writeString('hello');
    writeString('héllo wörld 世界');
    beginRead(endWrite());
    expect(readString()).toBe('');
    expect(readString()).toBe('hello');
    expect(readString()).toBe('héllo wörld 世界');
    endRead();
  });

  it('round-trips characters outside the Basic Multilingual Plane (surrogate pairs)', () => {
    const emoji = '😀🎮👾'; // each requires a 4-byte UTF-8 sequence / UTF-16 surrogate pair
    beginWrite();
    writeString(emoji);
    beginRead(endWrite());
    expect(readString()).toBe(emoji);
    endRead();
  });

  it('grows its internal buffer beyond the initial capacity', () => {
    beginWrite(1);
    for (let i = 0; i < 100; i += 1) {
      writeU32(i);
    }
    beginRead(endWrite());
    for (let i = 0; i < 100; i += 1) {
      expect(readU32()).toBe(i);
    }
    endRead();
  });

  it('trims the result to exactly the bytes written', () => {
    beginWrite(256);
    writeU8(1);
    writeU8(2);
    expect(endWrite().byteLength).toBe(2);
  });
});
