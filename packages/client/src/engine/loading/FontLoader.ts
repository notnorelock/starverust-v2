import type { LoadTask } from './AssetLoader';

/** One custom web font to load and register before the game is considered ready to play. */
export interface FontAsset {
  /** The font-family name other CSS will reference (e.g. via `font-family:`). */
  family: string;
  /** URL to the font file (woff2/woff/ttf) — typically a webpack-bundled asset path. */
  url: string;
  /** Forwarded to the FontFace descriptor (e.g. { weight: '700' }) — omit for defaults. */
  descriptors?: FontFaceDescriptors;
}

/**
 * Turns a list of custom web fonts into LoadTasks (see AssetLoader) that construct a
 * `FontFace`, load it, and register it on `document.fonts` — mirroring how sprite textures
 * become LoadTasks, so both funnel through the same sequential loader/progress-reporting
 * pipeline rather than fonts being a separate, differently-shaped loading concern.
 *
 * Uses the FontFace API directly (`font.load()` + `document.fonts.add()`) rather than
 * `document.fonts.load('16px MyFont')` + polling `document.fonts.check()` — the constructor
 * approach lets this resolve deterministically per font without needing a CSS `@font-face`
 * rule to already exist for `document.fonts.load()` to find, and without a real font size/
 * usage string to check() against (which document.fonts.check() requires).
 *
 * No fonts are registered anywhere in this project yet (see CLAUDE.md's "documented
 * insertion points, not placeholder no-op systems" convention) — this returns an empty task
 * list until a real FontAsset is passed in, at which point the loading screen's font phase
 * starts actually reporting progress with zero other changes needed.
 */
export function fontLoadTasks(fonts: readonly FontAsset[]): LoadTask[] {
  return fonts.map((font) => ({
    name: `font: ${font.family}`,
    load: async () => {
      const face = new FontFace(font.family, `url(${font.url})`, font.descriptors);
      const loaded = await face.load();
      document.fonts.add(loaded);
    },
  }));
}
