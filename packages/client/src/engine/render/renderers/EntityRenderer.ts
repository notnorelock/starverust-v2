import type { ScreenPoint } from '../../camera/Camera2D';

/** Everything a per-EntityType renderer needs to draw one entity for one frame. */
export interface EntityRenderContext {
  entityId: number;
  screen: ScreenPoint;
  angle: number;
  isLocalPlayer: boolean;
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
