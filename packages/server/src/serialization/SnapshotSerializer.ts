import {
  PositionComponent,
  RenderPositionComponent,
  VelocityComponent,
  EntityTypeComponent,
  EntityType,
  EntityOwnerComponent,
  AimComponent,
  EntityActionStateComponent,
  ActionState,
  type World,
} from '@starve/shared';
import { encodeWorldSnapshot, NO_OWNER_PID, type WorldSnapshotEntity } from '@starve/protocol';

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
 * while sprinting) instead of assuming a fixed constant — see SnapshotBuffer — each
 * entity's EntityTypeComponent (falling back to EntityType.Player if somehow absent, same
 * default the wire format itself uses), and each entity's EntityOwnerComponent (falling
 * back to NO_OWNER_PID if absent — e.g. static world geometry has no owning player), each
 * entity's AimComponent (falling back to 0 if absent), and each entity's
 * EntityActionStateComponent (falling back to ActionState.Idle if absent — e.g. static
 * world geometry never walks), so this one-time catch-up packet is self-contained and a
 * newly-connected client doesn't depend on the separate EntityInsertPacket catch-up loop
 * (see PlayerSession.onHelloReceived) having already run first.
 *
 * Also broadcasts each owned entity's nickname, resolved via `nicknameForPid` — nickname
 * itself isn't ECS state (it lives on ClientConnection/ConnectionRegistry, session data,
 * not simulation state), so this is a lookup function rather than a component read, unlike
 * every other field here. Falls back to an empty string for unowned entities or a pid this
 * resolver doesn't recognize (e.g. a race between disconnect and this being called).
 */
export function serializeWorldSnapshot(
  world: World,
  serverTick: number,
  nicknameForPid: (pid: number) => string | undefined,
): ArrayBuffer {
  const entities: WorldSnapshotEntity[] = [];

  for (const entityId of world.entities.query(PositionComponent)) {
    const velocity = world.entities.getComponent(entityId, VelocityComponent);
    const speed = velocity ? Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy) : 0;
    const entityType = world.entities.getComponent(entityId, EntityTypeComponent)?.entityType ?? EntityType.Player;
    const ownerPid = world.entities.getComponent(entityId, EntityOwnerComponent)?.ownerPid ?? NO_OWNER_PID;
    const angle = world.entities.getComponent(entityId, AimComponent)?.angle ?? 0;
    const action = world.entities.getComponent(entityId, EntityActionStateComponent)?.action ?? ActionState.Idle;
    const nickname = ownerPid === NO_OWNER_PID ? '' : (nicknameForPid(ownerPid) ?? '');

    const renderPosition = world.entities.getComponent(entityId, RenderPositionComponent);
    if (renderPosition) {
      entities.push({
        entityId,
        entityType,
        ownerPid,
        x: renderPosition.x,
        y: renderPosition.y,
        speed,
        angle,
        action,
        nickname,
      });
      continue;
    }
    const position = world.entities.getComponent(entityId, PositionComponent);
    if (!position) {
      continue;
    }
    entities.push({ entityId, entityType, ownerPid, x: position.x, y: position.y, speed, angle, action, nickname });
  }

  return encodeWorldSnapshot({ serverTick, entities });
}
