import { createServiceKey, type ServiceKey } from '@starve/shared';
import type { CanvasContext2DProvider } from '../../engine/render/CanvasContext2DProvider';
import type { Camera2D } from '../../engine/camera/Camera2D';
import type { NetworkClient } from '../../engine/network/NetworkClient';

export const CANVAS_PROVIDER: ServiceKey<CanvasContext2DProvider> =
  createServiceKey<CanvasContext2DProvider>('CanvasContext2DProvider');
export const CAMERA_SERVICE: ServiceKey<Camera2D> = createServiceKey<Camera2D>('Camera2D');
export const NETWORK_CLIENT: ServiceKey<NetworkClient> = createServiceKey<NetworkClient>('NetworkClient');
