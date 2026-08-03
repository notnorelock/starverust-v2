import { beginWrite, writeU16, writeU32, writeF32, endWrite } from '../io/BufferWriter';
import { readU16, readU32, readF32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';
import type { EntitySnapshot } from './WorldSnapshotPacket';

/**
 * Server -> Client: per-tick position/speed update for dynamic entities near this
 * connection's own player — the recurring, spatially-filtered replacement for what
 * WorldSnapshotPacket used to broadcast every tick to everyone. Unlike WorldSnapshotPacket
 * (now sent once, at connection time, with every existing entity), this is unicast per
 * connection and typically carries only a handful of nearby entities, computed from a
 * SpatialHashGrid query centered on that connection's player each tick (see
 * InterestManagementSystem) — never a shared frame reused across every connection the way
 * WebSocketGateway.broadcast() reuses one protected frame, since each connection's nearby
 * set differs. Static/non-moving entities (world geometry) are never included here — they
 * were already sent once via EntityInsertPacket and never change, so re-sending them every
 * tick would be pure waste; only entities with a VelocityComponent are eligible.
 */
export interface EntityUpdatePacket {
  serverTick: number;
  entities: readonly EntitySnapshot[];
}

// Payload layout:
// [0..3] u32 serverTick
// [4..5] u16 entityCount
// repeated per entity (20 bytes): u32 entityId, f32 x, f32 y, f32 speed, f32 angle
const HEADER_FIELDS_SIZE = 6;
const ENTITY_RECORD_SIZE = 20;

export function encodeEntityUpdate(packet: EntityUpdatePacket): ArrayBuffer {
  const payloadSize = HEADER_FIELDS_SIZE + packet.entities.length * ENTITY_RECORD_SIZE;
  beginWrite(HEADER_SIZE + payloadSize);
  writeHeader({ opcode: Opcode.EntityUpdate, flags: 0, length: payloadSize });

  writeU32(packet.serverTick);
  writeU16(packet.entities.length);

  for (const entity of packet.entities) {
    writeU32(entity.entityId);
    writeF32(entity.x);
    writeF32(entity.y);
    writeF32(entity.speed);
    writeF32(entity.angle);
  }

  return endWrite();
}

export function decodeEntityUpdate(): EntityUpdatePacket {
  const serverTick = readU32();
  const entityCount = readU16();

  const entities: EntitySnapshot[] = [];
  for (let i = 0; i < entityCount; i += 1) {
    const entityId = readU32();
    const x = readF32();
    const y = readF32();
    const speed = readF32();
    const angle = readF32();
    entities.push({ entityId, x, y, speed, angle });
  }

  return { serverTick, entities };
}
