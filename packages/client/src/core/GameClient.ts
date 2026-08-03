import { Logger, type World } from '@starve/shared';
import { encodePlayerInput, encodePlayerAngle } from '@starve/protocol';
import type { NetworkClient } from '../network/NetworkClient';
import type { KeyboardInputSource } from '../input/KeyboardInputSource';
import type { MouseAngleInputSource } from '../input/MouseAngleInputSource';
import type { DebugOverlay } from '../debug/DebugOverlay';
import type { SnapshotBuffer } from '../network/SnapshotBuffer';
import type { LocalPlayerDataStore } from './LocalPlayerDataStore';
import { ClientClock } from './ClientClock';

const logger = new Logger('GameClient');

/**
 * Composition root for the browser client: owns the render loop (requestAnimationFrame,
 * variable rate) and reacts to input changes as they happen.
 *
 * start() deliberately never touches the network — it only initializes local state
 * (World.init(), input source attachment, the render loop) — so the canvas can render (an
 * empty world; the camera just sits wherever Camera2D defaults to until a real Handshake
 * arrives) the instant the page loads, before the welcome overlay has even collected a
 * nickname. Actually opening the WebSocket and sending HelloPacket is a separate step (see
 * ClientBootstrap's connect() — it owns NetworkClient construction and the Handshake/
 * ConnectionRejected handlers, so it's the natural place for this rather than GameClient),
 * called later once the player submits the overlay. A rejected/failed connection attempt
 * never needs to tear down and rebuild the whole render stack this way, only the
 * connection itself.
 *
 * PlayerInputPacket (movement-key direction, via KeyboardInputSource) is purely
 * event-driven — it goes out only when the held-key bitmask changes, since there's nothing
 * new to tell the server between key transitions. PlayerAnglePacket (mouse-driven aim
 * angle) is different: MouseAngleInputSource.poll(dt), called once per frame below,
 * throttles both how often it re-samples and how often it can emit to a fixed ~200ms
 * cadence (see that class's own doc comment for why). The two are sent as entirely
 * separate packets on entirely independent schedules (see PlayerAnglePacket's own doc
 * comment for why they're split rather than one combined packet).
 */
export class GameClient {
  private readonly clock = new ClientClock();
  private inputSequence = 0;
  private lastServerTick = 0;
  private fps = 0;
  private fpsAccumulator = 0;
  private fpsWindowStart = 0;
  private animationFrameHandle: number | undefined;
  private unsubscribeDirection: (() => void) | undefined;
  private unsubscribeAngle: (() => void) | undefined;

  constructor(
    private readonly world: World,
    private readonly networkClient: NetworkClient,
    private readonly keyboardInput: KeyboardInputSource,
    private readonly mouseAngleInput: MouseAngleInputSource,
    private readonly snapshotBuffer: SnapshotBuffer,
    private readonly debugOverlay: DebugOverlay,
    private readonly localPlayer: LocalPlayerDataStore,
  ) {}

  /** Starts local simulation/rendering/input only — no network. Safe to call before a nickname exists. */
  start(): void {
    this.world.init();
    this.keyboardInput.attach();
    this.mouseAngleInput.attach();

    this.unsubscribeDirection = this.keyboardInput.onChange((direction) => this.sendDirection(direction));
    this.unsubscribeAngle = this.mouseAngleInput.onChange((angle) => this.sendAngle(angle));

    this.fpsWindowStart = performance.now();
    this.animationFrameHandle = requestAnimationFrame((t) => this.frame(t));

    logger.info('Client started');
  }

  stop(): void {
    if (this.animationFrameHandle !== undefined) {
      cancelAnimationFrame(this.animationFrameHandle);
    }
    this.unsubscribeDirection?.();
    this.unsubscribeAngle?.();
  }

  onServerTick(tick: number): void {
    this.lastServerTick = tick;
  }

  private sendDirection(direction: number): void {
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

  private sendAngle(angle: number): void {
    if (!this.networkClient.isConnected) {
      return;
    }
    this.networkClient.send(encodePlayerAngle({ angle }));
  }

  private frame(now: number): void {
    const dt = this.clock.tick(now);
    this.world.update(dt);
    this.mouseAngleInput.poll(dt);
    this.trackFps(now);

    // dt=0: this is a read-only re-sample for the debug overlay after RenderSystem (part
    // of world.update() above) already advanced the real chase-and-snap for this frame —
    // see SnapshotBuffer.sample()'s own doc comment; a zero step is a no-op on top of that.
    const sampled = this.snapshotBuffer.sample(0);
    const localPlayerPosition = sampled.find((s) => s.entityId === this.localPlayer.entityId);

    this.debugOverlay.update({
      fps: this.fps,
      serverTick: this.lastServerTick,
      pingMs: 0,
      entityCount: sampled.length,
      // Debug-only: shows the local player's world position so camera behavior (follow,
      // easing, bounds clamping) can be sanity-checked directly against a number instead
      // of eyeballing the canvas. Undefined until Handshake assigns localPlayer.entityId
      // and at least one snapshot has arrived for it.
      playerPosition: localPlayerPosition ? { x: localPlayerPosition.x, y: localPlayerPosition.y } : undefined,
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
