import { Logger } from '@starve/shared';
import { finalizeForWire } from '@starve/protocol';
import type { PacketHandlerRegistry } from './PacketHandlerRegistry';

const logger = new Logger('NetworkClient');

export interface NetworkClientOptions {
  url: string;
  handlers: PacketHandlerRegistry;
  onClose?: () => void;
}

/** Thin wrapper over the browser WebSocket, binary-only, decoupled from render/input loops. */
export class NetworkClient {
  private socket: WebSocket | undefined;

  constructor(private readonly options: NetworkClientOptions) {}

  /**
   * Opens the socket. `onOpen` is a call-time parameter (not a construction-time option)
   * because the caller may not know everything it needs to send on open (e.g. the
   * player's nickname for HelloPacket) until later than NetworkClient itself is
   * constructed — see ClientBootstrap, where the render stack is built and started well
   * before a nickname exists, and connect() is only called once the welcome overlay
   * collects one.
   */
  connect(onOpen?: () => void): void {
    const socket = new WebSocket(this.options.url);
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      logger.info('Connected');
      onOpen?.();
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
