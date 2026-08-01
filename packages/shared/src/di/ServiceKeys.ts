import { createServiceKey, type ServiceKey } from './ServiceContainer';
import type { ClockService } from './ClockService';

/**
 * Shared service keys usable by both client and server. Each side additionally
 * defines its own keys locally (e.g. server's NETWORK_SERVICE, client's CAMERA_SERVICE)
 * rather than polluting this shared registry with side-specific concerns.
 */
export const CLOCK_SERVICE: ServiceKey<ClockService> = createServiceKey<ClockService>('ClockService');
