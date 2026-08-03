import { Logger } from '@starve/shared';
import { encodeChatBroadcast, type ChatMessagePacket } from '@starve/protocol';
import type { ClientConnection } from '../network/ClientConnection';
import type { NetworkService } from '../network/NetworkService';

const logger = new Logger('ChatSession');

const MAX_MESSAGE_LENGTH = 200;

/**
 * Server-side handling for an inbound ChatMessagePacket (see PacketRouterOptions.onChatMessage
 * / GameServer.handleChatMessage) — validates and re-broadcasts to every connection as
 * ChatBroadcastPacket, mirroring PlayerSession.onHelloReceived's own
 * validate-then-broadcast shape (see isValidNickname there for the same pattern applied to
 * nicknames instead of chat text).
 *
 * A message is silently dropped (not broadcast, no error sent back) if the sender has no
 * pid yet (hasn't completed Hello — see ClientConnection.pid) or the trimmed text is empty
 * or exceeds MAX_MESSAGE_LENGTH; never trust the client's own input validation alone, and
 * there's no gameplay reason to tell a misbehaving/pre-Hello client why its message didn't
 * go through.
 */
export function onChatMessageReceived(
  connection: ClientConnection,
  message: ChatMessagePacket,
  network: NetworkService,
): void {
  if (connection.pid === undefined) {
    logger.warn(`Dropping chat message from connection=${connection.connectionId}: no pid assigned yet`);
    return;
  }

  const text = message.text.trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    logger.warn(`Dropping chat message from pid=${connection.pid}: invalid length ${text.length}`);
    return;
  }

  network.broadcast(encodeChatBroadcast({ pid: connection.pid, text }));
}
