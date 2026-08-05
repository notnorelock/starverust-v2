import { InputSource } from './InputSource';
import { localPlayer } from '../core/LocalPlayerDataStore';

/**
 * How often (seconds) this source re-samples and possibly emits — ported from the
 * reference client's `CLIENT.ROTATE = 0.2` (see client-old.js's `control.update`, which
 * runs every render frame but only actually checks/sends on this cadence via an
 * accumulator: `this.timeout += delta; if (this.timeout > CLIENT.ROTATE) { ... }`). This
 * is a genuinely different mechanism from "emit on every mousemove event" — mousemove
 * fires far faster than this and would spam a PlayerAnglePacket on every pixel of cursor
 * movement if poll() weren't gating it to this fixed cadence first.
 */
const ANGLE_POLL_INTERVAL_SECONDS = 0.2;

/**
 * Minimum change (radians) between the previously-emitted angle and a freshly-sampled one
 * before onChange fires, even once the poll interval has elapsed — ported from the
 * reference client's own inner check (`Math.abs(this.angle - angle) > 0.005`). Two
 * independent gates, matching the reference exactly: this one skips a genuinely
 * insignificant angle change even when it's time to poll; ANGLE_POLL_INTERVAL_SECONDS
 * skips polling at all except on the fixed cadence.
 */
const ANGLE_CHANGE_EPSILON = 0.005;

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Bitmask of currently-held mouse buttons — mirrors KeyboardInputSource's InputFlag
 * pattern (composed with `|=`) rather than separate booleans, for the same reason: it's a
 * single value that's cheap to diff for "did anything change" and matches how this
 * project already models multi-flag input state. No wire packet exists for this yet
 * (there's no combat/action system on the server to consume it) — see buttons()/
 * onButtonsChange() below, which are purely local/client-side today.
 */
export enum MouseButtonFlag {
  Left = 1 << 0,
  Right = 1 << 1,
}

/** Maps the browser's MouseEvent.button values (0 = left, 2 = right) to MouseButtonFlag; other buttons (e.g. middle) are ignored. */
const BUTTON_TO_FLAG: Record<number, MouseButtonFlag> = {
  0: MouseButtonFlag.Left,
  2: MouseButtonFlag.Right,
};

/**
 * Aim angle in radians (standard math convention: 0 = +x, increasing counter-clockwise,
 * matching this project's screen-space Y-down world convention — see PlayerAnglePacket's
 * own doc comment), computed from the local player's screen position to the mouse cursor.
 * Ported from the reference client's `Utils.get_std_angle(mouse.pos, playerScreenPos)`
 * (see client-old.js's `control.update`): the reference computed the player's screen
 * position by translating world position through the camera's offset by hand
 * (`cam.x + p.x`); this uses Camera2D.worldToScreen() to get the same result the actual
 * renderer draws the player at, so the aim line always points exactly at the cursor
 * regardless of camera easing/zoom.
 *
 * `attach()` only ever records the raw mouse position on `mousemove` — it never samples or
 * emits from the event handler itself (mousemove fires far more often than the reference's
 * 200ms send cadence, which is exactly the "spamming the network" bug this replaced: an
 * earlier version called emitIfChanged() straight from mousemove, epsilon-filtered but not
 * rate-limited, so a fast mouse sweep sent a PlayerAnglePacket dozens of times a second).
 * `poll(dt)` is the actual throttle — call it once per rendered frame (see
 * GameClient.frame()) and it only re-samples/emits once ANGLE_POLL_INTERVAL_SECONDS has
 * accumulated, mirroring the reference's own `this.timeout += delta` accumulator pattern.
 *
 * Unlike KeyboardInputSource, sampling the angle requires a live "where is the local player
 * on screen right now" answer, which isn't a fixed browser-event payload —
 * `localPlayerScreenPosition` is injected as a callback (rather than, say, a direct
 * Camera2D+LocalPlayerDataStore dependency) so this class stays testable without
 * constructing a full render stack.
 *
 * Also tracks held mouse-button state (left/right — see MouseButtonFlag), extending
 * `InputSource<number>`'s angle-diffing machinery to a second, independent value on the
 * same class rather than a second InputSource subclass, since both are properties of "the
 * mouse" fed by listeners on the same `attach()`/`target`. Button state is event-driven
 * like KeyboardInputSource (emits immediately via its own listener set on press/release),
 * not polled like the angle — there's no equivalent of the 200ms angle-send throttle for
 * buttons since, unlike aim angle, there's currently no per-button wire packet spamming to
 * guard against (see MouseButtonFlag's own doc comment for why: no server-side consumer
 * exists yet).
 */
export class MouseInputSource extends InputSource<number> {
  private mouseScreenPosition: ScreenPoint = { x: 0, y: 0 };
  private elapsedSincePoll = 0;
  private pressedButtons = new Set<MouseButtonFlag>();
  private readonly buttonListeners = new Set<(buttons: number) => void>();

  constructor(private readonly localPlayerScreenPosition: () => ScreenPoint | undefined) {
    super();
  }

  attach(target: Window = window): () => void {
    const onMouseMove = (event: MouseEvent): void => {
      this.mouseScreenPosition = { x: event.clientX, y: event.clientY };
    };
    const onMouseDown = (event: MouseEvent): void => {
      const flag = BUTTON_TO_FLAG[event.button];
      if (flag !== undefined && !this.pressedButtons.has(flag)) {
        this.pressedButtons.add(flag);
        this.emitButtonsChanged();
      }
    };
    const onMouseUp = (event: MouseEvent): void => {
      const flag = BUTTON_TO_FLAG[event.button];
      if (flag !== undefined && this.pressedButtons.has(flag)) {
        this.pressedButtons.delete(flag);
        this.emitButtonsChanged();
      }
    };
    // Suppresses the browser's native right-click context menu — standard game UX, and
    // without this, releasing the right button after a context menu opened would leave
    // `pressedButtons` stuck (the browser never delivers a matching mouseup once focus
    // moves to the context menu).
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    target.addEventListener('mousemove', onMouseMove);
    target.addEventListener('mousedown', onMouseDown);
    target.addEventListener('mouseup', onMouseUp);
    target.addEventListener('contextmenu', onContextMenu);

    return () => {
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('mousedown', onMouseDown);
      target.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('contextmenu', onContextMenu);
    };
  }

  /**
   * Advances the poll accumulator by `dt` (seconds); once ANGLE_POLL_INTERVAL_SECONDS has
   * elapsed, re-samples the angle and emits via onChange if it changed by more than
   * ANGLE_CHANGE_EPSILON — call once per rendered frame.
   */
  poll(dt: number): void {
    this.elapsedSincePoll += dt;
    if (this.elapsedSincePoll < ANGLE_POLL_INTERVAL_SECONDS) {
      return;
    }
    this.elapsedSincePoll = 0;
    this.emitIfChanged();
  }

  /** Angle from the local player's current screen position to the mouse, or 0 if the local player isn't known yet. */
  sample(): number {
    const player = this.localPlayerScreenPosition();
    if (!player) {
      return 0;
    }
    const dx = this.mouseScreenPosition.x - player.x;
    const dy = this.mouseScreenPosition.y - player.y;
    return Math.atan2(dy, dx);
  }

  protected hasChanged(previous: number, next: number): boolean {
    return Math.abs(previous - next) > ANGLE_CHANGE_EPSILON;
  }

  /** Composes the currently-held mouse buttons into a single bitmask via `|=` — see MouseButtonFlag. */
  buttons(): number {
    let mask = 0;
    for (const flag of this.pressedButtons) {
      mask |= flag;
    }
    return mask;
  }

  /** Called with the new held-buttons bitmask each time it changes (a button pressed or released). */
  onButtonsChange(listener: (buttons: number) => void): () => void {
    this.buttonListeners.add(listener);
    return () => this.buttonListeners.delete(listener);
  }

  private emitButtonsChanged(): void {
    const mask = this.buttons();
    for (const listener of this.buttonListeners) {
      listener(mask);
    }
  }
}

/**
 * Module-level singleton — one per page, reached for directly instead of threaded through
 * constructors/DI (see the other input/network singletons for the same pattern, e.g.
 * localPlayer()). Unlike those, this class's constructor isn't no-arg — it needs
 * `localPlayer().screenPosition` as its localPlayerScreenPosition callback, so that's
 * wired here rather than left to the call site.
 */
const instance = new MouseInputSource(() => localPlayer().screenPosition);
export const mouseInput = (): MouseInputSource => instance;
