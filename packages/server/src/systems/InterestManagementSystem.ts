import {
  System,
  PositionComponent,
  RenderPositionComponent,
  VelocityComponent,
  AimComponent,
  SpatialHashGrid,
  type ComponentType,
  type World,
  type EntityId,
} from '@starve/shared';
import { encodeEntityUpdate, type EntitySnapshot } from '@starve/protocol';
import type { ConnectionRegistry } from '../network/ConnectionRegistry';

/**
 * Radius (world units) around a connection's own player within which other dynamic
 * entities are included in that connection's EntityUpdatePacket each tick. Arbitrary but
 * generous relative to PLAYER_MOVE_SPEED/PLAYER_SPRINT_SPEED — entities shouldn't visibly
 * pop in right at the camera's edge, and this stage has no client-side viewport size to
 * size it against precisely (that's a client concern the server doesn't know).
 */
const INTEREST_RADIUS = 800;

/**
 * Grid cell size for the interest query — independent of CollisionSystem's own
 * SpatialHashGrid instance (different cell size, different purpose): this one only needs
 * to answer "what's near this point," not narrowphase-pair broadphase, and is rebuilt
 * fresh each tick from every dynamic entity's current position.
 */
const INTEREST_CELL_SIZE = 100;

/**
 * Pipeline step 11-12 (Networking/Snapshot): replaces the old broadcast-everything-to-
 * everyone SnapshotBroadcastSystem. Builds one SpatialHashGrid per tick from every dynamic
 * (VelocityComponent-bearing) entity's current position, then for each connection with an
 * assigned entity, queries entities within INTEREST_RADIUS of that connection's own player
 * and unicasts an EntityUpdatePacket containing only those — never a single shared frame
 * reused across every connection, since each connection's nearby set is different by
 * construction. Static/non-moving entities (world geometry) are never included: they were
 * already sent once via EntityInsertPacket at creation/connection time and never change,
 * so re-sending them every tick would be pure waste for something that can't move.
 */
export class InterestManagementSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [PositionComponent, VelocityComponent];
  private readonly grid = new SpatialHashGrid(INTEREST_CELL_SIZE);
  private tickCounter = 0;

  constructor(private readonly connections: ConnectionRegistry) {
    super();
  }

  override onFixedUpdate(_fixedDt: number, world: World): void {
    this.grid.clear();

    const dynamicEntities = [...world.entities.query(PositionComponent, VelocityComponent)];
    for (const entityId of dynamicEntities) {
      const position = renderPositionOf(world, entityId);
      if (!position) {
        continue;
      }
      this.grid.insert(entityId, position.x, position.y, position.x, position.y);
    }

    for (const connection of this.connections.all()) {
      if (connection.entityId === undefined) {
        continue;
      }
      const center = renderPositionOf(world, connection.entityId);
      if (!center) {
        continue;
      }

      const nearbyIds = this.grid.queryRegion(
        center.x - INTEREST_RADIUS,
        center.y - INTEREST_RADIUS,
        center.x + INTEREST_RADIUS,
        center.y + INTEREST_RADIUS,
      );

      const entities: EntitySnapshot[] = [];
      for (const entityId of nearbyIds) {
        const position = renderPositionOf(world, entityId);
        if (!position) {
          continue;
        }
        const dx = position.x - center.x;
        const dy = position.y - center.y;
        if (dx * dx + dy * dy > INTEREST_RADIUS * INTEREST_RADIUS) {
          continue; // queryRegion is an AABB test; narrow it to the actual circular radius.
        }
        const velocity = world.entities.getComponent(entityId, VelocityComponent)!;
        const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
        const angle = world.entities.getComponent(entityId, AimComponent)?.angle ?? 0;
        entities.push({ entityId, x: position.x, y: position.y, speed, angle });
      }

      connection.send(encodeEntityUpdate({ serverTick: this.tickCounter, entities }));
    }

    this.tickCounter += 1;
  }
}

function renderPositionOf(world: World, entityId: EntityId): { x: number; y: number } | undefined {
  const renderPosition = world.entities.getComponent(entityId, RenderPositionComponent);
  if (renderPosition) {
    return renderPosition;
  }
  return world.entities.getComponent(entityId, PositionComponent);
}
