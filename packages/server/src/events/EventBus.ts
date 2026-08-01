type Listener<T> = (payload: T) => void;

/**
 * Minimal typed pub/sub. Not wired into gameplay logic yet in Stage 1 — registered into
 * the ServiceContainer now so later stages (combat damage events, chat, clan events) have
 * a ready extension point without threading a new service through bootstrap at that point.
 */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener<unknown>>>();

  on<T>(event: string, listener: Listener<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => set!.delete(listener as Listener<unknown>);
  }

  emit<T>(event: string, payload: T): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const listener of set) {
      listener(payload);
    }
  }
}
