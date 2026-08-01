import type { ComponentType } from './ComponentType';
import type { World } from './World';
import type { IDestructible, IFixedUpdatable, IInitializable, IUpdatable } from './lifecycle';

/**
 * Base class every gameplay system extends. Concrete systems declare the component
 * set they operate on via `query` and override the lifecycle hooks they need —
 * this is the primary extension point future stages (physics, AI, combat, crafting)
 * plug into without touching World or the tick pipeline itself.
 */
export abstract class System implements IInitializable, IFixedUpdatable, IDestructible, Partial<IUpdatable> {
  /** Systems can be toggled off without being removed from the World's registration order. */
  enabled = true;

  /** Component types this system is interested in; World builds a Query from this. */
  abstract readonly query: ReadonlyArray<ComponentType>;

  onInit(_world: World): void {
    // Default no-op; override for one-time setup.
  }

  onFixedUpdate(_fixedDt: number, _world: World): void {
    // Default no-op; override to participate in the authoritative simulation tick.
  }

  onDestroy(_world: World): void {
    // Default no-op; override for explicit teardown.
  }

  /**
   * Optional: only systems that render or otherwise run per-frame (e.g. the client's
   * RenderSystem) implement this. Left undefined by default so World can skip calling it
   * without every system needing a no-op override.
   */
  onUpdate?(dt: number, world: World): void;
}
