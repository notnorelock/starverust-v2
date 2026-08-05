export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Everything the client knows about "which entity/player is me" — pulled out of
 * RenderSystem (which used to hold a bare `localEntityId` field directly) so that
 * non-rendering concerns needing the same identity (MouseInputSource's aim-angle
 * calculation, future UI/HUD code) don't have to depend on the render system itself just
 * to ask "what's my entityId."
 *
 * `screenPosition` is written by RenderSystem once per frame (it's the one place that
 * already computes every entity's screen position via Camera2D.worldToScreen) and read by
 * MouseInputSource to compute the aim angle from the player's on-screen position to
 * the mouse cursor — this is a plain read/write field rather than a computed getter
 * because computing it requires the camera and the latest interpolated position, neither
 * of which this store owns or should reach into.
 */
export class LocalPlayerDataStore {
  entityId: number | undefined;
  pid: number | undefined;
  screenPosition: ScreenPoint | undefined;
}

/**
 * Module-level singleton — there is exactly one local player per page, so this is
 * reached for directly instead of being threaded through constructors/DI. `localPlayer()`
 * is a function (not a plain exported const) so every call site reads through the same
 * indirection, matching the pattern already used for the localPlayerScreenPosition
 * callback in MouseInputSource.
 */
const store = new LocalPlayerDataStore();
export const localPlayer = (): LocalPlayerDataStore => store;
