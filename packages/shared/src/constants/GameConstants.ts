/** Default authoritative simulation rate; overridable server-side via TICK_RATE env var. */
export const DEFAULT_TICK_RATE = 30;

/** Movement speed in world units/second applied by InputApplicationSystem. */
export const PLAYER_MOVE_SPEED = 200;

/** Client-side interpolation delay in milliseconds, expressed as a multiple of tick duration. */
export const INTERPOLATION_DELAY_TICKS = 2;
