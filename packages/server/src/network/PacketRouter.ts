import { Opcode, decodeAny } from '@starve/protocol';
import { Logger } from '@starve/shared';
import type { ClientConnection } from './ClientConnection';

const logger = new Logger('PacketRouter');

/**
 * Dispatches decoded inbound packets to the systems/state that care about them.
 * Stage 1 only handles PlayerInput; the switch is the extension point for future
 * client->server packet families (combat actions, crafting requests, chat...).
 */
export class PacketRouter {
  route(connection: ClientConnection, buffer: ArrayBuffer): void {
    try {
      const decoded = decodeAny(buffer);
      switch (decoded.opcode) {
        case Opcode.PlayerInput:
          connection.setLatestInput(decoded.packet);
          break;
        default:
          logger.warn(`Received unexpected opcode from client: 0x${decoded.opcode.toString(16)}`);
      }
    } catch (error) {
      logger.warn('Failed to decode inbound packet', error);
    }
  }
}
