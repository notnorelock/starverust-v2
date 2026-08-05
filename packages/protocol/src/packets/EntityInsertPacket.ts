import { beginWrite, writeU8, writeU32, writeF32, endWrite } from '../io/BufferWriter';
import { readU8, readU32, readF32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/** ownerPid value meaning "no owning player" (e.g. static world geometry) — pids are assigned starting at 1. */
export const NO_OWNER_PID = 0;

/**
 * Server -> Client: an entity now exists and the client should start tracking it. Sent
 * once when an entity is created (player spawn, world geometry at startup) — plus once
 * per already-alive entity to a newly-connected client, since it has no other way to
 * learn about entities that existed before it connected. Position/speed still arrive on
 * the regular WorldSnapshotPacket every tick; this packet's job is only the client's
 * entity-tracking lifecycle (spawn the right visual for entityType, know who owns it via
 * ownerPid), not per-tick state.
 */
export interface EntityInsertPacket {
  entityId: number;
  /** See EntityType (shared) — Player = 0 is the default/first value. */
  entityType: number;
  /** See EntityOwnerComponent (shared) / ClientConnection.pid — NO_OWNER_PID if unowned. */
  ownerPid: number;
  x: number;
  y: number;
  /**
   * ActionState bitmask (see EntityActionStateComponent, shared) — included here too (not
   * just on WorldSnapshotPacket/EntityUpdatePacket) so a freshly-spawned entity has a
   * correct idle/walk render state from the very first frame, rather than defaulting to
   * whatever the client assumes until its first EntityUpdatePacket arrives a tick later.
   * Entities with no EntityActionStateComponent (e.g. static world geometry) default to
   * ActionState.Idle at the packet-building call site.
   */
  action: number;
}

// Payload layout (18 bytes):
// [0..3]  u32 entityId
// [4]     u8  entityType (see EntityType)
// [5..8]  u32 ownerPid
// [9..12] f32 x
// [13..16] f32 y
// [17]    u8  action (see EntityActionStateComponent)
const PAYLOAD_SIZE = 18;

export function encodeEntityInsert(packet: EntityInsertPacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.EntityInsert, flags: 0, length: PAYLOAD_SIZE });

  writeU32(packet.entityId);
  writeU8(packet.entityType);
  writeU32(packet.ownerPid);
  writeF32(packet.x);
  writeF32(packet.y);
  writeU8(packet.action);

  return endWrite();
}

/** Decodes only the payload; caller is expected to have already read the header via beginRead()+readHeader(). */
export function decodeEntityInsert(): EntityInsertPacket {
  const entityId = readU32();
  const entityType = readU8();
  const ownerPid = readU32();
  const x = readF32();
  const y = readF32();
  const action = readU8();

  return { entityId, entityType, ownerPid, x, y, action };
}
