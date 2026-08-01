/** Thrown by beginWrite() if a previous write wasn't finished — mirrors ReadInProgressError. */
export class WriteInProgressError extends Error {
  constructor() {
    super('called while a previous write was still in progress');
  }
}

/**
 * Single, module-scoped encode cursor — no per-call state argument, no per-encode object
 * allocation, mirroring BufferReader's design. `beginWrite()` resets it; every `write*()`
 * function writes to and advances this one shared buffer; `endWrite()` returns the final
 * bytes and releases the cursor for the next encode.
 *
 * Safe ONLY for strictly sequential encoding — one packet's encode*() function runs
 * beginWrite()...write*() calls...endWrite() to completion before the next encode starts.
 * That's how every packet in packets/ is used today (called synchronously, one at a time,
 * from PacketRouter-adjacent send paths). `inProgress` guards against violating that —
 * see BufferReader.ts's matching comment for the full reasoning; the same constraint
 * applies here symmetrically.
 *
 * All multi-byte writes are manual little-endian bit composition on a Uint8Array (no
 * DataView) — DataView's per-call bounds/endianness handling measurably loses to direct
 * byte-array writes for the small, frequent field writes a binary game protocol does.
 */
let bytes = new Uint8Array(64);
let cursor = 0;
let inProgress = false;

// Single reusable scratch buffer for float32<->bytes reinterpretation: writing a float
// is aliasing the same 4 bytes through a Float32Array view and a Uint8Array view of one
// shared ArrayBuffer, so the CPU does a raw bit reinterpretation instead of DataView's
// call overhead or IEEE-754 decomposition via Math.log2/Math.pow.
const f32Scratch = new Float32Array(1);
const f32ScratchBytes = new Uint8Array(f32Scratch.buffer);

export function beginWrite(initialCapacity = 64): void {
  if (inProgress) {
    throw new WriteInProgressError();
  }
  if (bytes.length < initialCapacity) {
    bytes = new Uint8Array(initialCapacity);
  }
  cursor = 0;
  inProgress = true;
}

export function writerLength(): number {
  return cursor;
}

function ensureCapacity(additionalBytes: number): void {
  const required = cursor + additionalBytes;
  if (required <= bytes.length) {
    return;
  }

  let newCapacity = bytes.length * 2;
  while (newCapacity < required) {
    newCapacity *= 2;
  }

  const grown = new Uint8Array(newCapacity);
  grown.set(bytes);
  bytes = grown;
}

export function writeU8(value: number): void {
  ensureCapacity(1);
  bytes[cursor] = value & 0xff;
  cursor += 1;
}

export function writeU16(value: number): void {
  ensureCapacity(2);
  const c = cursor;
  bytes[c] = value & 0xff;
  bytes[c + 1] = (value >>> 8) & 0xff;
  cursor += 2;
}

export function writeI16(value: number): void {
  // Two's-complement wrap into the same u16 bit pattern, then identical byte layout.
  writeU16(value & 0xffff);
}

export function writeU32(value: number): void {
  ensureCapacity(4);
  const c = cursor;
  bytes[c] = value & 0xff;
  bytes[c + 1] = (value >>> 8) & 0xff;
  bytes[c + 2] = (value >>> 16) & 0xff;
  bytes[c + 3] = (value >>> 24) & 0xff;
  cursor += 4;
}

export function writeF32(value: number): void {
  ensureCapacity(4);
  f32Scratch[0] = value;
  const c = cursor;
  bytes[c] = f32ScratchBytes[0]!;
  bytes[c + 1] = f32ScratchBytes[1]!;
  bytes[c + 2] = f32ScratchBytes[2]!;
  bytes[c + 3] = f32ScratchBytes[3]!;
  cursor += 4;
}

/**
 * u16 byte-length prefix followed by UTF-8 encoded bytes. Hand-rolled UTF-8 encoding
 * (reading UTF-16 code units via charCodeAt and manually composing 1-4 byte UTF-8
 * sequences, including surrogate-pair handling for characters outside the Basic
 * Multilingual Plane) instead of TextEncoder — consistent with this module avoiding
 * built-in codec objects elsewhere (DataView, etc.) in favor of direct byte manipulation.
 */
export function writeString(value: string): void {
  // Byte length isn't known until encoding, but the length prefix must be written first —
  // encode into a scratch buffer, then copy, rather than encoding twice.
  ensureCapacity(value.length * 4 + 2); // worst case: every char is 4 UTF-8 bytes
  const lengthCursor = cursor;
  cursor += 2; // reserve space for the u16 length prefix, filled in below

  const byteStart = cursor;
  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.charCodeAt(i);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < value.length) {
      // High surrogate: combine with the following low surrogate into a full code point.
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = (codePoint - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i += 1;
      }
    }

    ensureCapacity(4);
    if (codePoint < 0x80) {
      bytes[cursor] = codePoint;
      cursor += 1;
    } else if (codePoint < 0x800) {
      bytes[cursor] = 0xc0 | (codePoint >> 6);
      bytes[cursor + 1] = 0x80 | (codePoint & 0x3f);
      cursor += 2;
    } else if (codePoint < 0x10000) {
      bytes[cursor] = 0xe0 | (codePoint >> 12);
      bytes[cursor + 1] = 0x80 | ((codePoint >> 6) & 0x3f);
      bytes[cursor + 2] = 0x80 | (codePoint & 0x3f);
      cursor += 3;
    } else {
      bytes[cursor] = 0xf0 | (codePoint >> 18);
      bytes[cursor + 1] = 0x80 | ((codePoint >> 12) & 0x3f);
      bytes[cursor + 2] = 0x80 | ((codePoint >> 6) & 0x3f);
      bytes[cursor + 3] = 0x80 | (codePoint & 0x3f);
      cursor += 4;
    }
  }

  const byteLength = cursor - byteStart;
  bytes[lengthCursor] = byteLength & 0xff;
  bytes[lengthCursor + 1] = (byteLength >>> 8) & 0xff;
}

/** Returns a tightly-sized copy of only the bytes written so far, and ends the write. */
export function endWrite(): ArrayBuffer {
  const result = bytes.slice(0, cursor).buffer as ArrayBuffer;
  inProgress = false;
  return result;
}
