import { describe, expect, it } from 'vitest';
import { EntityTypeRegistry } from './EntityTypeRegistry';
import { EntityType } from '@starve/shared';

describe('EntityTypeRegistry', () => {
  it('returns Player as the default for an unknown entity', () => {
    const registry = new EntityTypeRegistry();
    expect(registry.get(1)).toBe(EntityType.Player);
  });

  it('returns the inserted type for a known entity', () => {
    const registry = new EntityTypeRegistry();
    registry.insert(1, EntityType.WorldGeometry);
    expect(registry.get(1)).toBe(EntityType.WorldGeometry);
  });

  it('reverts to the default after removal', () => {
    const registry = new EntityTypeRegistry();
    registry.insert(1, EntityType.WorldGeometry);
    registry.remove(1);
    expect(registry.get(1)).toBe(EntityType.Player);
  });

  it('tracks multiple entities independently', () => {
    const registry = new EntityTypeRegistry();
    registry.insert(1, EntityType.Player);
    registry.insert(2, EntityType.WorldGeometry);

    expect(registry.get(1)).toBe(EntityType.Player);
    expect(registry.get(2)).toBe(EntityType.WorldGeometry);
  });
});
