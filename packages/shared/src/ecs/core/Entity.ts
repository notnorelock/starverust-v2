import type { EntityId } from './EntityId';

/**
 * Thin handle to an entity. Entities hold no data themselves — all state lives in
 * ComponentStores keyed by EntityId, so an Entity is just an identity, not a container.
 */
export class Entity {
  constructor(public readonly id: EntityId) {}
}
