import { describe, expect, it } from 'vitest';
import { protect, unprotect, ChecksumMismatchError, FRAME_TRAILER_SIZE } from './PacketFraming';

function frameOf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('PacketFraming', () => {
  it('round-trips an arbitrary frame exactly', () => {
    const frame = frameOf([0x01, 0x02, 0x03, 0xff, 0x00, 0x7f]);
    const wire = protect(frame);
    const recovered = unprotect(wire);
    expect(Array.from(new Uint8Array(recovered))).toEqual(Array.from(new Uint8Array(frame)));
  });

  it('round-trips an empty frame', () => {
    const frame = frameOf([]);
    const wire = protect(frame);
    const recovered = unprotect(wire);
    expect(new Uint8Array(recovered).length).toBe(0);
  });

  it('appends exactly FRAME_TRAILER_SIZE bytes', () => {
    const frame = frameOf([1, 2, 3, 4, 5]);
    const wire = protect(frame);
    expect(new Uint8Array(wire).length).toBe(frame.byteLength + FRAME_TRAILER_SIZE);
  });

  it('does not leave the frame bytes visibly unchanged on the wire (obfuscation applied)', () => {
    const frame = frameOf([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const wire = new Uint8Array(protect(frame));
    // The XOR key is non-zero, so XORing all-zero bytes must produce non-zero wire bytes.
    expect(Array.from(wire.subarray(0, frame.byteLength)).some((b) => b !== 0)).toBe(true);
  });

  it('throws ChecksumMismatchError when a wire byte is corrupted', () => {
    const frame = frameOf([1, 2, 3, 4, 5, 6, 7, 8]);
    const wire = new Uint8Array(protect(frame));
    wire[0] = wire[0]! ^ 0xff; // flip bits in the first frame byte
    expect(() => unprotect(wire.buffer)).toThrow(ChecksumMismatchError);
  });

  it('throws ChecksumMismatchError when the trailer itself is corrupted', () => {
    const frame = frameOf([1, 2, 3]);
    const wire = new Uint8Array(protect(frame));
    wire[wire.length - 1] = wire[wire.length - 1]! ^ 0xff;
    expect(() => unprotect(wire.buffer)).toThrow(ChecksumMismatchError);
  });

  it('throws ChecksumMismatchError for input shorter than the trailer', () => {
    expect(() => unprotect(new Uint8Array(1).buffer)).toThrow(ChecksumMismatchError);
  });

  it('accepts a Uint8Array input directly, not just ArrayBuffer', () => {
    const frame = frameOf([9, 8, 7]);
    const wire = new Uint8Array(protect(frame));
    const recovered = unprotect(wire);
    expect(Array.from(new Uint8Array(recovered))).toEqual([9, 8, 7]);
  });
});
