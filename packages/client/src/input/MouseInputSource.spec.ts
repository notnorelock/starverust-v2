import { describe, expect, it, vi } from 'vitest';
import { MouseInputSource, MouseButtonFlag, type ScreenPoint } from './MouseInputSource';

const POLL_INTERVAL = 0.2; // matches ANGLE_POLL_INTERVAL_SECONDS

class FakeWindow {
  private listenersByType = new Map<string, Set<(event: MouseEvent) => void>>();

  addEventListener(type: string, listener: EventListener): void {
    let listeners = this.listenersByType.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listenersByType.set(type, listeners);
    }
    listeners.add(listener as (event: MouseEvent) => void);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listenersByType.get(type)?.delete(listener as (event: MouseEvent) => void);
  }

  private dispatchTo(type: string, event: Partial<MouseEvent>): void {
    for (const listener of this.listenersByType.get(type) ?? []) {
      listener(event as MouseEvent);
    }
  }

  dispatch(clientX: number, clientY: number): void {
    this.dispatchTo('mousemove', { clientX, clientY });
  }

  dispatchMouseDown(button: number): void {
    this.dispatchTo('mousedown', { button });
  }

  dispatchMouseUp(button: number): void {
    this.dispatchTo('mouseup', { button });
  }
}

describe('MouseInputSource', () => {
  it('returns 0 when the local player screen position is unknown', () => {
    const source = new MouseInputSource(() => undefined);
    expect(source.sample()).toBe(0);
  });

  it('computes the angle from the local player screen position to the mouse', () => {
    const player: ScreenPoint = { x: 100, y: 100 };
    const source = new MouseInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);

    win.dispatch(200, 100); // directly to the right of the player -> angle 0
    expect(source.sample()).toBeCloseTo(0, 5);
  });

  it('computes a positive angle for a mouse position below the player (screen-space Y-down)', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);

    win.dispatch(0, 100); // straight down -> +PI/2
    expect(source.sample()).toBeCloseTo(Math.PI / 2, 5);
  });

  it('mousemove alone never emits — only poll() can trigger onChange', () => {
    const player: ScreenPoint = { x: 0, y: 0 };
    const source = new MouseInputSource(() => player);
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
    const source = new MouseInputSource(() => player);
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
    const source = new MouseInputSource(() => player);
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
    const source = new MouseInputSource(() => player);
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
    const source = new MouseInputSource(() => player);
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
    const source = new MouseInputSource(() => player);
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
    const source = new MouseInputSource(() => player);
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    const unsubscribe = source.onChange(listener);

    unsubscribe();
    win.dispatch(100, 0);
    source.poll(POLL_INTERVAL);

    expect(listener).not.toHaveBeenCalled();
  });

  describe('mouse buttons', () => {
    it('starts with no buttons held', () => {
      const source = new MouseInputSource(() => undefined);
      expect(source.buttons()).toBe(0);
    });

    it('sets the Left flag on left mousedown and clears it on mouseup', () => {
      const source = new MouseInputSource(() => undefined);
      const win = new FakeWindow();
      source.attach(win as unknown as Window);

      win.dispatchMouseDown(0);
      expect(source.buttons()).toBe(MouseButtonFlag.Left);

      win.dispatchMouseUp(0);
      expect(source.buttons()).toBe(0);
    });

    it('composes Left and Right into a single bitmask when both are held', () => {
      const source = new MouseInputSource(() => undefined);
      const win = new FakeWindow();
      source.attach(win as unknown as Window);

      win.dispatchMouseDown(0);
      win.dispatchMouseDown(2);
      expect(source.buttons()).toBe(MouseButtonFlag.Left | MouseButtonFlag.Right);

      win.dispatchMouseUp(0);
      expect(source.buttons()).toBe(MouseButtonFlag.Right);
    });

    it('ignores unmapped buttons (e.g. middle click)', () => {
      const source = new MouseInputSource(() => undefined);
      const win = new FakeWindow();
      source.attach(win as unknown as Window);

      win.dispatchMouseDown(1);
      expect(source.buttons()).toBe(0);
    });

    it('notifies onButtonsChange listeners immediately on press/release, not throttled by poll()', () => {
      const source = new MouseInputSource(() => undefined);
      const win = new FakeWindow();
      source.attach(win as unknown as Window);
      const listener = vi.fn();
      source.onButtonsChange(listener);

      win.dispatchMouseDown(0);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(MouseButtonFlag.Left);
    });

    it('does not re-emit for a redundant mousedown on an already-held button', () => {
      const source = new MouseInputSource(() => undefined);
      const win = new FakeWindow();
      source.attach(win as unknown as Window);
      const listener = vi.fn();
      source.onButtonsChange(listener);

      win.dispatchMouseDown(0);
      win.dispatchMouseDown(0);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribing onButtonsChange stops further notifications', () => {
      const source = new MouseInputSource(() => undefined);
      const win = new FakeWindow();
      source.attach(win as unknown as Window);
      const listener = vi.fn();
      const unsubscribe = source.onButtonsChange(listener);

      unsubscribe();
      win.dispatchMouseDown(0);

      expect(listener).not.toHaveBeenCalled();
    });

    it('detach stops further button tracking', () => {
      const source = new MouseInputSource(() => undefined);
      const win = new FakeWindow();
      const detach = source.attach(win as unknown as Window);

      detach();
      win.dispatchMouseDown(0);

      expect(source.buttons()).toBe(0);
    });
  });
});
