import { beginWrite, writeU8, writeU32, writeF32, endWrite } from '../io/BufferWriter';
import { readU8, readU32, readF32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Server -> Client: an entity now exists and the client should start tracking it. Sent
 * once when an entity is created (player spawn, world geometry at startup) — plus once
 * per already-alive entity to a newly-connected client, since it has no other way to
 * learn about entities that existed before it connected. Position/speed still arrive on
 * the regular WorldSnapshotPacket every tick; this packet's job is only the client's
 * entity-tracking lifecycle (spawn the right visual for entityType), not per-tick state.
 */
export interface EntityInsertPacket {
  entityId: number;
  /** See EntityType (shared) — Player = 0 is the default/first value. */
  entityType: number;
  x: number;
  y: number;
}

// Payload layout (13 bytes):
// [0..3] u32 entityId
// [4]    u8  entityType (see EntityType)
// [5..8] f32 x
// [9..12] f32 y
const PAYLOAD_SIZE = 13;

export function encodeEntityInsert(packet: EntityInsertPacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.EntityInsert, flags: 0, length: PAYLOAD_SIZE });

  writeU32(packet.entityId);
  writeU8(packet.entityType);
  writeF32(packet.x);
  writeF32(packet.y);

  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodeEntityInsert(): EntityInsertPacket {
  const entityId = readU32();
  const entityType = readU8();
  const x = readF32();
  const y = readF32();

  return { entityId, entityType, x, y };
}
