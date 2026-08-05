import type { NetworkClient } from '../network/NetworkClient';

/** How often the debug overlay's packets-in/packets-out counters are refreshed — see update(). */
const PACKET_RATE_WINDOW_MS = 1000;

export interface FrameStats {
  fps: number;
  packetsInPerSecond: number;
  packetsOutPerSecond: number;
  bytesInPerSecond: number;
  bytesOutPerSecond: number;
}

/**
 * Debug-overlay bookkeeping split out of GameClient — both FPS and packet/byte rates
 * share the same "accumulate, then rate over a timed window" shape and are only ever
 * read together (see GameClient.frame()'s debugOverlay.update() call), so they're one
 * tracker rather than two.
 *
 * FPS ticks every frame via recordFrame() (its own 500ms window). Packet/byte rates are
 * diffed against NetworkClient's lifetime counters once every PACKET_RATE_WINDOW_MS
 * (1s) — a separate, longer window from FPS's, refreshed lazily inside stats() rather
 * than needing its own per-frame call site.
 */
export class FrameStatsTracker {
  private fps = 0;
  private fpsAccumulator = 0;
  private fpsWindowStart = 0;

  private packetsInPerSecond = 0;
  private packetsOutPerSecond = 0;
  private bytesInPerSecond = 0;
  private bytesOutPerSecond = 0;
  private packetRateWindowStart = 0;
  private packetsInAtWindowStart = 0;
  private packetsOutAtWindowStart = 0;
  private bytesInAtWindowStart = 0;
  private bytesOutAtWindowStart = 0;

  constructor(private readonly networkClient: NetworkClient) {}

  /** Call once, at the same time as start()'s other window-start timestamps. */
  reset(now: number): void {
    this.fpsWindowStart = now;
    this.packetRateWindowStart = now;
  }

  /** Call once per rendered frame, before reading stats(). */
  recordFrame(now: number): void {
    this.fpsAccumulator += 1;
    if (now - this.fpsWindowStart >= 500) {
      this.fps = (this.fpsAccumulator * 1000) / (now - this.fpsWindowStart);
      this.fpsAccumulator = 0;
      this.fpsWindowStart = now;
    }

    this.refreshPacketRates(now);
  }

  stats(): FrameStats {
    return {
      fps: this.fps,
      packetsInPerSecond: this.packetsInPerSecond,
      packetsOutPerSecond: this.packetsOutPerSecond,
      bytesInPerSecond: this.bytesInPerSecond,
      bytesOutPerSecond: this.bytesOutPerSecond,
    };
  }

  /**
   * Diffs NetworkClient's lifetime send/receive/byte counters against their values at
   * the start of the current window to produce packets-per-second and bytes-per-second
   * rates, refreshed once every PACKET_RATE_WINDOW_MS (1s).
   */
  private refreshPacketRates(now: number): void {
    if (now - this.packetRateWindowStart < PACKET_RATE_WINDOW_MS) {
      return;
    }

    const elapsedSeconds = (now - this.packetRateWindowStart) / 1000;
    const totalPacketsIn = this.networkClient.totalPacketsReceived;
    const totalPacketsOut = this.networkClient.totalPacketsSent;
    const totalBytesIn = this.networkClient.totalBytesReceived;
    const totalBytesOut = this.networkClient.totalBytesSent;

    this.packetsInPerSecond = Math.round((totalPacketsIn - this.packetsInAtWindowStart) / elapsedSeconds);
    this.packetsOutPerSecond = Math.round((totalPacketsOut - this.packetsOutAtWindowStart) / elapsedSeconds);
    this.bytesInPerSecond = (totalBytesIn - this.bytesInAtWindowStart) / elapsedSeconds;
    this.bytesOutPerSecond = (totalBytesOut - this.bytesOutAtWindowStart) / elapsedSeconds;

    this.packetsInAtWindowStart = totalPacketsIn;
    this.packetsOutAtWindowStart = totalPacketsOut;
    this.bytesInAtWindowStart = totalBytesIn;
    this.bytesOutAtWindowStart = totalBytesOut;
    this.packetRateWindowStart = now;
  }
}
