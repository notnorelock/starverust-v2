/** Anything texImage2D can upload directly — an already-decoded <img> or a canvas used as a texture source. */
export type TexImageSource2D = HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

/**
 * Uploads `source` as a WebGL texture with this project's standard sprite/text filtering —
 * shared by loadTexture() (real PNG assets) and TextTextureCache (baked text) so both go
 * through identical filtering/wrap settings rather than each duplicating the
 * texImage2D/texParameteri calls.
 *
 * CLAMP_TO_EDGE avoids wrap-around artifacts at a quad's edges; LINEAR filtering keeps
 * scaled sprites/text smooth rather than blocky. No mipmaps — sprites and text are drawn
 * close to their native pixel size, not minified across a wide zoom range yet.
 */
export function uploadTexture(gl: WebGL2RenderingContext, source: TexImageSource2D): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('gl.createTexture returned null');
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  // WebGL's texture V=0 is conventionally the BOTTOM row, but texImage2D uploads an <img>/
  // <canvas> source's row 0 (its top) unchanged — without this flag that puts the source
  // image's top row at texture V=0, i.e. upside-down relative to how SpriteRenderer's quad
  // UVs (V=1 at the quad's screen-top edge) expect to sample it. Setting this once here
  // means every texture (real sprite PNGs and TextTextureCache's baked text alike) uploads
  // right-side-up without each quad's own UV data needing a compensating flip.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return texture;
}

/**
 * Loads an image URL (a webpack-bundled asset path — see @starve/assets's spriteUrl()) via
 * the browser's `Image` element and uploads it as a WebGL texture. Image decoding is
 * inherently async (the browser fetches + decodes off the main thread's synchronous
 * execution), so this returns a Promise — callers that need to draw before the texture is
 * ready (see SpriteRenderer) must tolerate an undefined/not-yet-loaded texture for the
 * first few frames rather than blocking startup on every sprite load completing.
 */
export function loadTexture(gl: WebGL2RenderingContext, url: string): Promise<WebGLTexture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(uploadTexture(gl, image));
    image.onerror = () => reject(new Error(`Failed to load texture image: ${url}`));
    image.src = url;
  });
}
