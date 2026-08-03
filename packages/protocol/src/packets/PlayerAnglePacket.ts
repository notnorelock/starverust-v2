import { beginWrite, writeF32, endWrite } from '../io/BufferWriter';
import { readF32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Client -> Server: the player's current aim/facing angle in radians (standard math
 * convention: 0 = +x, increasing counter-clockwise — see AimComponent, shared), sent on
 * its own mouse-driven schedule via MouseAngleInputSource, independent of
 * PlayerInputPacket's movement-key-driven direction bitmask. Split into its own packet
 * (rather than a field on PlayerInputPacket) because the two change on genuinely
 * different, uncorrelated schedules — a player can move without moving the mouse, or aim
 * without pressing a movement key — matching the reference implementation's own separate
 * `send_angle()` call, distinct from its movement-key handling.
 */
export interface PlayerAnglePacket {
  angle: number;
}

// Payload layout (4 bytes):
// [0..3] f32 angle (radians)
const PAYLOAD_SIZE = 4;

export function encodePlayerAngle(packet: PlayerAnglePacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.PlayerAngle, flags: 0, length: PAYLOAD_SIZE });
  writeF32(packet.angle);
  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodePlayerAngle(): PlayerAnglePacket {
  const angle = readF32();
  return { angle };
}
