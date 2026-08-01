import { describe, expect, it } from 'vitest';
import { ServiceContainer, ServiceNotFoundError, createServiceKey } from './ServiceContainer';

interface FakeService {
  greet(): string;
}

describe('ServiceContainer', () => {
  it('resolves the exact instance registered for a key', () => {
    const key = createServiceKey<FakeService>('FakeService');
    const container = new ServiceContainer();
    const instance: FakeService = { greet: () => 'hi' };

    container.register(key, instance);

    expect(container.resolve(key)).toBe(instance);
  });

  it('throws ServiceNotFoundError when resolving an unregistered key', () => {
    const key = createServiceKey<FakeService>('FakeService');
    const container = new ServiceContainer();

    expect(() => container.resolve(key)).toThrow(ServiceNotFoundError);
  });

  it('tryResolve returns undefined instead of throwing for an unregistered key', () => {
    const key = createServiceKey<FakeService>('FakeService');
    const container = new ServiceContainer();

    expect(container.tryResolve(key)).toBeUndefined();
  });
});
