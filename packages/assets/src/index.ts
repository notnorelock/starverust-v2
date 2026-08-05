/**
 * Auto-discovers every sprite PNG under `src/` (one folder per entity type, e.g. `player/`,
 * each with `day/`/`night/` variant subfolders, each containing one PNG per drawn part —
 * e.g. player has `default_head.png`/`default_left_arm.png`/`default_right_arm.png`, since
 * the player is composited from multiple part sprites rather than one flat image) via
 * webpack's `require.context`, rather than a hand-written `export … from
 * './entity/variant/file.png'` per file — with many entity types, a day/night variant
 * each, and multiple parts per variant, that would mean editing this file for every new
 * sprite added. `require.context` is a webpack build-time construct (see
 * @types/webpack-env, which types it): `tsc --build`'s real typecheck doesn't execute it,
 * it just sees this file's declared exports (SPRITE_URLS's inferred type) the same as any
 * other module — the glob itself only actually runs inside webpack's bundling/dev-server
 * pass, which is also the only place `*.png` files need to resolve to real bundled URLs.
 *
 * Keys are the entity-type folder name (e.g. "player"), variant (e.g. "day"), and part
 * name — the PNG's filename without extension (e.g. "default_head") — see spritePartUrl()
 * below for the lookup a consumer actually calls.
 */
const context = require.context('.', true, /\.png$/);

const SPRITE_URLS: Record<string, Record<string, Record<string, string>>> = {};

for (const key of context.keys()) {
  // key looks like './player/day/default_head.png' — capture ("player", "day", "default_head").
  const match = /^\.\/([^/]+)\/([^/]+)\/([^/]+)\.png$/.exec(key);
  const entityType = match?.[1];
  const variant = match?.[2];
  const part = match?.[3];
  if (!entityType || !variant || !part) {
    continue;
  }
  ((SPRITE_URLS[entityType] ??= {})[variant] ??= {})[part] = context<string>(key);
}

/**
 * Resolves an entity type + variant + part (e.g. "player", "day", "default_head") to its
 * bundled sprite URL. Throws rather than returning undefined — a missing sprite is a
 * build-time asset problem (wrong path, forgot to add the file), not a runtime condition
 * calling code should have to branch on. No day/night *selection* system exists yet (see
 * CLAUDE.md's "documented insertion points, not placeholder no-op systems" convention) —
 * callers pass "day" explicitly today; whatever later picks day vs. night based on real
 * game time is what eventually calls this with a computed variant instead of a hardcoded
 * one.
 */
export function spritePartUrl(entityType: string, variant: string, part: string): string {
  const url = SPRITE_URLS[entityType]?.[variant]?.[part];
  if (!url) {
    throw new Error(`No sprite found for entityType="${entityType}" variant="${variant}" part="${part}"`);
  }
  return url;
}
