import { Logger, type World } from '@starve/shared';
import { encodePlayerInput } from '@starve/protocol';
import type { NetworkClient } from '../network/NetworkClient';
import type { KeyboardInputSource } from '../input/KeyboardInputSource';
import type { DebugOverlay } from '../debug/DebugOverlay';
import type { SnapshotBuffer } from '../network/SnapshotBuffer';
import { ClientClock } from './ClientClock';

const logger = new Logger('GameClient');

/**
 * Composition root for the browser client: owns the render loop (requestAnimationFrame,
 * variable rate) and reacts to input changes as they happen. Input is event-driven, not
 * sent on a fixed timer — a PlayerInputPacket goes out only when the held-key bitmask
 * actually changes (see KeyboardInputSource.onDirectionChange), since there's nothing new
 * to tell the server between key transitions and a fixed-rate resend would just be wasted
 * bandwidth. This is a distinct concern from client-side prediction/reconciliation (not
 * implemented yet) — that would still hook in between input sampling and rendering.
 */
export class GameClient {
  private readonly clock = new ClientClock();
  private inputSequence = 0;
  private lastServerTick = 0;
  private fps = 0;
  private fpsAccumulator = 0;
  private fpsWindowStart = 0;
  private animationFrameHandle: number | undefined;
  private unsubscribeInput: (() => void) | undefined;

  constructor(
    private readonly world: World,
    private readonly networkClient: NetworkClient,
    private readonly inputSource: KeyboardInputSource,
    private readonly snapshotBuffer: SnapshotBuffer,
    private readonly debugOverlay: DebugOverlay,
  ) {}

  start(): void {
    this.world.init();
    this.inputSource.attach();
    this.networkClient.connect();

    this.unsubscribeInput = this.inputSource.onDirectionChange((direction) => this.sendInput(direction));

    this.fpsWindowStart = performance.now();
    this.animationFrameHandle = requestAnimationFrame((t) => this.frame(t));

    logger.info('Client started');
  }

  stop(): void {
    if (this.animationFrameHandle !== undefined) {
      cancelAnimationFrame(this.animationFrameHandle);
    }
    this.unsubscribeInput?.();
  }

  onServerTick(tick: number): void {
    this.lastServerTick = tick;
  }

  private sendInput(direction: number): void {
    if (!this.networkClient.isConnected) {
      return;
    }
    const buffer = encodePlayerInput({
      tick: this.inputSequence,
      direction,
      sequence: this.inputSequence,
    });
    this.inputSequence = (this.inputSequence + 1) % 0xffff;
    this.networkClient.send(buffer);
  }

  private frame(now: number): void {
    const dt = this.clock.tick(now);
    this.world.update(dt);
    this.trackFps(now);

    this.debugOverlay.update({
      fps: this.fps,
      serverTick: this.lastServerTick,
      pingMs: 0,
      entityCount: this.snapshotBuffer.sample(0).length,
    });

    this.animationFrameHandle = requestAnimationFrame((t) => this.frame(t));
  }

  private trackFps(now: number): void {
    this.fpsAccumulator += 1;
    if (now - this.fpsWindowStart >= 500) {
      this.fps = (this.fpsAccumulator * 1000) / (now - this.fpsWindowStart);
      this.fpsAccumulator = 0;
      this.fpsWindowStart = now;
    }
  }
}
