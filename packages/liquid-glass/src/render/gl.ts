/**
 * Small WebGL2 helpers shared by the render passes. Every offscreen texture in the renderer is
 * stored "y down": row 0 is the top of what it holds, so CSS coordinates map to texel rows
 * without flipping. Only the default framebuffer (the canvas the placeholders copy from) is
 * bottom-up, and the glass pass accounts for that in its fragment-to-local mapping.
 */

export type GL = WebGL2RenderingContext;

export function compileProgram(
  gl: GL,
  name: string,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const program = gl.createProgram();
  const shaders = [
    compileShader(gl, name, gl.VERTEX_SHADER, vertex),
    compileShader(gl, name, gl.FRAGMENT_SHADER, fragment),
  ];
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.linkProgram(program);
  for (const shader of shaders) gl.deleteShader(shader);
  // The link status is read once, after both shaders compiled; on a lost context it reads false
  // too, which the caller treats like any other failure and retries after restore.
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? "";
    gl.deleteProgram(program);
    throw new Error(`The ${name} shader did not link: ${log}`);
  }
  return program;
}

function compileShader(gl: GL, name: string, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not create the ${name} shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new Error(
      `The ${name} ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader did not compile: ${log}`,
    );
  }
  return shader;
}

/** Uniform locations by name, looked up once per program. */
export function uniforms<const Names extends readonly string[]>(
  gl: GL,
  program: WebGLProgram,
  names: Names,
): Record<Names[number], WebGLUniformLocation | null> {
  const out = {} as Record<Names[number], WebGLUniformLocation | null>;
  for (const name of names) out[name as Names[number]] = gl.getUniformLocation(program, name);
  return out;
}

export interface Target {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

/** An RGBA8 texture with a framebuffer, linear filtering and clamped edges. */
export function createTarget(gl: GL, width: number, height: number): Target {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  setSampling(gl, gl.LINEAR);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

export function deleteTarget(gl: GL, target: Target | null | undefined): void {
  if (!target) return;
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

export function setSampling(gl: GL, filter: number): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/**
 * A float texture used as a table the shaders read with texelFetch: scroll offsets, clips and
 * surface transforms. Grown by reallocation, so callers re-upload after `ensure` reports growth.
 */
export class DataTexture {
  texture: WebGLTexture;
  width: number;
  height = 0;

  constructor(
    private readonly gl: GL,
    width: number,
  ) {
    this.width = width;
    this.texture = gl.createTexture();
  }

  /** Upload `data` (RGBA float texels, row-major at `width` texels per row). */
  upload(data: Float32Array, texels: number): void {
    const gl = this.gl;
    const rows = Math.max(1, Math.ceil(texels / this.width));
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (rows > this.height) {
      // Grow in powers of two so a list that keeps growing reallocates rarely.
      let height = Math.max(1, this.height);
      while (height < rows) height *= 2;
      this.height = height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.width, height, 0, gl.RGBA, gl.FLOAT, null);
      setSampling(gl, gl.NEAREST);
    }
    // These flags would otherwise rescale the table by its fourth component.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const needed = rows * this.width * 4;
    const padded = data.length >= needed ? data : grow(data, needed);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, rows, gl.RGBA, gl.FLOAT, padded, 0);
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
  }
}

function grow(data: Float32Array, length: number): Float32Array {
  const out = new Float32Array(length);
  out.set(data);
  return out;
}
