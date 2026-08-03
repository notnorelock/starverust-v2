import { beginWrite, writeU32, endWrite } from '../io/BufferWriter';
import { readU32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Server -> Client: an entity no longer exists and the client should stop tracking it
 * (disconnect today; entity death is a later stage). Explicit rather than inferred from a
 * missing entityId on the next WorldSnapshotPacket, so cleanup happens the instant the
 * server knows about it instead of waiting up to one tick and requiring the client to diff
 * consecutive snapshots itself.
 */
export interface EntityDestroyPacket {
  entityId: number;
}

// Payload layout (4 bytes):
// [0..3] u32 entityId
const PAYLOAD_SIZE = 4;

export function encodeEntityDestroy(packet: EntityDestroyPacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.EntityDestroy, flags: 0, length: PAYLOAD_SIZE });

  writeU32(packet.entityId);

  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodeEntityDestroy(): EntityDestroyPacket {
  const entityId = readU32();
  return { entityId };
}
