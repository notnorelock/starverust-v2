import {
  System,
  VelocityComponent,
  PLAYER_MOVE_SPEED,
  PLAYER_SPRINT_SPEED,
  type ComponentType,
  type World,
} from '@starve/shared';
import { InputFlag } from '@starve/protocol';
import type { ConnectionRegistry } from '../network/ConnectionRegistry';

/**
 * Pipeline step 1 (Input): reads each connection's latest buffered PlayerInputPacket
 * and writes a normalized velocity onto that connection's entity. Direct/instant —
 * velocity snaps to full PLAYER_MOVE_SPEED (or PLAYER_SPRINT_SPEED while InputFlag.Sprint
 * is held) in the input direction (or zero) rather than ramping via acceleration,
 * matching the snappy, immediately-responsive movement feel this game wants. Stage 1
 * overwrites rather than queues input — no replay/reconciliation yet.
 */
export class InputApplicationSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [VelocityComponent];

  constructor(private readonly connections: ConnectionRegistry) {
    super();
  }

  override onFixedUpdate(_fixedDt: number, world: World): void {
    for (const connection of this.connections.all()) {
      if (connection.entityId === undefined) {
        continue;
      }

      const velocity = world.entities.getComponent(connection.entityId, VelocityComponent);
      if (!velocity) {
        continue;
      }

      const input = connection.getLatestInput();
      const direction = input?.direction ?? 0;

      let dx = 0;
      let dy = 0;
      if (direction & InputFlag.Up) dy -= 1;
      if (direction & InputFlag.Down) dy += 1;
      if (direction & InputFlag.Left) dx -= 1;
      if (direction & InputFlag.Right) dx += 1;

      const length = Math.sqrt(dx * dx + dy * dy);
      if (length > 0) {
        dx /= length;
        dy /= length;
      }

      const speed = direction & InputFlag.Sprint ? PLAYER_SPRINT_SPEED : PLAYER_MOVE_SPEED;
      velocity.vx = dx * speed;
      velocity.vy = dy * speed;
    }
  }
}
