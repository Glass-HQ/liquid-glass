import { EDGE_FROSTS } from "../core/material";
import type { BackdropReading, DisplayListPatch, FrameMessage, SurfaceFrame } from "../protocol";
import { Atlas } from "./atlas";
import { DisplayList, surfaceScale } from "./display-list";
import { FrostCache, frostCell, type Frost } from "./frost";
import { createTarget, deleteTarget, type GL, type Target } from "./gl";
import { arrangeShapes, frostGamma, GlassPass, readBounds, type ShapeSet } from "./glass";
import { BackdropMeter } from "./measure";
import { ItemPainter } from "./painter";
import {
  contains,
  covers,
  EMPTY,
  expand,
  fromRect,
  intersect,
  intersects,
  isEmpty,
  toPixels,
  holding,
  union,
  withBox,
  type Box,
  type Region,
} from "./rect";

/**
 * One frame, start to finish:
 *
 * 1. Plan (CPU only). Surfaces are grouped into levels: a surface sits one level above the
 *    highest lower-ranked surface it overlaps. Level 0's backdrop is the page; level L's is
 *    level L-1's plus the glass and items of the level L-1 surfaces. Each level
 *    gets a signature of everything its pixels depend on and the region its surfaces read.
 * 2. Backdrops. The page texture is repainted only in the region glass reads, and only when the
 *    display list or scrolling changed or glass moved beyond what was painted. A higher level
 *    copies the level below and draws the lower surfaces over it, again only when needed; when
 *    no lower surface overlaps what it reads, it simply reuses the level below.
 * 3. Frost for frosted surfaces, cached per backdrop.
 * 4. Glass for every surface whose inputs changed, into a region of the shared GL canvas, then
 *    `drawImage` into its placeholder canvas. A surface's inputs are its own frame and the page
 *    and lower surfaces only where it reads, so an unchanged placeholder is never re-presented.
 */

/** Extra CSS px repainted around what glass reads, so small moves reuse the backdrop. */
const MARGIN = 64;
/** The GL canvas's size is a multiple of this. */
const CANVAS_STEP = 128;
/** Frames of history the GL canvas is sized for when it shrinks. */
const SHRINK_AFTER_FRAMES = 60;

export interface Timings {
  underlay: number;
  frost: number;
  glass: number;
  copy: number;
  surfaces: number;
  /** Of `surfaces`, how many were redrawn only in part, and the device px redrawn in all. */
  partial: number;
  pixels: number;
}

interface Slot {
  readonly canvas: OffscreenCanvas;
  readonly context: OffscreenCanvasRenderingContext2D | null;
  /** Inputs of what the placeholder shows now; equal inputs skip drawing and copying. */
  signature: string;
  labels: Target | null;
  labelSignature: string;
  /** What the placeholder shows, in parts, so a frame redraws only the part that changed. */
  shown: Shown | null;
}

/**
 * A placeholder's pixels, by what they depend on. `whole`: inputs that change every pixel (size,
 * shadow, labels). `inside`: what shows only inside the shapes (the backdrop where the glass
 * reads, where it is on screen, and the material's frost and tone). `shapes`: one key per shape,
 * and `boxes` the local CSS px each one's change reaches (its shadow, lens ring and merging).
 */
interface Shown {
  readonly whole: string;
  readonly inside: string;
  readonly shapes: readonly string[];
  readonly boxes: readonly Box[];
}

/** A region of the GL canvas (x, y, size) to copy into a placeholder at (dx, dy). */
interface Copy {
  readonly slot: Slot;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly dx: number;
  readonly dy: number;
  /** The placeholder's size; a copy smaller than it leaves the rest as it was. */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

interface Plan {
  readonly surface: SurfaceFrame;
  readonly set: ShapeSet;
  readonly scale: readonly [number, number];
  /** Screen CSS px the glass reads from its backdrop. */
  readonly read: Box;
  /** Screen CSS px the backdrop must be valid over (reads plus the frost's reach). */
  readonly paint: Box;
  /** Screen CSS px the surface's canvas covers. */
  readonly footprint: Box;
  /** Frost sigma rounded to half px (0: none). */
  readonly sigma: number;
  /** A progressive blur's lighter frosts, lightest first (none for glass). */
  readonly lighter: readonly number[];
  /** A progressive blur that draws only the content of the scroller it replaces. */
  readonly replacing: boolean;
  readonly gamma: number;
  /** Placeholder size in device px. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  level: number;
}

interface Layer {
  target: Target | null;
  signature: string;
  /** Where the layer holds what its signature says, CSS px. */
  valid: Region;
  usedAt: number;
}

/** What a level reads: a texture, the key frost is cached under, its signature and validity. */
interface Level {
  readonly key: string;
  readonly signature: string;
  layer: Layer;
}

interface Gpu {
  readonly painter: ItemPainter;
  readonly frost: FrostCache;
  readonly glass: GlassPass;
  readonly meter: BackdropMeter;
}

export class Renderer {
  readonly list = new DisplayList();
  readonly atlas: Atlas;
  private gpu: Gpu | null;
  private readonly slots = new Map<number, Slot>();
  private page: Layer = { target: null, signature: "", valid: [], usedAt: 0 };
  /** Only what scrolls inside the scrollers progressive blurs replace, over nothing. */
  private content: Layer = { target: null, signature: "", valid: [], usedAt: 0 };
  private layers: Layer[] = [];
  private sceneWidth = 0;
  private sceneHeight = 0;
  private scrollVersion = 0;
  private lastOffsets: Float32Array = new Float32Array(0);
  private frameIndex = 0;
  private compactedAt = -Infinity;
  /** The GL canvas size each of the last frames needed. */
  private readonly recent: [number, number][] = [];
  private readonly maxTexture: number;
  private readonly maxCanvas: number;

  constructor(
    private readonly canvas: OffscreenCanvas,
    private gl: GL,
    private readonly desynchronized: boolean,
  ) {
    this.atlas = new Atlas(gl);
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maxCanvas = Math.min(this.maxTexture, dims[0] ?? 4096, dims[1] ?? 4096, 8192);
    this.gpu = this.createGpu();
  }

  attach(id: number, canvas: OffscreenCanvas): void {
    this.detach(id);
    // Every surface is drawn into one GL canvas and copied out by region. Measured alternatives
    // (apps/lab present.html): bitmaprenderer placeholders fed by a GL canvas resized to each
    // surface cost about 1 ms per resize in Chromium and a readback per surface in Gecko; cropping
    // one snapshot with createImageBitmap is slower everywhere; drawing the GL canvas itself into
    // each placeholder resolves it once per surface. WebKit copies every placeholder on commit
    // whatever its context, so there the number of placeholders updated per frame is what counts.
    const context = canvas.getContext("2d", { alpha: true, desynchronized: this.desynchronized });
    this.slots.set(id, {
      canvas,
      context,
      signature: "",
      labels: null,
      labelSignature: "",
      shown: null,
    });
  }

  detach(id: number): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    deleteTarget(this.gl, slot.labels);
    this.slots.delete(id);
  }

  display(patch: DisplayListPatch): void {
    this.list.apply(patch, this.atlas);
    // Packing the atlas again uploads every bitmap, so it's done at most once a second.
    const now = performance.now();
    if (now - this.compactedAt > 1000 && this.atlas.compact()) this.compactedAt = now;
    for (const id of this.atlas.dropped) {
      console.warn(`liquid-glass: bitmap ${id} does not fit the texture atlas and is not drawn`);
    }
    this.atlas.dropped.clear();
  }

  /** The context is gone: forget every GPU object (they are invalid) until it is restored. */
  lose(): void {
    this.gpu = null;
  }

  /** Recreate GPU state and upload everything again from what the worker kept. */
  restore(gl: GL): void {
    this.gl = gl;
    this.atlas.restore(gl);
    this.list.invalidate();
    this.page = { target: null, signature: "", valid: [], usedAt: 0 };
    this.content = { target: null, signature: "", valid: [], usedAt: 0 };
    this.layers = [];
    this.sceneWidth = 0;
    this.sceneHeight = 0;
    for (const slot of this.slots.values()) {
      slot.signature = "";
      slot.labels = null;
      slot.labelSignature = "";
      slot.shown = null;
    }
    this.gpu = this.createGpu();
  }

  /** Whether backdrop readings are on their way back from the GPU (see `readings`). */
  get measuring(): boolean {
    return this.gpu?.meter.busy ?? false;
  }

  /** Backdrop readings whose readback has completed since the last call. Never waits. */
  readings(): BackdropReading[] {
    const gpu = this.gpu;
    if (!gpu || this.gl.isContextLost()) return [];
    return gpu.meter.collect();
  }

  get lost(): boolean {
    return this.gpu === null || this.gl.isContextLost();
  }

  render(frame: FrameMessage): Timings {
    const timings: Timings = {
      underlay: 0,
      frost: 0,
      glass: 0,
      copy: 0,
      surfaces: 0,
      partial: 0,
      pixels: 0,
    };
    const gpu = this.gpu;
    if (!gpu || this.gl.isContextLost()) return timings;
    const gl = this.gl;
    this.frameIndex += 1;
    gpu.frost.beginFrame();

    const { width: vw, height: vh, dpr } = frame.viewport;
    if (vw <= 0 || vh <= 0) return timings;
    // The backdrop is at device resolution unless the viewport is larger than a texture can be.
    const scale = Math.min(dpr, this.maxTexture / vw, this.maxTexture / vh);
    const pw = Math.max(1, Math.round(vw * scale));
    const ph = Math.max(1, Math.round(vh * scale));
    if (pw !== this.sceneWidth || ph !== this.sceneHeight) this.resizeScene(pw, ph);
    const view: Box = [0, 0, vw, vh];
    let started = performance.now();

    // Display list and per-frame tables.
    const replaced = new Set<number>();
    for (const surface of frame.surfaces)
      if (surface.material.edge?.replace && surface.replaces !== undefined)
        replaced.add(surface.replaces);
    const offsets = this.list.scrollOffsets(frame.scroll, replaced);
    this.list.assignAnchors(frame.surfaces, offsets);
    gpu.painter.sync(this.list, this.atlas, this.list.clipVersion);
    if (!sameFloats(offsets, this.lastOffsets)) {
      this.scrollVersion += 1;
      this.lastOffsets = offsets;
    }
    const byId = new Map(frame.surfaces.map((surface) => [surface.id, surface]));
    gpu.painter.setFrame(offsets, this.ownerTable(byId, offsets));

    // 1. Plan.
    const plans = frame.surfaces
      .filter((surface) => this.slots.has(surface.id))
      .map((surface) => planSurface(surface, view, dpr))
      .sort((a, b) => a.surface.rank - b.surface.rank || a.surface.id - b.surface.id);
    // A surface only needs to sit a level above the lower-ranked surfaces it overlaps (it reads
    // where they are, or they read where it is). Surfaces that don't overlap share a level, so
    // the number of backdrop layers is how deep glass is stacked, not how many surfaces there
    // are: 32 cards gliding over a page are two or three levels, not 32.
    const groups: Plan[][] = [];
    plans.forEach((plan, index) => {
      let level = 0;
      for (let other = 0; other < index; other += 1) {
        const below = plans[other];
        if (!below || below.surface.rank >= plan.surface.rank || below.level < level) continue;
        if (intersects(below.footprint, plan.paint) || intersects(plan.footprint, below.paint))
          level = below.level + 1;
      }
      plan.level = level;
      (groups[level] ??= []).push(plan);
    });
    // What each level's backdrop must hold: where its surfaces read, and what the levels above
    // need of it. Kept as separate boxes, so far apart glass repaints only what is behind it.
    const need: Region[] = groups.map(() => []);
    for (let level = groups.length - 1; level >= 0; level -= 1) {
      let region: Region = need[level + 1] ?? [];
      // A replacing progressive blur reads the content layer, not its level's backdrop.
      for (const plan of groups[level] ?? [])
        if (!plan.replacing) region = withBox(region, intersect(plan.paint, view));
      need[level] = region;
    }
    const levels: Level[] = [];
    for (let level = 0; level < groups.length; level += 1) {
      const below = levels[level - 1];
      if (!below) {
        levels.push({
          key: "page",
          signature: `${this.list.pageVersion}:${this.scrollVersion}:${pw}x${ph}`,
          layer: this.page,
        });
        continue;
      }
      const lower = groups[level - 1] ?? [];
      const mine = need[level] ?? [];
      if (!lower.some((plan) => mine.some((box) => intersects(plan.footprint, box)))) {
        levels.push(below);
        continue;
      }
      const contents = lower.map((plan) => this.surfaceSignature(plan)).join(",");
      const layer = (this.layers[level] ??= {
        target: null,
        signature: "",
        valid: [],
        usedAt: 0,
      });
      levels.push({ key: `layer${level}`, signature: `${below.signature}|${contents}`, layer });
    }
    // Frost is shared by surfaces that read the same backdrop at the same sigma close to one
    // another; surfaces far apart each get their own, so nothing between them is frosted.
    // A replacing progressive blur reads the content layer instead of its level's backdrop.
    const contentLevel: Level = {
      key: "content",
      signature: `${levels[0]?.signature ?? ""}`,
      layer: this.content,
    };
    const sourceOf = (plan: Plan): Level | undefined =>
      plan.replacing ? contentLevel : levels[plan.level];
    const frostNeed = new Map<string, Region>();
    for (const plan of plans) {
      const level = sourceOf(plan);
      if (!level || plan.sigma <= 0) continue;
      for (const sigma of [plan.sigma, ...plan.lighter]) {
        const id = frostId(level, sigma, plan.gamma);
        frostNeed.set(id, withBox(frostNeed.get(id) ?? [], plan.read));
      }
    }
    // What each placeholder shows depends only on the page where it reads and on the lower
    // surfaces that overlap that region (with everything they depend on in turn): a lens gliding
    // at one end of the page must not redraw, and re-present, glass at the other end.
    const signatures = new Map<Plan, string>();
    const backdrops = new Map<Plan, string>();
    for (const plan of plans) {
      const parts = [`${this.list.pageStamp(plan.paint, this.lastOffsets)}`];
      for (const lower of plans) {
        if (lower === plan) break;
        if (lower.surface.rank < plan.surface.rank && intersects(lower.footprint, plan.paint))
          parts.push(signatures.get(lower) ?? "");
      }
      const screen = plan.surface.screen;
      backdrops.set(
        plan,
        `${parts.join("|")}@${screen.x},${screen.y},${screen.width},${screen.height}:${this.scrollVersion}:${this.sceneWidth}x${this.sceneHeight}`,
      );
      signatures.set(
        plan,
        `${parts.join("|")}#${this.surfaceSignature(plan)}#${plan.dpr}:${this.sceneWidth}x${this.sceneHeight}`,
      );
    }
    const dirty = plans.filter((plan) => {
      const slot = this.slots.get(plan.surface.id);
      return slot && slot.signature !== signatures.get(plan);
    });
    // The device px of each dirty placeholder that differ from what it shows: often much less
    // than all of it (a lens moving in a still bar; glass moving with its shadow unchanged), and
    // sometimes nothing (only its opacity changed, which CSS applies). Only that is drawn, sent
    // through the GL canvas and copied, which is what presenting costs in Gecko and WebKit.
    const regions = new Map<Plan, Box>();
    for (const plan of dirty) {
      const slot = this.slots.get(plan.surface.id);
      if (slot) regions.set(plan, this.changedRegion(plan, slot, backdrops.get(plan) ?? ""));
    }
    const drawn = dirty.filter((plan) => !isEmpty(regions.get(plan) ?? EMPTY));
    timings.surfaces = drawn.length;
    const spots = this.place(drawn, regions);
    // Used only when the dirty surfaces don't all fit the GL canvas at once (then spots is empty).
    const overflow = new Packer(this.canvas.width, this.canvas.height);

    // 2-4, level by level.
    const frosts = new Map<string, Frost>();
    const frostAt = (plan: Plan, level: Level, sigma: number): Frost | null => {
      const shared = frostNeed.get(frostId(level, sigma, plan.gamma)) ?? [plan.read];
      const cluster = Math.max(
        0,
        shared.findIndex((box) => contains(box, plan.read)),
      );
      const need = shared[cluster] ?? plan.read;
      const id = `${frostId(level, sigma, plan.gamma)}#${cluster}`;
      let frost = frosts.get(id);
      if (!frost) {
        const at = performance.now();
        const target = level.layer.target;
        if (!target) return null;
        frost = gpu.frost.ensure(
          `${level.key}#${cluster}`,
          { target, signature: level.signature, valid: holding(level.layer.valid, need) },
          sigma,
          plan.gamma,
          need,
          { width: vw, height: vh },
        );
        frosts.set(id, frost);
        timings.frost += performance.now() - at;
      }
      return frost;
    };
    const frostFor = (plan: Plan, level: Level): Frost | null => {
      if (plan.sigma <= 0) return null;
      const frost = frostAt(plan, level, plan.sigma);
      if (!frost || plan.lighter.length === 0) return frost;
      const lighter: Frost[] = [];
      for (const sigma of plan.lighter) {
        const found = frostAt(plan, level, sigma);
        if (found) lighter.push(found);
      }
      return { ...frost, lighter };
    };
    const copies: Copy[] = [];

    // Every replacing blur's content, when anything is drawn: a blur that isn't redrawn may
    // still be drawn into the backdrop of glass above it.
    const contentNeed = drawn.length
      ? plans.reduce<Region>(
          (region, plan) =>
            plan.replacing ? withBox(region, intersect(plan.paint, view)) : region,
          [],
        )
      : [];
    if (contentNeed.length) {
      started = performance.now();
      this.ensurePage(gpu, contentLevel, contentNeed, scale, view, true);
      this.content.usedAt = this.frameIndex;
      timings.underlay += performance.now() - started;
    }

    // Levels above the highest dirty surface are not needed this frame.
    const top = drawn.reduce((most, plan) => Math.max(most, plan.level), -1);
    for (let index = 0; index <= top; index += 1) {
      const level = levels[index];
      const group = groups[index];
      if (!level || !group) continue;
      started = performance.now();
      if (index === 0) this.ensurePage(gpu, level, need[0] ?? [], scale, view);
      else if (level.key !== levels[index - 1]?.key) {
        this.ensureLayer(
          gpu,
          level,
          levels[index - 1],
          groups[index - 1] ?? [],
          need[index] ?? [],
          scale,
          view,
          frostFor,
          contentLevel,
        );
      }
      level.layer.usedAt = this.frameIndex;
      timings.underlay += performance.now() - started;

      for (const plan of group) {
        const region = regions.get(plan);
        const slot = this.slots.get(plan.surface.id);
        if (!region || !slot) continue;
        if (isEmpty(region)) {
          slot.signature = signatures.get(plan) ?? "";
          continue;
        }
        const source = plan.replacing ? contentLevel : level;
        const target = source.layer.target;
        if (!target) continue;
        const width = region[2] - region[0];
        const height = region[3] - region[1];
        if (width !== plan.width || height !== plan.height) timings.partial += 1;
        timings.pixels += width * height;
        const frost = frostFor(plan, source);
        started = performance.now();
        let spot = spots.get(plan) ?? overflow.place(width, height);
        if (!spot) {
          // More than the GL canvas holds: present what is drawn so far and start over at its top.
          timings.copy += this.copy(copies);
          copies.length = 0;
          overflow.reset();
          spot = overflow.place(width, height);
        }
        if (!spot) continue;
        const labels = this.labelsFor(gpu, plan, slot, scale);
        // The placeholder's origin in the GL canvas, so that `region` lands on `spot`.
        const origin = [spot[0] - region[0], spot[1] - region[1]] as const;
        this.drawPlaceholder(
          gpu,
          plan,
          origin[0],
          origin[1],
          region,
          target,
          frost,
          labels,
          view,
          plan.replacing,
        );
        const body = bodyScreenBox(plan);
        // A progressive blur has no tone to adapt, so nothing behind it is measured.
        if (!isEmpty(body) && !plan.surface.material.edge)
          gpu.meter.measure(plan.surface.id, target.texture, body, { width: vw, height: vh });
        slot.signature = signatures.get(plan) ?? "";
        copies.push({
          slot,
          x: spot[0],
          y: spot[1],
          width,
          height,
          dx: region[0],
          dy: region[1],
          canvasWidth: plan.width,
          canvasHeight: plan.height,
        });
        timings.glass += performance.now() - started;
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    timings.copy += this.copy(copies);
    gpu.meter.flush();
    gl.disable(gl.SCISSOR_TEST);
    this.sweep(gpu, groups.length);
    return timings;
  }

  dispose(): void {
    const gl = this.gl;
    if (this.gpu) {
      this.gpu.frost.dispose();
      this.gpu.glass.dispose();
      this.gpu.meter.dispose();
    }
    deleteTarget(gl, this.page.target);
    deleteTarget(gl, this.content.target);
    for (const layer of this.layers) deleteTarget(gl, layer?.target);
    for (const slot of this.slots.values()) deleteTarget(gl, slot.labels);
    this.atlas.dispose();
    this.slots.clear();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private createGpu(): Gpu {
    const gl = this.gl;
    return {
      painter: new ItemPainter(gl),
      frost: new FrostCache(gl),
      glass: new GlassPass(gl),
      meter: new BackdropMeter(gl),
    };
  }

  private resizeScene(width: number, height: number): void {
    this.gpu?.meter.forget();
    deleteTarget(this.gl, this.page.target);
    deleteTarget(this.gl, this.content.target);
    for (const layer of this.layers) deleteTarget(this.gl, layer?.target);
    this.page = { target: null, signature: "", valid: [], usedAt: 0 };
    this.content = { target: null, signature: "", valid: [], usedAt: 0 };
    this.layers = [];
    this.sceneWidth = width;
    this.sceneHeight = height;
  }

  /** Per owner slot: where its surface is now and how far its base scroller has moved. */
  private ownerTable(byId: Map<number, SurfaceFrame>, offsets: Float32Array): Float32Array {
    const slots = this.list.ownerSlots();
    const table = new Float32Array(Math.max(1, slots.size) * 8);
    for (const [owner, slot] of slots) {
      if (owner === 0) continue;
      const surface = byId.get(owner);
      const base = this.list.ownerBaseScroller(owner);
      if (surface)
        table.set([surface.screen.x, surface.screen.y, ...surfaceScale(surface)], slot * 8);
      else table.set([0, 0, 1, 1], slot * 8);
      table.set([offsets[base * 4] ?? 0, offsets[base * 4 + 1] ?? 0, 0, 0], slot * 8 + 4);
    }
    return table;
  }

  private surfaceSignature(plan: Plan): string {
    const surface = plan.surface;
    return `${JSON.stringify(surface)}:${this.list.ownerVersion(surface.id)}:${this.scrollVersion}`;
  }

  /**
   * The device px of a dirty placeholder whose pixels differ from what it shows (see `Shown`),
   * and remember what it will show. Everything when its size, shadow or labels changed. Else:
   * the shapes, if the backdrop or the material's tone changed (inside the shapes; outside them,
   * shadows, rings and outlines depend only on the shapes and the shadow), and around each shape
   * that changed, before and after, as far as its change reaches.
   */
  private changedRegion(plan: Plan, slot: Slot, backdrop: string): Box {
    const surface = plan.surface;
    const set = plan.set;
    const full: Box = [0, 0, plan.width, plan.height];
    const merge = set.merge.reduce((most, radius) => Math.max(most, radius), 0);
    const shapes = set.shapes.map((shape, index) => `${JSON.stringify(shape)}:${set.merge[index]}`);
    const boxes = set.shapes.map((shape, index) =>
      expand(rectBox(shape.rect), changeReach(plan, index) + merge),
    );
    const labels = surface.labelsInGlass
      ? `${this.list.ownerVersion(surface.id)}:${this.scrollVersion}`
      : "";
    const whole = [
      plan.width,
      plan.height,
      plan.dpr,
      surface.bleed.join(","),
      surface.size.width,
      surface.size.height,
      // Outside the shapes only the shadow, the outline and lens rings show, and of the
      // material they use only these; the rest (frost, tone, dim, which adapting changes) shows
      // inside the shapes, like the backdrop.
      surface.material.kind,
      surface.material.appearance,
      JSON.stringify(surface.material.shadow),
      surface.opacity > 0,
      labels,
      set.bodyEnd,
      set.lensEnd,
      set.shapes.length,
    ].join("|");
    const inside = `${backdrop}|${JSON.stringify(surface.material)}`;
    const before = slot.shown;
    slot.shown = { whole, inside, shapes, boxes };
    if (!before || before.whole !== whole) return full;
    let local: Box = EMPTY;
    if (before.inside !== inside) {
      // Refraction, frost, tone and the one-pixel outline: inside the shapes, a few px past them.
      for (const shape of set.shapes) local = union(local, expand(rectBox(shape.rect), merge + 3));
    }
    shapes.forEach((key, index) => {
      if (key === before.shapes[index]) return;
      local = union(local, union(boxes[index] ?? EMPTY, before.boxes[index] ?? EMPTY));
    });
    if (isEmpty(local)) return EMPTY;
    // A lens shows what is under it magnified and shifted: a change anywhere under it changes
    // all of it (and a lens it grows into, in turn).
    for (let grown = true; grown;) {
      grown = false;
      for (let index = set.bodyEnd; index < set.lensEnd; index += 1) {
        const lens = boxes[index];
        if (!lens || contains(local, lens) || !intersects(local, lens)) continue;
        local = union(local, lens);
        grown = true;
      }
    }
    const [top, , , left] = surface.bleed;
    const region = toPixels(
      expand([local[0] + left, local[1] + top, local[2] + left, local[3] + top], 1 / plan.dpr),
      plan.dpr,
      plan.width,
      plan.height,
    );
    // Splitting a placeholder that changed nearly everywhere saves nothing.
    const area = (box: Box) => (box[2] - box[0]) * (box[3] - box[1]);
    return area(region) > 0.7 * area(full) ? full : region;
  }

  /**
   * Paint the page into `level`'s layer where `need` asks. `replacedOnly`: only what scrolls
   * inside the scrollers progressive blurs replace, over nothing, so its alpha is the content's.
   */
  private ensurePage(
    gpu: Gpu,
    level: Level,
    need: Region,
    scale: number,
    view: Box,
    replacedOnly = false,
  ): void {
    const layer = level.layer;
    const current = layer.signature === level.signature && layer.target !== null;
    const missing = current ? need.filter((box) => !covers(layer.valid, box)) : need;
    if (!missing.length) return;
    const gl = this.gl;
    layer.target ??= createTarget(gl, this.sceneWidth, this.sceneHeight);
    const painted: Box[] = [];
    const [r, g, b, a] = replacedOnly ? [0, 0, 0, 0] : this.list.backdrop;
    for (const box of missing) {
      const pixels = toPixels(
        intersect(expand(box, MARGIN), view),
        scale,
        this.sceneWidth,
        this.sceneHeight,
      );
      if (isEmpty(pixels)) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.target.framebuffer);
      gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(pixels[0], pixels[1], pixels[2] - pixels[0], pixels[3] - pixels[1]);
      gl.clearColor(r * a, g * a, b * a, a);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gpu.painter.paint(
        0,
        layer.target,
        { space: 0, localOrigin: [0, 0], scale, region: pixels, replacedOnly },
        this.atlas,
      );
      painted.push(pixelsToCss(pixels, scale));
    }
    // Boxes that overlap join, so glass gliding over a still page keeps one growing box.
    layer.valid = painted.reduce<Region>(withBox, current ? layer.valid : []);
    layer.signature = level.signature;
  }

  private ensureLayer(
    gpu: Gpu,
    level: Level,
    below: Level | undefined,
    lower: readonly Plan[],
    need: Region,
    scale: number,
    view: Box,
    frostFor: (plan: Plan, level: Level) => Frost | null,
    content: Level,
  ): void {
    const layer = level.layer;
    const source = below?.layer.target;
    if (!below || !source) return;
    const current = layer.signature === level.signature && layer.target !== null;
    const missing = current ? need.filter((box) => !covers(layer.valid, box)) : need;
    if (!missing.length) return;
    const gl = this.gl;
    const target = (layer.target ??= createTarget(gl, this.sceneWidth, this.sceneHeight));
    const composed: Box[] = [];
    for (const box of missing) {
      const region = intersect(
        intersect(expand(box, MARGIN), holding(below.layer.valid, box)),
        view,
      );
      const pixels = toPixels(region, scale, this.sceneWidth, this.sceneHeight);
      if (isEmpty(pixels)) continue;
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
      gl.blitFramebuffer(
        pixels[0],
        pixels[1],
        pixels[2],
        pixels[3],
        pixels[0],
        pixels[1],
        pixels[2],
        pixels[3],
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      for (const plan of lower) {
        if (!intersects(plan.footprint, region)) continue;
        const surface = plan.surface;
        const [kx, ky] = plan.scale;
        const slot = this.slots.get(surface.id);
        const labels = slot ? this.labelsFor(gpu, plan, slot, scale) : null;
        const replacing = plan.replacing ? content.layer.target : null;
        gpu.glass.draw({
          surface,
          set: plan.set,
          framebuffer: target.framebuffer,
          targetWidth: this.sceneWidth,
          targetHeight: this.sceneHeight,
          scissor: toPixels(
            intersect(plan.footprint, region),
            scale,
            this.sceneWidth,
            this.sceneHeight,
          ),
          fragToLocal: [
            1 / (scale * kx),
            1 / (scale * ky),
            -surface.screen.x / kx,
            -surface.screen.y / ky,
          ],
          pixel: 1 / (scale * Math.min(kx, ky)),
          // A replacing blur lays its blurred content over the page here. The page's own content
          // shows through it a little, which the glass above then frosts or bends anyway.
          backdrop: replacing ? replacing.texture : source.texture,
          viewport: { width: view[2], height: view[3] },
          frost: frostFor(plan, replacing ? content : below),
          replacing: replacing !== null,
          labels,
          blend: true,
          opacity: surface.opacity,
        });
        // Items on the surface (its DOM content) sit over its glass, unless the glass drew them.
        if (!(surface.labelsInGlass && labels)) {
          gpu.painter.paint(
            surface.id,
            target,
            { space: 0, localOrigin: [0, 0], scale, region: pixels },
            this.atlas,
          );
        }
      }
      composed.push(pixelsToCss(pixels, scale));
    }
    layer.valid = composed.reduce<Region>(withBox, current ? layer.valid : []);
    layer.signature = level.signature;
  }

  /** A surface's own items in its canvas space, for glass that draws its labels. */
  private labelsFor(
    gpu: Gpu,
    plan: Plan,
    slot: Slot,
    scale: number,
  ): { texture: WebGLTexture; map: readonly [number, number, number, number] } | null {
    const surface = plan.surface;
    if (!surface.labelsInGlass || !gpu.painter.hasItems(surface.id)) return null;
    const gl = this.gl;
    const { width, height, dpr } = plan;
    const [top, , , left] = surface.bleed;
    if (!slot.labels || slot.labels.width !== width || slot.labels.height !== height) {
      deleteTarget(gl, slot.labels);
      slot.labels = createTarget(gl, width, height);
      slot.labelSignature = "";
    }
    const signature = `${this.list.ownerVersion(surface.id)}:${this.scrollVersion}:${surface.bleed.join(",")}:${dpr}:${scale}`;
    if (slot.labelSignature !== signature) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, slot.labels.framebuffer);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gpu.painter.paint(
        surface.id,
        slot.labels,
        { space: 1, localOrigin: [left, top], scale: dpr, region: [0, 0, width, height] },
        this.atlas,
      );
      slot.labelSignature = signature;
    }
    return {
      texture: slot.labels.texture,
      map: [dpr / width, dpr / height, (left * dpr) / width, (top * dpr) / height],
    };
  }

  /**
   * Draw `region` (device px of the placeholder) of a surface's glass into the GL canvas, with
   * the placeholder's origin at (x, y) there (outside the canvas when only a part is drawn).
   */
  private drawPlaceholder(
    gpu: Gpu,
    plan: Plan,
    x: number,
    y: number,
    region: Box,
    backdrop: Target,
    frost: Frost | null,
    labels: { texture: WebGLTexture; map: readonly [number, number, number, number] } | null,
    view: Box,
    replacing: boolean,
  ): void {
    const gl = this.gl;
    const surface = plan.surface;
    const { width, height, dpr } = plan;
    const [top, right, bottom, left] = surface.bleed;
    const canvasHeight = this.canvas.height;
    // The canvas's framebuffer is bottom-up: canvas row y is GL row (height - 1 - y).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, canvasHeight);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      x + region[0],
      canvasHeight - y - region[3],
      region[2] - region[0],
      region[3] - region[1],
    );
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (surface.opacity <= 0 || plan.set.shapes.length === 0) return;
    // Only the shapes and what they cast need the shader; the rest stays clear.
    const drawn = intersect(localDrawBounds(plan), [
      -left,
      -top,
      surface.size.width + right,
      surface.size.height + bottom,
    ]);
    const local = intersect(
      toPixels(
        [drawn[0] + left, drawn[1] + top, drawn[2] + left, drawn[3] + top],
        dpr,
        width,
        height,
      ),
      region,
    );
    if (isEmpty(local)) return;
    gpu.glass.draw({
      surface,
      set: plan.set,
      framebuffer: null,
      targetWidth: this.canvas.width,
      targetHeight: canvasHeight,
      scissor: [
        x + local[0],
        canvasHeight - y - local[3],
        x + local[2],
        canvasHeight - y - local[1],
      ],
      fragToLocal: [1 / dpr, -1 / dpr, -x / dpr - left, (canvasHeight - y) / dpr - top],
      pixel: 1 / dpr,
      backdrop: backdrop.texture,
      viewport: { width: view[2], height: view[3] },
      frost,
      replacing,
      labels,
      blend: false,
      opacity: 1,
    });
  }

  /** Copy drawn regions of the GL canvas into their placeholders. Returns ms spent. */
  private copy(copies: readonly Copy[]): number {
    if (!copies.length) return 0;
    const started = performance.now();
    // One snapshot of the GL canvas for every placeholder: drawing the canvas itself into each
    // would make the browser resolve its whole drawing buffer once per surface.
    const frame = this.canvas.transferToImageBitmap();
    for (const { slot, x, y, width, height, dx, dy, canvasWidth, canvasHeight } of copies) {
      const context = slot.context;
      if (!context) continue;
      if (slot.canvas.width !== canvasWidth || slot.canvas.height !== canvasHeight) {
        slot.canvas.width = canvasWidth;
        slot.canvas.height = canvasHeight;
      }
      if (width === canvasWidth && height === canvasHeight) {
        context.globalCompositeOperation = "copy";
      } else {
        // "copy" would clear the rest of the placeholder: replace only this region.
        context.globalCompositeOperation = "source-over";
        context.clearRect(dx, dy, width, height);
      }
      context.drawImage(frame, x, y, width, height, dx, dy, width, height);
    }
    frame.close();
    return performance.now() - started;
  }

  /**
   * Where each dirty surface is drawn in the GL canvas, sized for this frame. The whole canvas is
   * snapshot every frame (transferToImageBitmap), which costs in proportion to its area in some
   * engines (Gecko reads it back), so it is kept close to what the dirty surfaces need: it grows
   * at once, and shrinks once it is more than twice what the last second needed. Resizing
   * reallocates the drawing buffer, so it is not done every frame. Empty when they don't fit
   * even the largest canvas: the caller then packs as it goes and copies when full.
   */
  private place(plans: readonly Plan[], regions: Map<Plan, Box>): Map<Plan, [number, number]> {
    const spots = new Map<Plan, [number, number]>();
    if (!plans.length) return spots;
    const sizes = new Map(
      plans.map((plan) => {
        const r = regions.get(plan) ?? [0, 0, plan.width, plan.height];
        return [plan, [r[2] - r[0], r[3] - r[1]] as const];
      }),
    );
    const w = (plan: Plan) => sizes.get(plan)?.[0] ?? 0;
    const h = (plan: Plan) => sizes.get(plan)?.[1] ?? 0;
    const sorted = [...plans].sort((a, b) => h(b) - h(a) || w(b) - w(a));
    const pack = (width: number, height: number): boolean => {
      spots.clear();
      const packer = new Packer(width, height);
      for (const plan of sorted) {
        const spot = packer.place(w(plan), h(plan));
        if (!spot) return false;
        spots.set(plan, spot);
      }
      return true;
    };
    const area = plans.reduce((sum, plan) => sum + w(plan) * h(plan), 0);
    const widest = plans.reduce((most, plan) => Math.max(most, w(plan)), 0);
    const width = Math.min(
      this.maxCanvas,
      roundUp(Math.max(widest, Math.sqrt(area) * 1.25, CANVAS_STEP), CANVAS_STEP),
    );
    const dry = new Packer(width, this.maxCanvas);
    for (const plan of sorted) dry.place(w(plan), h(plan));
    const height = Math.min(this.maxCanvas, roundUp(Math.max(dry.used, CANVAS_STEP), CANVAS_STEP));
    // The size the last frames needed: shrinking to less would only grow again.
    this.recent.push([width, height]);
    if (this.recent.length > SHRINK_AFTER_FRAMES) this.recent.shift();
    const keepWidth = Math.max(...this.recent.map(([recentWidth]) => recentWidth));
    const keepHeight = Math.max(...this.recent.map(([, recentHeight]) => recentHeight));
    const oversized =
      this.recent.length >= SHRINK_AFTER_FRAMES &&
      this.canvas.width * this.canvas.height > 2 * keepWidth * keepHeight;
    if (!oversized && pack(this.canvas.width, this.canvas.height)) return spots;
    this.canvas.width = Math.max(width, keepWidth);
    this.canvas.height = Math.max(height, keepHeight);
    if (!pack(this.canvas.width, this.canvas.height)) spots.clear();
    return spots;
  }

  private sweep(gpu: Gpu, levelCount: number): void {
    gpu.frost.sweep();
    for (let index = 0; index < this.layers.length; index += 1) {
      const layer = this.layers[index];
      if (layer?.target && (index >= levelCount || this.frameIndex - layer.usedAt > 120)) {
        gpu.meter.forget();
        deleteTarget(this.gl, layer.target);
        layer.target = null;
        layer.signature = "";
        layer.valid = [];
      }
    }
  }
}

function planSurface(surface: SurfaceFrame, view: Box, dpr: number): Plan {
  const set = arrangeShapes(surface);
  const scale = surfaceScale(surface);
  const toScreen = (box: Box): Box =>
    isEmpty(box)
      ? EMPTY
      : [
          surface.screen.x + box[0] * scale[0],
          surface.screen.y + box[1] * scale[1],
          surface.screen.x + box[2] * scale[0],
          surface.screen.y + box[3] * scale[1],
        ];
  const read = intersect(toScreen(readBounds(set)), view);
  const material = surface.material;
  const sigma = material.frost >= 0.5 ? Math.round(material.frost * 2) / 2 : 0;
  // Frost reaches 2.5 sigma and a cell past what glass reads (see frost.ts).
  const cell = frostCell(sigma);
  const paint = sigma > 0 ? intersect(expand(read, 2.5 * sigma + cell + 2), view) : read;
  const [top, right, bottom, left] = surface.bleed;
  const footprint = intersect(
    toScreen([-left, -top, surface.size.width + right, surface.size.height + bottom]),
    view,
  );
  const limit = 8192;
  return {
    surface,
    set,
    scale,
    read,
    paint,
    footprint,
    sigma,
    lighter: material.edge && sigma > 0 ? EDGE_FROSTS.slice(0, -1) : [],
    replacing: material.edge?.replace === true && surface.replaces !== undefined,
    gamma: frostGamma(material),
    width: Math.min(limit, Math.max(1, Math.ceil((surface.size.width + left + right) * dpr))),
    height: Math.min(limit, Math.max(1, Math.ceil((surface.size.height + top + bottom) * dpr))),
    dpr,
    level: 0,
  };
}

function rectBox(rect: { x: number; y: number; width: number; height: number }): Box {
  return fromRect(rect.x, rect.y, rect.width, rect.height);
}

/**
 * How far past its rect a change of shape `index` can change pixels, before merging: a body
 * moves its shadow and outline, a lens or thumb its ring of shadow (see glass.frag), a pill only
 * itself. Plus 3 px for antialiasing and rounding.
 */
function changeReach(plan: Plan, index: number): number {
  const set = plan.set;
  const shape = set.shapes[index];
  if (!shape) return 0;
  if (index < set.bodyEnd) {
    const shadow = plan.surface.material.shadow;
    if (!shadow || shadow.color[3] <= 0) return 3;
    return (
      1.5 * shadow.blur +
      Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) +
      Math.max(0, shadow.spread) +
      3
    );
  }
  if (index < set.lensEnd) {
    const fit = Math.min(
      1.5,
      Math.max(0.25, Math.min(shape.rect.width, shape.rect.height) / 2 / 42),
    );
    // The ring: 3 sigma (9 px) past the edge, dropped 6 px.
    return 33 * fit + 3;
  }
  return 3;
}

/** Local CSS px a surface's shader touches: shapes plus shadow, hairline and lens ring. */
function localDrawBounds(plan: Plan): Box {
  const material = plan.surface.material;
  const shadow = material.shadow;
  let reach = 3;
  if (shadow && shadow.color[3] > 0)
    reach = Math.max(
      reach,
      1.5 * shadow.blur +
        Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) +
        Math.max(0, shadow.spread),
    );
  let box: Box = EMPTY;
  plan.set.shapes.forEach((shape, index) => {
    let extra = reach;
    if (index >= plan.set.bodyEnd && index < plan.set.lensEnd) {
      const fit = Math.min(
        1.5,
        Math.max(0.25, Math.min(shape.rect.width, shape.rect.height) / 2 / 42),
      );
      extra = Math.max(extra, 33 * fit);
    }
    box = union(
      box,
      expand(fromRect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height), extra),
    );
  });
  return box;
}

/** The screen CSS px box of a surface's body shapes, where its backdrop is measured. */
function bodyScreenBox(plan: Plan): Box {
  let box: Box = EMPTY;
  for (let index = 0; index < plan.set.bodyEnd; index += 1) {
    const r = plan.set.shapes[index]?.rect;
    if (r) box = union(box, fromRect(r.x, r.y, r.width, r.height));
  }
  if (isEmpty(box)) return EMPTY;
  const { screen } = plan.surface;
  const [kx, ky] = plan.scale;
  return intersect(plan.read, [
    screen.x + box[0] * kx,
    screen.y + box[1] * ky,
    screen.x + box[2] * kx,
    screen.y + box[3] * ky,
  ]);
}

function frostId(level: Level, sigma: number, gamma: number): string {
  return `${level.key}|${sigma}|${gamma}`;
}

function pixelsToCss(pixels: Box, scale: number): Box {
  return [pixels[0] / scale, pixels[1] / scale, pixels[2] / scale, pixels[3] / scale];
}

function sameFloats(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/** Shelf packing of placeholder regions into the GL canvas, top row first. */
class Packer {
  private x = 0;
  private y = 0;
  private row = 0;
  used = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  place(width: number, height: number): [number, number] | null {
    if (width > this.width || height > this.height) return null;
    if (this.x + width > this.width) {
      this.y += this.row;
      this.x = 0;
      this.row = 0;
    }
    if (this.y + height > this.height) return null;
    const spot: [number, number] = [this.x, this.y];
    this.x += width;
    this.row = Math.max(this.row, height);
    this.used = Math.max(this.used, this.y + this.row);
    return spot;
  }

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.row = 0;
  }
}
