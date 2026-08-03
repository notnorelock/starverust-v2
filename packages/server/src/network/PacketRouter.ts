import { Opcode, decodeAny, type HelloPacket } from '@starve/protocol';
import { Logger } from '@starve/shared';
import type { ClientConnection } from './ClientConnection';

const logger = new Logger('PacketRouter');

export interface PacketRouterOptions {
  /**
   * Invoked once per connection when its HelloPacket arrives — the trigger for creating
   * that connection's player entity (see PlayerSession.onHelloReceived). Every other
   * opcode routes through the switch below unconditionally, but Hello is intentionally
   * handled via this injected callback rather than a case in the switch, since it needs
   * access to dependencies (World, PlayerRepository, WorldConfig, ...) this router has no
   * reason to know about otherwise.
   */
  onHello: (connection: ClientConnection, packet: HelloPacket) => void;
}

/**
 * Dispatches decoded inbound packets to the systems/state that care about them.
 * The switch is the extension point for future client->server packet families (combat
 * actions, crafting requests, chat...); Hello is special-cased via a callback (see
 * PacketRouterOptions) since it drives an async spawn flow other opcodes don't need.
 */
export class PacketRouter {
  constructor(private readonly options: PacketRouterOptions) {}

  route(connection: ClientConnection, buffer: ArrayBuffer): void {
    try {
      const decoded = decodeAny(buffer);
      switch (decoded.opcode) {
        case Opcode.Hello:
          this.options.onHello(connection, decoded.packet);
          break;
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
