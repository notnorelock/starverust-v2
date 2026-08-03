import { EntityType } from '@starve/shared';

/**
 * Tracks each known entity's EntityType, fed by EntityInsertPacket — the only packet that
 * carries it (EntityUpdatePacket's per-tick payload is deliberately position/speed only,
 * see EntityUpdatePacket's doc comment). RenderSystem consults this when it first spawns
 * an entity's client-side visual, so a future NPC/mob type can get a distinct sprite/color
 * instead of every entity defaulting to the player's circle. Isolated from RenderSystem the
 * same way SnapshotBuffer is, so it can be unit-tested without a full World/render stack.
 */
export class EntityTypeRegistry {
  private readonly types = new Map<number, EntityType>();

  insert(entityId: number, entityType: EntityType): void {
    this.types.set(entityId, entityType);
  }

  remove(entityId: number): void {
    this.types.delete(entityId);
  }

  /** Falls back to Player (0) when an entity's type hasn't been learned yet — matches the wire default. */
  get(entityId: number): EntityType {
    return this.types.get(entityId) ?? EntityType.Player;
  }
}
