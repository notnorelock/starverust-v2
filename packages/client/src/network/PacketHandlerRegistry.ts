import { decodeAny, Opcode, type DecodedPacket } from '@starve/protocol';
import { Logger } from '@starve/shared';

type HandlerFor<O extends Opcode> = (packet: Extract<DecodedPacket, { opcode: O }>['packet']) => void;

const logger = new Logger('PacketHandlerRegistry');

/**
 * Maps opcodes to handler callbacks and dispatches decoded inbound frames to them.
 * Mirrors the server's PacketRouter so both sides follow the same "decode once,
 * dispatch by opcode" shape.
 */
export class PacketHandlerRegistry {
  private readonly handlers = new Map<Opcode, (packet: unknown) => void>();

  on<O extends Opcode>(opcode: O, handler: HandlerFor<O>): void {
    this.handlers.set(opcode, handler as (packet: unknown) => void);
  }

  dispatch(buffer: ArrayBuffer): void {
    try {
      const decoded = decodeAny(buffer);
      const handler = this.handlers.get(decoded.opcode);
      handler?.(decoded.packet);
    } catch (error) {
      logger.warn('Failed to decode inbound packet', error);
    }
  }
}

/** Module-level singleton — one per page, reached for directly instead of threaded through constructors/DI. */
const instance = new PacketHandlerRegistry();
export const packetHandlerRegistry = (): PacketHandlerRegistry => instance;
