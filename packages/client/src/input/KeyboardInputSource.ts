import { InputFlag } from '@starve/protocol';

const KEY_TO_FLAG: Record<string, InputFlag> = {
  "KeyW": InputFlag.Up,
  "ArrowUp": InputFlag.Up,
  "KeyS": InputFlag.Down,
  "ArrowDown": InputFlag.Down,
  "KeyA": InputFlag.Left,
  "ArrowLeft": InputFlag.Left,
  "KeyD": InputFlag.Right,
  "ArrowRight": InputFlag.Right,
};

export type DirectionChangeListener = (direction: number) => void;

/**
 * Tracks currently-held movement keys and exposes them as a single InputFlag bitmask.
 * Notifies `onDirectionChange` listeners only when the bitmask actually changes (a key
 * transitions pressed/released), not on every poll — input is event-driven, not sent on
 * a fixed timer, since there's nothing new to tell the server between key transitions.
 */
export class KeyboardInputSource {
  private pressed = new Set<InputFlag>();
  private previousDirection = 0;
  private readonly listeners = new Set<DirectionChangeListener>();

  attach(target: Window = window): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
      const flag = KEY_TO_FLAG[event.code];
      if (flag !== undefined && !this.pressed.has(flag)) {
        this.pressed.add(flag);
        this.emitIfChanged();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const flag = KEY_TO_FLAG[event.code];
      if (flag !== undefined && this.pressed.has(flag)) {
        this.pressed.delete(flag);
        this.emitIfChanged();
      }
    };

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);

    return () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
    };
  }

  /** Called with the new bitmask each time it changes; not called on unrelated key events. */
  onDirectionChange(listener: DirectionChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Composes the currently-held keys into a single bitmask via `|=`, matching the wire format. */
  sampleDirection(): number {
    let direction = 0;
    for (const flag of this.pressed) {
      direction |= flag;
    }
    return direction;
  }

  private emitIfChanged(): void {
    const direction = this.sampleDirection();
    if (direction === this.previousDirection) {
      return;
    }
    this.previousDirection = direction;
    for (const listener of this.listeners) {
      listener(direction);
    }
  }
}
