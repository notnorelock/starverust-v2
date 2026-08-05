/**
 * Compiles one vertex + one fragment shader into a linked WebGL program, throwing with the
 * driver's own compile/link error log on failure — hand-rolled rather than pulling in a
 * shader-management library, matching this project's "no engine/framework, hand-rolled
 * everything" rule (see CLAUDE.md). Callers look up attribute/uniform locations once after
 * construction (see SpriteRenderer) rather than this class exposing a generic
 * `getUniform(name)` on every draw call — locations don't change once a program is linked,
 * so re-querying them per-frame would be pure waste.
 */
export class ShaderProgram {
  readonly program: WebGLProgram;

  constructor(private readonly gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    // Shaders are flagged for deletion but stay alive until the program using them is
    // itself deleted (WebGL refcounts this internally) — detaching them isn't needed.
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Shader program link failed: ${log}`);
    }

    this.program = program;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  attributeLocation(name: string): number {
    return this.gl.getAttribLocation(this.program, name);
  }

  uniformLocation(name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(this.program, name);
    if (!location) {
      throw new Error(`Uniform "${name}" not found`);
    }
    return location;
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('gl.createShader returned null');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`${kind} shader compile failed: ${log}`);
  }

  return shader;
}
