import { System, PositionComponent, EntityType, type ComponentType, type World } from '@starve/shared';
import type { WebGLCanvasProvider } from '../../../engine/render/WebGLCanvasProvider';
import type { SpriteRenderer } from '../../../engine/render/SpriteRenderer';
import type { ColorQuadRenderer } from '../../../engine/render/ColorQuadRenderer';
import type { Camera2D } from '../../../engine/camera/Camera2D';
import type { MouseInputSource } from '../../../engine/input/MouseInputSource';
import { RenderableComponent } from '../../../engine/ecs/components/RenderableComponent';
import { InterpolationComponent } from '../../../engine/ecs/components/InterpolationComponent';
import { snapshotBuffer } from '../../network/SnapshotBuffer';
import { entityTypeRegistry } from '../../network/EntityTypeRegistry';
import { localPlayer } from '../../core/LocalPlayerDataStore';
import { chatBubbleStore } from '../../network/ChatBubbleStore';
import type { EntityRenderer } from '../../../engine/render/renderers/EntityRenderer';

const DEBUG_LAG_LINE_COLOR: readonly [number, number, number, number] = [1, 0.23, 0.23, 1];
const DEBUG_LAG_LINE_THICKNESS = 2;
const DEBUG_LAG_LINE_DOT_SIZE = 6;

/**
 * The client's only onUpdate-implementing system: runs every rAF frame (variable rate),
 * independent of the server's fixed tick. Reads chase-and-snap smoothed positions from
 * SnapshotBuffer, writes them into each entity's InterpolationComponent, then dispatches
 * each RenderableComponent entity's actual drawing to an EntityRenderer chosen by that
 * entity's EntityType (see the `renderers` map passed to the constructor and
 * `rendererFor()`) — this system owns the per-frame loop, camera-follow, and interpolation
 * bookkeeping, not entity-specific drawing code, which lives in the renderer classes
 * themselves (see PlayerRenderer).
 *
 * The local player's own facing angle is drawn from MouseInputSource.sample() rather
 * than SnapshotBuffer's network-interpolated angle (see draw() below) — remote players
 * only ever have a broadcast angle to work with, which is why SnapshotBuffer's
 * chase-and-turn interpolation exists at all (see that class's own doc comment), but the
 * local player's real angle is already known instantly and exactly from the live mouse
 * position; routing it through a network round-trip plus interpolation would only add
 * lag with no benefit, the same reasoning that exempted the local entity's *position* from
 * interpolation delay earlier in this project.
 *
 * ChatBubbleStore is advanced here too (chatBubbles.advance(dt)) for the same reason
 * SnapshotBuffer/Camera2D are — it's per-frame animation timing, and PlayerRenderer reads
 * its current state during the draw() pass immediately below.
 *
 * Rendering is WebGL-only (see WebGLCanvasProvider) — this system drives both the textured
 * (SpriteRenderer) and flat-color (ColorQuadRenderer) draw pipelines, calling beginFrame()
 * on each once per frame, since both share the same single canvas/viewport but are two
 * independent shader programs (see ColorQuadRenderer's own doc comment for why they're
 * separate programs rather than one branching shader). `sprites` is the SAME instance
 * PlayerRenderer (and any other EntityRenderer) draws through — see ClientBootstrap, which
 * constructs exactly one SpriteRenderer/ColorQuadRenderer per canvas and passes it to both
 * this system and every renderer. A second SpriteRenderer instance would compile its own
 * separate GL program; since ShaderProgram's uniform locations are only valid against the
 * program they were queried from, a renderer holding one SpriteRenderer while this system's
 * beginFrame() bound a *different* SpriteRenderer's program produces
 * "uniform location is not from the associated program" WebGL errors — sharing the
 * instance is what keeps every draw() call, wherever it's issued, targeting the one
 * currently-bound program.
 */
export class RenderSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [RenderableComponent];

  constructor(
    private readonly canvasProvider: WebGLCanvasProvider,
    private readonly camera: Camera2D,
    private readonly renderers: ReadonlyMap<EntityType, EntityRenderer>,
    private readonly mouseInput: MouseInputSource,
    private readonly sprites: SpriteRenderer,
    private readonly colorQuads: ColorQuadRenderer,
  ) {
    super();
  }

  override onUpdate(dt: number, world: World): void {
    const sampled = snapshotBuffer().sample(dt);

    for (const sample of sampled) {
      this.ensureInterpolatedEntity(world, sample.entityId, sample.x, sample.y, sample.angle);
    }

    const localPosition = sampled.find((s) => s.entityId === localPlayer().entityId);
    if (localPosition) {
      this.camera.follow(localPosition.x, localPosition.y);
    }
    this.camera.update(dt);
    chatBubbleStore().advance(dt);

    this.draw(world);
  }

  private ensureInterpolatedEntity(world: World, entityId: number, x: number, y: number, angle: number): void {
    if (!world.entities.isAlive(entityId)) {
      // First time this server-assigned entityId is seen on the client — mirror it
      // into the client's own EntityRegistry rather than requiring a local createEntity()
      // call, since the client never mints these ids itself.
      world.entities.ensureEntity(entityId);
    }

    let interpolation = world.entities.getComponent(entityId, InterpolationComponent);
    if (!interpolation) {
      interpolation = world.entities.addComponent(
        entityId,
        InterpolationComponent,
        new InterpolationComponent(entityId, x, y, angle),
      );
    }
    interpolation.x = x;
    interpolation.y = y;
    interpolation.angle = angle;

    if (!world.entities.hasComponent(entityId, RenderableComponent)) {
      const isLocalPlayer = entityId === localPlayer().entityId;
      world.entities.addComponent(entityId, RenderableComponent, new RenderableComponent(entityId, { isLocalPlayer }));
    }
  }

  private draw(world: World): void {
    const { width, height } = this.canvasProvider.canvas;
    this.sprites.beginFrame(width, height);

    for (const entityId of world.entities.query(RenderableComponent)) {
      const renderable = world.entities.getComponent(entityId, RenderableComponent);
      const interpolation =
        world.entities.getComponent(entityId, InterpolationComponent) ??
        world.entities.getComponent(entityId, PositionComponent);
      if (!renderable || !interpolation) {
        continue;
      }

      const screen = this.camera.worldToScreen(interpolation.x, interpolation.y);

      let angle = interpolation instanceof InterpolationComponent ? interpolation.angle : 0;
      if (renderable.isLocalPlayer) {
        // screenPosition must be current before sampling the angle — MouseInputSource
        // computes it from this exact value (see that class's own doc comment).
        localPlayer().screenPosition = screen;
        angle = this.mouseInput.sample();
      }

      const entityRenderer = this.rendererFor(entityId);
      entityRenderer?.draw({ entityId, screen, angle, isLocalPlayer: renderable.isLocalPlayer });
    }

    // Debug lag lines draw in a second pass (a separate shader program/beginFrame — see
    // ColorQuadRenderer's own doc comment) after every entity's sprite/text, so they
    // overlay on top rather than being interleaved with — and potentially hidden behind —
    // per-entity draws above.
    this.colorQuads.beginFrame(width, height);
    for (const entityId of world.entities.query(RenderableComponent)) {
      const interpolation = world.entities.getComponent(entityId, InterpolationComponent);
      if (interpolation) {
        this.drawDebugLagLine(entityId, this.camera.worldToScreen(interpolation.x, interpolation.y));
      }
    }
  }

  private rendererFor(entityId: number): EntityRenderer | undefined {
    return this.renderers.get(entityTypeRegistry().get(entityId));
  }

  /**
   * DEBUG ONLY — draws a line from the raw last-received-snapshot position to the entity's
   * current smoothed render position, for every entity (not just local). Its length is a
   * direct visualization of how far the chase-and-snap smoothing (see SnapshotBuffer) is
   * currently lagging behind the latest network data: it stretches out the instant a new
   * snapshot arrives and shrinks back to a point once the render position has caught up.
   * Remove once movement smoothing is confirmed to look right.
   */
  private drawDebugLagLine(entityId: number, renderScreen: { x: number; y: number }): void {
    const raw = snapshotBuffer().latestRawPosition(entityId);
    if (!raw) {
      return;
    }

    const rawScreen = this.camera.worldToScreen(raw.x, raw.y);

    this.colorQuads.drawLine(rawScreen.x, rawScreen.y, renderScreen.x, renderScreen.y, DEBUG_LAG_LINE_THICKNESS, DEBUG_LAG_LINE_COLOR);
    this.colorQuads.draw({
      x: rawScreen.x - DEBUG_LAG_LINE_DOT_SIZE / 2,
      y: rawScreen.y - DEBUG_LAG_LINE_DOT_SIZE / 2,
      width: DEBUG_LAG_LINE_DOT_SIZE,
      height: DEBUG_LAG_LINE_DOT_SIZE,
      color: DEBUG_LAG_LINE_COLOR,
    });
  }
}
