import type { World } from './World';

/** Implemented by Systems that need one-time setup once registered into a World. */
export interface IInitializable {
  onInit(world: World): void;
}

/** Implemented by Systems that run on the variable-rate render/frame loop (client only). */
export interface IUpdatable {
  onUpdate(dt: number, world: World): void;
}

/** Implemented by Systems that run on the fixed-rate simulation tick (the authoritative pipeline). */
export interface IFixedUpdatable {
  onFixedUpdate(fixedDt: number, world: World): void;
}

/** Implemented by Systems that need explicit teardown when removed or the World is destroyed. */
export interface IDestructible {
  onDestroy(world: World): void;
}
