/**
 * What the worker has been told, and what it should be told next. Walks adopt new drafts and
 * retire old ones; a commit diffs them by key against the items already sent, so a recapture that
 * finds nothing changed sends nothing. Bitmap references are counted per draft and released
 * after the commit, so a bitmap moving from an old draft to its replacement is never freed.
 */

import type { Item } from "../protocol";
import type { BitmapStore } from "./bitmaps";
import { assignOrders, paintSequence } from "./order";
import type { Draft, ElementRecord, Resource } from "./types";

export class Ledger {
  /** The current draft for every key. */
  readonly live = new Map<number, Draft>();
  private readonly sent = new Map<number, Item>();
  private touched = new Map<number, Draft>();
  private retired = new Set<number>();
  private released: Resource[] = [];
  private structural = false;
  private upserts = new Map<number, Item>();
  private removes = new Set<number>();

  constructor(private readonly store: BitmapStore) {}

  adopt(draft: Draft): void {
    const previous = this.touched.get(draft.key) ?? this.live.get(draft.key);
    if (previous && !Number.isFinite(draft.order)) draft.order = previous.order;
    this.touched.set(draft.key, draft);
    if (draft.kind === "bitmap") this.store.acquire(draft.res);
    this.structural = true;
  }

  retire(draft: Draft): void {
    if (this.touched.get(draft.key) === draft) this.touched.delete(draft.key);
    this.retired.add(draft.key);
    if (draft.kind === "bitmap") this.released.push(draft.res);
    this.structural = true;
  }

  /** A draft changed in place (moved with its element). */
  touch(draft: Draft): void {
    this.touched.set(draft.key, draft);
  }

  get pending(): boolean {
    return (
      this.touched.size > 0 ||
      this.retired.size > 0 ||
      this.upserts.size > 0 ||
      this.removes.size > 0
    );
  }

  /** Apply everything adopted, retired and touched since the last commit. */
  commit(root: ElementRecord | null): void {
    if (this.structural && root) {
      assignOrders(paintSequence(root), (draft) => this.touched.set(draft.key, draft));
    }
    for (const key of this.retired) {
      if (this.touched.has(key) || !this.live.has(key)) continue;
      this.live.delete(key);
      this.upserts.delete(key);
      if (this.sent.delete(key)) this.removes.add(key);
    }
    for (const draft of this.touched.values()) {
      this.live.set(draft.key, draft);
      this.emit(draft);
    }
    for (const resource of this.released) this.store.release(resource);
    this.touched = new Map();
    this.retired = new Set();
    this.released = [];
    this.structural = false;
  }

  /** A bitmap became ready (or changed size): send the drafts that were waiting for it. */
  ready(resource: Resource): void {
    const keys = [...resource.waiting];
    resource.waiting.clear();
    for (const key of keys) {
      const draft = this.live.get(key);
      if (draft && draft.kind === "bitmap" && draft.res === resource) this.emit(draft);
    }
  }

  private emit(draft: Draft): void {
    if (!Number.isFinite(draft.order)) return;
    if (draft.kind === "bitmap" && draft.res.state !== "ready") {
      if (draft.res.state === "pending") draft.res.waiting.add(draft.key);
      return;
    }
    const item = toItem(draft);
    const previous = this.sent.get(draft.key);
    if (previous && itemEqual(previous, item)) return;
    this.sent.set(draft.key, item);
    this.upserts.set(draft.key, item);
    this.removes.delete(draft.key);
  }

  take(): { upsert: Item[]; remove: number[] } {
    const upsert = [...this.upserts.values()];
    const remove = [...this.removes];
    this.upserts = new Map();
    this.removes = new Set();
    return { upsert, remove };
  }

  /** Forget everything sent (the next patch is a reset). */
  clearSent(): void {
    this.sent.clear();
    this.upserts.clear();
    this.removes.clear();
  }
}

function toItem(draft: Draft): Item {
  const base = {
    key: draft.key,
    owner: draft.owner,
    order: draft.order,
    scroller: draft.scroller,
    clip: draft.clip,
    opacity: draft.opacity,
    rect: draft.rect,
    radii: draft.radii,
  };
  if (draft.kind === "box") {
    return {
      kind: "box",
      ...base,
      fill: draft.fill,
      border: draft.border,
      borderColor: draft.borderColor,
      shadows: draft.shadows,
    };
  }
  return { kind: "bitmap", ...base, bitmap: draft.res.bitmap, source: draft.source };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

function itemEqual(a: Item, b: Item): boolean {
  if (
    a.kind !== b.kind ||
    a.owner !== b.owner ||
    a.order !== b.order ||
    a.scroller !== b.scroller ||
    a.clip !== b.clip ||
    !near(a.opacity, b.opacity) ||
    !near(a.rect.x, b.rect.x) ||
    !near(a.rect.y, b.rect.y) ||
    !near(a.rect.width, b.rect.width) ||
    !near(a.rect.height, b.rect.height) ||
    a.radii.some((r, i) => !near(r, b.radii[i] ?? 0))
  ) {
    return false;
  }
  if (a.kind === "bitmap" && b.kind === "bitmap") {
    return (
      a.bitmap === b.bitmap &&
      near(a.source.x, b.source.x) &&
      near(a.source.y, b.source.y) &&
      near(a.source.width, b.source.width) &&
      near(a.source.height, b.source.height)
    );
  }
  if (a.kind === "box" && b.kind === "box") {
    return (
      a.fill.every((c, i) => c === b.fill[i]) &&
      a.borderColor.every((c, i) => c === b.borderColor[i]) &&
      a.border.every((w, i) => near(w, b.border[i] ?? 0)) &&
      a.shadows.length === b.shadows.length &&
      a.shadows.every((s, i) => {
        const t = b.shadows[i];
        return (
          !!t &&
          s.x === t.x &&
          s.y === t.y &&
          s.blur === t.blur &&
          s.spread === t.spread &&
          s.color.every((c, j) => c === t.color[j])
        );
      })
    );
  }
  return false;
}
