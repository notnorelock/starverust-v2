import { beginWrite, writeU16, writeU32, writeF32, endWrite } from '../io/BufferWriter';
import { readU16, readU32, readF32 } from '../io/BufferReader';
import { writeHeader, HEADER_SIZE } from '../io/PacketHeader';
import { Opcode } from '../opcodes';

/**
 * Server -> Client, sent once after a connection's HelloPacket has been accepted (see
 * PlayerSession.onHelloReceived — never sent on raw socket open). Carries the world's
 * bounds so the client never hardcodes them — different regional server instances (or,
 * later, different maps) can have different sizes, and the client learns its instance's
 * actual bounds over the wire instead of assuming a shared constant.
 */
export interface HandshakePacket {
  /** The entityId the client's own player is bound to for the rest of the session. */
  assignedEntityId: number;
  /**
   * The pid (player-networking id) assigned to this connection — see ClientConnection.pid
   * / ConnectionRegistry.assignPid. Distinct from assignedEntityId: this is the value the
   * client should compare against a future EntityInsertPacket/WorldSnapshotEntity's
   * ownerPid to recognize "this is something I own."
   */
  assignedPid: number;
  /** Authoritative tick rate, so the client can size its interpolation delay accordingly. */
  tickRate: number;
  worldMinX: number;
  worldMaxX: number;
  worldMinY: number;
  worldMaxY: number;
}

// Payload layout (26 bytes):
// [0..3]   u32 assignedEntityId
// [4..7]   u32 assignedPid
// [8..9]   u16 tickRate
// [10..13] f32 worldMinX
// [14..17] f32 worldMaxX
// [18..21] f32 worldMinY
// [22..25] f32 worldMaxY
const PAYLOAD_SIZE = 26;

export function encodeHandshake(packet: HandshakePacket): ArrayBuffer {
  beginWrite(HEADER_SIZE + PAYLOAD_SIZE);
  writeHeader({ opcode: Opcode.Handshake, flags: 0, length: PAYLOAD_SIZE });
  writeU32(packet.assignedEntityId);
  writeU32(packet.assignedPid);
  writeU16(packet.tickRate);
  writeF32(packet.worldMinX);
  writeF32(packet.worldMaxX);
  writeF32(packet.worldMinY);
  writeF32(packet.worldMaxY);
  return endWrite();
}

export function decodeHandshake(): HandshakePacket {
  const assignedEntityId = readU32();
  const assignedPid = readU32();
  const tickRate = readU16();
  const worldMinX = readF32();
  const worldMaxX = readF32();
  const worldMinY = readF32();
  const worldMaxY = readF32();
  return { assignedEntityId, assignedPid, tickRate, worldMinX, worldMaxX, worldMinY, worldMaxY };
}
