import { InputSource } from './InputSource';

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
 * Unlike KeyboardInputSource, sampling requires a live "where is the local player on
 * screen right now" answer, which isn't a fixed browser-event payload — `localPlayerScreenPosition`
 * is injected as a callback (rather than, say, a direct Camera2D+LocalPlayerDataStore
 * dependency) so this class stays testable without constructing a full render stack.
 */
export class MouseAngleInputSource extends InputSource<number> {
  private mouseScreenPosition: ScreenPoint = { x: 0, y: 0 };
  private elapsedSincePoll = 0;

  constructor(private readonly localPlayerScreenPosition: () => ScreenPoint | undefined) {
    super();
  }

  attach(target: Window = window): () => void {
    const onMouseMove = (event: MouseEvent): void => {
      this.mouseScreenPosition = { x: event.clientX, y: event.clientY };
    };

    target.addEventListener('mousemove', onMouseMove);

    return () => {
      target.removeEventListener('mousemove', onMouseMove);
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
}
