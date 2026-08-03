import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from './SnapshotBuffer';
import { PLAYER_MOVE_SPEED, PLAYER_SPRINT_SPEED, CLIENT_POSITION_SNAP_DISTANCE } from '@starve/shared';
import type { WorldSnapshotPacket } from '@starve/protocol';

function packet(serverTick: number, entities: WorldSnapshotPacket['entities']): WorldSnapshotPacket {
  return { serverTick, entities };
}

describe('SnapshotBuffer', () => {
  it('returns an empty list with no snapshots pushed', () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.sample(1 / 60)).toEqual([]);
  });

  it('seeds the render position exactly at the target on the first snapshot mentioning an entity', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 5, y: 5, speed: PLAYER_MOVE_SPEED }]));
    expect(buffer.sample(1 / 60)).toEqual([{ entityId: 1, x: 5, y: 5 }]);
  });

  it('chases the latest network position by the entity\'s broadcast speed * dt rather than jumping straight to it', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
    buffer.sample(1 / 60); // seeds render position at (0,0)

    // Kept under CLIENT_POSITION_SNAP_DISTANCE so this exercises the chase path, not the teleport-snap path.
    buffer.push(packet(2, [{ entityId: 1, x: 100, y: 0, speed: PLAYER_MOVE_SPEED }]));
    const result = buffer.sample(1 / 60);

    const expectedStep = PLAYER_MOVE_SPEED * (1 / 60);
    expect(result[0]!.x).toBeCloseTo(expectedStep, 5);
    expect(result[0]!.x).toBeLessThan(100);
  });

  it('chases at PLAYER_SPRINT_SPEED when the entity broadcasts a higher speed than PLAYER_MOVE_SPEED', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_SPRINT_SPEED }]));
    buffer.sample(1 / 60);

    buffer.push(packet(2, [{ entityId: 1, x: 100, y: 0, speed: PLAYER_SPRINT_SPEED }]));
    const result = buffer.sample(1 / 60);

    const expectedStep = PLAYER_SPRINT_SPEED * (1 / 60);
    expect(result[0]!.x).toBeCloseTo(expectedStep, 5);
    expect(expectedStep).toBeGreaterThan(PLAYER_MOVE_SPEED * (1 / 60));
  });

  it('keeps chasing every frame between snapshots instead of freezing once a chase step is applied', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
    buffer.sample(1 / 60);

    buffer.push(packet(2, [{ entityId: 1, x: 100, y: 0, speed: PLAYER_MOVE_SPEED }]));

    const xs = [buffer.sample(1 / 60)[0]!.x, buffer.sample(1 / 60)[0]!.x, buffer.sample(1 / 60)[0]!.x];
    expect(xs[1]).toBeGreaterThan(xs[0]!);
    expect(xs[2]).toBeGreaterThan(xs[1]!);
  });

  it('snaps to the target once a step would reach or overshoot it, instead of overshooting past it', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
    buffer.sample(1 / 60); // seeds render position at (0,0)

    buffer.push(packet(2, [{ entityId: 1, x: 0.001, y: 0, speed: PLAYER_MOVE_SPEED }]));
    const result = buffer.sample(1 / 60);

    expect(result[0]!.x).toBe(0.001);
  });

  it('still converges to the target even when the entity broadcasts speed 0 (e.g. it just stopped)', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
    buffer.sample(1 / 60);

    buffer.push(packet(2, [{ entityId: 1, x: 5, y: 0, speed: 0 }]));

    let result = buffer.sample(1 / 60);
    for (let i = 0; i < 60; i += 1) {
      result = buffer.sample(1 / 60);
    }

    expect(result[0]!.x).toBeCloseTo(5, 5);
  });

  it('converges to a stationary target over several frames', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
    buffer.sample(1 / 60);

    buffer.push(packet(2, [{ entityId: 1, x: 5, y: 0, speed: PLAYER_MOVE_SPEED }]));

    let result = buffer.sample(1 / 60);
    for (let i = 0; i < 60; i += 1) {
      result = buffer.sample(1 / 60);
    }

    expect(result[0]!.x).toBeCloseTo(5, 5);
    expect(result[0]!.y).toBe(0);
  });

  it('snaps directly to a position further than CLIENT_POSITION_SNAP_DISTANCE (teleport/respawn), not a slow chase', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
    buffer.sample(1 / 60);

    const teleportX = CLIENT_POSITION_SNAP_DISTANCE + 50;
    buffer.push(packet(2, [{ entityId: 1, x: teleportX, y: 0, speed: PLAYER_MOVE_SPEED }]));
    const result = buffer.sample(1 / 60);

    expect(result[0]!.x).toBe(teleportX);
  });

  it('tracks multiple entities independently, each at its own broadcast speed', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(
      packet(1, [
        { entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED },
        { entityId: 2, x: 0, y: 0, speed: PLAYER_SPRINT_SPEED },
      ]),
    );
    buffer.sample(1 / 60);

    buffer.push(
      packet(2, [
        { entityId: 1, x: 10, y: 0, speed: PLAYER_MOVE_SPEED },
        { entityId: 2, x: 10, y: 0, speed: PLAYER_SPRINT_SPEED },
      ]),
    );
    const result = buffer.sample(1 / 60);

    const entity1 = result.find((e) => e.entityId === 1)!;
    const entity2 = result.find((e) => e.entityId === 2)!;
    expect(entity1.x).toBeCloseTo(PLAYER_MOVE_SPEED * (1 / 60), 5);
    expect(entity2.x).toBeCloseTo(PLAYER_SPRINT_SPEED * (1 / 60), 5);
    expect(entity2.x).toBeGreaterThan(entity1.x);
  });

  it('drops render state for entities no longer present in the latest snapshot', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(
      packet(1, [
        { entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED },
        { entityId: 2, x: 0, y: 0, speed: PLAYER_MOVE_SPEED },
      ]),
    );
    buffer.sample(1 / 60);

    buffer.push(packet(2, [{ entityId: 1, x: 1, y: 0, speed: PLAYER_MOVE_SPEED }]));
    const result = buffer.sample(1 / 60);

    expect(result.find((e) => e.entityId === 2)).toBeUndefined();
  });

  it('re-seeds an entity at its new target if it disappears and reappears in a later snapshot', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
    buffer.sample(1 / 60);

    buffer.push(packet(2, []));
    buffer.sample(1 / 60);

    buffer.push(packet(3, [{ entityId: 1, x: 50, y: 50, speed: PLAYER_MOVE_SPEED }]));
    const result = buffer.sample(1 / 60);

    expect(result).toEqual([{ entityId: 1, x: 50, y: 50 }]);
  });

  it('latestRawPosition returns the raw last-received snapshot position with no smoothing', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(packet(1, [{ entityId: 1, x: 0, y: 0, speed: PLAYER_MOVE_SPEED }]));
    buffer.sample(1 / 60);

    buffer.push(packet(2, [{ entityId: 1, x: 1000, y: 0, speed: PLAYER_MOVE_SPEED }]));

    expect(buffer.latestRawPosition(1)).toEqual({ entityId: 1, x: 1000, y: 0 });
  });

  it('latestRawPosition returns undefined when no snapshot has arrived', () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.latestRawPosition(1)).toBeUndefined();
  });
});
