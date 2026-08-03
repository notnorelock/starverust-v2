import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

/**
 * An entity's facing/aim angle in radians, standard math convention (0 = +x, increasing
 * counter-clockwise) — independent of VelocityComponent's direction of travel, since a
 * player can move one way while aiming another (mouse-driven facing, not movement-key-
 * driven). Server-authoritative: InputApplicationSystem writes it from each connection's
 * latest PlayerInputPacket.angle every tick, the same way it writes VelocityComponent from
 * the packet's direction bitmask. Broadcast on EntityUpdatePacket/WorldSnapshotEntity
 * (see EntitySnapshot.angle) so clients can rotate the player's rendered facing —
 * ported from the reference implementation's per-tick `p.angle = p.nangle = angle` write.
 */
export class AimComponent extends Component {
  angle: number;

  constructor(entityId: EntityId, angle = 0) {
    super(entityId);
    this.angle = angle;
  }
}
