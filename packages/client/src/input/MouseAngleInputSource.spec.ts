import { describe, expect, it, vi } from 'vitest';
import { MouseAngleInputSource, type ScreenPoint } from './MouseAngleInputSource';

const POLL_INTERVAL = 0.2; // matches ANGLE_POLL_INTERVAL_SECONDS

class FakeWindow {
  private listeners = new Set<(event: MouseEvent) => void>();

  addEventListener(_type: string, listener: EventListener): void {
    this.listeners.add(listener as (event: MouseEvent) => void);
  }

  removeEventListener(_type: string, listener: EventListener): void {
    this.listeners.delete(listener as (event: MouseEvent) => void);
  }

  dispatch(clientX: number, clientY: number): void {
    const event = { clientX, clientY } as MouseEvent;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe('MouseAngleInputSource', () => {
  it('returns 0 when the local player screen position is unknown', () => {
    const source = new MouseAngleInputSource(() => undefined);
    expect(source.sample()).toBe(0);
  });

  it('computes the angle from the local player screen position to the mouse', () => {
    const player: ScreenPoint = { x: 100, y: 100 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);

    win.dispatch(200, 100); // directly to the right of the player -> angle 0
    expect(source.sample()).toBeCloseTo(0, 5);
  });

  it('computes a positive angle for a mouse position below the player (screen-space Y-down)', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);

    win.dispatch(0, 100); // straight down -> +PI/2
    expect(source.sample()).toBeCloseTo(Math.PI / 2, 5);
  });

  it('mousemove alone never emits — only poll() can trigger onChange', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch(100, 0);
    win.dispatch(0, 100);
    win.dispatch(-100, 0);

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not emit from poll() before the poll interval has elapsed', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch(100, 0);
    source.poll(POLL_INTERVAL / 2);

    expect(listener).not.toHaveBeenCalled();
  });

  it('emits from poll() once the interval elapses, with the currently-sampled angle', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch(100, 0); // angle 0
    source.poll(POLL_INTERVAL);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(0);
  });

  it('does not emit on a poll tick if the angle has not changed beyond the epsilon since the last emission', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);

    win.dispatch(10000, 0);
    source.poll(POLL_INTERVAL); // first emission, seeds previous angle ~0

    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch(10000, 1); // negligible angle change from a point this far away
    source.poll(POLL_INTERVAL);

    expect(listener).not.toHaveBeenCalled();
  });

  it('emits again on a later poll tick once the angle changes beyond the epsilon', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch(100, 0); // angle 0
    source.poll(POLL_INTERVAL);

    win.dispatch(0, 100); // angle PI/2 — well beyond the epsilon
    source.poll(POLL_INTERVAL);

    expect(listener).toHaveBeenCalledTimes(2);
    const lastCallAngle = listener.mock.calls[1]![0] as number;
    expect(lastCallAngle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('accumulates elapsed time across multiple sub-interval poll() calls before emitting', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch(100, 0);
    source.poll(POLL_INTERVAL / 3);
    source.poll(POLL_INTERVAL / 3);
    expect(listener).not.toHaveBeenCalled();

    source.poll(POLL_INTERVAL / 3 + 0.001); // pushes accumulated time just past the interval
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing stops further notifications', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseAngleInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    const unsubscribe = source.onChange(listener);

    unsubscribe();
    win.dispatch(100, 0);
    source.poll(POLL_INTERVAL);

    expect(listener).not.toHaveBeenCalled();
  });
});
