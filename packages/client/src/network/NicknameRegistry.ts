/**
 * Tracks each known player's nickname, keyed by entityId for the renderer's convenience
 * (it draws per-entity, see PlayerRenderer) but fed by PlayerJoinPacket/PlayerLeftPacket,
 * which are keyed by pid (see those packets' own doc comments for why player identity is
 * pid-keyed rather than entityId-keyed). Internally keeps a pid->entityId mapping too,
 * since PlayerLeftPacket only carries pid — this is what lets remove() find the right
 * entityId to drop without needing the caller to have tracked that correspondence itself.
 * Isolated from RenderSystem the same way EntityTypeRegistry is, so it can be unit-tested
 * without a full World/render stack.
 */
export class NicknameRegistry {
  private readonly nicknameByEntityId = new Map<number, string>();
  private readonly entityIdByPid = new Map<number, number>();

  insert(pid: number, entityId: number, nickname: string): void {
    this.nicknameByEntityId.set(entityId, nickname);
    this.entityIdByPid.set(pid, entityId);
  }

  remove(pid: number): void {
    const entityId = this.entityIdByPid.get(pid);
    if (entityId === undefined) {
      return;
    }
    this.entityIdByPid.delete(pid);
    this.nicknameByEntityId.delete(entityId);
  }

  /** Returns undefined if this entity's nickname hasn't been learned yet (e.g. PlayerJoin hasn't arrived, or it isn't a player). */
  get(entityId: number): string | undefined {
    return this.nicknameByEntityId.get(entityId);
  }
}
