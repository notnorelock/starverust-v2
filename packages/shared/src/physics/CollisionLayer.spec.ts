import { describe, expect, it } from 'vitest';
import { ALL_LAYERS, CollisionLayer, layersCollide } from './CollisionLayer';

describe('layersCollide', () => {
  it('collides when both masks mutually include the other layer', () => {
    expect(
      layersCollide(CollisionLayer.Player, CollisionLayer.World, CollisionLayer.World, ALL_LAYERS),
    ).toBe(true);
  });

  it('does not collide when neither mask includes the other layer', () => {
    expect(
      layersCollide(CollisionLayer.Player, CollisionLayer.World, CollisionLayer.Player, CollisionLayer.World),
    ).toBe(false);
  });

  it('requires the check to be symmetric — one-directional mask inclusion is not enough', () => {
    // A's mask includes B's layer, but B's mask does NOT include A's layer.
    expect(layersCollide(CollisionLayer.Player, CollisionLayer.World, CollisionLayer.World, 0)).toBe(false);
  });

  it('ALL_LAYERS collides with anything that reciprocates', () => {
    expect(layersCollide(CollisionLayer.World, ALL_LAYERS, CollisionLayer.Player, CollisionLayer.World)).toBe(
      true,
    );
  });
});
