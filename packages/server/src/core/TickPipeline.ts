import {
  MovementSystem,
  PhysicsSystem,
  CollisionSystem,
  WorldBoundsSystem,
  type System,
  type ServiceContainer,
  type WorldBounds,
} from '@starve/shared';
import { InputApplicationSystem } from '../systems/InputApplicationSystem';
import { SnapshotBroadcastSystem } from '../systems/SnapshotBroadcastSystem';
import { NETWORK_SERVICE, CONNECTION_REGISTRY } from './ServiceKeys';

/**
 * Builds the ordered system list matching the game's 12-step authoritative tick pipeline.
 * The remaining unimplemented slots are documented insertion points, not placeholder
 * no-op systems — later stages add a `System[]` entry at the matching position without
 * restructuring World or this function.
 *
 *  1. Input        -> InputApplicationSystem   (implemented)
 *  2. Movement     -> MovementSystem           (implemented, shared w/ potential client use)
 *  3. Physics      -> PhysicsSystem            (implemented: acceleration/friction/drag integration)
 *  4. Collision    -> CollisionSystem,          (implemented: spatial-hash broadphase, circle/rect
 *                     WorldBoundsSystem          narrowphase, push/slide resolution, CCD sub-stepping,
 *                                                 then world-edge clamping as a final catch-all)
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
    // PhysicsSystem runs before MovementSystem despite the conceptual step numbering
    // (2. Movement, 3. Physics) — it records each body's pre-movement position
    // (prevX/prevY) and turns pending acceleration into velocity BEFORE MovementSystem
    // integrates that velocity into position. If this order were reversed, prevX/prevY
    // would already reflect this tick's movement, and CollisionSystem's continuous-
    // collision pass would never see any displacement to sub-step against.
    new PhysicsSystem(),
    new MovementSystem(),
    new CollisionSystem(),
    new WorldBoundsSystem(worldBounds),
    new SnapshotBroadcastSystem(services.resolve(NETWORK_SERVICE)),
  ];
}
