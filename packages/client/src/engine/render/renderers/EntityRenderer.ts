import type { ScreenPoint } from '../../camera/Camera2D';

/** Everything a per-EntityType renderer needs to draw one entity for one frame. */
export interface EntityRenderContext {
  entityId: number;
  screen: ScreenPoint;
  angle: number;
  isLocalPlayer: boolean;
  /**
   * A generic idle/walk-style animation offset (world/screen pixels), optional since not
   * every entity type has one — RenderSystem computes it per entity type as needed (see
   * PlayerAnimationComponent for the player's own idle/walk/sprint arm-swing) and passes it
   * through here rather than this interface naming anything player-specific, so a future
   * non-player EntityRenderer can use the same field for its own animation without this
   * type needing to grow a second, differently-named offset for it.
   */
  animationOffset?: ScreenPoint;
}

/**
 * Base class for a per-EntityType visual — RenderSystem looks one up by an entity's
 * EntityType (see RenderSystem.rendererFor) and calls draw() once per frame per entity,
 * instead of RenderSystem itself containing a growing if/else chain of "if this is a
 * player, draw a circle + nickname; if this is an NPC, draw ...". Adding a new entity type
 * later means writing one new EntityRenderer subclass and registering it, not editing
 * RenderSystem's draw loop. Subclasses are pure drawing code: no ECS/World access, no
 * network/state ownership — everything they need arrives via EntityRenderContext or the
 * constructor (e.g. PlayerRenderer's SpriteRenderer/TextTextureCache).
 */
export abstract class EntityRenderer {
  abstract draw(context: EntityRenderContext): void;
}
