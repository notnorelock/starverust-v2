import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';
import { ALL_LAYERS, CollisionLayer } from '../../physics/CollisionLayer';

/** Circular collision shape centered on the entity's PositionComponent. */
export class CircleColliderComponent extends Component {
  radius: number;
  /** Which CollisionLayer this collider belongs to. */
  layer: number;
  /** Bitmask of layers this collider tests against — see CollisionLayer for the pattern. */
  collidesWith: number;

  constructor(
    entityId: EntityId,
    radius: number,
    options: { layer?: number; collidesWith?: number } = {},
  ) {
    super(entityId);
    this.radius = radius;
    this.layer = options.layer ?? CollisionLayer.World;
    this.collidesWith = options.collidesWith ?? ALL_LAYERS;
  }
}
