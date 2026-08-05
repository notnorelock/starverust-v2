import { createServiceKey, type ServiceKey } from '@starve/shared';
import type { WebGLCanvasProvider } from '../../engine/render/WebGLCanvasProvider';
import type { Camera2D } from '../../engine/camera/Camera2D';
import type { NetworkClient } from '../../engine/network/NetworkClient';

export const CANVAS_PROVIDER: ServiceKey<WebGLCanvasProvider> =
  createServiceKey<WebGLCanvasProvider>('WebGLCanvasProvider');
export const CAMERA_SERVICE: ServiceKey<Camera2D> = createServiceKey<Camera2D>('Camera2D');
export const NETWORK_CLIENT: ServiceKey<NetworkClient> = createServiceKey<NetworkClient>('NetworkClient');
