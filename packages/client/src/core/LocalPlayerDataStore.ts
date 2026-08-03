export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Everything the client knows about "which entity/player is me" — pulled out of
 * RenderSystem (which used to hold a bare `localEntityId` field directly) so that
 * non-rendering concerns needing the same identity (MouseAngleInputSource's aim-angle
 * calculation, future UI/HUD code) don't have to depend on the render system itself just
 * to ask "what's my entityId." A single shared instance is registered as a service (see
 * ServiceKeys.LOCAL_PLAYER_DATA) and threaded into whatever needs it.
 *
 * `screenPosition` is written by RenderSystem once per frame (it's the one place that
 * already computes every entity's screen position via Camera2D.worldToScreen) and read by
 * MouseAngleInputSource to compute the aim angle from the player's on-screen position to
 * the mouse cursor — this is a plain read/write field rather than a computed getter
 * because computing it requires the camera and the latest interpolated position, neither
 * of which this store owns or should reach into.
 */
export class LocalPlayerDataStore {
  entityId: number | undefined;
  pid: number | undefined;
  screenPosition: ScreenPoint | undefined;
}
