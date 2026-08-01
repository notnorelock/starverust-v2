/**
 * Wire-level protection applied to a fully-encoded packet frame (header + payload),
 * independent of any specific packet type — every packet's encode*() function produces
 * a plain frame; `protect()`/`unprotect()` wrap it for actual transport. Two concerns,
 * applied together but logically separate:
 *
 *  - Integrity: an additive checksum appended after the frame, verified before decoding
 *    so a corrupted or hand-crafted-by-a-cheat frame is rejected before it ever reaches
 *    a packet decoder or gameplay logic.
 *  - Obfuscation: the frame bytes are XORed against a repeating key before the checksum
 *    is computed, so a plain network sniff doesn't show the protocol's literal byte
 *    layout. This is deliberately NOT cryptographic security (the key is a fixed,
 *    compiled-in constant shared by client and server) — it raises the bar against
 *    casual packet inspection, not against someone willing to extract the key from the
 *    client bundle. Real anti-cheat/auth is a later stage's concern.
 *
 * Checksum is computed over the XORed (obfuscated) bytes, and XOR is applied/removed
 * around it symmetrically, so `unprotect(protect(frame))` round-trips exactly.
 */

/** Fixed, compiled-in XOR key. Shared by client and server — not a secret against a
 *  determined attacker with the client bundle, only against passive packet sniffing. */
const XOR_KEY = new Uint8Array([0x9e, 0x3b, 0xc7, 0x15, 0xa4, 0x6d, 0xf2, 0x58]);

/** Trailer size appended by protect(): u16 checksum, little-endian. */
export const FRAME_TRAILER_SIZE = 2;

/** Thrown by unprotect() when the trailing checksum doesn't match the frame contents. */
export class ChecksumMismatchError extends Error {
  constructor() {
    super('checksum mismatch');
  }
}

function xorInPlace(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = bytes[i]! ^ XOR_KEY[i % XOR_KEY.length]!;
  }
}

/** Simple additive checksum (u16, wraps on overflow) — fast, sufficient for corruption
 *  detection; not a cryptographic MAC. */
function computeChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    sum = (sum + bytes[i]!) & 0xffff;
  }
  return sum;
}

/** Applies XOR obfuscation to a raw encoded frame and appends an integrity checksum. Returns a new buffer. */
export function protect(frame: ArrayBuffer): ArrayBuffer {
  const obfuscated = new Uint8Array(frame.byteLength + FRAME_TRAILER_SIZE);
  obfuscated.set(new Uint8Array(frame), 0);
  xorInPlace(obfuscated.subarray(0, frame.byteLength));

  const checksum = computeChecksum(obfuscated.subarray(0, frame.byteLength));
  obfuscated[frame.byteLength] = checksum & 0xff;
  obfuscated[frame.byteLength + 1] = (checksum >>> 8) & 0xff;

  return obfuscated.buffer;
}

/**
 * Verifies the trailing checksum and reverses XOR obfuscation, returning the original
 * encoded frame. Throws ChecksumMismatchError if the checksum doesn't match — callers
 * should treat that as an untrusted/corrupt packet and drop the connection or ignore it,
 * never attempt to decode the payload anyway.
 */
export function unprotect(wire: ArrayBuffer | Uint8Array): ArrayBuffer {
  const bytes = wire instanceof Uint8Array ? wire : new Uint8Array(wire);
  const frameLength = bytes.length - FRAME_TRAILER_SIZE;
  if (frameLength < 0) {
    throw new ChecksumMismatchError();
  }

  const frameBytes = bytes.subarray(0, frameLength);
  const expectedChecksum = computeChecksum(frameBytes);
  const actualChecksum = bytes[frameLength]! | (bytes[frameLength + 1]! << 8);

  if (expectedChecksum !== actualChecksum) {
    throw new ChecksumMismatchError();
  }

  const frame = frameBytes.slice();
  xorInPlace(frame);
  return frame.buffer;
}
