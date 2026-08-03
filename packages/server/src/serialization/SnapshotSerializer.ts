import {
  PositionComponent,
  RenderPositionComponent,
  VelocityComponent,
  EntityTypeComponent,
  EntityType,
  type World,
} from '@starve/shared';
import { encodeWorldSnapshot, type WorldSnapshotEntity } from '@starve/protocol';

/**
 * Bridges the ECS World and the wire protocol: gathers every positioned entity into a
 * snapshot. Broadcasts RenderPositionComponent (the smoothed, broadcast-facing position
 * PositionSmoothingSystem maintains) when an entity has one, falling back to the raw
 * PositionComponent target for entities that don't (e.g. static world geometry, which
 * PositionSmoothingSystem doesn't touch) — see PositionSmoothingSystem/MovementSystem for
 * why these are two different values for moving entities.
 *
 * Also broadcasts each entity's current speed (VelocityComponent's magnitude, 0 for
 * entities with none — e.g. static world geometry) so clients can chase this entity's
 * render position at the same speed it's actually moving at (e.g. PLAYER_SPRINT_SPEED
 * while sprinting) instead of assuming a fixed constant — see SnapshotBuffer — and each
 * entity's EntityTypeComponent (falling back to EntityType.Player if somehow absent, same
 * default the wire format itself uses), so this one-time catch-up packet is self-contained
 * and a newly-connected client doesn't depend on the separate EntityInsertPacket catch-up
 * loop (see PlayerSession.onConnectionEstablished) having already run first.
 */
export function serializeWorldSnapshot(world: World, serverTick: number): ArrayBuffer {
  const entities: WorldSnapshotEntity[] = [];

  for (const entityId of world.entities.query(PositionComponent)) {
    const velocity = world.entities.getComponent(entityId, VelocityComponent);
    const speed = velocity ? Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy) : 0;
    const entityType = world.entities.getComponent(entityId, EntityTypeComponent)?.entityType ?? EntityType.Player;

    const renderPosition = world.entities.getComponent(entityId, RenderPositionComponent);
    if (renderPosition) {
      entities.push({ entityId, entityType, x: renderPosition.x, y: renderPosition.y, speed });
      continue;
    }
    const position = world.entities.getComponent(entityId, PositionComponent);
    if (!position) {
      continue;
    }
    entities.push({ entityId, entityType, x: position.x, y: position.y, speed });
  }

  return encodeWorldSnapshot({ serverTick, entities });
}
