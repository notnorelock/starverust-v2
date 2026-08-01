import { MovementSystem, WorldBoundsSystem, type System, type ServiceContainer, type WorldBounds } from '@starve/shared';
import { InputApplicationSystem } from '../systems/InputApplicationSystem';
import { SnapshotBroadcastSystem } from '../systems/SnapshotBroadcastSystem';
import { NETWORK_SERVICE, CONNECTION_REGISTRY } from './ServiceKeys';

/**
 * Builds the ordered system list matching the game's 12-step authoritative tick pipeline.
 * Stage 1 only implements 5 of the 12 conceptual steps; the remaining slots are documented
 * insertion points, not placeholder no-op systems — later stages add a `System[]` entry
 * at the matching position without restructuring World or this function.
 *
 *  1. Input        -> InputApplicationSystem   (implemented)
 *  2. Movement     -> MovementSystem           (implemented, shared w/ potential client use)
 *  3. Physics      -> [Stage 2+] forces/gravity
 *  4. Collision    -> WorldBoundsSystem         (implemented: clamps entities to world bounds;
 *                                                 full broadphase/narrowphase collision is Stage 2+)
 *  5. AI           -> [Stage 3+] mob behavior trees
 *  6. Combat       -> [Stage 3+] damage resolution
 *  7. Crafting     -> [Stage 4+] recipe processing
 *  8. Inventory    -> [Stage 4+] item transfer/stacking
 *  9. Projectiles  -> [Stage 3+] arrow/thrown-item travel
 * 10. Environment  -> [Stage 5+] weather/day-night/hunger ticking
 * 11. Networking \_ SnapshotBroadcastSystem folds both remaining steps together
 * 12. Snapshot    /  for Stage 1 (serialize + broadcast in one pass)
 */
export function buildTickPipeline(services: ServiceContainer, worldBounds: WorldBounds): System[] {
  return [
    new InputApplicationSystem(services.resolve(CONNECTION_REGISTRY)),
    new MovementSystem(),
    new WorldBoundsSystem(worldBounds),
    new SnapshotBroadcastSystem(services.resolve(NETWORK_SERVICE)),
  ];
}
