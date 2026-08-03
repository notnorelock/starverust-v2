/**
 * Reserved opcode ranges keep room for future gameplay packet families
 * without renumbering existing ones as the protocol grows across stages.
 *
 * 0x00-0x0F  connection lifecycle (handshake, ping/pong, disconnect)
 * 0x10-0x1F  player input
 * 0x20-0x2F  world/entity state
 * 0x30-0x3F  combat            (future stage)
 * 0x40-0x4F  inventory/items   (future stage)
 * 0x50-0x5F  chat              (future stage)
 */
export enum Opcode {
  Hello = 0x00,
  Handshake = 0x01,
  ConnectionRejected = 0x02,
  PlayerInput = 0x10,
  WorldSnapshot = 0x20,
  EntityInsert = 0x21,
  EntityDestroy = 0x22,
  EntityUpdate = 0x23,
}
