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
 * playable area) — the server's WorldBoundsSystem is the authoritative source of truth
 * for entity positions themselves. Bounds are set from the server's Handshake packet
 * (see ClientBootstrap), not a hardcoded constant, since different server instances can
 * run differently-sized worlds.
 */
export class Camera2D {
  zoom = 1;

  private readonly ease: Ease2D;
  private bounds: WorldBounds = UNBOUNDED;

  constructor(private readonly viewportWidth: number, private readonly viewportHeight: number) {
    this.ease = new Ease2D(0, 0, FOLLOW_EASE_DURATION_SECONDS, easeOutQuad);
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

  /** Sets the world-space point the camera eases toward; call once per frame with the latest target. */
  follow(worldX: number, worldY: number): void {
    const clampedX = MathUtils.clamp(worldX, this.bounds.minX, this.bounds.maxX);
    const clampedY = MathUtils.clamp(worldY, this.bounds.minY, this.bounds.maxY);
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
