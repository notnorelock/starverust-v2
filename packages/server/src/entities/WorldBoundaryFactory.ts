import {
  PositionComponent,
  PhysicsBodyComponent,
  RectColliderComponent,
  EntityTypeComponent,
  EntityType,
  CollisionLayer,
  ALL_LAYERS,
  World,
  type WorldBounds,
} from '@starve/shared';

/**
 * Thickness of the four boundary walls, in world units — arbitrary but must be nonzero;
 * a zero-thickness rect collider would let a fast-moving entity's CCD sweep pass through
 * it between sub-steps. Walls extend outward from the bounds rectangle rather than
 * inward, so the playable area itself is exactly WorldBounds, not shrunk by the wall.
 */
const WALL_THICKNESS = 10;

/**
 * Creates four static RectColliderComponent walls around the outer edge of the world, on
 * the World collision layer — this is what keeps every entity inside WorldBounds now,
 * replacing the old WorldBoundsSystem's manual per-tick clamp. World edges are just
 * ordinary static collision geometry as far as CollisionSystem is concerned: they get
 * pushed against and slid along exactly like any other static RectColliderComponent, no
 * separate clamping pass needed. Called once at server startup (see GameServer), not
 * per-connection — the boundary is shared world geometry, not per-player state.
 */
export function createWorldBoundaryWalls(world: World, bounds: WorldBounds): void {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  createWall(world, centerX, bounds.minY - WALL_THICKNESS / 2, width + WALL_THICKNESS * 2, WALL_THICKNESS); // top
  createWall(world, centerX, bounds.maxY + WALL_THICKNESS / 2, width + WALL_THICKNESS * 2, WALL_THICKNESS); // bottom
  createWall(world, bounds.minX - WALL_THICKNESS / 2, centerY, WALL_THICKNESS, height + WALL_THICKNESS * 2); // left
  createWall(world, bounds.maxX + WALL_THICKNESS / 2, centerY, WALL_THICKNESS, height + WALL_THICKNESS * 2); // right
}

function createWall(world: World, x: number, y: number, width: number, height: number): void {
  const entity = world.entities.createEntity();
  world.entities.addComponent(entity.id, PositionComponent, new PositionComponent(entity.id, x, y));
  world.entities.addComponent(
    entity.id,
    PhysicsBodyComponent,
    new PhysicsBodyComponent(entity.id, { bodyType: 'static', initialX: x, initialY: y }),
  );
  world.entities.addComponent(
    entity.id,
    RectColliderComponent,
    new RectColliderComponent(entity.id, width, height, { layer: CollisionLayer.World, collidesWith: ALL_LAYERS }),
  );
  world.entities.addComponent(
    entity.id,
    EntityTypeComponent,
    new EntityTypeComponent(entity.id, EntityType.WorldGeometry),
  );
}
