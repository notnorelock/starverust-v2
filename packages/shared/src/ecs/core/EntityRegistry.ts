import type { Component } from './Component';
import type { ComponentType } from './ComponentType';
import { ComponentStore } from './ComponentStore';
import { Entity } from './Entity';
import type { EntityId } from './EntityId';
import type { Query } from './Query';

/**
 * Owns entity identity, component storage, and querying. Systems never touch
 * component maps directly — they always go through the registry so storage
 * strategy (this Map-backed one today, something denser later) stays swappable.
 */
export class EntityRegistry {
  private nextEntityId: EntityId = 1;
  private readonly alive = new Set<EntityId>();
  private readonly stores = new Map<ComponentType, ComponentStore<Component>>();

  createEntity(): Entity {
    const id = this.nextEntityId;
    this.nextEntityId += 1;
    this.alive.add(id);
    return new Entity(id);
  }

  /**
   * Registers a specific, externally-assigned id as alive if it isn't already — idempotent.
   * For registries that mirror another authority's entity ids (e.g. the client mirroring
   * the server's ids from WorldSnapshotPacket) rather than minting their own via createEntity().
   */
  ensureEntity(id: EntityId): Entity {
    this.alive.add(id);
    return new Entity(id);
  }

  destroyEntity(id: EntityId): void {
    if (!this.alive.has(id)) {
      return;
    }
    for (const store of this.stores.values()) {
      store.remove(id);
    }
    this.alive.delete(id);
  }

  isAlive(id: EntityId): boolean {
    return this.alive.has(id);
  }

  addComponent<T extends Component>(id: EntityId, type: ComponentType<T>, component: T): T {
    const store = this.storeFor(type);
    store.add(id, component);
    return component;
  }

  removeComponent<T extends Component>(id: EntityId, type: ComponentType<T>): void {
    this.stores.get(type)?.remove(id);
  }

  getComponent<T extends Component>(id: EntityId, type: ComponentType<T>): T | undefined {
    return this.stores.get(type)?.get(id) as T | undefined;
  }

  hasComponent<T extends Component>(id: EntityId, type: ComponentType<T>): boolean {
    return this.stores.get(type)?.has(id) ?? false;
  }

  query(...types: ComponentType[]): Query {
    const registry = this;
    return {
      componentTypes: types,
      matches(id: EntityId): boolean {
        return types.every((type) => registry.hasComponent(id, type));
      },
      [Symbol.iterator](): Iterator<EntityId> {
        if (types.length === 0) {
          return registry.alive.values();
        }

        const [smallestType] = types.reduce<[ComponentType, number]>(
          (smallest, type) => {
            const size = registry.stores.get(type)?.size ?? 0;
            return size < smallest[1] ? [type, size] : smallest;
          },
          [types[0]!, registry.storeFor(types[0]!).size],
        );

        const candidates = registry.storeFor(smallestType).entityIds();
        const matches = registry.matchesAll(types);
        return filterIterator(candidates, matches);
      },
    };
  }

  private matchesAll(types: ComponentType[]): (id: EntityId) => boolean {
    return (id: EntityId) => types.every((type) => this.hasComponent(id, type));
  }

  private storeFor<T extends Component>(type: ComponentType<T>): ComponentStore<T> {
    let store = this.stores.get(type);
    if (!store) {
      store = new ComponentStore<Component>();
      this.stores.set(type, store);
    }
    return store as ComponentStore<T>;
  }
}

function* filterIterator<T>(source: IterableIterator<T>, predicate: (value: T) => boolean): IterableIterator<T> {
  for (const value of source) {
    if (predicate(value)) {
      yield value;
    }
  }
}
