import { describe, expect, it } from 'vitest';
import { World, ServiceContainer, PositionComponent, VelocityComponent, RenderPositionComponent } from '@starve/shared';
import { decodeAny, Opcode } from '@starve/protocol';
import { InterestManagementSystem } from './InterestManagementSystem';
import { ConnectionRegistry } from '../network/ConnectionRegistry';
import { ClientConnection } from '../network/ClientConnection';

function createWorld(): World {
  const world = new World({ services: new ServiceContainer() });
  return world;
}

function fakeConnection(connectionId: number): { connection: ClientConnection; sent: ArrayBuffer[] } {
  const sent: ArrayBuffer[] = [];
  const fakeSocket = { sendBinary: (buffer: ArrayBuffer) => sent.push(buffer) };
  const connection = new ClientConnection(connectionId, fakeSocket as never);
  return { connection, sent };
}

function decodeLastUpdate(sent: ArrayBuffer[]) {
  // connection.send() already applies wire-level protection internally — don't re-protect here.
  const decoded = decodeAny(sent[sent.length - 1]!);
  if (decoded.opcode !== Opcode.EntityUpdate) {
    throw new Error('expected an EntityUpdatePacket');
  }
  return decoded.packet;
}

describe('InterestManagementSystem', () => {
  it('sends an EntityUpdatePacket to a connection containing dynamic entities near its own player', () => {
    const world = createWorld();
    const registry = new ConnectionRegistry();
    const system = new InterestManagementSystem(registry);
    world.registerSystem(system);
    world.init();

    const { connection, sent } = fakeConnection(1);
    registry.add(connection);

    const player = world.entities.createEntity();
    world.entities.addComponent(player.id, PositionComponent, new PositionComponent(player.id, 0, 0));
    world.entities.addComponent(player.id, VelocityComponent, new VelocityComponent(player.id, 0, 0));
    connection.entityId = player.id;

    const nearby = world.entities.createEntity();
    world.entities.addComponent(nearby.id, PositionComponent, new PositionComponent(nearby.id, 50, 0));
    world.entities.addComponent(nearby.id, VelocityComponent, new VelocityComponent(nearby.id, 10, 0));

    world.fixedUpdate(1 / 20);

    const packet = decodeLastUpdate(sent);
    const ids = packet.entities.map((e) => e.entityId).sort((a, b) => a - b);
    expect(ids).toEqual([player.id, nearby.id].sort((a, b) => a - b));
  });

  it('excludes dynamic entities outside the interest radius', () => {
    const world = createWorld();
    const registry = new ConnectionRegistry();
    const system = new InterestManagementSystem(registry);
    world.registerSystem(system);
    world.init();

    const { connection, sent } = fakeConnection(1);
    registry.add(connection);

    const player = world.entities.createEntity();
    world.entities.addComponent(player.id, PositionComponent, new PositionComponent(player.id, 0, 0));
    world.entities.addComponent(player.id, VelocityComponent, new VelocityComponent(player.id, 0, 0));
    connection.entityId = player.id;

    const farAway = world.entities.createEntity();
    world.entities.addComponent(farAway.id, PositionComponent, new PositionComponent(farAway.id, 100000, 100000));
    world.entities.addComponent(farAway.id, VelocityComponent, new VelocityComponent(farAway.id, 0, 0));

    world.fixedUpdate(1 / 20);

    const packet = decodeLastUpdate(sent);
    const ids = packet.entities.map((e) => e.entityId);
    expect(ids).toContain(player.id);
    expect(ids).not.toContain(farAway.id);
  });

  it('excludes static entities (no VelocityComponent) from the recurring update', () => {
    const world = createWorld();
    const registry = new ConnectionRegistry();
    const system = new InterestManagementSystem(registry);
    world.registerSystem(system);
    world.init();

    const { connection, sent } = fakeConnection(1);
    registry.add(connection);

    const player = world.entities.createEntity();
    world.entities.addComponent(player.id, PositionComponent, new PositionComponent(player.id, 0, 0));
    world.entities.addComponent(player.id, VelocityComponent, new VelocityComponent(player.id, 0, 0));
    connection.entityId = player.id;

    const wall = world.entities.createEntity();
    world.entities.addComponent(wall.id, PositionComponent, new PositionComponent(wall.id, 10, 0)); // no VelocityComponent

    world.fixedUpdate(1 / 20);

    const packet = decodeLastUpdate(sent);
    const ids = packet.entities.map((e) => e.entityId);
    expect(ids).not.toContain(wall.id);
  });

  it('broadcasts RenderPositionComponent instead of the raw PositionComponent target when both exist', () => {
    const world = createWorld();
    const registry = new ConnectionRegistry();
    const system = new InterestManagementSystem(registry);
    world.registerSystem(system);
    world.init();

    const { connection, sent } = fakeConnection(1);
    registry.add(connection);

    const player = world.entities.createEntity();
    world.entities.addComponent(player.id, PositionComponent, new PositionComponent(player.id, 100, 100));
    world.entities.addComponent(
      player.id,
      RenderPositionComponent,
      new RenderPositionComponent(player.id, 7, 3),
    );
    world.entities.addComponent(player.id, VelocityComponent, new VelocityComponent(player.id, 0, 0));
    connection.entityId = player.id;

    world.fixedUpdate(1 / 20);

    const packet = decodeLastUpdate(sent);
    expect(packet.entities[0]).toMatchObject({ entityId: player.id, x: 7, y: 3 });
  });

  it('skips connections with no assigned entity', () => {
    const world = createWorld();
    const registry = new ConnectionRegistry();
    const system = new InterestManagementSystem(registry);
    world.registerSystem(system);
    world.init();

    const { connection, sent } = fakeConnection(1); // entityId left undefined
    registry.add(connection);

    world.fixedUpdate(1 / 20);

    expect(sent).toHaveLength(0);
  });
});
