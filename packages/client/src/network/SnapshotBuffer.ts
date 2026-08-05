import type { WorldSnapshotPacket, EntityUpdatePacket } from '@starve/protocol';
import { PLAYER_MOVE_SPEED, PLAYER_ROTATE_SPEED, CLIENT_POSITION_SNAP_DISTANCE } from '@starve/shared';

/**
 * Floor applied to an entity's broadcast speed when computing its chase step — guarantees
 * the render position always eventually reaches `r` even for the one-tick edge case where
 * an entity's speed reads 0 (e.g. input released) in the very snapshot that still moved
 * `r`, instead of stalling forever with a zero-length step.
 */
const MIN_CHASE_SPEED = PLAYER_MOVE_SPEED;

const TAU = Math.PI * 2;

interface RenderedEntity {
  x: number;
  y: number;
  /** Latest known network-authoritative position — what `x`/`y` chase toward. */
  r: { x: number; y: number };
  /** This entity's broadcast speed (world units/second) — see EntitySnapshot.speed. */
  speed: number;
  /** Currently-rendered facing angle (radians) — chases `rAngle`, see chaseAngleTowards(). */
  angle: number;
  /** Latest known network-broadcast facing angle (radians) — see EntitySnapshot.angle. */
  rAngle: number;
}

export interface InterpolatedEntity {
  entityId: number;
  x: number;
  y: number;
  angle: number;
}

/**
 * Per-entity rendered position (`x`/`y`) chasing the latest network-received position
 * (`r`) at that entity's own current speed every rAF frame, snapping once within one
 * frame's step of it — ported directly from the reference client's `move_units()` (see
 * `client-old.js`, `Utils.get_std_angle`/`build_vector`/`add_vector`/`norm`/
 * `copy_vector`): move `x`/`y` toward `r` by `dt * speed` along the straight-line
 * direction each frame; if that step's magnitude would reach or exceed the remaining
 * distance, snap exactly to `r` instead of overshooting past it. `speed` is read straight
 * off each EntitySnapshot (the entity's actual current movement speed, e.g.
 * PLAYER_SPRINT_SPEED while sprinting), matching how the reference client reads a
 * per-entity `speed` field off the wire on every packet rather than assuming one constant
 * for every entity — necessary once entities can move at different speeds, since chasing
 * at a fixed constant slower than an entity's real speed makes the render permanently lag
 * behind it.
 *
 * `r` is reset to the exact new position on every received snapshot (never itself
 * smoothed) — only `x`/`y` glide toward it. If the new `r` lands further than
 * CLIENT_POSITION_SNAP_DISTANCE from the currently-rendered position, `x`/`y` snap
 * straight there too instead of chasing — this is what the reference's own
 * `CLIENT.LAG_DISTANCE` check on `pid != 0` entities exists for: a teleport/respawn should
 * not visibly slide across the map at movement speed.
 *
 * `angle` is interpolated the same "chase a network target" way, but with its own
 * shape — see chaseAngleTowards() — ported from `move_units()`'s own angle-update block
 * (`b.angle`/`b.nangle`, distinct from its position `b.x`/`b.r.x` handling): the turn rate
 * is proportional to the remaining angular distance rather than constant, and it always
 * turns the shorter way around the circle (handling the 0/2*PI wraparound seam).
 *
 * Isolated from RenderSystem/NetworkClient so a future client-prediction stage can extend
 * or replace the smoothing strategy without touching rendering or transport code.
 *
 * Two distinct inputs feed this, matching the split on the wire: seed() consumes the
 * one-time, full-world WorldSnapshotPacket sent right after connecting (see PlayerSession)
 * to initialize render state for everything that exists at that moment; push() consumes
 * the recurring, per-connection EntityUpdatePacket (see InterestManagementSystem), which
 * only ever contains entities currently within interest range — critically, an entity's
 * *absence* from one push() no longer means it was destroyed (unlike the old
 * WorldSnapshotPacket-every-tick model), since it may simply have left interest range this
 * tick. Actual destruction is remove(), driven by EntityDestroyPacket.
 */
export class SnapshotBuffer {
  private latestServerTick = 0;
  private readonly rendered = new Map<number, RenderedEntity>();

  /** One-time full-world catch-up — see the class doc comment for why this is distinct from push(). */
  seed(packet: WorldSnapshotPacket): void {
    for (const target of packet.entities) {
      if (this.rendered.has(target.entityId)) {
        continue; // Already known (e.g. arrived via an EntityUpdatePacket first) — don't stomp live state.
      }
      this.rendered.set(target.entityId, {
        x: target.x,
        y: target.y,
        r: { x: target.x, y: target.y },
        speed: target.speed,
        angle: target.angle,
        rAngle: target.angle,
      });
    }
  }

  /** Recurring, spatially-filtered per-tick update — see the class doc comment for why this never prunes. */
  push(packet: EntityUpdatePacket): void {
    this.latestServerTick = packet.serverTick;

    for (const target of packet.entities) {
      const render = this.rendered.get(target.entityId);
      if (!render) {
        // First time this entity has come into interest range — start exactly at it
        // rather than gliding in from (0,0), mirroring the reference's Item constructor
        // seeding `this.r = { x, y }` and `this.x = x` from the same initial values.
        this.rendered.set(target.entityId, {
          x: target.x,
          y: target.y,
          r: { x: target.x, y: target.y },
          speed: target.speed,
          angle: target.angle,
          rAngle: target.angle,
        });
        continue;
      }

      render.r.x = target.x;
      render.r.y = target.y;
      render.speed = target.speed;
      render.rAngle = target.angle;

      const dx = target.x - render.x;
      const dy = target.y - render.y;
      if (Math.sqrt(dx * dx + dy * dy) > CLIENT_POSITION_SNAP_DISTANCE) {
        render.x = target.x;
        render.y = target.y;
      }
    }
  }

  /**
   * Advances every known entity's rendered position toward its latest network position by
   * that entity's own broadcast speed * dt, snapping once within one step of it, and its
   * rendered angle toward its latest network angle (see chaseAngleTowards()). Returns the
   * resulting positions/angles. `dt` is the frame's delta time in seconds (rAF is variable
   * rate, so this must be measured per call rather than assumed constant).
   */
  sample(dt: number): InterpolatedEntity[] {
    const result: InterpolatedEntity[] = [];

    for (const [entityId, render] of this.rendered) {
      const step = Math.max(render.speed, MIN_CHASE_SPEED) * dt;
      chaseTowards(render, step);
      chaseAngleTowards(render, dt);
      result.push({ entityId, x: render.x, y: render.y, angle: render.angle });
    }

    return result;
  }

  /** The server tick the most recent EntityUpdatePacket was stamped with — for debug/UI display. */
  get lastServerTick(): number {
    return this.latestServerTick;
  }

  /**
   * Debug helper: the raw position from the most recent network update for one entity,
   * with no smoothing applied — lets a caller compare "what the server most recently
   * reported" against sample()'s smoothed render position, to visually gauge how far apart
   * they drift.
   */
  latestRawPosition(entityId: number): InterpolatedEntity | undefined {
    const render = this.rendered.get(entityId);
    return render ? { entityId, x: render.r.x, y: render.r.y, angle: render.rAngle } : undefined;
  }

  /**
   * Drops an entity's render state immediately on EntityDestroyPacket — the sole source of
   * removal now that push() never prunes (see the class doc comment for why an
   * EntityUpdatePacket's absence no longer implies destruction).
   */
  remove(entityId: number): void {
    this.rendered.delete(entityId);
  }
}

/** Module-level singleton — one per page, reached for directly instead of threaded through constructors/DI. */
const instance = new SnapshotBuffer();
export const snapshotBuffer = (): SnapshotBuffer => instance;

function chaseTowards(render: RenderedEntity, step: number): void {
  if (render.x === render.r.x && render.y === render.r.y) {
    return;
  }

  const dx = render.r.x - render.x;
  const dy = render.r.y - render.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (step >= distance) {
    render.x = render.r.x;
    render.y = render.r.y;
  } else {
    render.x += (dx / distance) * step;
    render.y += (dy / distance) * step;
  }
}

/**
 * Turns `render.angle` toward `render.rAngle` — ported from the reference client's
 * `move_units()` angle-update block. Two things distinguish this from a plain lerp:
 *
 * 1. Turn rate is proportional to the remaining angular distance (`min`, always in
 *    [0, PI] — the *shorter* way around the circle), not constant: `3 * (min / PI) *
 *    PLAYER_ROTATE_SPEED * dt`. A near-180-degree turn rotates at full speed; a small
 *    correction rotates slowly, which reads as a settling/easing motion rather than a
 *    mechanical constant-speed sweep.
 * 2. It always turns the shorter way around the 0/2*PI seam — e.g. going from 350 degrees
 *    to 10 degrees turns forward through 0 (a 20-degree turn), not backward through 180
 *    degrees, by working with the raw (possibly >PI or <-PI) difference and picking the
 *    turn direction from which side of +-PI it falls on.
 */
function chaseAngleTowards(render: RenderedEntity, dt: number): void {
  if (render.angle === render.rAngle) {
    return;
  }

  render.angle = ((render.angle % TAU) + TAU) % TAU;
  render.rAngle = ((render.rAngle % TAU) + TAU) % TAU;
  if (render.angle === render.rAngle) {
    return;
  }

  const diff = render.rAngle - render.angle;
  let remaining = Math.abs(diff);
  if (remaining > Math.PI) {
    remaining = TAU - remaining;
  }

  const step = 3 * (remaining / Math.PI) * PLAYER_ROTATE_SPEED * dt;

  if (diff > Math.PI) {
    render.angle -= step;
  } else if (diff < -Math.PI) {
    render.angle += step;
  } else if (diff < 0) {
    render.angle -= step;
  } else {
    render.angle += step;
  }

  render.angle = ((render.angle % TAU) + TAU) % TAU;
  if (Math.abs(render.angle - render.rAngle) < step) {
    render.angle = render.rAngle;
  }
}
