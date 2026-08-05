import { System, PositionComponent, EntityType, type ComponentType, type World } from '@starve/shared';
import type { CanvasContext2DProvider } from '../../../engine/render/CanvasContext2DProvider';
import type { Renderer } from '../../../engine/render/Renderer';
import type { Camera2D } from '../../../engine/camera/Camera2D';
import type { MouseInputSource } from '../../../engine/input/MouseInputSource';
import { RenderableComponent } from '../../../engine/ecs/components/RenderableComponent';
import { InterpolationComponent } from '../../../engine/ecs/components/InterpolationComponent';
import { snapshotBuffer } from '../../network/SnapshotBuffer';
import { entityTypeRegistry } from '../../network/EntityTypeRegistry';
import { localPlayer } from '../../core/LocalPlayerDataStore';
import { chatBubbleStore } from '../../network/ChatBubbleStore';
import type { EntityRenderer } from '../../../engine/render/renderers/EntityRenderer';

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
 */
export class RenderSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [RenderableComponent];

  constructor(
    private readonly canvasProvider: CanvasContext2DProvider,
    private readonly renderer: Renderer,
    private readonly camera: Camera2D,
    private readonly renderers: ReadonlyMap<EntityType, EntityRenderer>,
    private readonly mouseInput: MouseInputSource,
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
    const { context } = this.canvasProvider;
    this.renderer.clear();

    context.save();

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

      this.drawDebugLagLine(entityId, screen);
    }

    context.restore();
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

    const { context } = this.canvasProvider;
    const rawScreen = this.camera.worldToScreen(raw.x, raw.y);

    context.beginPath();
    context.strokeStyle = '#ff3b3b';
    context.lineWidth = 2;
    context.moveTo(rawScreen.x, rawScreen.y);
    context.lineTo(renderScreen.x, renderScreen.y);
    context.stroke();

    context.beginPath();
    context.fillStyle = '#ff3b3b';
    context.arc(rawScreen.x, rawScreen.y, 3, 0, Math.PI * 2);
    context.fill();
  }
}
