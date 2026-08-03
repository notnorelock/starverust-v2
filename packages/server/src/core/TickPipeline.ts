import {
  MovementSystem,
  PhysicsSystem,
  CollisionSystem,
  PositionSmoothingSystem,
  type System,
  type ServiceContainer,
} from '@starve/shared';
import { InputApplicationSystem } from '../systems/InputApplicationSystem';
import { InterestManagementSystem } from '../systems/InterestManagementSystem';
import { CONNECTION_REGISTRY } from './ServiceKeys';

/**
 * Builds the ordered system list matching the game's 12-step authoritative tick pipeline.
 * The remaining unimplemented slots are documented insertion points, not placeholder
 * no-op systems — later stages add a `System[]` entry at the matching position without
 * restructuring World or this function.
 *
 *  1. Input        -> InputApplicationSystem   (implemented)
 *  2. Movement     -> MovementSystem           (implemented, shared w/ potential client use)
 *  3. Physics      -> PhysicsSystem            (implemented: acceleration/friction/drag integration)
 *  4. Collision    -> CollisionSystem           (implemented: spatial-hash broadphase, circle/rect
 *                                                 narrowphase, push/slide resolution, CCD sub-stepping;
 *                                                 world edges are ordinary static RectColliderComponent
 *                                                 walls resolved here too — see WorldBoundaryFactory —
 *                                                 not a separate clamping system/pipeline step)
 *                     PositionSmoothingSystem    eases the broadcast-facing RenderPositionComponent
 *                                                 toward the now-fully-resolved target every tick
 *  5. AI           -> [Stage 3+] mob behavior trees
 *  6. Combat       -> [Stage 3+] damage resolution
 *  7. Crafting     -> [Stage 4+] recipe processing
 *  8. Inventory    -> [Stage 4+] item transfer/stacking
 *  9. Projectiles  -> [Stage 3+] arrow/thrown-item travel
 * 10. Environment  -> [Stage 5+] weather/day-night/hunger ticking
 * 11. Networking \_ SnapshotBroadcastSystem folds both remaining steps together
 * 12. Snapshot    /  for Stage 1 (serialize + broadcast in one pass)
 */
export function buildTickPipeline(services: ServiceContainer): System[] {
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
    // Runs last, after the target position (PositionComponent) has been fully resolved
    // by collision against everything, including the boundary walls — eases
    // RenderPositionComponent toward that final target every tick. InterestManagementSystem
    // below sends RenderPositionComponent (not the raw target) per connection, so clients
    // see continuous motion even though MovementSystem only advances the target itself
    // every MOVEMENT_TARGET_INTERVAL_TICKS ticks.
    new PositionSmoothingSystem(),
    // Per-connection, spatially-filtered EntityUpdatePacket unicast — replaces the old
    // SnapshotBroadcastSystem's identical-frame-to-everyone broadcast. See
    // InterestManagementSystem's own doc comment for why this can't just call
    // NetworkService.broadcast() the way earlier stages did.
    new InterestManagementSystem(services.resolve(CONNECTION_REGISTRY)),
  ];
}
