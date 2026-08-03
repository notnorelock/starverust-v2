import { InputFlag } from '@starve/protocol';
import { InputSource } from './InputSource';

const KEY_TO_FLAG: Record<string, InputFlag> = {
  "KeyW": InputFlag.Up,
  "ArrowUp": InputFlag.Up,
  "KeyS": InputFlag.Down,
  "ArrowDown": InputFlag.Down,
  "KeyA": InputFlag.Left,
  "ArrowLeft": InputFlag.Left,
  "KeyD": InputFlag.Right,
  "ArrowRight": InputFlag.Right,
  "ShiftLeft": InputFlag.Sprint,
};

/**
 * Tracks currently-held movement keys and exposes them as a single InputFlag bitmask.
 * Notifies onChange listeners only when the bitmask actually changes (a key transitions
 * pressed/released), not on every keydown/keyup — input is event-driven, not sent on a
 * fixed timer, since there's nothing new to tell the server between key transitions.
 */
export class KeyboardInputSource extends InputSource<number> {
  private pressed = new Set<InputFlag>();

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

  /** Composes the currently-held keys into a single bitmask via `|=`, matching the wire format. */
  sample(): number {
    let direction = 0;
    for (const flag of this.pressed) {
      direction |= flag;
    }
    return direction;
  }

  protected hasChanged(previous: number, next: number): boolean {
    return previous !== next;
  }
}
