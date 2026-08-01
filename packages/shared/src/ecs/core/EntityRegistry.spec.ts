import { describe, expect, it } from 'vitest';
import { EntityRegistry } from './EntityRegistry';
import { Component } from './Component';
import type { EntityId } from './EntityId';

class TestComponentA extends Component {
  constructor(entityId: EntityId, public value = 0) {
    super(entityId);
  }
}

class TestComponentB extends Component {
  constructor(entityId: EntityId, public value = 0) {
    super(entityId);
  }
}

describe('EntityRegistry', () => {
  it('creates entities with unique, alive ids', () => {
    const registry = new EntityRegistry();
    const a = registry.createEntity();
    const b = registry.createEntity();
    expect(a.id).not.toBe(b.id);
    expect(registry.isAlive(a.id)).toBe(true);
    expect(registry.isAlive(b.id)).toBe(true);
  });

  it('attaches and detaches components', () => {
    const registry = new EntityRegistry();
    const entity = registry.createEntity();
    expect(registry.hasComponent(entity.id, TestComponentA)).toBe(false);

    const component = registry.addComponent(entity.id, TestComponentA, new TestComponentA(entity.id, 5));
    expect(registry.hasComponent(entity.id, TestComponentA)).toBe(true);
    expect(registry.getComponent(entity.id, TestComponentA)).toBe(component);

    registry.removeComponent(entity.id, TestComponentA);
    expect(registry.hasComponent(entity.id, TestComponentA)).toBe(false);
    expect(registry.getComponent(entity.id, TestComponentA)).toBeUndefined();
  });

  it('destroying an entity removes all of its components', () => {
    const registry = new EntityRegistry();
    const entity = registry.createEntity();
    registry.addComponent(entity.id, TestComponentA, new TestComponentA(entity.id));
    registry.addComponent(entity.id, TestComponentB, new TestComponentB(entity.id));

    registry.destroyEntity(entity.id);

    expect(registry.isAlive(entity.id)).toBe(false);
    expect(registry.hasComponent(entity.id, TestComponentA)).toBe(false);
    expect(registry.hasComponent(entity.id, TestComponentB)).toBe(false);
  });

  it('query() only yields entities holding every requested component type', () => {
    const registry = new EntityRegistry();
    const onlyA = registry.createEntity();
    const both = registry.createEntity();
    const onlyB = registry.createEntity();

    registry.addComponent(onlyA.id, TestComponentA, new TestComponentA(onlyA.id));
    registry.addComponent(both.id, TestComponentA, new TestComponentA(both.id));
    registry.addComponent(both.id, TestComponentB, new TestComponentB(both.id));
    registry.addComponent(onlyB.id, TestComponentB, new TestComponentB(onlyB.id));

    const results = Array.from(registry.query(TestComponentA, TestComponentB));
    expect(results).toEqual([both.id]);
  });

  it('query() with no requested types iterates all alive entities', () => {
    const registry = new EntityRegistry();
    const a = registry.createEntity();
    const b = registry.createEntity();
    const results = Array.from(registry.query()).sort();
    expect(results).toEqual([a.id, b.id].sort());
  });

  it('ensureEntity registers an externally-assigned id as alive', () => {
    const registry = new EntityRegistry();
    expect(registry.isAlive(42)).toBe(false);

    registry.ensureEntity(42);

    expect(registry.isAlive(42)).toBe(true);
  });

  it('ensureEntity is idempotent for an id already alive', () => {
    const registry = new EntityRegistry();
    registry.ensureEntity(7);
    registry.addComponent(7, TestComponentA, new TestComponentA(7, 9));

    registry.ensureEntity(7);

    expect(registry.isAlive(7)).toBe(true);
    expect(registry.getComponent(7, TestComponentA)?.value).toBe(9);
  });
});
