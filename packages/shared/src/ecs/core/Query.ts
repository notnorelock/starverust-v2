import type { ComponentType } from './ComponentType';
import type { EntityId } from './EntityId';

/** Iterable view over entities that currently hold every component type listed. */
export interface Query extends Iterable<EntityId> {
  readonly componentTypes: ReadonlyArray<ComponentType>;
  matches(entityId: EntityId): boolean;
}
