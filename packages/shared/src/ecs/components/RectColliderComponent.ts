import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';
import { ALL_LAYERS, CollisionLayer } from '../../physics/CollisionLayer';

/** Axis-aligned rectangular collision shape centered on the entity's PositionComponent. */
export class RectColliderComponent extends Component {
  halfWidth: number;
  halfHeight: number;
  /** Which CollisionLayer this collider belongs to. */
  layer: number;
  /** Bitmask of layers this collider tests against — see CollisionLayer for the pattern. */
  collidesWith: number;

  constructor(
    entityId: EntityId,
    width: number,
    height: number,
    options: { layer?: number; collidesWith?: number } = {},
  ) {
    super(entityId);
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
    this.layer = options.layer ?? CollisionLayer.World;
    this.collidesWith = options.collidesWith ?? ALL_LAYERS;
  }
}
