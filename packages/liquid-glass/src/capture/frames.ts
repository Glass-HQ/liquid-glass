/**
 * Scrollers and clips. Scroller 0 is the viewport. Scroller 1 is "fixed to the viewport": its
 * delta is always minus the viewport's, so items in it (position: fixed, the top layer) stay put
 * when the page scrolls, because the worker adds a scroller's parents' deltas to its own.
 *
 * Every scroller remembers its scroll position when first seen (its base); geometry is stored
 * relative to that ("normalised"), and each frame sends how far each scroller has moved since.
 */

import type { Clip, Radii, Rect, Scroller } from "../protocol";
import { rectEqual } from "./css";
import type { ElementRecord } from "./types";

export const VIEWPORT = 0;
export const FIXED = 1;

export interface ScrollerState {
  readonly id: number;
  readonly el: Element | null;
  parent: number;
  baseX: number;
  baseY: number;
  /** Screen px per CSS px of scrolling (an ancestor's transform scale). */
  zoom: number;
  /** Capture window for the content, normalised; null until computed. */
  cull: Rect | null;
  /** The scroller's own clip (its padding box), or 0 for the viewport. */
  clip: number;
  readonly sticky: Set<ElementRecord>;
  /** Scrolled since the window was last checked. */
  moved: boolean;
}

interface ClipState {
  readonly id: number;
  readonly el: Element;
  parent: number;
  scroller: number;
  rect: Rect;
  radii: Radii;
}

const radiiEqual = (a: Radii, b: Radii) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

export class Frames {
  readonly scrollers = new Map<number, ScrollerState>();
  private readonly scrollerOf = new WeakMap<Element, number>();
  private readonly clips = new Map<number, ClipState>();
  private readonly clipOf = new WeakMap<Element, number>();
  private nextScroller = 2;
  private nextClip = 1;
  private readonly changedScrollers = new Set<number>();
  private readonly changedClips = new Set<number>();
  private readonly chains = new Map<number, { x: number; y: number }>();

  constructor() {
    this.scrollers.set(VIEWPORT, this.state(VIEWPORT, null, -1, 1));
    this.scrollers.set(FIXED, this.state(FIXED, null, VIEWPORT, 1));
    this.changedScrollers.add(FIXED);
  }

  private state(id: number, el: Element | null, parent: number, zoom: number): ScrollerState {
    const position = el
      ? { x: el.scrollLeft, y: el.scrollTop }
      : id === VIEWPORT
        ? { x: scrollX, y: scrollY }
        : { x: 0, y: 0 };
    return {
      id,
      el,
      parent,
      baseX: position.x,
      baseY: position.y,
      zoom,
      cull: null,
      clip: 0,
      sticky: new Set(),
      moved: false,
    };
  }

  /** Forget cached chain deltas; scroll positions are read again. Call at the start of a pass. */
  begin(): void {
    this.chains.clear();
  }

  /** How far a scroller's content has scrolled since its base, in screen px. */
  own(id: number): { x: number; y: number } {
    const state = this.scrollers.get(id);
    if (!state) return { x: 0, y: 0 };
    if (id === VIEWPORT) return { x: scrollX - state.baseX, y: scrollY - state.baseY };
    if (id === FIXED) {
      const viewport = this.own(VIEWPORT);
      return { x: -viewport.x, y: -viewport.y };
    }
    const el = state.el;
    if (!el) return { x: 0, y: 0 };
    return {
      x: (el.scrollLeft - state.baseX) * state.zoom,
      y: (el.scrollTop - state.baseY) * state.zoom,
    };
  }

  /** Total movement of a scroller and all its ancestors since their bases. */
  chain(id: number): { x: number; y: number } {
    const cached = this.chains.get(id);
    if (cached) return cached;
    let x = 0;
    let y = 0;
    let guard = 0;
    for (let at = id; at >= 0 && guard < 64; guard += 1) {
      const own = this.own(at);
      x += own.x;
      y += own.y;
      at = this.scrollers.get(at)?.parent ?? -1;
    }
    const result = { x, y };
    this.chains.set(id, result);
    return result;
  }

  /** A rect read now, in a scroller's normalised coordinates. */
  normalise(
    rect: { left: number; top: number; width: number; height: number },
    scroller: number,
  ): Rect {
    const chain = this.chain(scroller);
    return {
      x: rect.left + chain.x,
      y: rect.top + chain.y,
      width: rect.width,
      height: rect.height,
    };
  }

  scrollerFor(el: Element): ScrollerState | undefined {
    const id = this.scrollerOf.get(el);
    return id === undefined ? undefined : this.scrollers.get(id);
  }

  /** The scroller an element creates, made on first sight with the current position as base. */
  ensureScroller(el: Element, parent: number, zoom: number, clip: number): ScrollerState {
    const id = this.scrollerOf.get(el);
    let state = id === undefined ? undefined : this.scrollers.get(id);
    if (!state) {
      state = this.state(this.nextScroller++, el, parent, zoom);
      this.scrollers.set(state.id, state);
      this.scrollerOf.set(el, state.id);
      this.changedScrollers.add(state.id);
    } else if (state.parent !== parent) {
      state.parent = parent;
      this.changedScrollers.add(state.id);
      this.chains.clear();
    }
    state.zoom = zoom;
    state.clip = clip;
    return state;
  }

  /** The clip an element creates; rect in the normalised coordinates of `scroller`. */
  ensureClip(el: Element, parent: number, scroller: number, rect: Rect, radii: Radii): number {
    const known = this.clipOf.get(el);
    const state = known === undefined ? undefined : this.clips.get(known);
    if (state) {
      if (
        state.parent !== parent ||
        state.scroller !== scroller ||
        !rectEqual(state.rect, rect) ||
        !radiiEqual(state.radii, radii)
      ) {
        state.parent = parent;
        state.scroller = scroller;
        state.rect = rect;
        state.radii = radii;
        this.changedClips.add(state.id);
      }
      return state.id;
    }
    const id = this.nextClip++;
    this.clips.set(id, { id, el, parent, scroller, rect, radii });
    this.clipOf.set(el, id);
    this.changedClips.add(id);
    return id;
  }

  clipRect(id: number): Rect | null {
    return this.clips.get(id)?.rect ?? null;
  }

  clipScroller(id: number): number {
    return this.clips.get(id)?.scroller ?? VIEWPORT;
  }

  /** Move a clip with its element (a rigid layout shift). */
  shiftClip(id: number, dx: number, dy: number): void {
    const state = this.clips.get(id);
    if (!state) return;
    state.rect = {
      x: state.rect.x + dx,
      y: state.rect.y + dy,
      width: state.rect.width,
      height: state.rect.height,
    };
    this.changedClips.add(id);
  }

  /** Flat [id, dx, dy, ...] scroll movement per scroller since its base. */
  deltas(): Float32Array {
    const out = new Float32Array(this.scrollers.size * 3);
    let at = 0;
    for (const state of this.scrollers.values()) {
      let x: number;
      let y: number;
      if (state.id === VIEWPORT) {
        x = scrollX - state.baseX;
        y = scrollY - state.baseY;
      } else if (state.id === FIXED) {
        const viewport = this.scrollers.get(VIEWPORT);
        x = viewport ? viewport.baseX - scrollX : 0;
        y = viewport ? viewport.baseY - scrollY : 0;
      } else if (state.el) {
        x = (state.el.scrollLeft - state.baseX) * state.zoom;
        y = (state.el.scrollTop - state.baseY) * state.zoom;
      } else {
        x = 0;
        y = 0;
      }
      out[at] = state.id;
      out[at + 1] = x;
      out[at + 2] = y;
      at += 3;
    }
    return out;
  }

  /** Drop scrollers and clips of elements that left the document. */
  prune(): void {
    for (const [id, state] of this.scrollers) {
      if (state.el && !state.el.isConnected) {
        this.scrollers.delete(id);
        this.scrollerOf.delete(state.el);
      }
    }
    for (const [id, state] of this.clips) {
      if (!state.el.isConnected) {
        this.clips.delete(id);
        this.clipOf.delete(state.el);
        this.changedClips.delete(id);
      }
    }
  }

  hasChanges(): boolean {
    return this.changedScrollers.size > 0 || this.changedClips.size > 0;
  }

  /** Scrollers and clips to send: every one on a reset, else the changed ones. */
  take(all: boolean): { scrollers: Scroller[]; clips: Clip[] } {
    const scrollers: Scroller[] = [];
    const clips: Clip[] = [];
    const scrollerIds = all ? this.scrollers.keys() : this.changedScrollers.values();
    for (const id of scrollerIds) {
      const state = this.scrollers.get(id);
      if (state && id !== VIEWPORT) scrollers.push({ id, parent: state.parent });
    }
    const clipIds = all ? this.clips.keys() : this.changedClips.values();
    for (const id of clipIds) {
      const state = this.clips.get(id);
      if (state)
        clips.push({
          id,
          parent: state.parent,
          scroller: state.scroller,
          rect: state.rect,
          radii: state.radii,
        });
    }
    this.changedScrollers.clear();
    this.changedClips.clear();
    return { scrollers, clips };
  }
}
