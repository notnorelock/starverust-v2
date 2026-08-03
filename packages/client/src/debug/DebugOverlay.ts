import styles from '../styles/App.module.scss';

export interface DebugOverlayStats {
  fps: number;
  serverTick: number;
  pingMs: number;
  entityCount: number;
  /** The local player's current world position, for debugging camera follow/easing/bounds — undefined before it's known. */
  playerPosition: { x: number; y: number } | undefined;
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
      `Ping: ${stats.pingMs.toFixed(0)}ms\n` +
      `Entities: ${stats.entityCount}\n` +
      `Player Pos: ${position ? `${position.x.toFixed(1)}, ${position.y.toFixed(1)}` : '—'}`;
  }
}
