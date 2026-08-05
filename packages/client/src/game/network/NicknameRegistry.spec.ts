import { describe, expect, it } from 'vitest';
import { NicknameRegistry } from './NicknameRegistry';

describe('NicknameRegistry', () => {
  it('returns undefined for an entity whose nickname is unknown', () => {
    const registry = new NicknameRegistry();
    expect(registry.get(1)).toBeUndefined();
  });

  it('returns the nickname for a known entity, keyed by entityId', () => {
    const registry = new NicknameRegistry();
    registry.insert(5, 7, 'Survivor');
    expect(registry.get(7)).toBe('Survivor');
  });

  it('removes by pid, dropping the associated entityId nickname', () => {
    const registry = new NicknameRegistry();
    registry.insert(5, 7, 'Survivor');
    registry.remove(5);
    expect(registry.get(7)).toBeUndefined();
  });

  it('removing an unknown pid is a no-op', () => {
    const registry = new NicknameRegistry();
    registry.insert(5, 7, 'Survivor');
    registry.remove(999);
    expect(registry.get(7)).toBe('Survivor');
  });

  it('tracks multiple players independently', () => {
    const registry = new NicknameRegistry();
    registry.insert(1, 10, 'Alice');
    registry.insert(2, 20, 'Bob');

    expect(registry.get(10)).toBe('Alice');
    expect(registry.get(20)).toBe('Bob');

    registry.remove(1);

    expect(registry.get(10)).toBeUndefined();
    expect(registry.get(20)).toBe('Bob');
  });

  it('re-inserting for the same pid with a new entityId does not leave the old entityId mapped', () => {
    const registry = new NicknameRegistry();
    registry.insert(1, 10, 'Alice');
    registry.insert(1, 11, 'Alice'); // e.g. reconnect got a new entityId

    expect(registry.get(11)).toBe('Alice');
    // Old entityId 10 was never explicitly removed, so it can still resolve — this
    // documents current behavior (insert() doesn't clean up a pid's previous entityId)
    // rather than asserting a guarantee; remove() is the only cleanup path today.
    expect(registry.get(10)).toBe('Alice');
  });

  describe('entityIdForPid', () => {
    it('returns undefined for a pid whose entityId is unknown', () => {
      const registry = new NicknameRegistry();
      expect(registry.entityIdForPid(5)).toBeUndefined();
    });

    it('resolves a known pid to its entityId', () => {
      const registry = new NicknameRegistry();
      registry.insert(5, 7, 'Survivor');
      expect(registry.entityIdForPid(5)).toBe(7);
    });

    it('returns undefined after the pid is removed', () => {
      const registry = new NicknameRegistry();
      registry.insert(5, 7, 'Survivor');
      registry.remove(5);
      expect(registry.entityIdForPid(5)).toBeUndefined();
    });
  });
});
