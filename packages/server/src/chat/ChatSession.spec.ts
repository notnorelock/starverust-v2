import { describe, expect, it } from 'vitest';
import { decodeChatBroadcast, beginRead, endRead, readHeader } from '@starve/protocol';
import { onChatMessageReceived } from './ChatSession';
import { ClientConnection } from '../network/ClientConnection';
import type { NetworkService } from '../network/NetworkService';

// network.broadcast() (see NetworkService) receives the raw, pre-wire-protection frame —
// finalizeForWire()/checksum+XOR protection is applied later, inside WebSocketGateway.broadcast()
// (the real implementation), which this fake bypasses entirely. So unlike PacketRouter.spec.ts
// (which decodes via decodeAny() against frames that DID pass through a real ClientConnection.send()),
// this decodes the header/payload directly without decodeAny()'s built-in unprotect() step.
function decodeChatBroadcastFrame(buffer: ArrayBuffer): ReturnType<typeof decodeChatBroadcast> {
  beginRead(buffer);
  readHeader();
  const packet = decodeChatBroadcast();
  endRead();
  return packet;
}

function fakeConnection(pid: number | undefined): ClientConnection {
  const fakeSocket = { sendBinary: () => {}, close: () => {} };
  const connection = new ClientConnection(1, fakeSocket as never);
  connection.pid = pid;
  return connection;
}

function fakeNetwork(): { network: NetworkService; broadcasts: ArrayBuffer[] } {
  const broadcasts: ArrayBuffer[] = [];
  return { network: { broadcast: (buffer) => broadcasts.push(buffer) }, broadcasts };
}

describe('onChatMessageReceived', () => {
  it('broadcasts a ChatBroadcastPacket carrying the sender pid and trimmed text', () => {
    const connection = fakeConnection(5);
    const { network, broadcasts } = fakeNetwork();

    onChatMessageReceived(connection, { text: '  hello world  ' }, network);

    expect(broadcasts).toHaveLength(1);
    const packet = decodeChatBroadcastFrame(broadcasts[0]!);
    expect(packet.pid).toBe(5);
    expect(packet.text).toBe('hello world');
  });

  it('drops the message without broadcasting if the connection has no pid yet', () => {
    const connection = fakeConnection(undefined);
    const { network, broadcasts } = fakeNetwork();

    onChatMessageReceived(connection, { text: 'hello' }, network);

    expect(broadcasts).toHaveLength(0);
  });

  it('drops an empty (or whitespace-only) message', () => {
    const connection = fakeConnection(5);
    const { network, broadcasts } = fakeNetwork();

    onChatMessageReceived(connection, { text: '   ' }, network);

    expect(broadcasts).toHaveLength(0);
  });

  it('drops a message exceeding the max length', () => {
    const connection = fakeConnection(5);
    const { network, broadcasts } = fakeNetwork();

    onChatMessageReceived(connection, { text: 'a'.repeat(201) }, network);

    expect(broadcasts).toHaveLength(0);
  });

  it('allows a message at exactly the max length', () => {
    const connection = fakeConnection(5);
    const { network, broadcasts } = fakeNetwork();

    onChatMessageReceived(connection, { text: 'a'.repeat(200) }, network);

    expect(broadcasts).toHaveLength(1);
  });
});
