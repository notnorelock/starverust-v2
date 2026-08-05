import { uploadTexture } from './TextureLoader';

export interface TextTexture {
  texture: WebGLTexture;
  /** Pixel dimensions of the baked texture — SpriteRenderer sizes the drawn quad from this, not a fixed sprite radius. */
  width: number;
  height: number;
}

/** One cache entry's lookup key — text + every visual parameter that would change the baked pixels. */
function cacheKey(text: string, font: string, color: string): string {
  return `${font}_${color}_${text}`;
}

/**
 * Bakes a string to a WebGL texture via a detached (never appended to the DOM — purely a
 * texture source) Canvas2D canvas, so nicknames/chat bubble text can be drawn as ordinary
 * textured quads through the same SpriteRenderer as sprites, keeping this project to a
 * single visible `<canvas>` (see WebGLCanvasProvider's own doc comment for why: WebGL has
 * no built-in text API, and a full SDF/font-atlas shader is a bigger undertaking than this
 * stage needs).
 *
 * Baking is synchronous (unlike loadTexture()'s image decode) since Canvas2D's
 * measureText()/fillText() are themselves synchronous — no Promise/loading-state needed
 * here. Results are cached by (text, font, color) so a nickname or already-sent chat
 * message (both immutable once known) is baked once and reused every frame rather than
 * re-rendering-to-canvas-and-re-uploading-to-the-GPU on every single draw call, which
 * would be needlessly expensive for a value that never changes after its first bake.
 * Callers are responsible for evicting entries that will never be drawn again (see
 * evict()) — e.g. when a chat bubble finishes its fade-out — since nothing here knows a
 * cached string's owning entity has gone away.
 */
export class TextTextureCache {
  private readonly cache = new Map<string, TextTexture>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get(text: string, font: string, color: string): TextTexture {
    const key = cacheKey(text, font, color);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const baked = this.bake(text, font, color);
    this.cache.set(key, baked);
    return baked;
  }

  /** Drops a cached bake so its GL texture can be garbage-collected — call once the text will never be drawn again. */
  evict(text: string, font: string, color: string): void {
    const key = cacheKey(text, font, color);
    const cached = this.cache.get(key);
    if (!cached) {
      return;
    }
    this.gl.deleteTexture(cached.texture);
    this.cache.delete(key);
  }

  private bake(text: string, font: string, color: string): TextTexture {
    // Two-pass: measure on a throwaway 1x1 canvas first (font metrics are already correct
    // as soon as `ctx.font` is set, regardless of the canvas's own pixel dimensions), then
    // size the real bake canvas to exactly fit — avoids guessing a fixed max size or
    // over-allocating a texture much larger than the text actually needs.
    const measuringCanvas = document.createElement('canvas');
    const measuringContext = getContext2D(measuringCanvas);
    measuringContext.font = font;
    const metrics = measuringContext.measureText(text);
    const width = Math.max(1, Math.ceil(metrics.width));
    const height = Math.max(
      1,
      Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) || Math.ceil(parseInt(font, 10) * 1.2),
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = getContext2D(canvas);
    context.font = font;
    context.fillStyle = color;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(text, 0, metrics.actualBoundingBoxAscent || height * 0.8);

    return { texture: uploadTexture(this.gl, canvas), width, height };
  }
}

function getContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('CanvasRenderingContext2D is not available in this environment');
  }
  return context;
}
