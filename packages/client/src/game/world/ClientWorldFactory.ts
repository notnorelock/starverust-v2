import { ServiceContainer, SystemClockService, World, CLOCK_SERVICE } from '@starve/shared';

/** Builds the client's render-side World with the base service set registered. */
export function createClientWorld(): World {
  const services = new ServiceContainer();
  services.register(CLOCK_SERVICE, new SystemClockService());
  return new World({ services });
}
