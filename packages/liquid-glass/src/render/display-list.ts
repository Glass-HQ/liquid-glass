import type { Atlas } from "./atlas";
import type { Clip, DisplayListPatch, Item, Rgba, Scroller, SurfaceFrame } from "../protocol";
import { type Box, expand, intersects } from "./rect";

/** How many page changes are remembered by place; older ones count as touching everything. */
const DAMAGE_LIMIT = 256;

/**
 * The worker's copy of the page's display list, and the instance data the item painter draws
 * from it. Everything here is CPU-side and survives a lost context; the painter re-uploads it.
 *
 * Items are grouped by owner (0 for the page, else a surface id) because each group is painted
 * into a different place: page items into the backdrop, a surface's items over its glass.
 */

/** Floats per instance: eight vec4 attributes (see items.vert.glsl). */
export const INSTANCE_FLOATS = 32;

export const KIND_BOX = 0;
export const KIND_BITMAP = 1;
export const KIND_SHADOW = 2;

/** Consecutive instances drawn with one atlas page bound (-1: none needed). */
export interface Run {
  readonly start: number;
  readonly count: number;
  readonly page: number;
}

export interface Group {
  readonly owner: number;
  readonly runs: readonly Run[];
  readonly count: number;
}

/**
 * Where a surface was when its items were captured: the screen origin and the CSS-transform
 * scale of the surface, from the first frame after the items arrived. Owned items move with
 * their surface from there.
 */
type Anchor = readonly [x: number, y: number, scaleX: number, scaleY: number];

export class DisplayList {
  readonly items = new Map<number, Item>();
  private readonly clips = new Map<number, Clip>();
  private readonly scrollers = new Map<number, Scroller>();
  backdrop: Rgba = [0, 0, 0, 0];
  /** Bumps whenever the clip table may have changed. */
  clipVersion = 0;

  /** Bumps when anything the page layer shows changes (page items, clips, scrollers, backdrop). */
  pageVersion = 0;
  /**
   * Where the page changed, newest last: the page version of the change, and the box it touched
   * in capture coordinates with the scroller it moves with (null: anywhere). Glass that reads
   * none of these boxes looks the same and is not redrawn.
   */
  private damage: { version: number; scroller: number; box: Box | null }[] = [];
  /** Every page version up to this one may have touched anything. */
  private damageFloor = 0;
  private readonly ownerVersions = new Map<number, number>();
  private readonly anchors = new Map<number, Anchor>();
  private readonly waitingAnchor = new Set<number>();
  /** Which owners draw each bitmap, so a new frame of a bitmap invalidates only them. */
  private bitmapOwners = new Map<number, Set<number>>();

  private instancesStale = true;
  private builtGeneration = -1;
  private instanceData = new Float32Array(0);
  private groups = new Map<number, Group>();
  /** Dense slot per owning surface (0 is the page), the row of its transform in the owner table. */
  private slots = new Map<number, number>();

  private clipIndex = new Map<number, number>();
  private clipTable = new Float32Array(0);
  private clipsStale = true;

  private scrollerIndex = new Map<number, number>();
  private scrollerParent: number[] = [];
  private scrollerDepth: number[] = [];
  private scrollersStale = true;
  /** Per owner: the shallowest scroller its items use, whose movement the surface itself shows. */
  private baseScroller = new Map<number, number>();

  apply(patch: DisplayListPatch, atlas: Atlas): void {
    if (patch.reset) {
      for (const owner of this.ownerVersions.keys()) this.bump(owner);
      for (const item of this.items.values()) this.bump(item.owner);
      this.items.clear();
      this.clips.clear();
      this.scrollers.clear();
      this.anchors.clear();
      this.waitingAnchor.clear();
    }
    for (const key of patch.remove) {
      const item = this.items.get(key);
      if (!item) continue;
      this.bump(item.owner, item);
      this.items.delete(key);
      this.anchors.delete(key);
      this.waitingAnchor.delete(key);
    }
    for (const item of patch.upsert) {
      const previous = this.items.get(item.key);
      if (previous) this.bump(previous.owner, previous);
      this.bump(item.owner, item);
      this.items.set(item.key, item);
      this.anchors.delete(item.key);
      if (item.owner !== 0) this.waitingAnchor.add(item.key);
    }
    if (patch.clips.length || patch.scrollers.length || patch.reset) {
      const changed = new Set<number>();
      for (const clip of patch.clips) {
        const before = this.clips.get(clip.id);
        if (!before || !sameClip(before, clip)) changed.add(clip.id);
        this.clips.set(clip.id, clip);
      }
      for (const scroller of patch.scrollers) this.scrollers.set(scroller.id, scroller);
      this.clipsStale = true;
      this.scrollersStale = true;
      this.clipVersion += 1;
      // A new scroller tree can move any layer's edges; a changed clip only what it clips (a
      // menu clipped while it morphs must not redraw every piece of glass on the page).
      if (patch.reset || patch.scrollers.length) this.bumpAll();
      else if (changed.size) this.bumpClipped(changed);
    }
    const [r, g, b, a] = patch.backdrop;
    const [pr, pg, pb, pa] = this.backdrop;
    if (r !== pr || g !== pg || b !== pb || a !== pa) {
      this.backdrop = patch.backdrop;
      this.bump(0, null);
    }
    for (const id of patch.releaseBitmaps) atlas.release(id);
    for (const upload of patch.bitmaps) {
      atlas.put(upload.id, upload.image, upload.snapshot);
      const owners = this.bitmapOwners.get(upload.id);
      if (!owners) continue;
      for (const owner of owners) if (owner !== 0) this.bump(owner);
      // A new frame of a video or canvas source: only where the page draws it changed.
      if (owners.has(0))
        for (const item of this.items.values())
          if (item.owner === 0 && item.kind === "bitmap" && item.bitmap === upload.id)
            this.bump(0, item);
    }
    if (
      patch.upsert.length ||
      patch.remove.length ||
      patch.reset ||
      patch.clips.length ||
      patch.scrollers.length
    ) {
      this.instancesStale = true;
      if (patch.upsert.length || patch.reset) this.scrollersStale = true;
    }
  }

  /** After a lost context: the next `instances` call rebuilds everything for new GPU buffers. */
  invalidate(): void {
    this.instancesStale = true;
  }

  ownerVersion(owner: number): number {
    return owner === 0 ? this.pageVersion : (this.ownerVersions.get(owner) ?? 0);
  }

  /**
   * Give items that arrived since the last frame the anchor of their surface in this frame.
   * `offsets` are this frame's scroll offsets (see `scrollOffsets`). Owned items are compared in
   * capture coordinates less their base scroller's offset, so the anchor is taken in that space
   * too: where the surface is on screen, less how far its base scroller has moved by now.
   */
  assignAnchors(surfaces: readonly SurfaceFrame[], offsets: Float32Array): void {
    if (!this.waitingAnchor.size) return;
    const bySurface = new Map<number, SurfaceFrame>();
    for (const surface of surfaces) bySurface.set(surface.id, surface);
    for (const key of this.waitingAnchor) {
      const item = this.items.get(key);
      if (!item) {
        this.waitingAnchor.delete(key);
        continue;
      }
      const surface = bySurface.get(item.owner);
      if (!surface) continue;
      const base = this.ownerBaseScroller(item.owner);
      const bx = offsets[base * 4] ?? 0;
      const by = offsets[base * 4 + 1] ?? 0;
      this.anchors.set(key, [
        surface.screen.x - bx,
        surface.screen.y - by,
        ...surfaceScale(surface),
      ]);
      this.waitingAnchor.delete(key);
      this.instancesStale = true;
      this.bump(item.owner);
    }
  }

  /** Instance data for every owner, rebuilt only after a change. */
  instances(atlas: Atlas): {
    data: Float32Array;
    groups: ReadonlyMap<number, Group>;
    rebuilt: boolean;
  } {
    if (!this.instancesStale && this.builtGeneration === atlas.generation) {
      return { data: this.instanceData, groups: this.groups, rebuilt: false };
    }
    this.ensureTables();
    this.build(atlas);
    this.instancesStale = false;
    this.builtGeneration = atlas.generation;
    return { data: this.instanceData, groups: this.groups, rebuilt: true };
  }

  /** Clip table: three texels per clip (rect, radii, [scroller, parent, 0, 0]). */
  clipData(): { data: Float32Array; count: number } {
    this.ensureTables();
    return { data: this.clipTable, count: this.clipIndex.size };
  }

  /**
   * Per scroller index, the cumulative distance its content has moved on screen since capture,
   * from the frame's [id, dx, dy, ...] scroll-position deltas. Content moves opposite to the
   * scroll position, and a nested scroller carries every ancestor's movement too.
   */
  scrollOffsets(scroll: Float32Array, replaced: ReadonlySet<number>): Float32Array {
    this.ensureTables();
    const count = this.scrollerParent.length;
    const own = new Float32Array(count * 2);
    for (let index = 0; index + 2 < scroll.length; index += 3) {
      const at = this.scrollerIndex.get(scroll[index] ?? -1);
      if (at === undefined) continue;
      own[at * 2] = -(scroll[index + 1] ?? 0);
      own[at * 2 + 1] = -(scroll[index + 2] ?? 0);
    }
    const out = new Float32Array(count * 4);
    const done = new Uint8Array(count);
    const resolve = (index: number, guard: number): [number, number] => {
      if (done[index]) return [out[index * 4] ?? 0, out[index * 4 + 1] ?? 0];
      const parent = this.scrollerParent[index] ?? -1;
      const up: [number, number] =
        parent >= 0 && parent !== index && guard < 64 ? resolve(parent, guard + 1) : [0, 0];
      out[index * 4] = (own[index * 2] ?? 0) + up[0];
      out[index * 4 + 1] = (own[index * 2 + 1] ?? 0) + up[1];
      done[index] = 1;
      return [out[index * 4] ?? 0, out[index * 4 + 1] ?? 0];
    };
    for (let index = 0; index < count; index += 1) resolve(index, 0);
    // The third number marks scrollers a progressive blur replaces, and everything inside them.
    if (replaced.size > 0) {
      const roots = new Set<number>();
      for (const id of replaced) {
        const at = this.scrollerIndex.get(id);
        if (at !== undefined) roots.add(at);
      }
      for (let index = 0; index < count; index += 1) {
        for (let at = index, guard = 0; at >= 0 && guard < 64; guard += 1) {
          if (roots.has(at)) {
            out[index * 4 + 2] = 1;
            break;
          }
          const parent = this.scrollerParent[at] ?? -1;
          if (parent === at) break;
          at = parent;
        }
      }
    }
    return out;
  }

  /** Index of the scroller whose movement an owner's surface already shows by moving. */
  ownerBaseScroller(owner: number): number {
    this.ensureTables();
    return this.baseScroller.get(owner) ?? 0;
  }

  /** Owner id to its slot in the owner table, as baked into the instances. */
  ownerSlots(): ReadonlyMap<number, number> {
    return this.slots;
  }

  /** A change to an owner's items; for the page, `item` says where (null or none: anywhere). */
  private bump(owner: number, item: Item | null = null): void {
    if (owner !== 0) {
      this.ownerVersions.set(owner, (this.ownerVersions.get(owner) ?? 0) + 1);
      return;
    }
    this.pageVersion += 1;
    let box: Box | null = null;
    if (item) {
      const r = item.rect;
      // A box's shadows paint outside it.
      let reach = 0;
      if (item.kind === "box")
        for (const shadow of item.shadows)
          reach = Math.max(
            reach,
            Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) +
              shadow.blur +
              Math.max(0, shadow.spread),
          );
      box = [r.x - reach, r.y - reach, r.x + r.width + reach, r.y + r.height + reach];
    }
    this.damage.push({ version: this.pageVersion, scroller: item?.scroller ?? 0, box });
    if (this.damage.length > DAMAGE_LIMIT) {
      const dropped = this.damage.splice(0, DAMAGE_LIMIT / 2);
      this.damageFloor = dropped[dropped.length - 1]?.version ?? this.damageFloor;
    }
  }

  /**
   * The newest page version that changed anything inside `read` (screen CSS px), given this
   * frame's scroll offsets. Equal stamps mean the page looks the same there.
   */
  pageStamp(read: Box, offsets: Float32Array): number {
    let stamp = this.damageFloor;
    // Item boxes may grow a little in the painter (shadows, anti-aliasing).
    const area = expand(read, 32);
    for (const entry of this.damage) {
      if (entry.version <= stamp) continue;
      if (!entry.box) {
        stamp = entry.version;
        continue;
      }
      const index = this.scrollerIndex.get(entry.scroller) ?? 0;
      const dx = offsets[index * 4] ?? 0;
      const dy = offsets[index * 4 + 1] ?? 0;
      const [x0, y0, x1, y1] = entry.box;
      if (intersects([x0 + dx, y0 + dy, x1 + dx, y1 + dy], area)) stamp = entry.version;
    }
    return stamp;
  }

  /** Everything drawn inside `changed` clips, or clips nested in them. */
  private bumpClipped(changed: ReadonlySet<number>): void {
    const inside = new Map<number, boolean>();
    const within = (id: number): boolean => {
      if (id === 0) return false;
      const known = inside.get(id);
      if (known !== undefined) return known;
      inside.set(id, false);
      const clip = this.clips.get(id);
      const result = changed.has(id) || (clip !== undefined && within(clip.parent));
      inside.set(id, result);
      return result;
    };
    for (const item of this.items.values()) if (within(item.clip)) this.bump(item.owner, item);
  }

  private bumpAll(): void {
    this.bump(0, null);
    for (const owner of this.ownerVersions.keys()) this.bump(owner);
    for (const item of this.items.values())
      if (item.owner !== 0 && !this.ownerVersions.has(item.owner)) this.bump(item.owner);
  }

  private ensureTables(): void {
    if (this.scrollersStale) this.buildScrollers();
    if (this.clipsStale) this.buildClips();
  }

  private buildScrollers(): void {
    this.scrollersStale = false;
    this.clipsStale = true;
    const index = new Map<number, number>([[0, 0]]);
    const parentId: number[] = [-1];
    const add = (id: number, parent: number) => {
      if (index.has(id)) return;
      index.set(id, parentId.length);
      parentId.push(parent);
    };
    for (const scroller of this.scrollers.values())
      if (scroller.id !== 0) add(scroller.id, scroller.parent);
    // Items and clips may name scrollers the page never declared; they hang off the viewport.
    for (const item of this.items.values()) add(item.scroller, 0);
    for (const clip of this.clips.values()) add(clip.scroller, 0);
    this.scrollerIndex = index;
    this.scrollerParent = parentId.map((parent, at) => (at === 0 ? -1 : (index.get(parent) ?? 0)));
    this.scrollerDepth = this.scrollerParent.map((_, at) => {
      let depth = 0;
      for (let walk = at; walk > 0 && depth < 64; depth += 1) walk = this.scrollerParent[walk] ?? 0;
      return depth;
    });
    const base = new Map<number, number>();
    for (const item of this.items.values()) {
      if (item.owner === 0) continue;
      const at = index.get(item.scroller) ?? 0;
      const current = base.get(item.owner);
      if (
        current === undefined ||
        (this.scrollerDepth[at] ?? 0) < (this.scrollerDepth[current] ?? 0)
      )
        base.set(item.owner, at);
    }
    this.baseScroller = base;
  }

  private buildClips(): void {
    this.clipsStale = false;
    const index = new Map<number, number>();
    for (const clip of this.clips.values()) if (clip.id !== 0) index.set(clip.id, index.size);
    const table = new Float32Array(Math.max(1, index.size) * 12);
    for (const clip of this.clips.values()) {
      const at = index.get(clip.id);
      if (at === undefined) continue;
      const o = at * 12;
      table.set([clip.rect.x, clip.rect.y, clip.rect.width, clip.rect.height], o);
      table.set(clip.radii, o + 4);
      const parent = clip.parent === clip.id ? -1 : (index.get(clip.parent) ?? -1);
      table.set([this.scrollerIndex.get(clip.scroller) ?? 0, parent, 0, 0], o + 8);
    }
    this.clipIndex = index;
    this.clipTable = table;
  }

  private build(atlas: Atlas): void {
    const byOwner = new Map<number, Item[]>();
    for (const item of this.items.values()) {
      let list = byOwner.get(item.owner);
      if (!list) byOwner.set(item.owner, (list = []));
      list.push(item);
    }
    let total = 0;
    for (const list of byOwner.values()) {
      list.sort((a, b) => a.order - b.order);
      for (const item of list) total += item.kind === "box" ? 1 + item.shadows.length : 1;
    }
    const data = new Float32Array(total * INSTANCE_FLOATS);
    this.slots = new Map([[0, 0]]);
    for (const owner of byOwner.keys())
      if (!this.slots.has(owner)) this.slots.set(owner, this.slots.size);
    const groups = new Map<number, Group>();
    const bitmapOwners = new Map<number, Set<number>>();
    let cursor = 0;
    for (const [owner, list] of byOwner) {
      const runs: Run[] = [];
      let runStart = cursor;
      let runPage = -1;
      const start = cursor;
      for (const item of list) {
        if (item.kind === "bitmap") {
          let owners = bitmapOwners.get(item.bitmap);
          if (!owners) bitmapOwners.set(item.bitmap, (owners = new Set()));
          owners.add(owner);
          const place = atlas.get(item.bitmap);
          if (!place) continue;
          if (runPage !== -1 && runPage !== place.page) {
            runs.push({ start: runStart, count: cursor - runStart, page: runPage });
            runStart = cursor;
          }
          runPage = place.page;
          this.writeBitmap(data, cursor, item, place.x, place.y, place.pageWidth, place.pageHeight);
          cursor += 1;
          continue;
        }
        // CSS paints the first shadow on top, so shadows go in reverse, all under the box.
        for (let s = item.shadows.length - 1; s >= 0; s -= 1) {
          const shadow = item.shadows[s];
          if (!shadow || shadow.color[3] <= 0) continue;
          this.writeShadow(data, cursor, item, s);
          cursor += 1;
        }
        const bordered = item.border.some((width) => width > 0) && item.borderColor[3] > 0;
        if (item.fill[3] <= 0 && !bordered) continue;
        this.writeBox(data, cursor, item);
        cursor += 1;
      }
      if (cursor > runStart)
        runs.push({ start: runStart, count: cursor - runStart, page: runPage });
      groups.set(owner, { owner, runs, count: cursor - start });
    }
    this.instanceData = data.subarray(0, cursor * INSTANCE_FLOATS);
    this.groups = groups;
    this.bitmapOwners = bitmapOwners;
  }

  private writeCommon(data: Float32Array, at: number, item: Item, kind: number): number {
    const o = at * INSTANCE_FLOATS;
    data[o] = item.rect.x;
    data[o + 1] = item.rect.y;
    data[o + 2] = item.rect.width;
    data[o + 3] = item.rect.height;
    data.set(item.radii, o + 4);
    data[o + 20] = kind;
    data[o + 21] = item.clip === 0 ? -1 : (this.clipIndex.get(item.clip) ?? -1);
    data[o + 22] = this.scrollerIndex.get(item.scroller) ?? 0;
    data[o + 23] = item.opacity;
    const anchor = this.anchors.get(item.key);
    if (item.owner !== 0 && anchor) data.set(anchor, o + 24);
    else data.set([0, 0, 1, 1], o + 24);
    // Owned items without an anchor yet are drawn as page-space items for this one frame.
    data[o + 28] = item.owner !== 0 && anchor ? (this.slots.get(item.owner) ?? 0) : 0;
    return o;
  }

  private writeBox(data: Float32Array, at: number, item: Item & { kind: "box" }): void {
    const o = this.writeCommon(data, at, item, KIND_BOX);
    data.set(premultiply(item.fill), o + 8);
    data.set(item.border, o + 12);
    data.set(premultiply(item.borderColor), o + 16);
  }

  private writeShadow(
    data: Float32Array,
    at: number,
    item: Item & { kind: "box" },
    index: number,
  ): void {
    const shadow = item.shadows[index];
    if (!shadow) return;
    const o = this.writeCommon(data, at, item, KIND_SHADOW);
    // CSS blur radius is twice the Gaussian's standard deviation.
    data.set([shadow.blur / 2, shadow.spread, shadow.x, shadow.y], o + 12);
    data.set(premultiply(shadow.color), o + 16);
  }

  private writeBitmap(
    data: Float32Array,
    at: number,
    item: Item & { kind: "bitmap" },
    x: number,
    y: number,
    pageWidth: number,
    pageHeight: number,
  ): void {
    const o = this.writeCommon(data, at, item, KIND_BITMAP);
    const s = item.source;
    data.set(
      [
        (x + s.x) / pageWidth,
        (y + s.y) / pageHeight,
        (x + s.x + s.width) / pageWidth,
        (y + s.y + s.height) / pageHeight,
      ],
      o + 8,
    );
    data.set([1 / pageWidth, 1 / pageHeight, 0, 0], o + 12);
  }
}

export function surfaceScale(surface: SurfaceFrame): [number, number] {
  const sx = surface.size.width > 0 ? surface.screen.width / surface.size.width : 1;
  const sy = surface.size.height > 0 ? surface.screen.height / surface.size.height : 1;
  return [sx || 1, sy || 1];
}

function premultiply(color: Rgba): [number, number, number, number] {
  const a = color[3];
  return [color[0] * a, color[1] * a, color[2] * a, a];
}

function sameClip(a: Clip, b: Clip): boolean {
  return (
    a.parent === b.parent &&
    a.scroller === b.scroller &&
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height &&
    a.radii.every((radius, index) => radius === b.radii[index])
  );
}
