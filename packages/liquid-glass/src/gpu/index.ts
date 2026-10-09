import { outlineSegments } from "../core/concentric.js";
import type { ShapePoint } from "../core/concentric.js";
import { shapeSegments } from "../core/shape.js";
import type { GlassRadius } from "../core/shape.js";
import { effect, frame, init, target } from "vgpu";
import type { Effect, Gpu, Target, ShaderSource } from "vgpu";
import source from "./maps.wgsl";
export interface MapGeometry {
  /** Resolved convex outline for container-relative glass, in local CSS pixels. */
  outline?: ShapePoint[];
  width: number;
  height: number;
  radius: GlassRadius;
  dpr?: number;
  appearance?: "light" | "dark";
}
export interface MapPixels {
  width: number;
  height: number;
  pixels: Uint8Array;
  duration: number;
}
/** A validated request, laid out in an atlas band of four planes. */
interface Shape {
  geometry: MapGeometry;
  columns: number;
  rows: number;
  dpr: number;
  segments: number[][];
  resolve: (pixels: MapPixels) => void;
  reject: (error: Error) => void;
  started: number;
}
const maxShapes = 32;
const maxSegments = 4096;
const maxAtlasRows = 8192;
/** Pixels per CSS pixel a map is rendered at. Maps are stretched to their
 * surface when drawn, so a surface too large for the atlas at the display's
 * ratio, such as a full-height panel on a 2x or 3x display, renders at a
 * lower ratio instead of failing. */
export function mapScale(g: MapGeometry): number {
  const dpr = Math.max(1, Math.min(g.dpr ?? 1, 2));
  const fit = Math.min(1, 4096 / ((g.width + 4) * dpr), (maxAtlasRows / 4) / ((g.height + 4) * dpr));
  return fit < 1 ? Math.max(0.25, dpr * fit) : dpr;
}
/** Measure a request and tessellate its outline; invalid geometry throws here,
 * before anything is queued. */
function measure(g: MapGeometry): Omit<Shape, "resolve" | "reject" | "started"> {
  if (![g.width, g.height, g.dpr ?? 1].every(Number.isFinite) || g.width <= 0 || g.height <= 0)
    throw new RangeError("Glass geometry must have positive, finite dimensions.");
  const dpr = mapScale(g);
  const columns = Math.ceil((g.width + 4) * dpr), rows = Math.ceil((g.height + 4) * dpr);
  if (columns > 4096 || rows * 4 > maxAtlasRows)
    throw new RangeError("Glass map exceeds the 4096 × 2048 pixel surface limit.");
  const { segments } = g.outline ? outlineSegments(g.outline) : shapeSegments(g.width, g.height, g.radius);
  return { geometry: g, columns, rows, dpr, segments };
}
/** One render target per batch in flight, reused once its readback completes. */
interface Slot { target: Target; busy: boolean }
/** One GPU device, one compiled pipeline. Requests made in the same task are
 * rendered together: every shape of a batch is one band of an atlas, drawn
 * in one pass and read back once, so an animation path costs one roundtrip. */
export class MaterialRenderer {
  private readonly shader: Effect;
  private readonly ready: Promise<unknown>;
  private readonly slots: Slot[] = [];
  private queue: Shape[] = [];
  private flushing = false;
  /** Resolves once the device has completed its first submission. A fresh
   * device's first work is held back while the page keeps painting, so the
   * renderer warms itself up as soon as it exists rather than during a
   * surface's first animation. */
  readonly warmed: Promise<void>;
  constructor(private readonly gpu: Gpu) {
    const blank = { size: [1, 1], row: 0, rows: 1, columns: 1, dpr: 1, dark: 0, symmetric: 1, start: 0, count: 0, pad: [0, 0] };
    this.shader = effect(gpu, source, {
      label: "liquid-glass/material-field",
      set: {
        batch: { count: 1, pad: [0, 0, 0], shapes: Array.from({ length: maxShapes }, () => blank) },
        outline: { segments: Array.from({ length: maxSegments }, () => [0, 0, 0, 0]) },
      },
    });
    // Compile once against the atlas format; later batches reuse the pipeline.
    this.ready = this.shader.compile({ colors: ["rgba8unorm"] }).catch(() => undefined);
    this.warmed = this.ready.then(() => this.render({ width: 4, height: 4, radius: 2, dpr: 1 })).then(() => undefined, () => undefined);
  }
  render(geometry: MapGeometry): Promise<MapPixels> {
    const started = performance.now();
    return new Promise<MapPixels>((resolve, reject) => {
      let shape: Omit<Shape, "resolve" | "reject" | "started">;
      try { shape = measure(geometry); } catch (error) { reject(error as Error); return; }
      this.queue.push({ ...shape, resolve, reject, started });
      if (!this.flushing) {
        this.flushing = true;
        // Collect every request of the current task before drawing.
        queueMicrotask(() => this.flush());
      }
    });
  }
  private flush() {
    this.flushing = false;
    const shapes = this.queue;
    this.queue = [];
    // Pack in request order; a batch holds what fits its shape, segment, and row budgets.
    let batch: Shape[] = [], segments = 0, rows = 0;
    const batches: Shape[][] = [];
    for (const shape of shapes) {
      const band = shape.rows * 4 + (shape.rows * 4) % 2;
      if (batch.length && (batch.length === maxShapes || segments + shape.segments.length > maxSegments || rows + band > maxAtlasRows)) {
        batches.push(batch); batch = []; segments = 0; rows = 0;
      }
      batch.push(shape); segments += shape.segments.length; rows += band;
    }
    if (batch.length) batches.push(batch);
    for (const group of batches) void this.draw(group);
  }
  private slot(size: [number, number]): Slot {
    let slot = this.slots.find((s) => !s.busy);
    if (!slot) {
      slot = { target: target(this.gpu, { size, label: "liquid-glass/maps" }), busy: true };
      this.slots.push(slot);
      return slot;
    }
    slot.busy = true;
    if (slot.target.size[0] !== size[0] || slot.target.size[1] !== size[1]) slot.target.resize(size);
    return slot;
  }
  private async draw(shapes: Shape[]) {
    try {
      await this.ready;
      const width = Math.max(...shapes.map((s) => s.columns));
      const bands: number[] = [];
      let row = 0;
      const table: number[][] = [];
      const entries = shapes.map((s) => {
        bands.push(row);
        const start = table.length;
        table.push(...s.segments);
        const entry = {
          size: [s.geometry.width, s.geometry.height], row, rows: s.rows, columns: s.columns, dpr: s.dpr,
          dark: s.geometry.appearance === "dark" ? 1 : 0, symmetric: s.geometry.outline ? 0 : 1,
          start, count: s.segments.length, pad: [0, 0],
        };
        // Bands start on even rows so derivative quads never straddle two shapes.
        row += s.rows * 4 + (s.rows * 4) % 2;
        return entry;
      });
      const height = row;
      while (entries.length < maxShapes) entries.push({ ...entries[0]!, row: height + 2 });
      while (table.length < maxSegments) table.push([0, 0, 0, 0]);
      const slot = this.slot([width, height]);
      try {
        // Uniform writes and the pass are encoded without yielding, so a
        // following batch cannot overwrite them before this one is submitted.
        this.shader.set({ batch: { count: shapes.length, pad: [0, 0, 0], shapes: entries }, outline: { segments: table } });
        frame(this.gpu, (f) => f.pass({ target: slot.target, clear: [0, 0, 0, 0] }, this.shader));
        const atlas = await slot.target.color.read({ mipLevel: 0, region: "all" });
        const now = performance.now();
        shapes.forEach((s, i) => {
          const planeRows = s.rows * 4;
          const pixels = new Uint8Array(s.columns * planeRows * 4);
          for (let y = 0; y < planeRows; y++) {
            const from = ((bands[i]! + y) * width) * 4;
            pixels.set(atlas.subarray(from, from + s.columns * 4), y * s.columns * 4);
          }
          s.resolve({ width: s.columns, height: s.rows, pixels, duration: now - s.started });
        });
      } finally {
        slot.busy = false;
      }
    } catch (error) {
      for (const s of shapes) s.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  dispose(): void {
    this.gpu.dispose();
  }
}
let renderer: Promise<MaterialRenderer> | undefined;
export function getMaterialRenderer(): Promise<MaterialRenderer> {
  if (renderer) return renderer;
  const next = init()
    .then((gpu) => {
      const current = new MaterialRenderer(gpu);
      gpu.gpu.lost.then(() => {
        if (renderer === next) renderer = undefined;
      });
      return current;
    })
    .catch((error) => {
      if (renderer === next) renderer = undefined;
      throw error;
    });
  renderer = next;
  return next;
}
export async function disposeMaterialRenderer(): Promise<void> {
  const current = renderer;
  renderer = undefined;
  if (current) (await current).dispose();
}
export const materialShader: ShaderSource = source;
