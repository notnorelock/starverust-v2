import { System, PositionComponent, INTERPOLATION_DELAY_TICKS, DEFAULT_TICK_RATE, type ComponentType, type World } from '@starve/shared';
import type { CanvasContext2DProvider } from '../CanvasContext2DProvider';
import type { Renderer } from '../Renderer';
import type { Camera2D } from '../../camera/Camera2D';
import type { SnapshotBuffer } from '../../network/SnapshotBuffer';
import { RenderableComponent } from '../../ecs/components/RenderableComponent';
import { InterpolationComponent } from '../../ecs/components/InterpolationComponent';

const INTERPOLATION_DELAY_MS = (INTERPOLATION_DELAY_TICKS / DEFAULT_TICK_RATE) * 1000;

/**
 * The client's only onUpdate-implementing system: runs every rAF frame (variable rate),
 * independent of the server's fixed tick. Reads interpolated positions from SnapshotBuffer,
 * writes them into each entity's InterpolationComponent, then draws RenderableComponent
 * entities via raw CanvasRenderingContext2D.
 */
export class RenderSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [RenderableComponent];
  localEntityId: number | undefined;

  constructor(
    private readonly canvasProvider: CanvasContext2DProvider,
    private readonly renderer: Renderer,
    private readonly camera: Camera2D,
    private readonly snapshotBuffer: SnapshotBuffer,
  ) {
    super();
  }

  override onUpdate(dt: number, world: World): void {
    const sampled = this.snapshotBuffer.sample(INTERPOLATION_DELAY_MS, this.localEntityId);

    for (const sample of sampled) {
      this.ensureInterpolatedEntity(world, sample.entityId, sample.x, sample.y);
    }

    const localPosition = sampled.find((s) => s.entityId === this.localEntityId);
    if (localPosition) {
      this.camera.follow(localPosition.x, localPosition.y);
    }
    this.camera.update(dt);

    this.draw(world);
  }

  private ensureInterpolatedEntity(world: World, entityId: number, x: number, y: number): void {
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
        new InterpolationComponent(entityId, x, y),
      );
    }
    interpolation.x = x;
    interpolation.y = y;

    if (!world.entities.hasComponent(entityId, RenderableComponent)) {
      world.entities.addComponent(
        entityId,
        RenderableComponent,
        new RenderableComponent(entityId, {
          color: entityId === this.localEntityId ? '#7cffb2' : '#ff8a7c',
          isLocalPlayer: entityId === this.localEntityId,
        }),
      );
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

      context.beginPath();
      context.fillStyle = renderable.color;
      context.arc(screen.x, screen.y, renderable.radius, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }
}
