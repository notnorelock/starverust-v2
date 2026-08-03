import { createServiceKey, type ServiceKey } from '@starve/shared';
import type { CanvasContext2DProvider } from '../render/CanvasContext2DProvider';
import type { Camera2D } from '../camera/Camera2D';
import type { SnapshotBuffer } from '../network/SnapshotBuffer';
import type { NetworkClient } from '../network/NetworkClient';
import type { LocalPlayerDataStore } from './LocalPlayerDataStore';

export const CANVAS_PROVIDER: ServiceKey<CanvasContext2DProvider> =
  createServiceKey<CanvasContext2DProvider>('CanvasContext2DProvider');
export const CAMERA_SERVICE: ServiceKey<Camera2D> = createServiceKey<Camera2D>('Camera2D');
export const SNAPSHOT_BUFFER: ServiceKey<SnapshotBuffer> = createServiceKey<SnapshotBuffer>('SnapshotBuffer');
export const NETWORK_CLIENT: ServiceKey<NetworkClient> = createServiceKey<NetworkClient>('NetworkClient');
export const LOCAL_PLAYER_DATA: ServiceKey<LocalPlayerDataStore> =
  createServiceKey<LocalPlayerDataStore>('LocalPlayerDataStore');
