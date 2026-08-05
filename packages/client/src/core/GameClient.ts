import { Logger, type World } from '@starve/shared';
import { encodePlayerInput, encodePlayerAngle, encodePing, encodeChatMessage } from '@starve/protocol';
import type { NetworkClient } from '../network/NetworkClient';
import { keyboardInputSource } from '../input/KeyboardInputSource';
import { mouseInput } from '../input/MouseInputSource';
import type { DebugOverlay } from '../debug/DebugOverlay';
import { snapshotBuffer } from '../network/SnapshotBuffer';
import { chatBubbleStore } from '../network/ChatBubbleStore';
import { localPlayer } from './LocalPlayerDataStore';
import { ClientClock } from './ClientClock';
import { FrameStatsTracker } from './FrameStatsTracker';

const logger = new Logger('GameClient');

/** How often a PingPacket is sent to measure round-trip latency — see sendPing()/onPong(). */
const PING_INTERVAL_MS = 5000;

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
 * angle) is different: MouseInputSource.poll(dt), called once per frame below, throttles
 * both how often it re-samples and how often it can emit to a fixed ~200ms cadence (see
 * that class's own doc comment for why). The two are sent as entirely separate packets on
 * entirely independent schedules (see PlayerAnglePacket's own doc comment for why they're
 * split rather than one combined packet).
 */
export class GameClient {
  private readonly clock = new ClientClock();
  private readonly stats: FrameStatsTracker;
  private inputSequence = 0;
  private lastServerTick = 0;
  private animationFrameHandle: number | undefined;
  private unsubscribeDirection: (() => void) | undefined;
  private unsubscribeAngle: (() => void) | undefined;
  private pingIntervalHandle: ReturnType<typeof setInterval> | undefined;
  private pingMs: number | undefined;

  constructor(
    private readonly world: World,
    private readonly networkClient: NetworkClient,
    private readonly debugOverlay: DebugOverlay,
  ) {
    this.stats = new FrameStatsTracker(this.networkClient);
  }

  /** Starts local simulation/rendering/input only — no network. Safe to call before a nickname exists. */
  start(): void {
    this.world.init();
    keyboardInputSource().attach();
    mouseInput().attach();

    this.unsubscribeDirection = keyboardInputSource().onChange((direction) => this.sendDirection(direction));
    this.unsubscribeAngle = mouseInput().onChange((angle) => this.sendAngle(angle));

    this.stats.reset(performance.now());
    this.animationFrameHandle = requestAnimationFrame((t) => this.frame(t));

    // sendPing() itself no-ops while disconnected (same guard as sendDirection/sendAngle),
    // so it's safe to start this interval immediately rather than waiting for connect().
    this.pingIntervalHandle = setInterval(() => this.sendPing(), PING_INTERVAL_MS);

    logger.info('Client started');
  }

  stop(): void {
    if (this.animationFrameHandle !== undefined) {
      cancelAnimationFrame(this.animationFrameHandle);
    }
    if (this.pingIntervalHandle !== undefined) {
      clearInterval(this.pingIntervalHandle);
    }
    this.unsubscribeDirection?.();
    this.unsubscribeAngle?.();
  }

  onServerTick(tick: number): void {
    this.lastServerTick = tick;
  }

  /** Registered by ClientBootstrap against Opcode.Pong — see sendPing()'s own doc comment. */
  onPong(clientSendTime: number): void {
    this.pingMs = performance.now() - clientSendTime;
  }

  /**
   * Called by ChatBox (see @starve/ui) whenever its open/closed state changes — ported from
   * the reference client's `user.chat.open` flag gating movement sampling (see
   * client-old.js's `if (user.chat.open) return;` early-return in its move-update code).
   * This project implements the same effect at the source instead (see
   * KeyboardInputSource.setEnabled's own doc comment for why): disabling movement key
   * capture while chat is open means WASD typed as chat text never reaches the movement
   * system, and any keys already held when chat opens are released immediately (a synthetic
   * "stop" is sent) rather than the player continuing to walk on the server until they
   * happen to release the key mid-conversation.
   */
  setChatOpen(open: boolean): void {
    keyboardInputSource().setEnabled(!open);
  }

  /**
   * Sends `text` as a ChatMessagePacket and immediately echoes it as a bubble above the
   * local player's own entity — mirroring the reference client's `send_chat()`, which pushes
   * the message onto the sender's own bubble queue synchronously rather than waiting for the
   * server's broadcast to round-trip back (see ClientBootstrap's ChatBroadcast handler,
   * which explicitly skips re-pushing a bubble for packets carrying the local player's own
   * pid, for exactly this reason — this local echo is the only place that entity's own sent
   * messages get queued).
   */
  sendChatMessage(text: string): void {
    if (!this.networkClient.isConnected) {
      return;
    }
    this.networkClient.send(encodeChatMessage({ text }));
    const entityId = localPlayer().entityId;
    if (entityId !== undefined) {
      chatBubbleStore().push(entityId, text);
    }
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

  /**
   * Fired every PING_INTERVAL_MS (5s) by the interval started in start(). Carries
   * performance.now() as an opaque timestamp the server echoes back verbatim in the
   * matching PongPacket (see onPong()) — this is purely round-trip latency measurement,
   * not gameplay state, so it's on its own fixed timer rather than piggybacking on any
   * existing event-driven send (unlike PlayerInput/PlayerAngle, there's no "change" to
   * wait for here).
   */
  private sendPing(): void {
    if (!this.networkClient.isConnected) {
      return;
    }
    this.networkClient.send(encodePing({ clientSendTime: performance.now() }));
  }

  private frame(now: number): void {
    const dt = this.clock.tick(now);
    this.world.update(dt);
    mouseInput().poll(dt);
    this.stats.recordFrame(now);

    // dt=0: this is a read-only re-sample for the debug overlay after RenderSystem (part
    // of world.update() above) already advanced the real chase-and-snap for this frame —
    // see SnapshotBuffer.sample()'s own doc comment; a zero step is a no-op on top of that.
    const sampled = snapshotBuffer().sample(0);
    const localPlayerPosition = sampled.find((s) => s.entityId === localPlayer().entityId);

    this.debugOverlay.update({
      ...this.stats.stats(),
      serverTick: this.lastServerTick,
      pingMs: this.pingMs,
      entityCount: sampled.length,
      // Debug-only: shows the local player's world position so camera behavior (follow,
      // easing, bounds clamping) can be sanity-checked directly against a number instead
      // of eyeballing the canvas. Undefined until Handshake assigns localPlayer.entityId
      // and at least one snapshot has arrived for it.
      playerPosition: localPlayerPosition ? { x: localPlayerPosition.x, y: localPlayerPosition.y } : undefined,
    });

    this.animationFrameHandle = requestAnimationFrame((t) => this.frame(t));
  }
}
