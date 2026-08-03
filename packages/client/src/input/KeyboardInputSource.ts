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
 *
 * setEnabled(false) is how movement is suppressed while the chatbox is open (see GameClient's
 * chat open/close flow) — ported from the reference client's approach of gating the
 * *consumer* of key state rather than the browser listener itself (client-old.js's
 * `update()` early-returns `if (user.chat.open) return;` before reading `keyboard.is_*()`,
 * see that file's move-sampling code), but implemented here at the source instead: while
 * disabled, keydown/keyup are ignored outright (so WASD typed as chat text never reaches
 * `pressed`) and any keys already held at the moment of disabling are cleared with a
 * synthetic emit of 0, so a player who opens chat mid-stride doesn't keep walking on the
 * server until they happen to release the key.
 */
export class KeyboardInputSource extends InputSource<number> {
  private pressed = new Set<InputFlag>();
  private enabled = true;

  attach(target: Window = window): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!this.enabled) {
        return;
      }
      const flag = KEY_TO_FLAG[event.code];
      if (flag !== undefined && !this.pressed.has(flag)) {
        this.pressed.add(flag);
        this.emitIfChanged();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!this.enabled) {
        return;
      }
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

  /** See the class doc comment — disabling clears any currently-held keys and emits the resulting (empty) bitmask. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.pressed.size > 0) {
      this.pressed.clear();
      this.emitIfChanged();
    }
  }

  protected hasChanged(previous: number, next: number): boolean {
    return previous !== next;
  }
}
