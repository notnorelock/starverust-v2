/** Creates and owns the canvas element + its 2D rendering context, sized to the viewport. */
export class CanvasContext2DProvider {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;

  constructor(mountPoint: HTMLElement) {
    this.canvas = document.createElement('canvas');
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('CanvasRenderingContext2D is not available in this environment');
    }
    this.context = context;

    mountPoint.appendChild(this.canvas);
    this.resizeToWindow();
    window.addEventListener('resize', () => this.resizeToWindow());
  }

  private resizeToWindow(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
}
