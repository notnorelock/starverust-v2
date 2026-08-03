import { PositionComponent, RenderPositionComponent, VelocityComponent, type World } from '@starve/shared';
import { encodeWorldSnapshot, type EntitySnapshot } from '@starve/protocol';

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
 * while sprinting) instead of assuming a fixed constant — see SnapshotBuffer.
 */
export function serializeWorldSnapshot(world: World, serverTick: number): ArrayBuffer {
  const entities: EntitySnapshot[] = [];

  for (const entityId of world.entities.query(PositionComponent)) {
    const velocity = world.entities.getComponent(entityId, VelocityComponent);
    const speed = velocity ? Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy) : 0;

    const renderPosition = world.entities.getComponent(entityId, RenderPositionComponent);
    if (renderPosition) {
      entities.push({ entityId, x: renderPosition.x, y: renderPosition.y, speed });
      continue;
    }
    const position = world.entities.getComponent(entityId, PositionComponent);
    if (!position) {
      continue;
    }
    entities.push({ entityId, x: position.x, y: position.y, speed });
  }

  return encodeWorldSnapshot({ serverTick, entities });
}
