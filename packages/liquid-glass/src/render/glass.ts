import type { Material, Shape, SurfaceFrame } from "../protocol";
import type { Frost } from "./frost";
import { compileProgram, type GL, uniforms } from "./gl";
import { type Box, fromRect, union, EMPTY } from "./rect";
import fullscreenVertex from "./shaders/fullscreen.vert.glsl?raw";
import glassFragment from "./shaders/glass.frag.glsl?raw";

export const MAX_SHAPES = 8;

/** Merging, in CSS px: shapes start melting 7.33 px apart and fully merge at a 24 px radius. */
const MERGE_START_GAP = 7.33;
const MERGE_MAX_RADIUS = 24;

const UNIFORMS = [
  "uFragToLocal",
  "uLocalToScreen",
  "uViewport",
  "uPixel",
  "uBackdrop",
  "uFrost",
  "uFrosted",
  "uFrostScale",
  "uFrostGamma",
  "uLabels",
  "uLabeled",
  "uLabelMap",
  "uBodyEnd",
  "uLensEnd",
  "uPillEnd",
  "uBox",
  "uRadii",
  "uShape",
  "uShapeTint",
  "uShapeLight",
  "uSmoothing",
  "uDark",
  "uBezel",
  "uPull",
  "uFalloff",
  "uDispersion",
  "uFace",
  "uLighting",
  "uSharp",
  "uLight",
  "uTint",
  "uDim",
  "uShadow",
  "uShadowAlpha",
  "uOpacity",
] as const;

const UNIT_BACKDROP = 0;
const UNIT_FROST = 1;
const UNIT_LABELS = 2;

/** Shapes in the order the shader wants them: bodies, then lenses and thumbs, then pills. */
export interface ShapeSet {
  readonly shapes: readonly Shape[];
  readonly bodyEnd: number;
  readonly lensEnd: number;
  /** Merge radius of each shape with the shapes before it in its group. */
  readonly merge: readonly number[];
}

export function arrangeShapes(surface: SurfaceFrame): ShapeSet {
  const visible = surface.shapes.filter(
    (shape) => shape.alpha > 0 && shape.rect.width > 0 && shape.rect.height > 0,
  );
  const bodies = visible.filter((shape) => shape.role === "body");
  const lenses = visible.filter((shape) => shape.role === "lens" || shape.role === "thumb");
  const pills = visible.filter((shape) => shape.role === "pill");
  const shapes = [...bodies, ...lenses, ...pills].slice(0, MAX_SHAPES);
  const bodyEnd = Math.min(bodies.length, MAX_SHAPES);
  const lensEnd = Math.min(bodies.length + lenses.length, MAX_SHAPES);
  const merge = shapes.map((shape, index) => {
    const first = index < bodyEnd ? 0 : index < lensEnd ? bodyEnd : lensEnd;
    let radius = 0;
    for (let other = first; other < index; other += 1) {
      const before = shapes[other];
      if (before) radius = Math.max(radius, mergeRadius(before, shape));
    }
    return radius;
  });
  return { shapes, bodyEnd, lensEnd, merge };
}

/**
 * How much two shapes melt: nothing while they are more than the start gap apart, then a
 * radius that eases up to its largest as the gap closes. The start gap scales with the
 * largest radius, so smaller merges start closer.
 */
function mergeRadius(a: Shape, b: Shape): number {
  const largest = Math.min(a.merge, b.merge, MERGE_MAX_RADIUS * 4);
  if (largest <= 0) return 0;
  const start = (MERGE_START_GAP * largest) / MERGE_MAX_RADIUS;
  const dx =
    Math.abs(a.rect.x + a.rect.width / 2 - (b.rect.x + b.rect.width / 2)) -
    (a.rect.width + b.rect.width) / 2;
  const dy =
    Math.abs(a.rect.y + a.rect.height / 2 - (b.rect.y + b.rect.height / 2)) -
    (a.rect.height + b.rect.height) / 2;
  const gap = Math.max(dx, dy);
  const t = Math.min(1, Math.max(0, (start - gap) / start));
  return largest * t * t * (3 - 2 * t);
}

/**
 * Where a surface reads its backdrop, in its local CSS px: every shape with room for the
 * colour fringes and for a lens that shows a little more than it covers.
 */
export function readBounds(set: ShapeSet): Box {
  let box: Box = EMPTY;
  for (const shape of set.shapes) {
    const r = shape.rect;
    const magnify = Math.max(shape.magnify, 0.05);
    const overshoot = magnify < 1 ? (1 / magnify - 1) * Math.max(r.width, r.height) * 0.5 : 0;
    const margin = 4 + overshoot;
    box = union(
      box,
      fromRect(r.x - margin, r.y - margin, r.width + 2 * margin, r.height + 2 * margin),
    );
  }
  return box;
}

/** Frost is averaged in a gamma that favours the lighter (light) or darker (dark) detail. */
export function frostGamma(material: Material): number {
  return material.appearance === "dark" ? 0.8 : 1.4;
}

export interface GlassDraw {
  readonly surface: SurfaceFrame;
  readonly set: ShapeSet;
  /** Output framebuffer (null: the canvas) and its size in device px. */
  readonly framebuffer: WebGLFramebuffer | null;
  readonly targetWidth: number;
  readonly targetHeight: number;
  /** Device-px region of the target to draw, top row first for framebuffers, GL order for the canvas. */
  readonly scissor: Box;
  /** local = gl_FragCoord.xy * xy + zw */
  readonly fragToLocal: readonly [number, number, number, number];
  readonly pixel: number;
  readonly backdrop: WebGLTexture;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly frost: Frost | null;
  readonly labels: { texture: WebGLTexture; map: readonly [number, number, number, number] } | null;
  /** Blend over the target (composites) or replace it (the canvas, cleared first). */
  readonly blend: boolean;
  /**
   * How opaque to draw. The surface's own canvas is drawn opaque: CSS fades it with the
   * surface. Drawn into a higher surface's backdrop, it carries the surface's opacity.
   */
  readonly opacity: number;
}

export class GlassPass {
  private readonly program: WebGLProgram;
  private readonly u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly box = new Float32Array(MAX_SHAPES * 4);
  private readonly radii = new Float32Array(MAX_SHAPES * 4);
  private readonly shape = new Float32Array(MAX_SHAPES * 4);
  private readonly tint = new Float32Array(MAX_SHAPES * 4);
  private readonly light = new Float32Array(MAX_SHAPES);
  private readonly smoothing = new Float32Array(MAX_SHAPES);
  private readonly empty: WebGLTexture;

  constructor(private readonly gl: GL) {
    this.program = compileProgram(gl, "glass", fullscreenVertex, glassFragment);
    this.u = uniforms(gl, this.program, UNIFORMS);
    this.empty = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.empty);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }

  draw(d: GlassDraw): void {
    const gl = this.gl;
    const u = this.u;
    const { surface, set } = d;
    const material = surface.material;
    const [x0, y0, x1, y1] = d.scissor;
    if (x1 <= x0 || y1 <= y0) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, d.framebuffer);
    gl.viewport(0, 0, d.targetWidth, d.targetHeight);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, y0, x1 - x0, y1 - y0);
    if (d.blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.useProgram(this.program);

    const sx = surface.size.width > 0 ? surface.screen.width / surface.size.width : 1;
    const sy = surface.size.height > 0 ? surface.screen.height / surface.size.height : 1;
    gl.uniform4f(
      u.uFragToLocal,
      d.fragToLocal[0],
      d.fragToLocal[1],
      d.fragToLocal[2],
      d.fragToLocal[3],
    );
    gl.uniform4f(u.uLocalToScreen, sx || 1, sy || 1, surface.screen.x, surface.screen.y);
    gl.uniform2f(u.uViewport, d.viewport.width, d.viewport.height);
    gl.uniform1f(u.uPixel, d.pixel);

    gl.activeTexture(gl.TEXTURE0 + UNIT_BACKDROP);
    gl.bindTexture(gl.TEXTURE_2D, d.backdrop);
    gl.uniform1i(u.uBackdrop, UNIT_BACKDROP);
    gl.activeTexture(gl.TEXTURE0 + UNIT_FROST);
    gl.bindTexture(gl.TEXTURE_2D, d.frost?.texture ?? this.empty);
    gl.uniform1i(u.uFrost, UNIT_FROST);
    gl.uniform1i(u.uFrosted, d.frost ? 1 : 0);
    gl.uniform2f(u.uFrostScale, d.frost?.uvScale[0] ?? 0, d.frost?.uvScale[1] ?? 0);
    gl.uniform1f(u.uFrostGamma, d.frost?.gamma ?? 1);
    gl.activeTexture(gl.TEXTURE0 + UNIT_LABELS);
    gl.bindTexture(gl.TEXTURE_2D, d.labels?.texture ?? this.empty);
    gl.uniform1i(u.uLabels, UNIT_LABELS);
    gl.uniform1i(u.uLabeled, d.labels ? 1 : 0);
    const map = d.labels?.map ?? [0, 0, 0, 0];
    gl.uniform4f(u.uLabelMap, map[0], map[1], map[2], map[3]);

    this.box.fill(0);
    this.radii.fill(0);
    this.shape.fill(0);
    this.tint.fill(0);
    this.light.fill(0);
    this.smoothing.fill(0);
    set.shapes.forEach((shape, i) => {
      const r = shape.rect;
      this.box.set([r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2], i * 4);
      this.radii.set(shape.radii, i * 4);
      this.shape.set(
        [
          Math.min(1, Math.max(0, shape.lift)),
          shape.magnify > 0 ? shape.magnify : 1,
          Math.min(1, shape.alpha),
          set.merge[i] ?? 0,
        ],
        i * 4,
      );
      if (shape.tint) this.tint.set(shape.tint, i * 4);
      this.light[i] = Math.min(1, Math.max(0, shape.light));
      this.smoothing[i] = Math.min(1, Math.max(0, shape.smoothing ?? 1));
    });
    gl.uniform1i(u.uBodyEnd, set.bodyEnd);
    gl.uniform1i(u.uLensEnd, set.lensEnd);
    gl.uniform1i(u.uPillEnd, set.shapes.length);
    gl.uniform4fv(u.uBox, this.box);
    gl.uniform4fv(u.uRadii, this.radii);
    gl.uniform4fv(u.uShape, this.shape);
    gl.uniform4fv(u.uShapeTint, this.tint);
    gl.uniform1fv(u.uShapeLight, this.light);
    gl.uniform1fv(u.uSmoothing, this.smoothing);

    gl.uniform1f(u.uDark, material.appearance === "dark" ? 1 : 0);
    gl.uniform1f(u.uBezel, Math.max(0, material.bezel));
    gl.uniform1f(u.uPull, Math.max(0, material.pull));
    gl.uniform1f(u.uFalloff, Math.max(0.5, material.falloff));
    gl.uniform1f(u.uDispersion, Math.min(1, Math.max(0, material.dispersion)));
    gl.uniform2f(u.uSharp, material.sharp, material.rimSharp);
    // Specular glass turns its highlights to the axis it is given; other glass is lit from above.
    const angle = material.lightAngle ?? null;
    gl.uniform2f(
      u.uLight,
      angle === null ? 0 : Math.cos(angle),
      angle === null ? -1 : Math.sin(angle),
    );
    gl.uniform4f(u.uFace, material.lift, material.gain, material.curve, material.saturation);
    gl.uniform4f(
      u.uLighting,
      material.shine,
      material.sheen,
      material.hairline,
      material.hairlineCap,
    );
    const tint = material.tint ?? [0, 0, 0, 0];
    gl.uniform4f(u.uTint, tint[0], tint[1], tint[2], tint[3]);
    gl.uniform1f(u.uDim, Math.min(1, Math.max(0, material.dim)));
    const shadow = material.shadow;
    gl.uniform4f(
      u.uShadow,
      shadow?.x ?? 0,
      shadow?.y ?? 0,
      (shadow?.blur ?? 0) / 2,
      shadow?.spread ?? 0,
    );
    gl.uniform1f(u.uShadowAlpha, shadow ? shadow.color[3] : 0);
    gl.uniform1f(u.uOpacity, Math.min(1, Math.max(0, d.opacity)));

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.gl.deleteTexture(this.empty);
  }
}
