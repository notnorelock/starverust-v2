import type { ClientConnection } from './ClientConnection';

/** Tracks all currently-connected clients, keyed by their connection id. */
export class ConnectionRegistry {
  private readonly connections = new Map<number, ClientConnection>();
  private nextPid = 1;

  add(connection: ClientConnection): void {
    this.connections.set(connection.connectionId, connection);
  }

  /**
   * Assigns `connection` the next pid from this registry's own independent sequence —
   * separate from EntityRegistry's entityId counter, so the two id spaces can never
   * collide or be confused for one another (see ClientConnection.pid). Called once per
   * connection, from PlayerSession.onHelloReceived after Hello validation passes — a
   * rejected connection never consumes a pid.
   */
  assignPid(connection: ClientConnection): number {
    const pid = this.nextPid;
    this.nextPid += 1;
    connection.pid = pid;
    return pid;
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
