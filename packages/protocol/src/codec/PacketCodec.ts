import { beginRead, endRead } from '../io/BufferReader';
import { readHeader } from '../io/PacketHeader';
import { Opcode } from '../opcodes';
import { decodeHandshake, type HandshakePacket } from '../packets/HandshakePacket';
import { decodePlayerInput, type PlayerInputPacket } from '../packets/PlayerInputPacket';
import { decodeWorldSnapshot, type WorldSnapshotPacket } from '../packets/WorldSnapshotPacket';
import { decodeEntityInsert, type EntityInsertPacket } from '../packets/EntityInsertPacket';
import { decodeEntityDestroy, type EntityDestroyPacket } from '../packets/EntityDestroyPacket';
import { decodeEntityUpdate, type EntityUpdatePacket } from '../packets/EntityUpdatePacket';
import { protect, unprotect } from '../security/PacketFraming';

export type DecodedPacket =
  | { opcode: Opcode.Handshake; packet: HandshakePacket }
  | { opcode: Opcode.PlayerInput; packet: PlayerInputPacket }
  | { opcode: Opcode.WorldSnapshot; packet: WorldSnapshotPacket }
  | { opcode: Opcode.EntityInsert; packet: EntityInsertPacket }
  | { opcode: Opcode.EntityDestroy; packet: EntityDestroyPacket }
  | { opcode: Opcode.EntityUpdate; packet: EntityUpdatePacket };

/** Thrown when a buffer's opcode has no registered decoder. */
export class UnknownOpcodeError extends Error {
  constructor(opcode: number) {
    super(`No opcode 0x${opcode.toString(16).padStart(2, '0')}`);
  }
}

/**
 * Applies wire-level protection (checksum + XOR obfuscation) to an already-encoded
 * packet frame. Every packet's encode*() function returns a plain frame — call this
 * once, right before handing the result to the WebSocket, rather than baking protection
 * into each packet's own encoder (keeps packet codecs decoupled from transport security).
 */
export function finalizeForWire(frame: ArrayBuffer): ArrayBuffer {
  return protect(frame);
}

/**
 * Reverses wire-level protection and dispatches to the matching packet decoder based on
 * the (now-decoded) header's opcode. This is the single entry point both client and
 * server use to decode inbound frames, so adding a new packet type only requires a new
 * case here plus its own codec file. Throws ChecksumMismatchError (from PacketFraming)
 * for a corrupted/tampered frame before any packet-specific decoding is attempted.
 *
 * Wraps the whole decode in beginRead()/endRead() — BufferReader.ts's module-scoped
 * cursor means endRead() MUST run even if decoding throws partway through (a bad opcode,
 * a truncated payload), or the guard flag would stay stuck and every subsequent decodeAny()
 * call anywhere in the process would fail with ReadInProgressError. Hence the try/finally.
 */
export function decodeAny(wire: ArrayBuffer | Uint8Array): DecodedPacket {
  const frame = unprotect(wire);
  beginRead(frame);
  try {
    const header = readHeader();

    switch (header.opcode) {
      case Opcode.Handshake:
        return { opcode: Opcode.Handshake, packet: decodeHandshake() };
      case Opcode.PlayerInput:
        return { opcode: Opcode.PlayerInput, packet: decodePlayerInput() };
      case Opcode.WorldSnapshot:
        return { opcode: Opcode.WorldSnapshot, packet: decodeWorldSnapshot() };
      case Opcode.EntityInsert:
        return { opcode: Opcode.EntityInsert, packet: decodeEntityInsert() };
      case Opcode.EntityDestroy:
        return { opcode: Opcode.EntityDestroy, packet: decodeEntityDestroy() };
      case Opcode.EntityUpdate:
        return { opcode: Opcode.EntityUpdate, packet: decodeEntityUpdate() };
      default:
        throw new UnknownOpcodeError(header.opcode);
    }
  } finally {
    endRead();
  }
}
