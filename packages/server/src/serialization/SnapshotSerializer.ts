import { PositionComponent, type World } from '@starve/shared';
import { encodeWorldSnapshot, type EntitySnapshot } from '@starve/protocol';

/** Bridges the ECS World and the wire protocol: gathers every positioned entity into a snapshot. */
export function serializeWorldSnapshot(world: World, serverTick: number): ArrayBuffer {
  const entities: EntitySnapshot[] = [];

  for (const entityId of world.entities.query(PositionComponent)) {
    const position = world.entities.getComponent(entityId, PositionComponent);
    if (!position) {
      continue;
    }
    entities.push({ entityId, x: position.x, y: position.y });
  }

  return encodeWorldSnapshot({ serverTick, entities });
}
