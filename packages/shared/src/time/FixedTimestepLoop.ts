export type TickCallback = (fixedDt: number, tickIndex: number) => void;

export interface FixedTimestepLoopOptions {
  /** Ticks per second the simulation should advance at. */
  tickRate: number;
  onTick: TickCallback;
  /** Injectable time source; defaults to performance.now(). Enables deterministic tests. */
  now?: () => number;
  /** Injectable scheduler; defaults to setTimeout. Enables deterministic tests. */
  scheduler?: (fn: () => void, ms: number) => unknown;
  canceler?: (handle: unknown) => void;
}

/**
 * Self-correcting fixed-timestep loop using an accumulator, so slow/irregular callback
 * scheduling doesn't cause the simulation to drift off real time. Reused by the server's
 * authoritative tick loop; kept in `shared` (not `server`) so it stays independently
 * unit-testable and reusable by any future fixed-step subsystem.
 */
export class FixedTimestepLoop {
  private readonly fixedDt: number;
  private readonly onTick: TickCallback;
  private readonly now: () => number;
  private readonly scheduler: (fn: () => void, ms: number) => unknown;
  private readonly canceler: (handle: unknown) => void;

  private running = false;
  private accumulator = 0;
  private lastTime = 0;
  private tickCount = 0;
  private timerHandle: unknown = undefined;

  constructor(options: FixedTimestepLoopOptions) {
    this.fixedDt = 1 / options.tickRate;
    this.onTick = options.onTick;
    this.now = options.now ?? (() => performance.now() / 1000);
    this.scheduler = options.scheduler ?? ((fn, ms) => setTimeout(fn, ms));
    this.canceler = options.canceler ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get isRunning(): boolean {
    return this.running;
  }

  get tickIndex(): number {
    return this.tickCount;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.accumulator = 0;
    this.lastTime = this.now();
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timerHandle !== undefined) {
      this.canceler(this.timerHandle);
      this.timerHandle = undefined;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.timerHandle = this.scheduler(() => this.step(), Math.max(delayMs, 0));
  }

  private step(): void {
    if (!this.running) {
      return;
    }

    const current = this.now();
    const elapsed = current - this.lastTime;
    this.lastTime = current;
    this.accumulator += elapsed;

    while (this.accumulator >= this.fixedDt) {
      this.onTick(this.fixedDt, this.tickCount);
      this.tickCount += 1;
      this.accumulator -= this.fixedDt;
    }

    const overshoot = this.accumulator;
    const delayMs = (this.fixedDt - overshoot) * 1000;
    this.scheduleNext(delayMs);
  }
}
