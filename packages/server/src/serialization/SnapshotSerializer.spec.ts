import { describe, expect, it } from 'vitest';
import { World, ServiceContainer, PositionComponent } from '@starve/shared';
import { decodeAny, finalizeForWire, Opcode } from '@starve/protocol';
import { serializeWorldSnapshot } from './SnapshotSerializer';

function createWorld(): World {
  return new World({ services: new ServiceContainer() });
}

describe('serializeWorldSnapshot', () => {
  it('encodes every entity with a PositionComponent into a decodable WorldSnapshotPacket', () => {
    const world = createWorld();
    const a = world.entities.createEntity();
    const b = world.entities.createEntity();
    world.entities.addComponent(a.id, PositionComponent, new PositionComponent(a.id, 1, 2));
    world.entities.addComponent(b.id, PositionComponent, new PositionComponent(b.id, -5, 10));

    const buffer = serializeWorldSnapshot(world, 42);
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

    const buffer = serializeWorldSnapshot(world, 0);
    const decoded = decodeAny(finalizeForWire(buffer));

    if (decoded.opcode !== Opcode.WorldSnapshot) {
      throw new Error('unexpected opcode');
    }
    expect(decoded.packet.entities).toHaveLength(0);
  });
});
