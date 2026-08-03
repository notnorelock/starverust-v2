import { describe, expect, it, vi } from 'vitest';
import { encodePing, encodeHello, encodeChatMessage, decodeAny, finalizeForWire, Opcode } from '@starve/protocol';
import { PacketRouter, type PacketRouterOptions } from './PacketRouter';
import { ClientConnection } from './ClientConnection';

function fakeConnection(): { connection: ClientConnection; sentFrames: ArrayBuffer[] } {
  const sentFrames: ArrayBuffer[] = [];
  const fakeSocket = {
    sendBinary: (data: ArrayBuffer) => sentFrames.push(data),
    close: () => {},
  };
  const connection = new ClientConnection(1, fakeSocket as never);
  return { connection, sentFrames };
}

function fakeRouter(overrides: Partial<PacketRouterOptions> = {}): PacketRouter {
  return new PacketRouter({ onHello: () => {}, onChatMessage: () => {}, ...overrides });
}

describe('PacketRouter', () => {
  it('replies to Ping with a Pong echoing clientSendTime unmodified', () => {
    const router = fakeRouter();
    const { connection, sentFrames } = fakeConnection();

    router.route(connection, finalizeForWire(encodePing({ clientSendTime: 123456.789 })));

    expect(sentFrames).toHaveLength(1);
    const decoded = decodeAny(sentFrames[0]!);
    expect(decoded.opcode).toBe(Opcode.Pong);
    if (decoded.opcode !== Opcode.Pong) {
      throw new Error('unexpected opcode');
    }
    expect(decoded.packet.clientSendTime).toBeCloseTo(123456.789, 9);
  });

  it('invokes onHello (not the Pong reply path) for a Hello packet', () => {
    const onHello = vi.fn();
    const router = fakeRouter({ onHello });
    const { connection, sentFrames } = fakeConnection();

    router.route(connection, finalizeForWire(encodeHello({ protocolVersion: 1, nickname: 'Alice' })));

    expect(onHello).toHaveBeenCalledTimes(1);
    expect(onHello).toHaveBeenCalledWith(connection, { protocolVersion: 1, nickname: 'Alice' });
    expect(sentFrames).toHaveLength(0);
  });

  it('invokes onChatMessage for a ChatMessage packet', () => {
    const onChatMessage = vi.fn();
    const router = fakeRouter({ onChatMessage });
    const { connection, sentFrames } = fakeConnection();

    router.route(connection, finalizeForWire(encodeChatMessage({ text: 'hello' })));

    expect(onChatMessage).toHaveBeenCalledTimes(1);
    expect(onChatMessage).toHaveBeenCalledWith(connection, { text: 'hello' });
    expect(sentFrames).toHaveLength(0);
  });
});
