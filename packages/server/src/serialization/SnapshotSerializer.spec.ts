import { describe, expect, it } from 'vitest';
import {
  World,
  ServiceContainer,
  PositionComponent,
  RenderPositionComponent,
  VelocityComponent,
  EntityTypeComponent,
  EntityType,
  EntityOwnerComponent,
  AimComponent,
  EntityActionStateComponent,
  ActionState,
} from '@starve/shared';
import { decodeAny, finalizeForWire, Opcode } from '@starve/protocol';
import { serializeWorldSnapshot } from './SnapshotSerializer';

function createWorld(): World {
  return new World({ services: new ServiceContainer() });
}

const noNicknames = (): undefined => undefined;

describe('serializeWorldSnapshot', () => {
  it('encodes every entity with a PositionComponent into a decodable WorldSnapshotPacket', () => {
    const world = createWorld();
    const a = world.entities.createEntity();
    const b = world.entities.createEntity();
    world.entities.addComponent(a.id, PositionComponent, new PositionComponent(a.id, 1, 2));
    world.entities.addComponent(b.id, PositionComponent, new PositionComponent(b.id, -5, 10));

    const buffer = serializeWorldSnapshot(world, 42, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    expect(decoded.opcode).toBe(Opcode.WorldSnapshot);
    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    expect(decoded.packet.serverTick).toBe(42);
    const ids = decoded.packet.entities.map((e) => e.entityId).sort((x, y) => x - y);
    expect(ids).toEqual([a.id, b.id].sort((x, y) => x - y));
  });

  it('excludes entities without a PositionComponent', () => {
    const world = createWorld();
    world.entities.createEntity(); // no components attached

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    expect(decoded.packet.entities).toHaveLength(0);
  });

  it('broadcasts RenderPositionComponent instead of the raw PositionComponent target when both exist', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 100, 100));
    world.entities.addComponent(
      entity.id,
      RenderPositionComponent,
      new RenderPositionComponent(entity.id, 7, 3), // smoothed position, still trailing the target
    );

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    expect(decoded.packet.entities[0]).toEqual({
      entityId: entity.id,
      entityType: EntityType.Player,
      ownerPid: 0,
      x: 7,
      y: 3,
      speed: 0,
      angle: 0,
      action: ActionState.Idle,
      nickname: '',
    });
  });

  it('falls back to PositionComponent for entities with no RenderPositionComponent', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 42, -8));

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    expect(decoded.packet.entities[0]).toEqual({
      entityId: entity.id,
      entityType: EntityType.Player,
      ownerPid: 0,
      x: 42,
      y: -8,
      speed: 0,
      angle: 0,
      action: ActionState.Idle,
      nickname: '',
    });
  });

  it('broadcasts VelocityComponent magnitude as speed', () => {
    const world = createWorld();
    const entity = world.entities.createEntity();
    world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, 0, 0));
    world.entities.addComponent(entity.id, VelocityComponent, new VelocityComponent(entity.id, 3, 4));

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    expect(decoded.packet.entities[0]!.speed).toBeCloseTo(5, 5); // 3-4-5 triangle
  });

  it('broadcasts entityType from EntityTypeComponent, falling back to Player when absent', () => {
    const world = createWorld();
    const wall = world.entities.createEntity();
    world.entities.addComponent(wall.id, PositionComponent, new PositionComponent(wall.id, 0, 0));
    world.entities.addComponent(wall.id, EntityTypeComponent, new EntityTypeComponent(wall.id, EntityType.WorldGeometry));

    const noType = world.entities.createEntity();
    world.entities.addComponent(noType.id, PositionComponent, new PositionComponent(noType.id, 0, 0));

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    const wallEntity = decoded.packet.entities.find((e) => e.entityId === wall.id)!;
    const noTypeEntity = decoded.packet.entities.find((e) => e.entityId === noType.id)!;
    expect(wallEntity.entityType).toBe(EntityType.WorldGeometry);
    expect(noTypeEntity.entityType).toBe(EntityType.Player);
  });

  it('broadcasts ownerPid from EntityOwnerComponent, falling back to NO_OWNER_PID (0) when absent', () => {
    const world = createWorld();
    const owned = world.entities.createEntity();
    world.entities.addComponent(owned.id, PositionComponent, new PositionComponent(owned.id, 0, 0));
    world.entities.addComponent(owned.id, EntityOwnerComponent, new EntityOwnerComponent(owned.id, 5));

    const unowned = world.entities.createEntity();
    world.entities.addComponent(unowned.id, PositionComponent, new PositionComponent(unowned.id, 0, 0));

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    const ownedEntity = decoded.packet.entities.find((e) => e.entityId === owned.id)!;
    const unownedEntity = decoded.packet.entities.find((e) => e.entityId === unowned.id)!;
    expect(ownedEntity.ownerPid).toBe(5);
    expect(unownedEntity.ownerPid).toBe(0);
  });

  it('resolves nickname via nicknameForPid for owned entities, falling back to empty string for unowned entities', () => {
    const world = createWorld();
    const owned = world.entities.createEntity();
    world.entities.addComponent(owned.id, PositionComponent, new PositionComponent(owned.id, 0, 0));
    world.entities.addComponent(owned.id, EntityOwnerComponent, new EntityOwnerComponent(owned.id, 5));

    const unowned = world.entities.createEntity();
    world.entities.addComponent(unowned.id, PositionComponent, new PositionComponent(unowned.id, 0, 0));

    const buffer = serializeWorldSnapshot(world, 0, (pid) => (pid === 5 ? 'Alice' : undefined));
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    const ownedEntity = decoded.packet.entities.find((e) => e.entityId === owned.id)!;
    const unownedEntity = decoded.packet.entities.find((e) => e.entityId === unowned.id)!;
    expect(ownedEntity.nickname).toBe('Alice');
    expect(unownedEntity.nickname).toBe('');
  });

  it('falls back to empty string when nicknameForPid returns undefined for an owned entity', () => {
    const world = createWorld();
    const owned = world.entities.createEntity();
    world.entities.addComponent(owned.id, PositionComponent, new PositionComponent(owned.id, 0, 0));
    world.entities.addComponent(owned.id, EntityOwnerComponent, new EntityOwnerComponent(owned.id, 5));

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    expect(decoded.packet.entities[0]!.nickname).toBe('');
  });

  it('broadcasts angle from AimComponent, falling back to 0 when absent', () => {
    const world = createWorld();
    const aiming = world.entities.createEntity();
    world.entities.addComponent(aiming.id, PositionComponent, new PositionComponent(aiming.id, 0, 0));
    world.entities.addComponent(aiming.id, AimComponent, new AimComponent(aiming.id, Math.PI / 2));

    const noAim = world.entities.createEntity();
    world.entities.addComponent(noAim.id, PositionComponent, new PositionComponent(noAim.id, 0, 0));

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    const aimingEntity = decoded.packet.entities.find((e) => e.entityId === aiming.id)!;
    const noAimEntity = decoded.packet.entities.find((e) => e.entityId === noAim.id)!;
    expect(aimingEntity.angle).toBeCloseTo(Math.PI / 2, 5);
    expect(noAimEntity.angle).toBe(0);
  });

  it('broadcasts action from EntityActionStateComponent, falling back to ActionState.Idle when absent', () => {
    const world = createWorld();
    const walking = world.entities.createEntity();
    world.entities.addComponent(walking.id, PositionComponent, new PositionComponent(walking.id, 0, 0));
    world.entities.addComponent(
      walking.id,
      EntityActionStateComponent,
      new EntityActionStateComponent(walking.id, ActionState.Walk),
    );

    const noAction = world.entities.createEntity();
    world.entities.addComponent(noAction.id, PositionComponent, new PositionComponent(noAction.id, 0, 0));

    const buffer = serializeWorldSnapshot(world, 0, noNicknames);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    const walkingEntity = decoded.packet.entities.find((e) => e.entityId === walking.id)!;
    const noActionEntity = decoded.packet.entities.find((e) => e.entityId === noAction.id)!;
    expect(walkingEntity.action).toBe(ActionState.Walk);
    expect(noActionEntity.action).toBe(ActionState.Idle);
  });
});
