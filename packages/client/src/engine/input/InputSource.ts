export type InputChangeListener<T> = (value: T) => void;

/**
 * Shared shape for a browser input source that samples to a single value of type `T` and
 * notifies listeners only when that value actually changes — not on every underlying
 * browser event. KeyboardInputSource (T = direction bitmask) and MouseInputSource
 * (T = aim angle in radians) both extend this: same attach/detach lifecycle and
 * listener-set/emit-if-changed bookkeeping, but each defines its own `hasChanged()`
 * threshold, since a bitmask's "changed" is exact equality while an angle's is a small
 * epsilon (matching the reference implementation's own `Math.abs(this.angle - angle) >
 * 0.005` throttle — see MouseInputSource) — forcing both through one comparison rule
 * would be wrong for at least one of them.
 */
export abstract class InputSource<T> {
  private readonly listeners = new Set<InputChangeListener<T>>();
  private previousValue: T | undefined;
  private hasEmitted = false;

  /** Attaches this source's browser event listeners to `target`; returns a detach function. */
  abstract attach(target: Window): () => void;

  /** Returns the current sampled value, independent of whether it has changed since the last emit. */
  abstract sample(): T;

  /** True if `next` counts as different from `previous` and should trigger a change notification. */
  protected abstract hasChanged(previous: T, next: T): boolean;

  /** Called with the new value each time it changes; not called for unrelated underlying events. */
  onChange(listener: InputChangeListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-samples the current value and notifies listeners if it counts as changed — call after any input event. */
  protected emitIfChanged(): void {
    const next = this.sample();
    if (this.hasEmitted && !this.hasChanged(this.previousValue as T, next)) {
      return;
    }
    this.hasEmitted = true;
    this.previousValue = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
