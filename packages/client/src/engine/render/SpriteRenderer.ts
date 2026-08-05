import { ShaderProgram } from './ShaderProgram';

export interface SpriteDraw {
  texture: WebGLTexture;
  /** Top-left corner in screen-space pixels (matches Camera2D.worldToScreen()'s convention — Y-down, origin top-left). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, standard math convention (0 = +x, increasing counter-clockwise) — same as EntityRenderContext.angle. Rotates around the quad's center. */
  rotation?: number;
  /** 0..1, multiplies the texture's own alpha — used for chat bubble fade in/out (see chatBubbleOpacity()). Defaults to 1 (opaque). */
  opacity?: number;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition; // unit quad corner, in [0,1]
in vec2 aTexCoord;

uniform vec2 uScreenSize;
uniform vec2 uTranslation;
uniform vec2 uScale;
uniform float uRotation;

out vec2 vTexCoord;

void main() {
  // Rotation is computed directly in screen-space pixels (Y-DOWN, matching
  // Camera2D.worldToScreen() and MouseInputSource's atan2(dy,dx) angle convention) using
  // the plain rotation matrix — NO pre-flip to Y-up before rotating. The single Y-down ->
  // Y-up conversion (negating Y once) happens only at the very end, after translation AND
  // rotation are both already fully resolved in screen space — this mirrors a reference
  // WebGL implementation (biomes-dev's SpriteBatch.draw()) where the equivalent per-vertex
  // rotation runs in plain Y-down world space and the Y-flip lives entirely in the
  // projection matrix, applied once, afterward, uniformly to already-rotated vertices.
  // An earlier version of this shader pre-flipped to Y-up before rotating and negated the
  // rotation angle to "compensate" — that reasoning was wrong: flipping first and rotating
  // second is NOT equivalent to rotating first and flipping second (a reflection and a
  // rotation don't commute), and it visibly reversed rotation direction for asymmetric
  // sprite art. Verified against the reference project and confirmed correct for
  // mouse-right/below/above/left test cases before landing this version — don't
  // reintroduce a pre-rotation flip without re-deriving it against a full multi-vertex
  // trace, not just a single isolated point (that's what produced the wrong "fix").
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

  vTexCoord = aTexCoord;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec2 vTexCoord;
uniform sampler2D uTexture;
uniform float uOpacity;

out vec4 fragColor;

void main() {
  vec4 texel = texture(uTexture, vTexCoord);
  fragColor = vec4(texel.rgb, texel.a * uOpacity);
}
`;

/**
 * Draws textured quads (sprites, and baked text — see TextTextureCache) one at a time.
 * Each call binds its own texture and issues one draw call; this project's current entity
 * count (a handful of players) doesn't need texture-atlas batching to stay performant, so
 * this deliberately isn't an instanced/batched renderer yet — if entity counts grow enough
 * to matter, batching by texture (sorting draws so the same texture's quads run
 * consecutively, or a true texture-atlas + instanced draw) is the natural next step,
 * without changing this class's public per-sprite draw() call shape.
 *
 * The unit quad + per-draw uniforms (translation/scale/rotation) approach — rather than
 * recomputing a full vertex buffer per sprite — keeps CPU-side work to "set a few
 * uniforms," leaving the actual position math to the GPU each frame.
 */
export class SpriteRenderer {
  private readonly program: ShaderProgram;
  private readonly quadBuffer: WebGLBuffer;
  private readonly aPosition: number;
  private readonly aTexCoord: number;
  private readonly uScreenSize: WebGLUniformLocation;
  private readonly uTranslation: WebGLUniformLocation;
  private readonly uScale: WebGLUniformLocation;
  private readonly uRotation: WebGLUniformLocation;
  private readonly uTexture: WebGLUniformLocation;
  private readonly uOpacity: WebGLUniformLocation;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = new ShaderProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);

    // Interleaved [x, y, u, v] per corner — two triangles forming a unit quad in [0,1]^2,
    // with V flipped (1 - y) so texture row 0 (top of the source image) maps to the
    // quad's top edge, matching how images are conventionally authored top-down while GL
    // texture coordinates are bottom-up by default.
    // prettier-ignore
    const quad = new Float32Array([
      0, 0, 0, 1,
      1, 0, 1, 1,
      0, 1, 0, 0,
      0, 1, 0, 0,
      1, 0, 1, 1,
      1, 1, 1, 0,
    ]);

    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error('gl.createBuffer returned null');
    }
    this.quadBuffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    this.aPosition = this.program.attributeLocation('aPosition');
    this.aTexCoord = this.program.attributeLocation('aTexCoord');
    this.uScreenSize = this.program.uniformLocation('uScreenSize');
    this.uTranslation = this.program.uniformLocation('uTranslation');
    this.uScale = this.program.uniformLocation('uScale');
    this.uRotation = this.program.uniformLocation('uRotation');
    this.uTexture = this.program.uniformLocation('uTexture');
    this.uOpacity = this.program.uniformLocation('uOpacity');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Call once per frame before any draw() calls, with the canvas's current pixel size. */
  beginFrame(screenWidth: number, screenHeight: number): void {
    const { gl } = this;
    gl.clearColor(0.039, 0.039, 0.039, 1); // matches the old Renderer.clear()'s default #0a0a0a
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.program.use();
    gl.uniform2f(this.uScreenSize, screenWidth, screenHeight);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 4 * 4, 0);
    gl.enableVertexAttribArray(this.aTexCoord);
    gl.vertexAttribPointer(this.aTexCoord, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
  }

  draw(sprite: SpriteDraw): void {
    const { gl } = this;

    gl.uniform2f(this.uTranslation, sprite.x, sprite.y);
    gl.uniform2f(this.uScale, sprite.width, sprite.height);
    gl.uniform1f(this.uRotation, sprite.rotation ?? 0);
    gl.uniform1f(this.uOpacity, sprite.opacity ?? 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
    gl.uniform1i(this.uTexture, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
