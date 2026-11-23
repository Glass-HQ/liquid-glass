/**
 * Paint order, computed from the record tree without touching the DOM.
 *
 * Within a stacking context CSS paints: the context's own background, then descendants with a
 * negative z-index, then in-flow content in tree order, then positioned descendants with
 * z-index auto or 0 and those with a positive z-index, sorted by z-index then tree order. A
 * positioned element without a z-index is not a stacking context: its own positioned descendants
 * are sorted in the same list as it. Top-layer elements (modal dialogs, open popovers) come after
 * everything.
 *
 * The approximation: in-flow content is painted element by element (each box, then its
 * children), where CSS paints all block backgrounds of a context before its inline content and
 * floats in between. That only differs when an in-flow box overlaps the text of an earlier one.
 *
 * Orders are floats. After a change, the items that keep their relative order keep their number
 * (a longest increasing subsequence of the previous orders) and the rest are spread between
 * their neighbours, so inserting a message does not renumber every item after it.
 */

import type { Draft, ElementRecord } from "./types";

export function paintSequence(root: ElementRecord): Draft[] {
  const out: Draft[] = [];
  const top: ElementRecord[] = [];
  paintContext(root, out, top);
  for (let index = 0; index < top.length; index += 1) {
    const element = top[index];
    if (element) paintContext(element, out, top);
  }
  return out;
}

function paintContext(context: ElementRecord, out: Draft[], top: ElementRecord[]): void {
  for (const draft of context.drafts) out.push(draft);
  const layers: ElementRecord[] = [];
  const normal: Draft[] = [];
  collect(context, normal, layers, top);
  if (layers.length > 1) layers.sort((a, b) => a.z - b.z);
  let index = 0;
  for (; index < layers.length && (layers[index]?.z ?? 0) < 0; index += 1)
    paintLayer(layers[index] as ElementRecord, out, top);
  for (const draft of normal) out.push(draft);
  for (; index < layers.length; index += 1) paintLayer(layers[index] as ElementRecord, out, top);
}

function paintLayer(layer: ElementRecord, out: Draft[], top: ElementRecord[]): void {
  if (layer.context) {
    paintContext(layer, out, top);
    return;
  }
  for (const draft of layer.drafts) out.push(draft);
  collect(layer, out, null, top);
}

/**
 * In-flow content of `parent` into `normal`; layered descendants into `layers` (or skipped when
 * null: they were already listed by the enclosing context).
 */
function collect(
  parent: ElementRecord,
  normal: Draft[],
  layers: ElementRecord[] | null,
  top: ElementRecord[],
): void {
  for (const child of parent.children) {
    if (child.kind === "text") {
      for (const draft of child.drafts) normal.push(draft);
      continue;
    }
    if (child.state !== "drawn") continue;
    if (child.top) {
      top.push(child);
      continue;
    }
    if (child.layered) {
      if (layers) {
        layers.push(child);
        if (!child.context) collectLayers(child, layers);
      }
      continue;
    }
    for (const draft of child.drafts) normal.push(draft);
    collect(child, normal, layers, top);
  }
}

/** Layered descendants of a positioned element that is not a stacking context. */
function collectLayers(parent: ElementRecord, layers: ElementRecord[]): void {
  for (const child of parent.children) {
    if (child.kind === "text" || child.state !== "drawn" || child.top) continue;
    if (child.layered) {
      layers.push(child);
      if (!child.context) collectLayers(child, layers);
    } else {
      collectLayers(child, layers);
    }
  }
}

const STEP = 1024;
const MIN_GAP = 1e-4;
const LIMIT = 1e12;

/**
 * Give every draft an order that increases along `sequence`, keeping as many previous orders as
 * possible. `changed` is called for each draft whose order changed.
 */
export function assignOrders(sequence: readonly Draft[], changed: (draft: Draft) => void): void {
  const n = sequence.length;
  const tails: number[] = [];
  const previous = new Int32Array(n).fill(-1);
  for (let index = 0; index < n; index += 1) {
    const order = sequence[index]?.order ?? Number.NaN;
    if (!Number.isFinite(order) || Math.abs(order) > LIMIT) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sequence[tails[mid] ?? 0]?.order ?? 0) < order) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[index] = tails[lo - 1] ?? -1;
    tails[lo] = index;
  }
  const keep = new Uint8Array(n);
  for (
    let at = tails.length ? (tails[tails.length - 1] ?? -1) : -1;
    at >= 0;
    at = previous[at] ?? -1
  )
    keep[at] = 1;

  const set = (draft: Draft, order: number) => {
    if (draft.order !== order) {
      draft.order = order;
      changed(draft);
    }
  };
  // Fill runs of drafts without a kept order between their kept neighbours.
  const fill = (from: number, to: number, low: number, high: number): boolean => {
    const count = to - from;
    if (count <= 0) return true;
    let base: number;
    let step: number;
    if (!Number.isFinite(low) && !Number.isFinite(high)) {
      base = 0;
      step = STEP;
    } else if (!Number.isFinite(low)) {
      base = high - STEP * (count + 1);
      step = STEP;
    } else if (!Number.isFinite(high)) {
      base = low;
      step = STEP;
    } else {
      step = (high - low) / (count + 1);
      base = low;
      if (step < MIN_GAP) return false;
    }
    for (let k = 0; k < count; k += 1) {
      const draft = sequence[from + k];
      if (draft) set(draft, base + step * (k + 1));
    }
    return true;
  };
  let ok = true;
  let lastIndex = -1;
  let lastOrder = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < n && ok; index += 1) {
    if (!keep[index]) continue;
    const order = sequence[index]?.order ?? 0;
    ok = fill(lastIndex + 1, index, lastOrder, order);
    lastIndex = index;
    lastOrder = order;
  }
  if (ok) ok = fill(lastIndex + 1, n, lastOrder, Number.POSITIVE_INFINITY);
  if (ok) return;
  for (let index = 0; index < n; index += 1) {
    const draft = sequence[index];
    if (draft) set(draft, (index + 1) * STEP);
  }
}
