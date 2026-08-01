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

  setLatestInput(input: PlayerInputPacket): void {
    this.latestInput = input;
  }

  getLatestInput(): PlayerInputPacket | undefined {
    return this.latestInput;
  }
}
