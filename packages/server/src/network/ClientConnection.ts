import type { ServerWebSocket } from 'bun';
import type { EntityId } from '@starve/shared';
import { finalizeForWire, type PlayerInputPacket } from '@starve/protocol';

export interface ConnectionSocketData {
  connectionId: number;
}

/**
 * Server-side handle for one connected client. Owns the raw socket plus whatever
 * per-connection state the simulation needs to read each tick.
 *
 * The client sends PlayerInputPacket only when its held-key bitmask changes (event-driven,
 * not a fixed-rate resend), so `latestInput` deliberately persists across ticks rather than
 * being cleared after one read — InputApplicationSystem re-applies the same last-known
 * direction every tick until a new packet arrives, which is what keeps movement continuous
 * between key transitions instead of stopping the instant a packet isn't received that tick.
 */
export class ClientConnection {
  public entityId: EntityId | undefined;
  /**
   * A player-networking identity, distinct from entityId — assigned once (see
   * ConnectionRegistry.assignPid, called from PlayerSession.onHelloReceived after
   * validation passes) from its own independent sequence, so ownership/networking
   * references (see EntityOwnerComponent) can never be confused with or collide against
   * the general ECS entityId space. entityId is Stage 1 accident of implementation (a
   * player's entity happens to live in the same id space as everything else in the
   * world); pid is deliberately its own namespace for "which player."
   */
  public pid: number | undefined;
  private latestInput: PlayerInputPacket | undefined;

  constructor(
    public readonly connectionId: number,
    private readonly socket: ServerWebSocket<ConnectionSocketData>,
  ) {}

  /** Applies wire-level protection (checksum + XOR) to an encoded frame and sends it. */
  send(frame: ArrayBuffer): void {
    this.socket.sendBinary(finalizeForWire(frame));
  }

  /** Sends bytes that have already been through finalizeForWire() — for broadcast, which
   *  protects a shared frame once instead of redundantly per-recipient. */
  sendProtected(wireBytes: ArrayBuffer): void {
    this.socket.sendBinary(wireBytes);
  }

  /**
   * Gracefully closes the underlying socket — used after sending a ConnectionRejectedPacket
   * (see PlayerSession.onHelloReceived) so a rejected connection doesn't linger open with
   * no player entity ever created for it.
   */
  close(): void {
    this.socket.close();
  }

  setLatestInput(input: PlayerInputPacket): void {
    this.latestInput = input;
  }

  getLatestInput(): PlayerInputPacket | undefined {
    return this.latestInput;
  }
}
