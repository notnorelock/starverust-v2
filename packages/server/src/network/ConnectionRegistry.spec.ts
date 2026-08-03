import { describe, expect, it } from 'vitest';
import { ConnectionRegistry } from './ConnectionRegistry';
import { ClientConnection } from './ClientConnection';

function fakeConnection(connectionId: number): ClientConnection {
  const fakeSocket = { sendBinary: () => {}, close: () => {} };
  return new ClientConnection(connectionId, fakeSocket as never);
}

describe('ConnectionRegistry', () => {
  describe('assignPid', () => {
    it('assigns pids starting at 1, from a sequence independent of connectionId', () => {
      const registry = new ConnectionRegistry();
      const connection = fakeConnection(999); // deliberately not 1, to prove pid isn't derived from it

      const pid = registry.assignPid(connection);

      expect(pid).toBe(1);
      expect(connection.pid).toBe(1);
    });

    it('assigns strictly increasing pids across connections, never reusing one', () => {
      const registry = new ConnectionRegistry();
      const a = fakeConnection(1);
      const b = fakeConnection(2);
      const c = fakeConnection(3);

      expect(registry.assignPid(a)).toBe(1);
      expect(registry.assignPid(b)).toBe(2);
      expect(registry.assignPid(c)).toBe(3);
    });

    it('does not consume a pid for a connection that is never assigned one (e.g. a rejected Hello)', () => {
      const registry = new ConnectionRegistry();
      const rejected = fakeConnection(1);
      const accepted = fakeConnection(2);

      // rejected never calls assignPid — simulates PlayerSession.onHelloReceived rejecting before assigning.
      expect(rejected.pid).toBeUndefined();
      expect(registry.assignPid(accepted)).toBe(1);
    });
  });

  it('add/get/remove/size/all track connections by connectionId', () => {
    const registry = new ConnectionRegistry();
    const connection = fakeConnection(42);

    registry.add(connection);

    expect(registry.get(42)).toBe(connection);
    expect(registry.size).toBe(1);
    expect([...registry.all()]).toEqual([connection]);

    registry.remove(42);

    expect(registry.get(42)).toBeUndefined();
    expect(registry.size).toBe(0);
  });
});
