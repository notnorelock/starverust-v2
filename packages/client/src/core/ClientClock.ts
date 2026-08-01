/** Tracks frame-to-frame delta time for the rAF render loop, independent of the network tick. */
export class ClientClock {
  private lastFrameTime: number | undefined;

  tick(now: number): number {
    const dt = this.lastFrameTime === undefined ? 0 : (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    return dt;
  }
}
