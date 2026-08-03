import { beginWrite, writeU8, writeU16, writeU32, writeF32, writeString, writerLength, endWrite } from '../io/BufferWriter';
import { readU8, readU16, readU32, readF32, readString } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/** Position snapshot for a single entity within an EntityUpdatePacket. */
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
  /**
   * Facing/aim angle in radians (see AimComponent, shared) — independent of the direction
   * of travel `speed` implies, since a player can move one way while facing another
   * (mouse-driven facing). Included here (not just on the one-time insert/snapshot
   * packets) because, unlike entityType/ownerPid, it changes just as often as position
   * while the player is actively aiming.
   */
  angle: number;
}

/**
 * Full catch-up record for a single entity within a WorldSnapshotPacket — EntitySnapshot's
 * fields plus entityType and ownerPid, so this packet is self-contained and a client can
 * spawn the right visual (and know who owns it) for every pre-existing entity without
 * depending on ordering against the separate EntityInsertPacket catch-up loop (see
 * PlayerSession.onHelloReceived, which sends both). EntityUpdatePacket deliberately does
 * NOT carry either field — it's the high-frequency per-tick stream, and values that don't
 * change tick-to-tick shouldn't be re-sent every tick for every nearby entity.
 */
export interface WorldSnapshotEntity extends EntitySnapshot {
  /** See EntityType (shared) — Player = 0 is the default/first value. */
  entityType: number;
  /** See EntityOwnerComponent (shared) / EntityInsertPacket.NO_OWNER_PID if unowned. */
  ownerPid: number;
  /**
   * The owning player's nickname, empty string for unowned/non-player entities. Embedded
   * directly here (rather than relying solely on the separate PlayerJoinPacket catch-up
   * loop — see PlayerSession.onHelloReceived) so this packet alone is enough to render
   * every pre-existing player's name label, without depending on PlayerJoinPacket having
   * already been processed first.
   */
  nickname: string;
}

/**
 * Server -> Client: full-world catch-up, sent once to a connection right after it joins
 * (see PlayerSession.onHelloReceived) — every entity that exists at that moment, so the
 * newly-connected client has initial position/speed/type/owner data to render before its
 * first EntityUpdatePacket arrives a tick later. NOT sent on a recurring timer anymore —
 * the per-tick, spatially-filtered stream is EntityUpdatePacket (see that file), unicast
 * per connection with only entities near that connection's own player. Entity lifecycle
 * itself (spawn/despawn after this initial catch-up) is EntityInsertPacket/
 * EntityDestroyPacket, broadcast to everyone as it happens.
 */
export interface WorldSnapshotPacket {
  serverTick: number;
  entities: readonly WorldSnapshotEntity[];
}

// Payload layout (variable length — per-entity records carry a variable-length nickname,
// see writeString/readString, so unlike most binary packets in this protocol there's no
// fixed per-record byte size to precompute; two-pass encode, same reasoning as HelloPacket):
// [0..3] u32 serverTick
// [4..5] u16 entityCount
// repeated per entity: u32 entityId, u8 entityType, u32 ownerPid, f32 x, f32 y, f32 speed,
//   f32 angle, string nickname (u16 length prefix + UTF-8 bytes)

function writeEntities(entities: readonly WorldSnapshotEntity[]): void {
  for (const entity of entities) {
    writeU32(entity.entityId);
    writeU8(entity.entityType);
    writeU32(entity.ownerPid);
    writeF32(entity.x);
    writeF32(entity.y);
    writeF32(entity.speed);
    writeF32(entity.angle);
    writeString(entity.nickname);
  }
}

export function encodeWorldSnapshot(packet: WorldSnapshotPacket): ArrayBuffer {
  beginWrite();
  writeU32(packet.serverTick);
  writeU16(packet.entities.length);
  writeEntities(packet.entities);
  const payloadSize = writerLength();
  endWrite();

  beginWrite(HEADER_SIZE + payloadSize);
  writeHeader({ opcode: Opcode.WorldSnapshot, flags: 0, length: payloadSize });
  writeU32(packet.serverTick);
  writeU16(packet.entities.length);
  writeEntities(packet.entities);

  return endWrite();
}

export function decodeWorldSnapshot(): WorldSnapshotPacket {
  const serverTick = readU32();
  const entityCount = readU16();

  const entities: WorldSnapshotEntity[] = [];
  for (let i = 0; i < entityCount; i += 1) {
    const entityId = readU32();
    const entityType = readU8();
    const ownerPid = readU32();
    const x = readF32();
    const y = readF32();
    const speed = readF32();
    const angle = readF32();
    const nickname = readString();
    entities.push({ entityId, entityType, ownerPid, x, y, speed, angle, nickname });
  }

  return { serverTick, entities };
}
