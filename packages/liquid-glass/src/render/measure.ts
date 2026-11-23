import type { BackdropReading } from "../protocol";
import { compileProgram, createTarget, deleteTarget, type GL, type Target, uniforms } from "./gl";
import fullscreenVertex from "./shaders/fullscreen.vert.glsl?raw";
import measureFragment from "./shaders/measure.frag.glsl?raw";

/**
 * Measures what is behind each redrawn surface, on the GPU, and reads the numbers back without
 * stalling: every surface drawn in a frame writes one texel (mean luma, variation, bright share)
 * of a small target, the frame ends with one `readPixels` into a pixel buffer and a fence, and
 * `collect` picks the result up once the GPU has passed the fence (usually a few ms later).
 * The page turns readings into the surface's tone, dimming and shadow (core/adapt.ts).
 */

/** Texels per row of the target; more surfaces than this in one frame wait for a later one. */
const WIDTH = 64;
/** Readbacks in flight at once; a frame that finds them all busy measures nothing. */
const BUFFERS = 3;

interface Readback {
  readonly buffer: WebGLBuffer;
  sync: WebGLSync | null;
  ids: number[];
}

export class BackdropMeter {
  private readonly program: WebGLProgram;
  private readonly u;
  private readonly target: Target;
  private readonly idle: Readback[] = [];
  private readonly pending: Readback[] = [];
  private ids: number[] = [];

  constructor(private readonly gl: GL) {
    this.program = compileProgram(gl, "measure", fullscreenVertex, measureFragment);
    this.u = uniforms(gl, this.program, ["uBackdrop", "uViewport", "uBox"] as const);
    this.target = createTarget(gl, WIDTH, 1);
    for (let i = 0; i < BUFFERS; i += 1) {
      const buffer = gl.createBuffer();
      this.idle.push({ buffer, sync: null, ids: [] });
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  /** Whether readbacks are waiting for the GPU. */
  get busy(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Measure surface `id`'s backdrop over `box` (screen CSS px: left, top, right, bottom).
   * Call between `render` steps; it changes the bound framebuffer, program and texture unit 0.
   */
  measure(
    id: number,
    backdrop: WebGLTexture,
    box: readonly [number, number, number, number],
    viewport: { width: number; height: number },
  ): void {
    if (this.ids.length >= WIDTH || this.idle.length === 0) return;
    if (box[2] - box[0] < 1 || box[3] - box[1] < 1) return;
    const gl = this.gl;
    const x = this.ids.length;
    this.ids.push(id);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    gl.viewport(0, 0, WIDTH, 1);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, 0, 1, 1);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backdrop);
    gl.uniform1i(this.u.uBackdrop, 0);
    gl.uniform2f(this.u.uViewport, viewport.width, viewport.height);
    gl.uniform4f(this.u.uBox, box[0], box[1], box[2], box[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Start reading back what this frame measured. */
  flush(): void {
    if (!this.ids.length) return;
    const readback = this.idle.pop();
    if (!readback) {
      this.ids = [];
      return;
    }
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readback.buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, WIDTH * 4, gl.STREAM_READ);
    // The whole row, read back whole: a partial read leaves the driver's readback copy unused.
    gl.readPixels(0, 0, WIDTH, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    readback.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    readback.ids = this.ids;
    this.ids = [];
    this.pending.push(readback);
    gl.flush();
  }

  /** Readings whose readback has completed, oldest first. Never waits. */
  collect(): BackdropReading[] {
    const gl = this.gl;
    const readings: BackdropReading[] = [];
    while (this.pending.length) {
      const readback = this.pending[0]!;
      const sync = readback.sync;
      if (sync && gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) break;
      this.pending.shift();
      if (sync) gl.deleteSync(sync);
      readback.sync = null;
      const bytes = new Uint8Array(WIDTH * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readback.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      readback.ids.forEach((id, index) => {
        readings.push({
          id,
          luma: (bytes[index * 4] ?? 0) / 255,
          contrast: (bytes[index * 4 + 1] ?? 0) / 255,
          bright: (bytes[index * 4 + 2] ?? 0) / 255,
          detail: (bytes[index * 4 + 3] ?? 0) / 255,
        });
      });
      readback.ids = [];
      this.idle.push(readback);
    }
    return readings;
  }

  dispose(): void {
    const gl = this.gl;
    for (const readback of [...this.idle, ...this.pending]) {
      if (readback.sync) gl.deleteSync(readback.sync);
      gl.deleteBuffer(readback.buffer);
    }
    this.idle.length = 0;
    this.pending.length = 0;
    deleteTarget(gl, this.target);
    gl.deleteProgram(this.program);
  }
}
