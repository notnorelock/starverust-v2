import { ServiceContainer, SystemClockService, World, CLOCK_SERVICE } from '@starve/shared';

/** Builds the server's authoritative World with the base service set registered. */
export function createServerWorld(): World {
  const services = new ServiceContainer();
  services.register(CLOCK_SERVICE, new SystemClockService());
  return new World({ services });
}
