import styles from '../styles/App.module.scss';

export interface DebugOverlayStats {
  fps: number;
  serverTick: number;
  pingMs: number;
  entityCount: number;
}

/** Small on-screen HUD showing live FPS/tick/ping — cheap now, reused by later debug tooling. */
export class DebugOverlay {
  private readonly element: HTMLDivElement;

  constructor(mountPoint: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = styles.debugOverlay ?? '';
    mountPoint.appendChild(this.element);
  }

  update(stats: DebugOverlayStats): void {
    this.element.textContent =
      `FPS: ${stats.fps.toFixed(0)}\n` +
      `Server Tick: ${stats.serverTick}\n` +
      `Ping: ${stats.pingMs.toFixed(0)}ms\n` +
      `Entities: ${stats.entityCount}`;
  }
}
