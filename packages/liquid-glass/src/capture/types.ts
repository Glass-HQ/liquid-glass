/**
 * The capture's internal model. Every captured element has a record that mirrors the DOM: its
 * own drafts (box, background, marker, replaced content), its children in DOM order (elements
 * and text nodes) and what it inherited from its ancestors (`Walk`). A recapture rewalks one
 * record in place; paint order is recomputed from the record tree without touching the DOM.
 *
 * Geometry is stored "normalised": in viewport coordinates as they were when each scroller was
 * first seen. A rect read now is shifted by how far its scroller chain has moved since, so items
 * captured at different times agree with one per-frame scroll delta per scroller.
 */

import type { BoxShadow, Radii, Rect, Rgba } from "../protocol";

/** The scroller and clip that an element's box (or its children) moves and is clipped with. */
export interface Frame {
  readonly scroller: number;
  readonly clip: number;
}

export interface Decoration {
  readonly underline: boolean;
  readonly overline: boolean;
  readonly lineThrough: boolean;
  readonly color: string;
  /** CSS px, or 0 for the font's default. */
  readonly thickness: number;
  /** CSS px below the default underline position. */
  readonly offset: number;
}

/** A content box whose overflowing text ends in an ellipsis, in normalised coordinates. */
export interface Ellipsis {
  readonly scroller: number;
  readonly left: number;
  readonly right: number;
}

/** What an element inherits from its ancestors during a walk. */
export interface Walk {
  /** Surface that owns this element's own items (0 for the page). */
  readonly owner: number;
  /** Frame for in-flow boxes. */
  readonly flow: Frame;
  /** Frame for `position: absolute` boxes: inside the nearest positioned ancestor. */
  readonly abs: Frame;
  /** Frame for `position: fixed` boxes: the viewport, or the nearest transformed ancestor. */
  readonly fixed: Frame;
  /** Product of every ancestor's opacity. */
  readonly opacity: number;
  /** Product of every ancestor's scale (transform, `scale`, `zoom`). */
  readonly zoom: number;
  /** Text decorations propagated from ancestors. */
  readonly decorations: readonly Decoration[];
  readonly ellipsis: Ellipsis | null;
  /** The parent is a flex or grid container, so `z-index` applies without positioning. */
  readonly flexItem: boolean;
}

/** A resource an item draws: a bitmap sent to the worker once and shared by key. */
export interface Resource {
  readonly key: string;
  /** Bitmap id the worker knows it by. */
  readonly bitmap: number;
  state: "pending" | "ready" | "failed";
  width: number;
  height: number;
  refs: number;
  /** Item keys whose bitmap was not ready when they were captured. */
  readonly waiting: Set<number>;
  /** Owned resources (live sources) are not freed when their refs drop to zero. */
  readonly owned: boolean;
  /** Kept for reuse for a while after the last item lets go (slow to make again). */
  readonly keep: boolean;
  /** Drawing metadata for text runs: where the run's line box sits in the bitmap, in CSS px. */
  meta: RunMeta | null;
  /** Bumped when an owned resource's bitmap changes size, so drafts recompute their source rect. */
  generation: number;
}

export interface RunMeta {
  /** Offset of the line box's left edge from the bitmap's left edge, CSS px. */
  readonly left: number;
  /** Offset of the baseline from the bitmap's top edge, in bitmap pixels (an integer). */
  readonly baseline: number;
  /** Baseline offset from the line box's top edge, CSS px. */
  readonly ascent: number;
  /** Bitmap pixels per CSS px. */
  readonly scale: number;
}

interface DraftBase {
  readonly key: number;
  owner: number;
  scroller: number;
  clip: number;
  opacity: number;
  /** Paint order; NaN until assigned. */
  order: number;
  rect: Rect;
  radii: Radii;
}

export interface BoxDraft extends DraftBase {
  readonly kind: "box";
  fill: Rgba;
  border: readonly [number, number, number, number];
  borderColor: Rgba;
  shadows: readonly BoxShadow[];
}

export interface BitmapDraft extends DraftBase {
  readonly kind: "bitmap";
  readonly res: Resource;
  source: Rect;
}

export type Draft = BoxDraft | BitmapDraft;

export interface TextRecord {
  readonly kind: "text";
  readonly node: Text;
  drafts: Draft[];
  /** Normalised vertical range the captured lines cover, or null when every line was captured. */
  covered: { top: number; bottom: number } | null;
  /** Scroller the text's lines scroll with. */
  scroller: number;
}

export type RecordState = "drawn" | "hidden" | "culled";

export interface ElementRecord {
  readonly kind: "element";
  readonly el: Element;
  parent: ElementRecord | null;
  input: Walk;
  state: RecordState;
  /** Normalised border box. */
  rect: Rect;
  /** Scroller the element's own box moves with. */
  boxScroller: number;
  drafts: Draft[];
  children: (ElementRecord | TextRecord)[];
  /** Painted in its stacking context's layer lists (positioned, or a stacking context). */
  layered: boolean;
  /** Creates a stacking context. */
  context: boolean;
  z: number;
  /** In the top layer (modal dialog, open popover): painted above everything. */
  top: boolean;
  /** `position: fixed`: its geometry does not follow its parent's. */
  fixed: boolean;
  /** Scroller created by this element for its children, or 0. */
  scroller: number;
  /** Clip created by this element for its children, or 0. */
  clip: number;
  /** For form fields: the value that was drawn, to notice programmatic changes. */
  value: string | null;
}
