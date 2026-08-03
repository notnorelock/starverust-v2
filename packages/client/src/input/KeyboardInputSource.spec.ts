import { describe, expect, it, vi } from 'vitest';
import { KeyboardInputSource } from './KeyboardInputSource';
import { InputFlag } from '@starve/protocol';

class FakeWindow {
  private listeners = new Map<string, Set<(event: KeyboardEvent) => void>>();

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (event: KeyboardEvent) => void);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener as (event: KeyboardEvent) => void);
  }

  dispatch(type: 'keydown' | 'keyup', code: string): void {
    const event = { code } as KeyboardEvent;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('KeyboardInputSource', () => {
  it('emits on the first keydown of a mapped key', () => {
    const source = new KeyboardInputSource();
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch('keydown', 'KeyW');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(InputFlag.Up);
  });

  it('does not emit again for a repeated keydown of an already-held key', () => {
    const source = new KeyboardInputSource();
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch('keydown', 'KeyW');
    win.dispatch('keydown', 'KeyW'); // browser key-repeat, same key still held

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits again on keyup once the bitmask changes back', () => {
    const source = new KeyboardInputSource();
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch('keydown', 'KeyW');
    win.dispatch('keyup', 'KeyW');

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(0);
  });

  it('composes multiple held keys into a combined bitmask, emitting once per transition', () => {
    const source = new KeyboardInputSource();
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch('keydown', 'KeyW');
    win.dispatch('keydown', 'KeyD');

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(InputFlag.Up | InputFlag.Right);
  });

  it('ignores unmapped keys entirely', () => {
    const source = new KeyboardInputSource();
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    source.onChange(listener);

    win.dispatch('keydown', 'Space');

    expect(listener).not.toHaveBeenCalled();
  });

  it('sample() reflects currently-held keys independent of onChange emissions', () => {
    const source = new KeyboardInputSource();
    const win = new FakeWindow();
    source.attach(win as unknown as Window);

    expect(source.sample()).toBe(0);

    win.dispatch('keydown', 'KeyW');
    win.dispatch('keydown', 'KeyD');

    expect(source.sample()).toBe(InputFlag.Up | InputFlag.Right);
  });

  it('unsubscribing stops further notifications', () => {
    const source = new KeyboardInputSource();
    const win = new FakeWindow();
    source.attach(win as unknown as Window);
    const listener = vi.fn();
    const unsubscribe = source.onChange(listener);

    unsubscribe();
    win.dispatch('keydown', 'KeyW');

    expect(listener).not.toHaveBeenCalled();
  });
});
