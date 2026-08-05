import styles from '../../styles/App.module.scss';

export interface DebugOverlayStats {
  fps: number;
  serverTick: number;
  /** Latest round-trip time from a Ping/Pong exchange, in ms — see PingPacket/PongPacket. Undefined before the first Pong arrives. */
  pingMs: number | undefined;
  entityCount: number;
  /** The local player's current world position, for debugging camera follow/easing/bounds — undefined before it's known. */
  playerPosition: { x: number; y: number } | undefined;
  /** Inbound WorldSnapshot/EntityUpdate/etc. frames received in roughly the last second — see NetworkClient. */
  packetsInPerSecond: number;
  /** Outbound PlayerInput/PlayerAngle/Ping/etc. frames sent in roughly the last second — see NetworkClient. */
  packetsOutPerSecond: number;
  /** Inbound bytes-on-the-wire in roughly the last second — see NetworkClient.totalBytesReceived. */
  bytesInPerSecond: number;
  /** Outbound bytes-on-the-wire in roughly the last second — see NetworkClient.totalBytesSent. */
  bytesOutPerSecond: number;
}

/** Formats a bytes/second rate as e.g. "512 B/s" or "12.3 KB/s" for the HUD. */
function formatBytesPerSecond(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(0)} B/s`;
  }
  return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
}

/** Small on-screen HUD showing live FPS/tick/ping/player-position — cheap now, reused by later debug tooling. */
export class DebugOverlay {
  private readonly element: HTMLDivElement;

  constructor(mountPoint: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = styles.debugOverlay ?? '';
    mountPoint.appendChild(this.element);
  }

  update(stats: DebugOverlayStats): void {
    const position = stats.playerPosition;
    this.element.textContent =
      `FPS: ${stats.fps.toFixed(0)}\n` +
      `Server Tick: ${stats.serverTick}\n` +
      `Ping: ${stats.pingMs !== undefined ? `${stats.pingMs.toFixed(0)}ms` : '—'}\n` +
      `Entities: ${stats.entityCount}\n` +
      `Player Pos: ${position ? `${position.x.toFixed(1)}, ${position.y.toFixed(1)}` : '—'}\n` +
      `Packets In/s: ${stats.packetsInPerSecond} (${formatBytesPerSecond(stats.bytesInPerSecond)})\n` +
      `Packets Out/s: ${stats.packetsOutPerSecond} (${formatBytesPerSecond(stats.bytesOutPerSecond)})`;
  }
}
