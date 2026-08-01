import { describe, expect, it } from 'vitest';
import { FixedTimestepLoop } from './FixedTimestepLoop';

interface FakeClock {
  now: () => number;
  advance: (seconds: number) => void;
}

function createFakeClock(): FakeClock {
  let time = 0;
  return {
    now: () => time,
    advance: (seconds: number) => {
      time += seconds;
    },
  };
}

interface FakeScheduler {
  scheduler: (fn: () => void, ms: number) => unknown;
  canceler: (handle: unknown) => void;
  runNext: () => void;
  pendingCount: () => number;
}

function createFakeScheduler(): FakeScheduler {
  let idCounter = 0;
  const pending = new Map<number, () => void>();
  return {
    scheduler: (fn: () => void) => {
      const id = idCounter++;
      pending.set(id, fn);
      return id;
    },
    canceler: (handle: unknown) => {
      pending.delete(handle as number);
    },
    runNext: () => {
      const [id, fn] = [...pending.entries()][0] ?? [];
      if (id === undefined || !fn) {
        throw new Error('No pending callback to run');
      }
      pending.delete(id);
      fn();
    },
    pendingCount: () => pending.size,
  };
}

describe('FixedTimestepLoop', () => {
  it('calls onTick exactly N times when N full fixedDt intervals have elapsed', () => {
    const clock = createFakeClock();
    const scheduler = createFakeScheduler();
    const tickRate = 30;
    const fixedDt = 1 / tickRate;

    let tickCalls = 0;
    const loop = new FixedTimestepLoop({
      tickRate,
      onTick: () => {
        tickCalls += 1;
      },
      now: clock.now,
      scheduler: scheduler.scheduler,
      canceler: scheduler.canceler,
    });

    loop.start();
    scheduler.runNext(); // initial scheduled step (delay 0), establishes lastTime

    clock.advance(fixedDt * 3);
    scheduler.runNext();

    expect(tickCalls).toBe(3);
  });

  it('does not call onTick when less than one fixedDt has elapsed', () => {
    const clock = createFakeClock();
    const scheduler = createFakeScheduler();
    const tickRate = 30;
    const fixedDt = 1 / tickRate;

    let tickCalls = 0;
    const loop = new FixedTimestepLoop({
      tickRate,
      onTick: () => {
        tickCalls += 1;
      },
      now: clock.now,
      scheduler: scheduler.scheduler,
      canceler: scheduler.canceler,
    });

    loop.start();
    scheduler.runNext();

    clock.advance(fixedDt * 0.5);
    scheduler.runNext();

    expect(tickCalls).toBe(0);
  });

  it('stop() prevents further scheduling', () => {
    const clock = createFakeClock();
    const scheduler = createFakeScheduler();
    const loop = new FixedTimestepLoop({
      tickRate: 30,
      onTick: () => {},
      now: clock.now,
      scheduler: scheduler.scheduler,
      canceler: scheduler.canceler,
    });

    loop.start();
    expect(scheduler.pendingCount()).toBe(1);
    loop.stop();
    expect(scheduler.pendingCount()).toBe(0);
    expect(loop.isRunning).toBe(false);
  });
});
