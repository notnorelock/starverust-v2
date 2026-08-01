import { createServiceKey, type ServiceKey } from '@starve/shared';
import type { NetworkService } from '../network/NetworkService';
import type { ConnectionRegistry } from '../network/ConnectionRegistry';
import type { IPlayerRepository } from '../database/repositories/IPlayerRepository';
import type { EventBus } from '../events/EventBus';

export const NETWORK_SERVICE: ServiceKey<NetworkService> = createServiceKey<NetworkService>('NetworkService');
export const CONNECTION_REGISTRY: ServiceKey<ConnectionRegistry> =
  createServiceKey<ConnectionRegistry>('ConnectionRegistry');
export const PLAYER_REPOSITORY: ServiceKey<IPlayerRepository> =
  createServiceKey<IPlayerRepository>('PlayerRepository');
export const EVENT_BUS: ServiceKey<EventBus> = createServiceKey<EventBus>('EventBus');
