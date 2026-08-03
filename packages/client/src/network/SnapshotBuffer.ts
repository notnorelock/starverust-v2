import type { WorldSnapshotPacket, EntitySnapshot } from '@starve/protocol';
import { PLAYER_MOVE_SPEED, CLIENT_POSITION_SNAP_DISTANCE } from '@starve/shared';

/**
 * Floor applied to an entity's broadcast speed when computing its chase step — guarantees
 * the render position always eventually reaches `r` even for the one-tick edge case where
 * an entity's speed reads 0 (e.g. input released) in the very snapshot that still moved
 * `r`, instead of stalling forever with a zero-length step.
 */
const MIN_CHASE_SPEED = PLAYER_MOVE_SPEED;

interface RenderedEntity {
  x: number;
  y: number;
  /** Latest known network-authoritative position — what `x`/`y` chase toward. */
  r: { x: number; y: number };
  /** This entity's broadcast speed (world units/second) — see EntitySnapshot.speed. */
  speed: number;
}

export interface InterpolatedEntity {
  entityId: number;
  x: number;
  y: number;
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
 * Isolated from RenderSystem/NetworkClient so a future client-prediction stage can extend
 * or replace the smoothing strategy without touching rendering or transport code.
 */
export class SnapshotBuffer {
  private latest: WorldSnapshotPacket | undefined;
  private readonly rendered = new Map<number, RenderedEntity>();

  push(packet: WorldSnapshotPacket): void {
    this.latest = packet;

    for (const target of packet.entities) {
      const render = this.rendered.get(target.entityId);
      if (!render) {
        // First snapshot mentioning this entity — start exactly at it rather than
        // gliding in from (0,0), mirroring the reference's Item constructor seeding
        // `this.r = { x, y }` and `this.x = x` from the same initial values.
        this.rendered.set(target.entityId, {
          x: target.x,
          y: target.y,
          r: { x: target.x, y: target.y },
          speed: target.speed,
        });
        continue;
      }

      render.r.x = target.x;
      render.r.y = target.y;
      render.speed = target.speed;

      const dx = target.x - render.x;
      const dy = target.y - render.y;
      if (Math.sqrt(dx * dx + dy * dy) > CLIENT_POSITION_SNAP_DISTANCE) {
        render.x = target.x;
        render.y = target.y;
      }
    }

    pruneStaleEntities(this.rendered, packet.entities);
  }

  /**
   * Advances every known entity's rendered position toward its latest network position by
   * that entity's own broadcast speed * dt, snapping once within one step of it, and
   * returns the resulting positions. `dt` is the frame's delta time in seconds (rAF is
   * variable rate, so this must be measured per call rather than assumed constant).
   */
  sample(dt: number): InterpolatedEntity[] {
    if (!this.latest) {
      return [];
    }

    const result: InterpolatedEntity[] = [];

    for (const [entityId, render] of this.rendered) {
      const step = Math.max(render.speed, MIN_CHASE_SPEED) * dt;
      chaseTowards(render, step);
      result.push({ entityId, x: render.x, y: render.y });
    }

    return result;
  }

  /**
   * Debug helper: the raw position from the single latest received snapshot for one
   * entity, with no smoothing applied — lets a caller compare "what the server most
   * recently reported" against sample()'s smoothed render position, to visually gauge how
   * far apart they drift.
   */
  latestRawPosition(entityId: number): InterpolatedEntity | undefined {
    const entity = this.latest?.entities.find((e) => e.entityId === entityId);
    return entity ? { entityId, x: entity.x, y: entity.y } : undefined;
  }

  /**
   * Drops an entity's render state immediately on EntityDestroyPacket, rather than waiting
   * for it to fall out of the next WorldSnapshotPacket via pruneStaleEntities() — the two
   * are redundant in the common case (both eventually agree the entity is gone) but this
   * makes cleanup happen the instant the server says so instead of up to one tick later.
   */
  remove(entityId: number): void {
    this.rendered.delete(entityId);
  }
}

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

function pruneStaleEntities(rendered: Map<number, RenderedEntity>, entities: readonly EntitySnapshot[]): void {
  const seen = new Set(entities.map((e) => e.entityId));
  for (const entityId of rendered.keys()) {
    if (!seen.has(entityId)) {
      rendered.delete(entityId);
    }
  }
}
