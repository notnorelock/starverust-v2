import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

/**
 * Tags an entity with the pid (player-networking id, see ClientConnection.pid — the
 * server's own domain type doesn't live in `shared`, so this is typed as a plain number)
 * of the player that owns it — a player's own entity is owned by its own pid (see
 * PlayerEntityFactory), and a future player-placed object (a wall, a chest, anything
 * "tented" to a specific player) would carry the placing player's pid here so
 * ownership-gated logic (who can open/break/interact with it) has something to check
 * against instead of the game not knowing whose object it's looking at.
 *
 * Deliberately pid, not entityId — a player's pid is assigned from its own independent
 * sequence (ConnectionRegistry.assignPid), so ownership can never be confused with or
 * collide against the general ECS entityId space the way reusing entityId here would risk
 * (e.g. an owned object surviving its owning player's entity being destroyed and a new,
 * unrelated entity later reusing that same numeric entityId).
 */
export class EntityOwnerComponent extends Component {
  constructor(entityId: EntityId, public readonly ownerPid: number) {
    super(entityId);
  }
}
