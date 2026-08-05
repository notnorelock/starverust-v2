import { ShaderProgram } from './ShaderProgram';

export interface ColorQuadDraw {
  /** Top-left corner in screen-space pixels (same convention as SpriteRenderer's SpriteDraw). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, standard math convention — rotates around the quad's center, same as SpriteDraw.rotation. */
  rotation?: number;
  /** [r, g, b, a], each 0..1. */
  color: readonly [number, number, number, number];
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition; // unit quad corner, in [0,1]

uniform vec2 uScreenSize;
uniform vec2 uTranslation;
uniform vec2 uScale;
uniform float uRotation;

void main() {
  // See SpriteRenderer's identical vertex shader for the full explanation: rotation runs
  // directly in screen-space Y-down using the plain rotation matrix, with the one Y-down
  // -> Y-up flip applied only at the very end (after translation AND rotation), matching
  // a verified working reference implementation. Do not pre-flip to Y-up before rotating —
  // that was tried and is wrong (a reflection and a rotation don't commute).
  vec2 centered = (aPosition - 0.5) * uScale;

  float c = cos(uRotation);
  float s = sin(uRotation);
  vec2 rotated = vec2(
    centered.x * c - centered.y * s,
    centered.x * s + centered.y * c
  );

  vec2 screenPos = uTranslation + uScale * 0.5 + rotated;
  vec2 clipSpace = (screenPos / uScreenSize) * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform vec4 uColor;
out vec4 fragColor;

void main() {
  fragColor = uColor;
}
`;

/**
 * Draws flat-colored, untextured quads — used for debug visualizations (see
 * RenderSystem.drawDebugLagLine()) and, later, any UI chrome that needs a plain colored
 * rectangle (e.g. a chat bubble background) without the overhead of baking/uploading a
 * texture for a solid fill. A thin, rotated quad IS a line: drawLine() below computes the
 * width/rotation that makes a quad span exactly between two points, rather than this class
 * needing separate line-specific vertex/index buffers or a GL_LINES draw call (GL_LINES'
 * line width support is unreliable across platforms/drivers, whereas a rotated quad renders
 * identically everywhere).
 *
 * Deliberately a second, separate shader program from SpriteRenderer rather than one
 * shader branching on "is this draw textured" via a uniform flag — keeping the two
 * concerns (textured vs. flat-color quads) as separate, simple programs is easier to
 * reason about than one shader with a conditional texture sample, at the cost of one extra
 * program object; this project's draw-call volume doesn't make that cost meaningful.
 */
export class ColorQuadRenderer {
  private readonly program: ShaderProgram;
  private readonly quadBuffer: WebGLBuffer;
  private readonly aPosition: number;
  private readonly uScreenSize: WebGLUniformLocation;
  private readonly uTranslation: WebGLUniformLocation;
  private readonly uScale: WebGLUniformLocation;
  private readonly uRotation: WebGLUniformLocation;
  private readonly uColor: WebGLUniformLocation;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = new ShaderProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);

    // prettier-ignore
    const quad = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]);

    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error('gl.createBuffer returned null');
    }
    this.quadBuffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    this.aPosition = this.program.attributeLocation('aPosition');
    this.uScreenSize = this.program.uniformLocation('uScreenSize');
    this.uTranslation = this.program.uniformLocation('uTranslation');
    this.uScale = this.program.uniformLocation('uScale');
    this.uRotation = this.program.uniformLocation('uRotation');
    this.uColor = this.program.uniformLocation('uColor');
  }

  /** Call once per frame before any draw()/drawLine() calls, with the canvas's current pixel size. Blending state is shared with SpriteRenderer (gl.enable(BLEND) persists across programs), so this doesn't re-set it. */
  beginFrame(screenWidth: number, screenHeight: number): void {
    const { gl } = this;
    this.program.use();
    gl.uniform2f(this.uScreenSize, screenWidth, screenHeight);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
  }

  draw(quad: ColorQuadDraw): void {
    const { gl } = this;

    gl.uniform2f(this.uTranslation, quad.x, quad.y);
    gl.uniform2f(this.uScale, quad.width, quad.height);
    gl.uniform1f(this.uRotation, quad.rotation ?? 0);
    gl.uniform4f(this.uColor, ...quad.color);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Draws a `thickness`-wide line from (x1,y1) to (x2,y2) as a single rotated quad — see the class doc comment for why a quad instead of GL_LINES. */
  drawLine(x1: number, y1: number, x2: number, y2: number, thickness: number, color: readonly [number, number, number, number]): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    this.draw({
      x: midX - length / 2,
      y: midY - thickness / 2,
      width: length,
      height: thickness,
      rotation: angle,
      color,
    });
  }
}
