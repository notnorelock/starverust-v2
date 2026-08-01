import { Opcode } from '@starve/protocol';
import { createClientWorld } from '../world/ClientWorldFactory';
import { CanvasContext2DProvider } from '../render/CanvasContext2DProvider';
import { Renderer } from '../render/Renderer';
import { RenderSystem } from '../render/systems/RenderSystem';
import { Camera2D } from '../camera/Camera2D';
import { SnapshotBuffer } from '../network/SnapshotBuffer';
import { NetworkClient } from '../network/NetworkClient';
import { PacketHandlerRegistry } from '../network/PacketHandlerRegistry';
import { KeyboardInputSource } from '../input/KeyboardInputSource';
import { DebugOverlay } from '../debug/DebugOverlay';
import { GameClient } from '../core/GameClient';
import { CANVAS_PROVIDER, CAMERA_SERVICE, SNAPSHOT_BUFFER, NETWORK_CLIENT } from '../core/ServiceKeys';

function resolveWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8081`;
}

export function bootstrapClient(mountPoint: HTMLElement): GameClient {
  const world = createClientWorld();

  const canvasProvider = new CanvasContext2DProvider(mountPoint);
  const renderer = new Renderer(canvasProvider);
  const camera = new Camera2D(window.innerWidth, window.innerHeight);
  const snapshotBuffer = new SnapshotBuffer();

  world.services.register(CANVAS_PROVIDER, canvasProvider);
  world.services.register(CAMERA_SERVICE, camera);
  world.services.register(SNAPSHOT_BUFFER, snapshotBuffer);

  const renderSystem = new RenderSystem(canvasProvider, renderer, camera, snapshotBuffer);
  world.registerSystem(renderSystem);

  const handlers = new PacketHandlerRegistry();
  const networkClient = new NetworkClient({ url: resolveWebSocketUrl(), handlers });
  world.services.register(NETWORK_CLIENT, networkClient);

  const inputSource = new KeyboardInputSource();
  const debugOverlay = new DebugOverlay(mountPoint);

  const gameClient = new GameClient(world, networkClient, inputSource, snapshotBuffer, debugOverlay);

  handlers.on(Opcode.Handshake, (packet) => {
    renderSystem.localEntityId = packet.assignedEntityId;
    camera.setBounds({
      minX: packet.worldMinX,
      maxX: packet.worldMaxX,
      minY: packet.worldMinY,
      maxY: packet.worldMaxY,
    });
  });

  handlers.on(Opcode.WorldSnapshot, (packet) => {
    snapshotBuffer.push(packet);
    gameClient.onServerTick(packet.serverTick);
  });

  return gameClient;
}
