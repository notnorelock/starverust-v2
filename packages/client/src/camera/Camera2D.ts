import { Ease2D, easeOutQuad, MathUtils, type WorldBounds } from '@starve/shared';

export interface ScreenPoint {
  x: number;
  y: number;
}

const FOLLOW_EASE_DURATION_SECONDS = 0.4;

/** No clamping until the server's Handshake packet tells the camera the actual world bounds. */
const UNBOUNDED: WorldBounds = {
  minX: -Infinity,
  maxX: Infinity,
  minY: -Infinity,
  maxY: Infinity,
};

/**
 * 2D camera: world-space position (eased toward whatever entity it's following) + zoom.
 * Follow smoothing uses Ease2D/easeOutQuad rather than snapping directly to the target
 * position, matching the eased-follow feel used elsewhere in this codebase's lineage.
 * Bounds-clamping is purely a client-side visual nicety (never shows space outside the
 * playable area) — the server's boundary-wall collision (see WorldBoundaryFactory) is
 * the authoritative source of truth for entity positions themselves. Bounds are set from
 * the server's Handshake packet
 * (see ClientBootstrap), not a hardcoded constant, since different server instances can
 * run differently-sized worlds.
 */
export class Camera2D {
  zoom = 1;

  private readonly ease: Ease2D;
  private bounds: WorldBounds = UNBOUNDED;

  constructor(private viewportWidth: number, private viewportHeight: number) {
    this.ease = new Ease2D(0, 0, FOLLOW_EASE_DURATION_SECONDS, easeOutQuad);
  }

  /**
   * Updates the viewport size this camera centers/clamps against — call whenever the
   * canvas itself resizes (see CanvasContext2DProvider's own `window.addEventListener('resize', ...)`,
   * which ClientBootstrap wires to this too). Without this, worldToScreen()'s
   * `+ viewportWidth / 2` centering and follow()'s half-viewport boundary clamp both keep
   * using the size the camera happened to be constructed with, drifting out of sync with
   * the canvas's actual (now-resized) dimensions — entities would render off-center and the
   * boundary clamp would show either too much or too little margin at the edges.
   */
  resize(viewportWidth: number, viewportHeight: number): void {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
  }

  get x(): number {
    return this.ease.x;
  }

  get y(): number {
    return this.ease.y;
  }

  setBounds(bounds: WorldBounds): void {
    this.bounds = bounds;
  }

  /**
   * Sets the world-space point the camera eases toward; call once per frame with the
   * latest target. Clamped to keep the *viewport's edges* inside world bounds, not just
   * the followed point itself — worldToScreen() centers the viewport on the camera's
   * position, so clamping the raw target to [minX, maxX] would let the camera center sit
   * exactly on the world edge and show half a viewport's worth of empty space beyond it
   * whenever the player stands near a boundary. Subtracting half the viewport size (scaled
   * by zoom, since a larger zoom shows less world per screen pixel) from each side is the
   * fix — ported conceptually from the reference client's own camera clamp
   * (`x - this.rw / 2`, `world.w - this.rw`), which bakes in the same half-viewport margin
   * for the same reason, just against its own cam.x-is-a-translation-offset convention
   * instead of this class's cam.x-is-the-centered-world-position one.
   *
   * Degenerates to no clamping (matches the old behavior) when bounds are ±Infinity (see
   * UNBOUNDED) or the world is smaller than the viewport itself, in which case min > max
   * and MathUtils.clamp would otherwise pin the camera to the (wrong) lower bound — the
   * clamp is skipped instead so the camera just centers on the raw target.
   */
  follow(worldX: number, worldY: number): void {
    const halfWidth = this.viewportWidth / 2 / this.zoom;
    const halfHeight = this.viewportHeight / 2 / this.zoom;

    const clampedX = clampToViewport(worldX, this.bounds.minX, this.bounds.maxX, halfWidth);
    const clampedY = clampToViewport(worldY, this.bounds.minY, this.bounds.maxY, halfHeight);
    this.ease.setTarget(clampedX, clampedY);
  }

  /** Advances the follow easing; call once per rendered frame with the frame's dt in seconds. */
  update(dt: number): void {
    this.ease.update(dt);
  }

  worldToScreen(worldX: number, worldY: number): ScreenPoint {
    return {
      x: (worldX - this.x) * this.zoom + this.viewportWidth / 2,
      y: (worldY - this.y) * this.zoom + this.viewportHeight / 2,
    };
  }
}

/**
 * Clamps `value` so a viewport extending `halfExtent` on either side of it never crosses
 * [min, max] — i.e. clamps to [min + halfExtent, max - halfExtent], not [min, max]
 * directly. Falls back to the simple [min, max] clamp when the world is narrower than the
 * viewport itself (min + halfExtent > max - halfExtent) rather than producing an inverted
 * range, which would otherwise pin the camera to the wrong side.
 */
function clampToViewport(value: number, min: number, max: number, halfExtent: number): number {
  const lower = min + halfExtent;
  const upper = max - halfExtent;
  if (lower > upper) {
    return MathUtils.clamp(value, min, max);
  }
  return MathUtils.clamp(value, lower, upper);
}
