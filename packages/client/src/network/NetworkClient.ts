import { Logger } from '@starve/shared';
import { finalizeForWire } from '@starve/protocol';
import type { PacketHandlerRegistry } from './PacketHandlerRegistry';

const logger = new Logger('NetworkClient');

export interface NetworkClientOptions {
  url: string;
  handlers: PacketHandlerRegistry;
  onOpen?: () => void;
  onClose?: () => void;
}

/** Thin wrapper over the browser WebSocket, binary-only, decoupled from render/input loops. */
export class NetworkClient {
  private socket: WebSocket | undefined;

  constructor(private readonly options: NetworkClientOptions) {}

  connect(): void {
    const socket = new WebSocket(this.options.url);
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      logger.info('Connected');
      this.options.onOpen?.();
    });

    socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.options.handlers.dispatch(event.data);
      }
    });

    socket.addEventListener('close', () => {
      logger.info('Disconnected');
      this.options.onClose?.();
    });

    socket.addEventListener('error', (event) => {
      logger.warn('Socket error', event);
    });

    this.socket = socket;
  }

  /** Applies wire-level protection (checksum + XOR) to an encoded frame and sends it. */
  send(frame: ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(finalizeForWire(frame));
    }
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}
