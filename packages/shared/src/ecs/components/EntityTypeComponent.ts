import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

/**
 * Wire-stable entity type discriminant, broadcast on EntityInsertPacket so clients know
 * what they're spawning without guessing from which components happened to arrive first.
 * Player is 0 (the default) since it's the only entity type Stage 1 actually spawns
 * dynamically — new types are appended, never renumbered, since the numeric value is
 * persisted on the wire.
 */
export enum EntityType {
  Player = 0,
  WorldGeometry = 1,
}

/** Tags an entity with its EntityType — see EntityType for why the numbering matters. */
export class EntityTypeComponent extends Component {
  constructor(entityId: EntityId, public readonly entityType: EntityType) {
    super(entityId);
  }
}
