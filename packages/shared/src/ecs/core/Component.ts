import type { EntityId } from './EntityId';

/**
 * Base class for all component data. Concrete components (PositionComponent,
 * VelocityComponent, ...) extend this and add plain public fields — components
 * are data, behavior belongs in Systems.
 */
export abstract class Component {
  constructor(public readonly entityId: EntityId) {}
}
