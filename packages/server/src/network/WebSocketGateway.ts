import type { Server, ServerWebSocket } from 'bun';
import { Logger } from '@starve/shared';
import { finalizeForWire } from '@starve/protocol';
import { ClientConnection, type ConnectionSocketData } from './ClientConnection';
import { ConnectionRegistry } from './ConnectionRegistry';
import { PacketRouter } from './PacketRouter';
import type { NetworkService } from './NetworkService';

const logger = new Logger('WebSocketGateway');

export interface WebSocketGatewayOptions {
  port: number;
  connectionRegistry: ConnectionRegistry;
  packetRouter: PacketRouter;
  onConnect: (connection: ClientConnection) => void;
  onDisconnect: (connection: ClientConnection) => void;
}

/**
 * Owns the Bun.serve() HTTP+WebSocket server. Bun's native WebSocket implementation is
 * already built on uSockets (the same engine standalone uWebSockets.js wraps), so this
 * avoids an extra native binary dependency while keeping first-party TypeScript support.
 */
export class WebSocketGateway implements NetworkService {
  private server: Server<ConnectionSocketData> | undefined;
  private nextConnectionId = 1;

  constructor(private readonly options: WebSocketGatewayOptions) {}

  start(): void {
    const { port, connectionRegistry, packetRouter, onConnect, onDisconnect } = this.options;

    this.server = Bun.serve<ConnectionSocketData>({
      port,
      fetch: (request, server) => {
        const connectionId = this.nextConnectionId++;
        const upgraded = server.upgrade(request, { data: { connectionId } });
        if (upgraded) {
          return undefined;
        }
        return new Response('WebSocket upgrade required', { status: 426 });
      },
      websocket: {
        open: (ws: ServerWebSocket<ConnectionSocketData>) => {
          const connection = new ClientConnection(ws.data.connectionId, ws);
          connectionRegistry.add(connection);
          logger.info(`Connection ${connection.connectionId} opened (${connectionRegistry.size} total)`);
          onConnect(connection);
        },
        message: (ws: ServerWebSocket<ConnectionSocketData>, message: string | Buffer) => {
          if (typeof message === 'string') {
            return; // Binary-only protocol; ignore stray text frames.
          }
          const connection = connectionRegistry.get(ws.data.connectionId);
          if (!connection) {
            return;
          }
          const view = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
          packetRouter.route(connection, view.slice().buffer);
        },
        close: (ws: ServerWebSocket<ConnectionSocketData>) => {
          const connection = connectionRegistry.get(ws.data.connectionId);
          connectionRegistry.remove(ws.data.connectionId);
          logger.info(`Connection ${ws.data.connectionId} closed (${connectionRegistry.size} total)`);
          if (connection) {
            onDisconnect(connection);
          }
        },
      },
    });

    logger.info(`Listening on ws://localhost:${this.server.port}`);
  }

  broadcast(frame: ArrayBuffer): void {
    // Protect once (checksum + XOR) and reuse the result for every recipient, rather than
    // redoing identical, deterministic work per connection.
    const wireBytes = finalizeForWire(frame);
    for (const connection of this.options.connectionRegistry.all()) {
      connection.sendProtected(wireBytes);
    }
  }

  stop(): void {
    this.server?.stop();
  }
}
