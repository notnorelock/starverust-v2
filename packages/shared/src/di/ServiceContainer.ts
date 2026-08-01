/** Symbol-keyed token identifying a service, carrying its type at the type level only. */
export type ServiceKey<T> = symbol & { readonly __serviceType?: T };

export function createServiceKey<T>(description: string): ServiceKey<T> {
  return Symbol(description) as ServiceKey<T>;
}

/** Thrown by resolve() when a key was never registered. */
export class ServiceNotFoundError extends Error {
  constructor(key: symbol) {
    super(`no service registered: ${key.description ?? key.toString()}`);
  }
}

/**
 * Minimal typed service locator — not a full IoC framework. Bootstrap code registers
 * concrete instances once at startup; systems receive their dependencies via constructor
 * injection at registration time rather than reaching into the container mid-update.
 */
export class ServiceContainer {
  private readonly services = new Map<symbol, unknown>();

  register<T>(key: ServiceKey<T>, instance: T): void {
    this.services.set(key, instance);
  }

  resolve<T>(key: ServiceKey<T>): T {
    const value = this.tryResolve(key);
    if (value === undefined) {
      throw new ServiceNotFoundError(key);
    }
    return value;
  }

  tryResolve<T>(key: ServiceKey<T>): T | undefined {
    return this.services.get(key) as T | undefined;
  }
}
