import type { WorldSnapshotPacket, EntitySnapshot } from '@starve/protocol';
import { MathUtils } from '@starve/shared';

interface TimestampedSnapshot {
  receivedAt: number;
  packet: WorldSnapshotPacket;
}

const MAX_BUFFERED_SNAPSHOTS = 3;

export interface InterpolatedEntity {
  entityId: number;
  x: number;
  y: number;
}

/**
 * Ring buffer of recently-received WorldSnapshotPackets plus the pure interpolation
 * function that turns them into a smoothed render-time entity list. Isolated from
 * RenderSystem/NetworkClient so a future client-prediction stage can extend or replace
 * the interpolation strategy without touching rendering or transport code.
 */
export class SnapshotBuffer {
  private readonly snapshots: TimestampedSnapshot[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  push(packet: WorldSnapshotPacket): void {
    this.snapshots.push({ receivedAt: this.now(), packet });
    if (this.snapshots.length > MAX_BUFFERED_SNAPSHOTS) {
      this.snapshots.shift();
    }
  }

  /**
   * Returns each entity's position interpolated at `now - interpolationDelayMs`.
   * Falls back to the latest known snapshot if not enough history has arrived yet.
   *
   * `snapEntityId`, if given, is rendered from the single latest snapshot instead of
   * the interpolated (delayed) result — for the locally-controlled entity, whose input
   * is already instantaneous client-side, interpolating it on the same ~100ms delay as
   * remote entities makes its own movement look laggy/glitchy every time direction
   * changes, since it's always animating toward an already-stale snapshot.
   */
  sample(interpolationDelayMs: number, snapEntityId?: number): InterpolatedEntity[] {
    if (this.snapshots.length === 0) {
      return [];
    }

    const result = this.sampleInterpolated(interpolationDelayMs);

    if (snapEntityId !== undefined) {
      const latest = this.snapshots[this.snapshots.length - 1]!.packet.entities.find(
        (e) => e.entityId === snapEntityId,
      );
      if (latest) {
        const index = result.findIndex((e) => e.entityId === snapEntityId);
        const snapped = { entityId: latest.entityId, x: latest.x, y: latest.y };
        if (index >= 0) {
          result[index] = snapped;
        } else {
          result.push(snapped);
        }
      }
    }

    return result;
  }

  private sampleInterpolated(interpolationDelayMs: number): InterpolatedEntity[] {
    const renderTime = this.now() - interpolationDelayMs;

    if (this.snapshots.length === 1) {
      return toInterpolatedEntities(this.snapshots[0]!.packet.entities);
    }

    for (let i = 0; i < this.snapshots.length - 1; i += 1) {
      const from = this.snapshots[i]!;
      const to = this.snapshots[i + 1]!;
      if (renderTime >= from.receivedAt && renderTime <= to.receivedAt) {
        const t = MathUtils.clamp(MathUtils.inverseLerp(from.receivedAt, to.receivedAt, renderTime), 0, 1);
        return interpolateBetween(from.packet.entities, to.packet.entities, t);
      }
    }

    const latest = this.snapshots[this.snapshots.length - 1]!;
    return toInterpolatedEntities(latest.packet.entities);
  }
}

function toInterpolatedEntities(entities: readonly EntitySnapshot[]): InterpolatedEntity[] {
  return entities.map((e) => ({ entityId: e.entityId, x: e.x, y: e.y }));
}

function interpolateBetween(
  from: readonly EntitySnapshot[],
  to: readonly EntitySnapshot[],
  t: number,
): InterpolatedEntity[] {
  const fromById = new Map(from.map((e) => [e.entityId, e]));
  const result: InterpolatedEntity[] = [];

  for (const toEntity of to) {
    const fromEntity = fromById.get(toEntity.entityId);
    if (!fromEntity) {
      // Entity newly appeared in the "to" snapshot; render it at its known position.
      result.push({ entityId: toEntity.entityId, x: toEntity.x, y: toEntity.y });
      continue;
    }
    result.push({
      entityId: toEntity.entityId,
      x: MathUtils.lerp(fromEntity.x, toEntity.x, t),
      y: MathUtils.lerp(fromEntity.y, toEntity.y, t),
    });
  }

  return result;
}
