import { beginWrite, writeU16, writeU32, writeF32, endWrite } from '../io/BufferWriter';
import { readU16, readU32, readF32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/** Position snapshot for a single entity within a WorldSnapshotPacket. */
export interface EntitySnapshot {
  entityId: number;
  x: number;
  y: number;
  /**
   * This entity's current movement speed in world units/second (e.g. PLAYER_MOVE_SPEED or
   * PLAYER_SPRINT_SPEED while sprinting) — broadcast so clients can chase this entity's
   * render position at the same speed it's actually moving at, rather than assuming a
   * fixed constant. See SnapshotBuffer's chase-and-snap smoothing.
   */
  speed: number;
}

/**
 * Server -> Client: authoritative world state broadcast once per server tick.
 * Identical payload is sent to every connected client in Stage 1 (no interest management yet).
 */
export interface WorldSnapshotPacket {
  serverTick: number;
  entities: readonly EntitySnapshot[];
}

// Payload layout:
// [0..3] u32 serverTick
// [4..5] u16 entityCount
// repeated per entity (16 bytes): u32 entityId, f32 x, f32 y, f32 speed
const HEADER_FIELDS_SIZE = 6;
const ENTITY_RECORD_SIZE = 16;

export function encodeWorldSnapshot(packet: WorldSnapshotPacket): ArrayBuffer {
  const payloadSize = HEADER_FIELDS_SIZE + packet.entities.length * ENTITY_RECORD_SIZE;
  beginWrite(HEADER_SIZE + payloadSize);
  writeHeader({ opcode: Opcode.WorldSnapshot, flags: 0, length: payloadSize });

  writeU32(packet.serverTick);
  writeU16(packet.entities.length);

  for (const entity of packet.entities) {
    writeU32(entity.entityId);
    writeF32(entity.x);
    writeF32(entity.y);
    writeF32(entity.speed);
  }

  return endWrite();
}

export function decodeWorldSnapshot(): WorldSnapshotPacket {
  const serverTick = readU32();
  const entityCount = readU16();

  const entities: EntitySnapshot[] = [];
  for (let i = 0; i < entityCount; i += 1) {
    const entityId = readU32();
    const x = readF32();
    const y = readF32();
    const speed = readF32();
    entities.push({ entityId, x, y, speed });
  }

  return { serverTick, entities };
}
