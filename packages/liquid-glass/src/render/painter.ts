import type { Atlas } from "./atlas";
import { INSTANCE_FLOATS, type DisplayList, type Group } from "./display-list";
import { compileProgram, DataTexture, type GL, uniforms } from "./gl";
import type { Box } from "./rect";
import itemsFragment from "./shaders/items.frag.glsl?raw";
import itemsVertex from "./shaders/items.vert.glsl?raw";

const UNIFORMS = [
  "uScroll",
  "uOwners",
  "uClips",
  "uPage",
  "uSpace",
  "uLocalOrigin",
  "uScale",
  "uTarget",
  "uCull",
  "uOnly",
] as const;

/** Texture units the painter binds; other passes use their own. */
const UNIT_SCROLL = 4;
const UNIT_OWNERS = 5;
const UNIT_CLIPS = 6;
const UNIT_PAGE = 7;

export interface PaintTarget {
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

export interface PaintOptions {
  /** 0: viewport (screen CSS px); 1: one surface's canvas space, for labels drawn in glass. */
  readonly space: 0 | 1;
  /** In surface space: where the surface's local (0, 0) lands, CSS px (the bleed). */
  readonly localOrigin: readonly [number, number];
  /** Target device px per CSS px. */
  readonly scale: number;
  /** Device-px region to paint; everything else is left alone. */
  readonly region: Box;
  /** Paint only what scrolls inside a scroller a progressive blur replaces. */
  readonly replacedOnly?: boolean;
}

/**
 * Draws display list items (boxes, shadows, bitmaps) with instanced quads. It holds the GPU
 * copies of the instance data and of the per-frame tables the vertex shader reads: scroll
 * offsets and the current transform of every surface that owns items.
 */
export class ItemPainter {
  private readonly program: WebGLProgram;
  private readonly u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly scroll: DataTexture;
  private readonly owners: DataTexture;
  private readonly clips: DataTexture;
  private readonly empty: WebGLTexture;
  private groups: ReadonlyMap<number, Group> = new Map();
  private clipVersion = -1;

  constructor(private readonly gl: GL) {
    this.program = compileProgram(gl, "item", itemsVertex, itemsFragment);
    this.u = uniforms(gl, this.program, UNIFORMS);
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    this.scroll = new DataTexture(gl, 1024);
    this.owners = new DataTexture(gl, 2);
    this.clips = new DataTexture(gl, 768);
    this.empty = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.empty);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (let attribute = 0; attribute < 8; attribute += 1) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribDivisor(attribute, 1);
    }
    gl.bindVertexArray(null);
    // Empty tables still need storage so texelFetch has something to read.
    this.scroll.upload(new Float32Array(4), 1);
    this.owners.upload(new Float32Array(8), 2);
    this.clips.upload(new Float32Array(12), 3);
  }

  /** Bring instance data and the clip table up to date with the display list. */
  sync(list: DisplayList, atlas: Atlas, clipVersion: number): void {
    const gl = this.gl;
    const { data, groups, rebuilt } = list.instances(atlas);
    if (rebuilt) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        data.byteLength ? data : new Float32Array(INSTANCE_FLOATS),
        gl.STATIC_DRAW,
      );
      this.groups = groups;
    }
    if (rebuilt || clipVersion !== this.clipVersion) {
      const clips = list.clipData();
      this.clips.upload(clips.data, Math.max(1, clips.count) * 3);
      this.clipVersion = clipVersion;
    }
  }

  /** Per-frame tables: scroll offsets per scroller, transform and base offset per owner slot. */
  setFrame(scrollOffsets: Float32Array, ownerTable: Float32Array): void {
    this.scroll.upload(scrollOffsets, Math.max(1, scrollOffsets.length / 4));
    this.owners.upload(ownerTable, Math.max(2, ownerTable.length / 4));
  }

  hasItems(owner: number): boolean {
    return (this.groups.get(owner)?.count ?? 0) > 0;
  }

  /** Paint one owner's items into `target`, blended over what is there. */
  paint(owner: number, target: PaintTarget, options: PaintOptions, atlas: Atlas): void {
    const group = this.groups.get(owner);
    if (!group || group.count === 0) return;
    const gl = this.gl;
    const [x0, y0, x1, y1] = options.region;
    if (x1 <= x0 || y1 <= y0) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, y0, x1 - x0, y1 - y0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    const u = this.u;
    gl.uniform1i(u.uSpace, options.space);
    gl.uniform2f(u.uLocalOrigin, options.localOrigin[0], options.localOrigin[1]);
    gl.uniform1f(u.uScale, options.scale);
    gl.uniform2f(u.uTarget, target.width, target.height);
    gl.uniform4f(u.uCull, x0, y0, x1, y1);
    gl.uniform1i(u.uOnly, options.replacedOnly ? 1 : 0);
    this.bind(UNIT_SCROLL, this.scroll.texture, u.uScroll);
    this.bind(UNIT_OWNERS, this.owners.texture, u.uOwners);
    this.bind(UNIT_CLIPS, this.clips.texture, u.uClips);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = INSTANCE_FLOATS * 4;
    for (const run of group.runs) {
      this.bind(UNIT_PAGE, (run.page >= 0 ? atlas.texture(run.page) : null) ?? this.empty, u.uPage);
      // No base-instance in WebGL2, so each run points the attributes at its first instance.
      for (let attribute = 0; attribute < 8; attribute += 1) {
        gl.vertexAttribPointer(
          attribute,
          4,
          gl.FLOAT,
          false,
          stride,
          run.start * stride + attribute * 16,
        );
      }
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, run.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  private bind(unit: number, texture: WebGLTexture, location: WebGLUniformLocation | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  }
}
