/** Thrown when a read would consume more bytes than remain in the buffer. */
export class BufferUnderrunError extends TypeError {
  constructor(requested: number, remaining: number) {
    super(`requested ${requested} bytes, only ${remaining} remaining`);
  }
}

/** Thrown by beginRead() if a previous read wasn't finished — see module doc below. */
export class ReadInProgressError extends ReferenceError {
  constructor() {
    super('called while a previous read was still in progress');
  }
}

/**
 * Single, module-scoped decode cursor — no per-call state argument, no per-decode object
 * allocation. `beginRead(source)` resets it to point at a new buffer; every `read*()`
 * function then reads from and advances this one shared cursor.
 *
 * This is safe ONLY for strictly sequential decoding: one packet fully decoded (all its
 * read*() calls made, cursor consumed) before the next call to beginRead(). That is
 * exactly how this protocol is used today — PacketRouter/PacketHandlerRegistry decode one
 * inbound frame at a time, synchronously, never decoding a second packet from inside the
 * middle of decoding a first one. `inProgress` guards against violating that: calling
 * beginRead() again before the previous read finished (e.g. an accidental nested/reentrant
 * decode) throws immediately instead of silently corrupting both reads by sharing one
 * cursor. Do NOT decode packets concurrently/interleaved against this module — if that
 * requirement ever appears, this needs per-call state again (see git history), not a
 * bigger guard.
 */
let bytes: Uint8Array | undefined;
let cursor = 0;
let inProgress = false;

const f32Scratch = new Float32Array(1);
const f32ScratchBytes = new Uint8Array(f32Scratch.buffer);

export function beginRead(source: ArrayBuffer | Uint8Array): void {
  if (inProgress) {
    throw new ReadInProgressError();
  }
  bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  cursor = 0;
  inProgress = true;
}

/** Marks the current read as finished, allowing the next beginRead() call. */
export function endRead(): void {
  inProgress = false;
  bytes = undefined;
}

export function readerRemaining(): number {
  return (bytes?.length ?? 0) - cursor;
}

function assertRemaining(count: number): void {
  const remaining = readerRemaining();
  if (count > remaining) {
    throw new BufferUnderrunError(count, remaining);
  }
}

export function readU8(): number {
  assertRemaining(1);
  const value = bytes![cursor]!;
  cursor += 1;
  return value;
}

export function readU16(): number {
  assertRemaining(2);
  const b = bytes!;
  const c = cursor;
  const value = b[c]! | (b[c + 1]! << 8);
  cursor += 2;
  return value;
}

export function readI16(): number {
  const value = readU16();
  // Sign-extend the 16-bit pattern to a JS number.
  return value & 0x8000 ? value - 0x10000 : value;
}

export function readU32(): number {
  assertRemaining(4);
  const b = bytes!;
  const c = cursor;
  // >>> 0 converts the potentially-negative result of the `|` chain (bit 31 set makes
  // the intermediate value a signed i32 in JS) back to an unsigned 32-bit value.
  const value = (b[c]! | (b[c + 1]! << 8) | (b[c + 2]! << 16) | (b[c + 3]! << 24)) >>> 0;
  cursor += 4;
  return value;
}

export function readF32(): number {
  assertRemaining(4);
  const b = bytes!;
  const c = cursor;
  f32ScratchBytes[0] = b[c]!;
  f32ScratchBytes[1] = b[c + 1]!;
  f32ScratchBytes[2] = b[c + 2]!;
  f32ScratchBytes[3] = b[c + 3]!;
  cursor += 4;
  return f32Scratch[0]!;
}

/**
 * Reads a u16 byte-length prefix followed by UTF-8 encoded bytes. Hand-rolled UTF-8
 * decoding (manually walking 1-4 byte sequences and composing UTF-16 code units via
 * String.fromCharCode, including surrogate-pair emission for code points outside the
 * Basic Multilingual Plane) instead of TextDecoder — mirrors writeString()'s hand-rolled
 * encoder so both sides of the wire format are self-contained, no built-in codec object.
 */
export function readString(): string {
  const length = readU16();
  assertRemaining(length);
  const b = bytes!;
  const end = cursor + length;

  let result = '';
  let i = cursor;
  while (i < end) {
    const byte1 = b[i]!;
    let codePoint: number;

    if (byte1 < 0x80) {
      codePoint = byte1;
      i += 1;
    } else if ((byte1 & 0xe0) === 0xc0) {
      codePoint = ((byte1 & 0x1f) << 6) | (b[i + 1]! & 0x3f);
      i += 2;
    } else if ((byte1 & 0xf0) === 0xe0) {
      codePoint = ((byte1 & 0x0f) << 12) | ((b[i + 1]! & 0x3f) << 6) | (b[i + 2]! & 0x3f);
      i += 3;
    } else {
      codePoint =
        ((byte1 & 0x07) << 18) | ((b[i + 1]! & 0x3f) << 12) | ((b[i + 2]! & 0x3f) << 6) | (b[i + 3]! & 0x3f);
      i += 4;
    }

    if (codePoint < 0x10000) {
      result += String.fromCharCode(codePoint);
    } else {
      // Split into a UTF-16 surrogate pair — String.fromCharCode only handles single
      // 16-bit code units, so code points outside the BMP need two of them.
      const adjusted = codePoint - 0x10000;
      result += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    }
  }

  cursor = end;
  return result;
}
