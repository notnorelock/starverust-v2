import { System, PositionComponent, type ComponentType, type World } from '@starve/shared';
import type { NetworkService } from '../network/NetworkService';
import { serializeWorldSnapshot } from '../serialization/SnapshotSerializer';

/**
 * Pipeline step 12 (Snapshot, folding in step 11/Networking for Stage 1): serializes every
 * positioned entity and broadcasts an identical binary payload to all connected clients.
 * No interest management/per-client culling yet — later stage.
 */
export class SnapshotBroadcastSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [PositionComponent];
  private tickCounter = 0;

  constructor(private readonly network: NetworkService) {
    super();
  }

  override onFixedUpdate(_fixedDt: number, world: World): void {
    const buffer = serializeWorldSnapshot(world, this.tickCounter);
    this.network.broadcast(buffer);
    this.tickCounter += 1;
  }
}
