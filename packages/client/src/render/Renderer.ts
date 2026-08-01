import type { CanvasContext2DProvider } from './CanvasContext2DProvider';

/**
 * Facade over the raw canvas context for cross-cutting render setup (clear color,
 * DPI scaling). Stage 1 keeps this minimal — later stages layer particle/lighting/shadow
 * renderers alongside RenderSystem without RenderSystem itself growing unrelated concerns.
 */
export class Renderer {
  constructor(private readonly canvasProvider: CanvasContext2DProvider) {}

  clear(color = '#0a0a0a'): void {
    const { context, canvas } = this.canvasProvider;
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
}
