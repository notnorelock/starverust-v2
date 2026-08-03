import { Opcode, decodeAny, encodePong, type HelloPacket, type ChatMessagePacket } from '@starve/protocol';
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
  /**
   * Invoked for every inbound ChatMessagePacket — same reasoning as onHello: broadcasting
   * to every other connection needs NetworkService, which this router has no reason to
   * hold itself (see ChatSession.onChatMessageReceived).
   */
  onChatMessage: (connection: ClientConnection, packet: ChatMessagePacket) => void;
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
        case Opcode.PlayerAngle:
          connection.setLatestAngle(decoded.packet);
          break;
        case Opcode.Ping:
          // Bounced straight back, unmodified — see PongPacket's own doc comment. Handled
          // right here rather than via a callback (unlike Hello) since it needs nothing
          // but the connection itself to reply.
          connection.send(encodePong({ clientSendTime: decoded.packet.clientSendTime }));
          break;
        case Opcode.ChatMessage:
          this.options.onChatMessage(connection, decoded.packet);
          break;
        default:
          logger.warn(`Received unexpected opcode from client: 0x${decoded.opcode.toString(16)}`);
      }
    } catch (error) {
      logger.warn('Failed to decode inbound packet', error);
    }
  }
}
