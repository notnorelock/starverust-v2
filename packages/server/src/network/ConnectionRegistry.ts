import type { ClientConnection } from './ClientConnection';

/** Tracks all currently-connected clients, keyed by their connection id. */
export class ConnectionRegistry {
  private readonly connections = new Map<number, ClientConnection>();

  add(connection: ClientConnection): void {
    this.connections.set(connection.connectionId, connection);
  }

  remove(connectionId: number): void {
    this.connections.delete(connectionId);
  }

  get(connectionId: number): ClientConnection | undefined {
    return this.connections.get(connectionId);
  }

  all(): IterableIterator<ClientConnection> {
    return this.connections.values();
  }

  get size(): number {
    return this.connections.size;
  }
}
