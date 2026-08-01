import type { Component } from './Component';
import type { EntityId } from './EntityId';

/** Dense-enough sparse store mapping entities to a single component type's data. */
export class ComponentStore<T extends Component> {
  private readonly byEntity = new Map<EntityId, T>();

  add(entityId: EntityId, component: T): T {
    this.byEntity.set(entityId, component);
    return component;
  }

  remove(entityId: EntityId): boolean {
    return this.byEntity.delete(entityId);
  }

  get(entityId: EntityId): T | undefined {
    return this.byEntity.get(entityId);
  }

  has(entityId: EntityId): boolean {
    return this.byEntity.has(entityId);
  }

  get size(): number {
    return this.byEntity.size;
  }

  *entries(): IterableIterator<[EntityId, T]> {
    yield* this.byEntity.entries();
  }

  *entityIds(): IterableIterator<EntityId> {
    yield* this.byEntity.keys();
  }
}
