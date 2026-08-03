import { beginWrite, writeU32, endWrite } from '../io/BufferWriter';
import { readU32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Server -> Client, broadcast once when a player leaves — disconnects today; a future
 * death/respawn stage could reuse it too, hence "left" rather than "disconnected". Carries
 * only pid, not entityId: this is the player-identity-lifecycle counterpart to
 * EntityDestroyPacket (which still fires separately for the underlying entity — see
 * PlayerSession.onConnectionClosed) and exists so a client tracking players by pid/nickname
 * (see PlayerJoinPacket) has a matching removal signal keyed the same way, without needing
 * to cross-reference entityId back to pid itself.
 */
export interface PlayerLeftPacket {
  pid: number;
}

// Payload layout (4 bytes):
// [0..3] u32 pid
const PAYLOAD_SIZE = 4;

export function encodePlayerLeft(packet: PlayerLeftPacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.PlayerLeft, flags: 0, length: PAYLOAD_SIZE });
  writeU32(packet.pid);
  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodePlayerLeft(): PlayerLeftPacket {
  const pid = readU32();
  return { pid };
}
