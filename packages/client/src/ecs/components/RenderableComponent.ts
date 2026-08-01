import { Component, type EntityId } from '@starve/shared';

/** Marks an entity as drawable and carries its visual identity. Client-only — never registered on the server's World. */
export class RenderableComponent extends Component {
  color: string;
  radius: number;
  isLocalPlayer: boolean;

  constructor(entityId: EntityId, options: { color: string; radius?: number; isLocalPlayer?: boolean }) {
    super(entityId);
    this.color = options.color;
    this.radius = options.radius ?? 16;
    this.isLocalPlayer = options.isLocalPlayer ?? false;
  }
}
