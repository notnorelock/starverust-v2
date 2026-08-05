import { Component, type EntityId } from '@starve/shared';

/**
 * Marks an entity as drawable. Client-only — never registered on the server's World.
 * Carries only `isLocalPlayer` (RenderSystem needs it to pick styling/camera-follow
 * behavior); visual specifics like color/radius now live inside each EntityRenderer
 * subclass (see PlayerRenderer), not here — this component's job is just "which entities
 * does RenderSystem's draw loop visit," not "what do they look like."
 */
export class RenderableComponent extends Component {
  isLocalPlayer: boolean;

  constructor(entityId: EntityId, options: { isLocalPlayer?: boolean } = {}) {
    super(entityId);
    this.isLocalPlayer = options.isLocalPlayer ?? false;
  }
}
