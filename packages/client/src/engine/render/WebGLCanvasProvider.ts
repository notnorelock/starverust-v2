/**
 * Creates and owns the single visible canvas + its WebGL2 context, sized to the viewport.
 * There is exactly one `<canvas>` on the page — text (nicknames, chat bubbles, the debug
 * HUD) is NOT a second canvas/DOM layer; it's baked to a texture and drawn as an ordinary
 * WebGL quad through the same sprite pipeline as everything else (see TextTextureCache /
 * SpriteRenderer). Game code never touches `canvas`/`gl` directly — it draws through the
 * engine's SpriteRenderer.
 */
export class WebGLCanvasProvider {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  constructor(mountPoint: HTMLElement) {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL2RenderingContext is not available in this environment');
    }
    this.gl = gl;

    mountPoint.appendChild(this.canvas);
    this.resizeToWindow();
    window.addEventListener('resize', () => this.resizeToWindow());
  }

  private resizeToWindow(): void {
    const { innerWidth, innerHeight } = window;
    this.canvas.width = innerWidth;
    this.canvas.height = innerHeight;
    this.gl.viewport(0, 0, innerWidth, innerHeight);
  }
}
