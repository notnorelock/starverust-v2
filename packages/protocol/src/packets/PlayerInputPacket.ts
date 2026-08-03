import { beginWrite, writeU8, writeU16, writeU32, endWrite } from '../io/BufferWriter';
import { readU8, readU16, readU32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/** Bitflags composed with `|=` into PlayerInputPacket.direction. */
export enum InputFlag {
  Up = 1 << 0,
  Down = 1 << 1,
  Left = 1 << 2,
  Right = 1 << 3,
  Sprint = 1 << 4,
}

/**
 * Client -> Server: current directional input state, sampled on the client's
 * fixed input-send interval (decoupled from render rate). Aim/facing angle is a separate
 * packet (see PlayerAnglePacket) — it changes on its own mouse-driven schedule,
 * independent of movement-key transitions, matching the reference implementation's own
 * separate `send_angle()` from movement input.
 */
export interface PlayerInputPacket {
  /** Client-local tick counter at time of sampling; reserved for future reconciliation. */
  tick: number;
  /** InputFlag bits OR'd together, e.g. `InputFlag.Up | InputFlag.Left`. */
  direction: number;
  /** Monotonically increasing per-client sequence number; reserved for future reconciliation. */
  sequence: number;
}

// Payload layout (7 bytes):
// [0..3] u32 tick
// [4]    u8  direction bitmask (see InputFlag)
// [5..6] u16 sequence
const PAYLOAD_SIZE = 7;

export function encodePlayerInput(packet: PlayerInputPacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.PlayerInput, flags: 0, length: PAYLOAD_SIZE });

  writeU32(packet.tick);
  writeU8(packet.direction);
  writeU16(packet.sequence);

  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodePlayerInput(): PlayerInputPacket {
  const tick = readU32();
  const direction = readU8();
  const sequence = readU16();

  return { tick, direction, sequence };
}
