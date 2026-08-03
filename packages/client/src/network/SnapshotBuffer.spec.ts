import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from './SnapshotBuffer';
import { PLAYER_MOVE_SPEED, PLAYER_SPRINT_SPEED, CLIENT_POSITION_SNAP_DISTANCE } from '@starve/shared';
import type { WorldSnapshotPacket, EntityUpdatePacket } from '@starve/protocol';

function snapshot(entities: WorldSnapshotPacket['entities']): WorldSnapshotPacket {
  return { serverTick: 0, entities };
}

function update(serverTick: number, entities: EntityUpdatePacket['entities']): EntityUpdatePacket {
  return { serverTick, entities };
}

describe('SnapshotBuffer', () => {
  it('returns an empty list with nothing seeded or pushed', () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.sample(1 / 60)).toEqual([]);
  });

  describe('seed()', () => {
    it('initializes render state exactly at the given position for each entity', () => {
      const buffer = new SnapshotBuffer();
      buffer.seed(snapshot([{ entityId: 1, entityType: 0, ownerPid: 0, x: 5, y: 5, speed: PLAYER_MOVE_SPEED }]));
      expect(buffer.sample(1 / 60)).toEqual([{ entityId: 1, x: 5, y: 5 }]);
    });

    it('does not overwrite an entity that already has render state (e.g. from an EntityUpdatePacket that arrived first)', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 50, y: 50, speed: PLAYER_MOVE_SPEED }]));
      buffer.seed(snapshot([{ entityId: 1, entityType: 0, ownerPid: 0, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));

      expect(buffer.sample(1 / 60)).toEqual([{ entityId: 1, x: 50, y: 50 }]);
    });
  });

  describe('push()', () => {
    it('seeds the render position exactly at the target on the first update mentioning an entity', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 5, y: 5, speed: PLAYER_MOVE_SPEED }]));
      expect(buffer.sample(1 / 60)).toEqual([{ entityId: 1, x: 5, y: 5 }]);
    });

    it("chases the latest network position by the entity's broadcast speed * dt rather than jumping straight to it", () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      buffer.sample(1 / 60); // seeds render position at (0,0)

      // Kept under CLIENT_POSITION_SNAP_DISTANCE so this exercises the chase path, not the teleport-snap path.
      buffer.push(update(2, [{ entityId: 1, x: 100, y: 0, speed: PLAYER_MOVE_SPEED }]));
      const result = buffer.sample(1 / 60);

      const expectedStep = PLAYER_MOVE_SPEED * (1 / 60);
      expect(result[0]!.x).toBeCloseTo(expectedStep, 5);
      expect(result[0]!.x).toBeLessThan(100);
    });

    it('chases at PLAYER_SPRINT_SPEED when the entity broadcasts a higher speed than PLAYER_MOVE_SPEED', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_SPRINT_SPEED }]));
      buffer.sample(1 / 60);

      buffer.push(update(2, [{ entityId: 1, x: 100, y: 0, speed: PLAYER_SPRINT_SPEED }]));
      const result = buffer.sample(1 / 60);

      const expectedStep = PLAYER_SPRINT_SPEED * (1 / 60);
      expect(result[0]!.x).toBeCloseTo(expectedStep, 5);
      expect(expectedStep).toBeGreaterThan(PLAYER_MOVE_SPEED * (1 / 60));
    });

    it('keeps chasing every frame between updates instead of freezing once a chase step is applied', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      buffer.sample(1 / 60);

      buffer.push(update(2, [{ entityId: 1, x: 100, y: 0, speed: PLAYER_MOVE_SPEED }]));

      const xs = [buffer.sample(1 / 60)[0]!.x, buffer.sample(1 / 60)[0]!.x, buffer.sample(1 / 60)[0]!.x];
      expect(xs[1]).toBeGreaterThan(xs[0]!);
      expect(xs[2]).toBeGreaterThan(xs[1]!);
    });

    it('snaps to the target once a step would reach or overshoot it, instead of overshooting past it', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      buffer.sample(1 / 60);

      buffer.push(update(2, [{ entityId: 1, x: 0.001, y: 0, speed: PLAYER_MOVE_SPEED }]));
      const result = buffer.sample(1 / 60);

      expect(result[0]!.x).toBe(0.001);
    });

    it('still converges to the target even when the entity broadcasts speed 0 (e.g. it just stopped)', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      buffer.sample(1 / 60);

      buffer.push(update(2, [{ entityId: 1, x: 5, y: 0, speed: 0 }]));

      let result = buffer.sample(1 / 60);
      for (let i = 0; i < 60; i += 1) {
        result = buffer.sample(1 / 60);
      }

      expect(result[0]!.x).toBeCloseTo(5, 5);
    });

    it('snaps directly to a position further than CLIENT_POSITION_SNAP_DISTANCE (teleport/respawn), not a slow chase', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      buffer.sample(1 / 60);

      const teleportX = CLIENT_POSITION_SNAP_DISTANCE + 50;
      buffer.push(update(2, [{ entityId: 1, x: teleportX, y: 0, speed: PLAYER_MOVE_SPEED }]));
      const result = buffer.sample(1 / 60);

      expect(result[0]!.x).toBe(teleportX);
    });

    it('does not remove an entity that is simply absent from one update (spatial filtering, not destruction)', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(
        update(1, [
          { entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED },
          { entityId: 2, x: 0, y: 0, speed: PLAYER_MOVE_SPEED },
        ]),
      );
      buffer.sample(1 / 60);

      // Entity 2 fell out of interest range this tick — it must NOT be treated as destroyed.
      buffer.push(update(2, [{ entityId: 1, x: 1, y: 0, speed: PLAYER_MOVE_SPEED }]));
      const result = buffer.sample(1 / 60);

      expect(result.find((e) => e.entityId === 2)).toBeDefined();
    });

    it('tracks the latest EntityUpdatePacket serverTick via lastServerTick', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(42, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      expect(buffer.lastServerTick).toBe(42);
    });
  });

  describe('remove()', () => {
    it('drops an entity immediately, unlike an absence from push() which does not', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      buffer.sample(1 / 60);

      buffer.remove(1);

      expect(buffer.sample(1 / 60)).toEqual([]);
    });

    it('re-seeds an entity at its new target if it is removed and then reappears in a later update', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      buffer.sample(1 / 60);

      buffer.remove(1);

      buffer.push(update(2, [{ entityId: 1, x: 50, y: 50, speed: PLAYER_MOVE_SPEED }]));
      const result = buffer.sample(1 / 60);

      expect(result).toEqual([{ entityId: 1, x: 50, y: 50 }]);
    });
  });

  describe('latestRawPosition()', () => {
    it('returns the raw last-received network position with no smoothing', () => {
      const buffer = new SnapshotBuffer();
      buffer.push(update(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
      buffer.sample(1 / 60);

      buffer.push(update(2, [{ entityId: 1, x: 1000, y: 0, speed: PLAYER_MOVE_SPEED }]));

      expect(buffer.latestRawPosition(1)).toEqual({ entityId: 1, x: 1000, y: 0 });
    });

    it('returns undefined when the entity is unknown', () => {
      const buffer = new SnapshotBuffer();
      expect(buffer.latestRawPosition(1)).toBeUndefined();
    });
  });
});
