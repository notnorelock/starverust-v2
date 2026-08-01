import type { ServiceContainer } from '../../di/ServiceContainer';
import { EntityRegistry } from './EntityRegistry';
import type { System } from './System';

export interface WorldOptions {
  services: ServiceContainer;
}

/**
 * Owns entity/component storage and the ordered list of systems that operate on it.
 * Both the server's authoritative simulation and the client's render-side World are
 * instances of this same class — what differs is which systems get registered into
 * each, not the orchestration logic itself.
 */
export class World {
  readonly entities: EntityRegistry;
  readonly services: ServiceContainer;

  private readonly systems: System[] = [];
  private initialized = false;

  constructor(options: WorldOptions) {
    this.entities = new EntityRegistry();
    this.services = options.services;
  }

  /** Registers a system. Registration order is execution order for both update passes. */
  registerSystem(system: System): this {
    this.systems.push(system);
    if (this.initialized) {
      system.onInit(this);
    }
    return this;
  }

  getSystem<S extends System>(type: new (...args: never[]) => S): S | undefined {
    return this.systems.find((system): system is S => system instanceof type);
  }

  /** Calls onInit on every currently-registered system, in registration order. */
  init(): void {
    for (const system of this.systems) {
      system.onInit(this);
    }
    this.initialized = true;
  }

  /** Drives the fixed-rate authoritative simulation tick — this ordering IS the tick pipeline. */
  fixedUpdate(fixedDt: number): void {
    for (const system of this.systems) {
      if (system.enabled) {
        system.onFixedUpdate(fixedDt, this);
      }
    }
  }

  /** Drives the variable-rate frame loop; only systems implementing onUpdate participate. */
  update(dt: number): void {
    for (const system of this.systems) {
      if (system.enabled) {
        system.onUpdate?.(dt, this);
      }
    }
  }

  destroy(): void {
    for (const system of this.systems) {
      system.onDestroy(this);
    }
    this.systems.length = 0;
  }
}
