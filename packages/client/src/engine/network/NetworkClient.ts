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
  /**
   * Lifetime frame/byte counts, incremented on every send()/inbound message — not yet rated
   * per-second. GameClient reads these once a second and diffs against its own previous
   * reading to produce the debug overlay's packets-in/out and bytes-in/out rates (mirroring
   * how it already turns a raw frame counter into FPS via trackFps()); NetworkClient itself
   * stays ignorant of "per second," it just counts. Byte counts are measured off the actual
   * wire frame — post-finalizeForWire() (checksum + XOR trailer included) for outbound,
   * and the raw received ArrayBuffer for inbound — so they reflect real bytes-on-the-wire,
   * not just the pre-protection payload size.
   */
  private packetsSent = 0;
  private packetsReceived = 0;
  private bytesSent = 0;
  private bytesReceived = 0;

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
        this.packetsReceived += 1;
        this.bytesReceived += event.data.byteLength;
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
      const wireBytes = finalizeForWire(frame);
      this.socket.send(wireBytes);
      this.packetsSent += 1;
      this.bytesSent += wireBytes.byteLength;
    }
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Lifetime outbound frame count — see the packetsSent field doc comment for how this is rated. */
  get totalPacketsSent(): number {
    return this.packetsSent;
  }

  /** Lifetime inbound frame count — see the packetsReceived field doc comment for how this is rated. */
  get totalPacketsReceived(): number {
    return this.packetsReceived;
  }

  /** Lifetime outbound byte count (post-wire-protection) — see the bytesSent field doc comment for how this is rated. */
  get totalBytesSent(): number {
    return this.bytesSent;
  }

  /** Lifetime inbound byte count (raw received frame) — see the bytesReceived field doc comment for how this is rated. */
  get totalBytesReceived(): number {
    return this.bytesReceived;
  }
}
