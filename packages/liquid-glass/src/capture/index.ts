/**
 * Page capture: the DOM under the scene root, turned into display-list patches for the worker.
 *
 * What is captured
 * - Boxes: background color, border widths and one border color, per-corner radii (circular,
 *   scaled down together like CSS), outer box shadows, and opacity multiplied down the tree.
 *   Inline boxes that wrap get one box per line fragment.
 * - Background images: linear, radial and conic gradients (repeating too) and `url()` images,
 *   with size, position, repeat, origin and clip, rasterised into one bitmap per element.
 * - Text, one bitmap per line of each text node, drawn by the canvas text engine with the
 *   computed font, color (including -webkit-text-fill-color), letter and word spacing,
 *   text-transform, small caps, kerning, text shadows, underline / overline / line-through
 *   (propagated from ancestors), justified spacing and `text-overflow: ellipsis`. Because whole
 *   runs are drawn, bidi, complex scripts, ligatures and emoji come out as laid out.
 * - List markers (bullets and numbers) of list items.
 * - `<img>`/`<picture>` with object-fit and object-position, inline `<svg>` (paint resolved,
 *   referenced symbols and gradients copied in), `<video>`/`<canvas>` (live with addSource,
 *   otherwise one still per capture; a video's poster before it has frames).
 * - `<input>`, `<textarea>` (wrapped) and `<select>` values or placeholders in their content box.
 * - Clips for every overflow other than visible (padding box, inner radii), scrollers for
 *   overflow auto/scroll (and hidden ones that are scrolled), position fixed and the top layer.
 *
 * Paint order is DOM order with stacking contexts honoured: negative z-index, in-flow content,
 * then positioned and z-indexed content sorted by z-index (see order.ts for the approximation).
 *
 * Limitations
 * - Rotation, skew and perspective are ignored: boxes are their axis-aligned bounding boxes and
 *   only the scale of a transform is applied to borders, radii and text.
 * - Not drawn: outlines and focus rings, inset shadows, border styles other than solid (dashed,
 *   dotted and double draw solid), per-side border colors (the first visible side's color is
 *   used), elliptical corners (the smaller radius is used), filters, backdrop filters, blend
 *   modes, masks and clip-path, background-clip: text (such text is invisible), scrollbars,
 *   iframes, native form control chrome (checkboxes, radios, ranges, select arrows), the
 *   caret and the selection highlight, ::before/::after content, ::backdrop, vertical writing
 *   modes, and text-stroke.
 * - Fonts: font-feature-settings, font-variation-settings and font-variant-numeric have no
 *   canvas equivalent; text using them may differ slightly in width.
 * - Pixels the page cannot read are not sent: cross-origin images, videos and canvases without
 *   CORS draw a neutral placeholder (counted as page.capture.tainted). SVG images cannot load
 *   external resources, and `<use>` of an external sprite file draws nothing.
 * - Only the window around what is visible is captured: each scroller's visible area plus one
 *   of its own size beyond every edge. Scrolling further captures more (immediately when the
 *   edge gets close). An element entirely outside its window is skipped with its subtree, even
 *   if a descendant overflows it into view (a fixed or absolute descendant of an off-screen
 *   element is missed until that element is captured).
 * - In-flow content paints element by element instead of "all backgrounds, then all text".
 * - Sticky elements are re-read when their scroller scrolls, one frame behind at worst.
 * - Changes are noticed through DOM mutations, resizes, font and image loads, CSS transitions and
 *   animations, hover, focus and form input. Changes that produce none of those (styles from
 *   `:has()` or sibling selectors reacting to another element, the Web Animations API,
 *   stylesheet rules inserted with insertRule) need `invalidate()`.
 * - Only the light DOM under `root` and open shadow roots are walked: portals rendered outside
 *   `root` are not captured.
 */

import type { DisplayListPatch, Rect, Rgba } from "../protocol";
import type { Telemetry } from "../scene/telemetry";
import { BitmapStore } from "./bitmaps";
import { contains, expand, intersects, rectEqual, shift } from "./css";
import { Frames, type ScrollerState, VIEWPORT } from "./frames";
import { Ledger } from "./ledger";
import { Sources } from "./sources";
import { touchSvg } from "./svg";
import { resetMetrics } from "./text";
import type { ElementRecord } from "./types";
import { rootWalk, Walker } from "./walk";

export interface CaptureHost {
  /** The glass surface an element is, or null. */
  surfaceOf(element: Element): { id: number; labelsInGlass: boolean } | null;
  /** A patch to post to the worker, with its ImageBitmaps in `transfer`. */
  send(patch: DisplayListPatch, transfer: Transferable[]): void;
  /** Something changed under glass: the scene should draw a frame. */
  requestFrame(): void;
  readonly telemetry: Telemetry;
}

export interface Capture {
  /** Flat [scrollerId, dx, dy, ...] since capture, read synchronously for this frame. */
  scrollDeltas(): Float32Array;
  /** Recapture an element's subtree (or everything) before the next frame. */
  invalidate(element?: Element): void;
  /** Send pending patches now (the scene calls it before posting a frame). */
  flush(): void;
  /** Feed a canvas or video element's frames live. Returns a stop function. */
  addSource(element: HTMLCanvasElement | HTMLVideoElement): () => void;
  destroy(): void;
}

type Mode = "deep" | "shallow";

/** Glass reaches this far beyond a surface's box (refraction and shadow). */
const GLASS_MARGIN = 32;
/** How many ancestors above the hovered element are recaptured when the pointer moves. */
const HOVER_LEVELS = 3;
/** Attributes on <html>/<body> that restyle the whole app (themes, direction, scroll locks). */
const DOCUMENT_ATTRIBUTES = [
  "class",
  "style",
  "dir",
  "lang",
  "data-theme",
  "data-mode",
  "data-color-scheme",
];

/** The svg element an svg node is drawn as part of (the outermost one). */
function outermostSvg(node: Node | null): SVGSVGElement | null {
  if (!(node instanceof SVGElement)) return null;
  let svg: SVGSVGElement | null = node instanceof SVGSVGElement ? node : node.ownerSVGElement;
  while (svg?.ownerSVGElement) svg = svg.ownerSVGElement;
  return svg;
}

const parentOf = (element: Element): Element | null => {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const parent = element.parentNode;
  return parent instanceof ShadowRoot ? parent.host : null;
};

export function createCapture(
  root: HTMLElement,
  host: CaptureHost,
  options: { backdrop: Rgba },
): Capture {
  const telemetry = host.telemetry;
  const backdrop = options.backdrop;
  let destroyed = false;
  let reset = true;

  const frames = new Frames();
  const store = new BitmapStore((resource) => {
    ledger.ready(resource);
    host.requestFrame();
  });
  const ledger = new Ledger(store);
  const sources = new Sources(
    store,
    () => host.requestFrame(),
    (element) => invalidate(element),
  );

  /** Elements to capture again: deep (with every descendant) or shallow (own drafts, text, layout). */
  const dirty = new Map<Element, Mode>();
  /** Dirty elements that must be captured before the next frame whatever they are under. */
  const forced = new Set<Element>();
  /** Elements with a CSS transition or animation running. */
  const animating = new Set<Element>();
  const stickies = new Set<ElementRecord>();
  const watched = new WeakSet<Element>();
  const sized = new WeakSet<Element>();
  const observedShadows = new WeakSet<ShadowRoot>();
  const abort = new AbortController();
  const signal = abort.signal;

  const walker = new Walker(root, frames, store, ledger, {
    surfaceOf: (element) => host.surfaceOf(element),
    sourceOf: (element, size) => sources.resourceOf(element, size),
    loaded: (element) => {
      mark(element, "deep");
      schedule();
    },
    shadow: (shadowRoot) => {
      if (observedShadows.has(shadowRoot)) return;
      observedShadows.add(shadowRoot);
      mutations.observe(shadowRoot, MUTATION_OPTIONS);
    },
    watch: (element) => {
      if (watched.has(element)) return;
      watched.add(element);
      resizes.observe(element);
    },
    tainted: () => telemetry.tick("page.capture.tainted"),
  });

  // -------------------------------------------------------------------------------------------
  // Marking dirty
  // -------------------------------------------------------------------------------------------

  /**
   * Mark the nearest captured element at or above `node`. Nodes without a record (new ones,
   * ones inside an svg or a skipped subtree) make their nearest captured ancestor shallow-dirty:
   * a shallow capture walks children it has not seen before in full anyway.
   * Returns the element marked, or null when the node is outside the capture.
   */
  function mark(node: Node | null, mode: Mode): Element | null {
    if (destroyed || !node) return null;
    let element: Element | null =
      node.nodeType === 1
        ? (node as Element)
        : node instanceof ShadowRoot
          ? node.host
          : node.parentElement;
    let effective = mode;
    while (element && !walker.records.has(element)) {
      element = parentOf(element);
      effective = "shallow";
    }
    if (!element) {
      if (!walker.records.has(root)) {
        dirty.set(root, "deep");
        return root;
      }
      return null;
    }
    if (dirty.get(element) !== "deep") dirty.set(element, effective);
    return element;
  }

  let idleHandle: number | null = null;
  const idleAvailable = typeof requestIdleCallback === "function";
  function schedule(): void {
    if (destroyed || idleHandle !== null) return;
    idleHandle = idleAvailable
      ? requestIdleCallback(idle, { timeout: 250 })
      : window.setTimeout(idle, 50);
  }
  function cancelIdle(): void {
    if (idleHandle === null) return;
    if (idleAvailable) cancelIdleCallback(idleHandle);
    else clearTimeout(idleHandle);
    idleHandle = null;
  }

  const MUTATION_OPTIONS: MutationObserverInit = {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  };

  const ignorable = (node: Node): boolean =>
    node.nodeType === 1
      ? (node as Element).hasAttribute("data-lg-canvas") ||
        (node as Element).hasAttribute("data-lg-ignore")
      : node.nodeType === 8;

  /** Inside an element the capture skips (the scene's own helpers, glass canvases). */
  const skipped = (node: Node): boolean => {
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    return !!element?.closest("[data-lg-ignore],[data-lg-canvas]");
  };

  // Glass moved by script (a transform written every frame on a wrapper around a surface) must
  // not recapture anything: the scene measures surfaces every frame and their own items follow
  // them. That holds while the element and everything in it paints nothing of its own apart from
  // surfaces, and its paint-relevant style is what it was the last time it was looked at.
  const paintStyles = new WeakMap<Element, string>();
  function glassOnly(record: ElementRecord): boolean {
    if (record.drafts.length) return false;
    for (const child of record.children) {
      if (child.kind !== "element") return false;
      if (host.surfaceOf(child.el)) {
        if (child.drafts.length) return false;
        continue;
      }
      if (!glassOnly(child)) return false;
    }
    return true;
  }
  function onlyMoved(target: Node): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const record = walker.records.get(target);
    if (!record || record.state !== "drawn" || !glassOnly(record)) return false;
    const style = getComputedStyle(target);
    const signature = [
      style.display,
      style.visibility,
      style.opacity,
      style.backgroundColor,
      style.backgroundImage,
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
      style.borderTopColor,
      style.boxShadow,
      style.outlineStyle,
      style.filter,
      style.clipPath,
      style.overflow,
      style.zIndex,
      style.position,
      target.offsetWidth,
      target.offsetHeight,
    ].join("|");
    const before = paintStyles.get(target);
    paintStyles.set(target, signature);
    return before === signature;
  }

  const mutations = new MutationObserver((records) => {
    let any = false;
    for (const record of records) {
      const target = record.target;
      if (skipped(target)) continue;
      if (record.type === "attributes") {
        const name = record.attributeName ?? "";
        if (name.startsWith("data-lg-")) continue;
        if ((name === "style" || name === "class") && onlyMoved(target)) continue;
        const svg = outermostSvg(target);
        if (svg) touchSvg(svg);
        any = mark(svg ?? target, "deep") !== null || any;
      } else if (record.type === "characterData") {
        const svg = outermostSvg(target.parentElement);
        if (svg) touchSvg(svg);
        any = mark(svg ?? target.parentElement, svg ? "deep" : "shallow") !== null || any;
      } else {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.length && nodes.every(ignorable)) continue;
        const svg = outermostSvg(target);
        if (svg) touchSvg(svg);
        any = mark(svg ?? target, svg ? "deep" : "shallow") !== null || any;
      }
    }
    if (any) schedule();
  });
  mutations.observe(root, MUTATION_OPTIONS);

  // Themes and scroll locks live on <html> and <body>, often outside the root.
  const documentObserver = new MutationObserver(() => {
    mark(root, "deep");
    schedule();
  });
  for (const element of [document.documentElement, document.body]) {
    if (element && !root.contains(element) && element !== root) {
      documentObserver.observe(element, { attributes: true, attributeFilter: DOCUMENT_ATTRIBUTES });
    }
  }

  const resizes = new ResizeObserver((entries) => {
    let any = false;
    for (const entry of entries) {
      // Observing reports the current size once; only later reports are changes.
      if (!sized.has(entry.target)) {
        sized.add(entry.target);
        continue;
      }
      any = mark(entry.target, entry.target === root ? "deep" : "shallow") !== null || any;
    }
    if (any) schedule();
  });
  watched.add(root);
  resizes.observe(root);

  const listen = (target: EventTarget, type: string, handler: (event: Event) => void) =>
    target.addEventListener(type, handler, { capture: true, passive: true, signal });

  const targetOf = (event: Event): Element | null => {
    const target = event.composedPath()[0] ?? event.target;
    return target instanceof Element ? target : null;
  };
  const ignored = (element: Element) => !!element.closest("[data-lg-ignore]");

  const deepen = (event: Event) => {
    const target = targetOf(event);
    if (target && !ignored(target) && mark(target, "deep")) schedule();
  };
  for (const type of ["load", "error", "input", "change", "toggle", "focusin", "focusout"])
    listen(root, type, deepen);

  const start = (event: Event) => {
    const target = targetOf(event);
    if (!target || ignored(target)) return;
    animating.add(target);
    host.requestFrame();
  };
  const finish = (event: Event) => {
    const target = targetOf(event);
    if (!target || !animating.delete(target)) return;
    const marked = mark(target, "deep");
    if (marked) {
      glass = null;
      if (underGlass(marked)) forced.add(marked);
      schedule();
      host.requestFrame();
    }
  };
  listen(root, "transitionrun", start);
  listen(root, "animationstart", start);
  for (const type of ["transitionend", "transitioncancel", "animationend", "animationcancel"])
    listen(root, type, finish);

  // :hover changes on the elements the pointer entered or left.
  const hover = (event: Event) => {
    const target = targetOf(event);
    if (!target || ignored(target)) return;
    const related = (event as PointerEvent).relatedTarget;
    let top: Element = target;
    if (related instanceof Node) {
      // Hover styles sit on or just above the element under the pointer; climbing further
      // would recapture whole regions when the pointer crosses between them.
      let steps = 0;
      for (
        let at = parentOf(target);
        at && at !== root && !at.contains(related) && steps < HOVER_LEVELS;
        at = parentOf(at)
      ) {
        top = at;
        steps += 1;
      }
    }
    if (mark(top, "deep")) schedule();
  };
  listen(root, "pointerover", hover);
  listen(root, "pointerout", hover);

  const scrolled = (state: ScrollerState) => {
    state.moved = true;
    for (const record of state.sticky) stickies.add(record);
    host.requestFrame();
  };
  listen(root, "scroll", (event) => {
    const target = event.target;
    if (target === document || target === document.documentElement || target === document.body)
      return;
    if (!(target instanceof Element) || ignored(target)) return;
    const state = frames.scrollerFor(target);
    if (state) scrolled(state);
    else if (walker.records.has(target) && mark(target, "deep")) {
      // Something that was not known to scroll did: capture it again as a scroller.
      forced.add(target);
      host.requestFrame();
    }
  });
  const viewportScrolled = () => {
    const state = frames.scrollers.get(VIEWPORT);
    if (state) scrolled(state);
  };
  window.addEventListener("scroll", viewportScrolled, { passive: true, signal });
  window.visualViewport?.addEventListener("scroll", () => host.requestFrame(), {
    passive: true,
    signal,
  });
  window.visualViewport?.addEventListener("resize", () => host.requestFrame(), {
    passive: true,
    signal,
  });
  window.addEventListener(
    "resize",
    () => {
      mark(root, "deep");
      schedule();
    },
    { passive: true, signal },
  );

  const watchResolution = () => {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        walker.epoch += 1;
        mark(root, "deep");
        forced.add(root);
        host.requestFrame();
        watchResolution();
      },
      { once: true, signal },
    );
  };
  watchResolution();

  document.fonts?.addEventListener(
    "loadingdone",
    () => {
      // Runs drawn with a fallback font must not be reused.
      walker.epoch += 1;
      resetMetrics();
      mark(root, "deep");
      schedule();
    },
    { signal },
  );

  // -------------------------------------------------------------------------------------------
  // Under glass
  // -------------------------------------------------------------------------------------------

  let glass: Rect[] | null = null;
  function glassRects(): Rect[] {
    if (glass) return glass;
    glass = [];
    for (const surface of walker.surfaces) {
      if (!surface.isConnected) {
        walker.surfaces.delete(surface);
        continue;
      }
      const r = surface.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        glass.push(
          expand(
            { x: r.left, y: r.top, width: r.width, height: r.height },
            GLASS_MARGIN,
            GLASS_MARGIN,
          ),
        );
    }
    return glass;
  }

  /** Whether an element's last captured box is under (or part of) any glass surface now. */
  function underGlass(element: Element): boolean {
    let record = walker.records.get(element);
    for (let at: Element | null = element; !record && at; at = parentOf(at))
      record = walker.records.get(at);
    if (!record) return false;
    if (record.input.owner !== 0 || host.surfaceOf(record.el)) return true;
    let rect = record.rect;
    let scroller = record.boxScroller;
    for (let up = record.parent; (rect.width <= 0 || rect.height <= 0) && up; up = up.parent) {
      rect = up.rect;
      scroller = up.boxScroller;
    }
    const chain = frames.chain(scroller);
    const now = shift(rect, -chain.x, -chain.y);
    return glassRects().some((g) => intersects(g, now));
  }

  // -------------------------------------------------------------------------------------------
  // Passes
  // -------------------------------------------------------------------------------------------

  const depthOf = (element: Element) => {
    let depth = 0;
    for (let at = parentOf(element); at; at = parentOf(at)) depth += 1;
    return depth;
  };

  /** The window a scroller should capture around what it shows now, and whether that moved far. */
  function visibleOf(state: ScrollerState): Rect | null {
    const chain = frames.chain(state.id);
    if (state.id === VIEWPORT)
      return { x: chain.x, y: chain.y, width: innerWidth, height: innerHeight };
    const clip = frames.clipRect(state.clip);
    if (!clip) return null;
    const parent = frames.chain(state.parent);
    return shift(clip, chain.x - parent.x, chain.y - parent.y);
  }

  /** Scrollers that moved: 0 = fine, 1 = recapture soon, 2 = recapture before the next frame. */
  function drift(state: ScrollerState): 0 | 1 | 2 {
    const visible = visibleOf(state);
    if (!visible || !state.cull) return 0;
    const marginX = Math.max(visible.width, 256);
    const marginY = Math.max(visible.height, 256);
    if (!contains(expand(state.cull, -marginX * 0.85, -marginY * 0.85), visible)) return 2;
    if (!contains(expand(state.cull, -marginX * 0.5, -marginY * 0.5), visible)) return 1;
    return 0;
  }

  function recull(state: ScrollerState): void {
    const visible = visibleOf(state);
    const record =
      state.id === VIEWPORT
        ? walker.records.get(root)
        : state.el
          ? walker.records.get(state.el)
          : undefined;
    if (!visible || !record) return;
    state.cull = expand(visible, Math.max(visible.width, 256), Math.max(visible.height, 256));
    walker.recull(record, state.id);
  }

  function run(entries: [Element, Mode][], reculls: ScrollerState[], moved: ElementRecord[]): void {
    telemetry.time("page.capture", () => {
      const first = !walker.records.has(root);
      const full = first || entries.some(([element, mode]) => element === root && mode === "deep");
      const targets = entries.map(([element]) => element);
      for (const state of reculls) targets.push(state.el ?? root);
      for (const record of moved) targets.push(record.el);
      walker.begin(targets, full);
      try {
        if (first) {
          walker.walk(root, rootWalk(), null, true);
        } else {
          const ordered = entries.map(([element, mode]) => ({
            element,
            mode,
            depth: depthOf(element),
          }));
          ordered.sort((a, b) => a.depth - b.depth);
          const deepDone = new Set<Element>();
          const changed = new Set<ElementRecord>();
          for (const { element, mode } of ordered) {
            let covered = false;
            for (let at = parentOf(element); at && !covered; at = parentOf(at))
              covered = deepDone.has(at);
            if (covered) continue;
            const record = walker.records.get(element);
            if (!record) continue;
            const before = record.rect;
            walker.walk(element, record.input, record.parent, mode === "deep");
            if (mode === "deep") deepDone.add(element);
            if (record.parent && !rectEqual(before, record.rect)) changed.add(record.parent);
          }
          // A box that changed size moves its siblings and may resize its ancestors.
          const parents = [...changed].sort((a, b) => depthOf(b.el) - depthOf(a.el));
          const settled = new Set<ElementRecord>();
          for (const parent of parents) {
            for (let at: ElementRecord | null = parent; at && !settled.has(at); at = at.parent) {
              settled.add(at);
              if (walker.records.get(at.el) !== at) break;
              const before = at.rect;
              walker.walk(at.el, at.input, at.parent, false);
              if (rectEqual(before, at.rect)) break;
            }
          }
        }
        for (const record of moved)
          if (walker.records.get(record.el) === record && record.state !== "hidden")
            walker.reconcile(record);
        for (const state of reculls) recull(state);
        ledger.commit(walker.records.get(root) ?? null);
      } finally {
        walker.end();
      }
    });
  }

  function send(): boolean {
    if (!walker.records.has(root)) return false;
    const { upsert, remove } = ledger.take();
    const { bitmaps, transfer, releases } = store.take();
    const { scrollers, clips } = frames.take(reset);
    if (
      !reset &&
      !upsert.length &&
      !remove.length &&
      !bitmaps.length &&
      !releases.length &&
      !scrollers.length &&
      !clips.length
    ) {
      return false;
    }
    const patch: DisplayListPatch = {
      reset,
      scrollers,
      clips,
      upsert,
      remove,
      bitmaps,
      releaseBitmaps: releases,
      backdrop,
    };
    reset = false;
    telemetry.tick("page.capture.items", upsert.length);
    host.send(patch, transfer);
    return true;
  }

  /** Everything pending, in idle time. */
  function idle(): void {
    idleHandle = null;
    if (destroyed) return;
    glass = null;
    frames.begin();
    const entries = [...dirty];
    dirty.clear();
    forced.clear();
    const reculls: ScrollerState[] = [];
    for (const state of frames.scrollers.values()) {
      if (!state.moved) continue;
      state.moved = false;
      if (drift(state) > 0) reculls.push(state);
    }
    const moved = [...stickies];
    stickies.clear();
    if (entries.length || reculls.length || moved.length) run(entries, reculls, moved);
    frames.prune();
    if (send()) host.requestFrame();
  }

  function flush(): void {
    if (destroyed) return;
    glass = null;
    frames.begin();
    // Values set from script fire no event.
    for (const record of walker.forms) {
      const el = record.el;
      if (!el.isConnected || walker.records.get(el) !== record) {
        walker.forms.delete(record);
        continue;
      }
      const value =
        el instanceof HTMLSelectElement
          ? `${el.selectedIndex}`
          : (el as HTMLInputElement | HTMLTextAreaElement).value;
      if (value !== record.value && mark(el, "deep")) {
        if (underGlass(el)) forced.add(el);
        schedule();
      }
    }
    // Animations under glass are captured every frame they run.
    let animated = false;
    for (const element of animating) {
      if (!element.isConnected) {
        animating.delete(element);
        continue;
      }
      if (!underGlass(element)) continue;
      const marked = mark(element, "deep");
      if (marked) {
        forced.add(marked);
        animated = true;
      }
    }
    const entries: [Element, Mode][] = [];
    for (const [element, mode] of dirty) {
      if (element === root && !walker.records.has(root)) {
        entries.push([element, mode]);
        continue;
      }
      if (forced.has(element) || underGlass(element)) entries.push([element, mode]);
    }
    for (const [element] of entries) {
      dirty.delete(element);
      forced.delete(element);
    }
    const reculls: ScrollerState[] = [];
    let later = false;
    for (const state of frames.scrollers.values()) {
      if (!state.moved) continue;
      const level = drift(state);
      if (level === 2) {
        state.moved = false;
        reculls.push(state);
      } else if (level === 1) later = true;
      else state.moved = false;
    }
    const moved = [...stickies];
    stickies.clear();
    if (entries.length || reculls.length || moved.length) run(entries, reculls, moved);
    if (later || dirty.size) schedule();
    send();
    if (animated) host.requestFrame();
  }

  function invalidate(element?: Element): void {
    if (destroyed) return;
    const marked = mark(element ?? root, "deep");
    if (marked) forced.add(marked);
    // The scene flushes on its next frame; idle time catches it if no frame comes.
    schedule();
    host.requestFrame();
  }

  // The first capture runs at the first flush, or in idle time if no frame comes first.
  dirty.set(root, "deep");
  forced.add(root);
  schedule();

  return {
    scrollDeltas: () => frames.deltas(),
    invalidate,
    flush,
    addSource: (element) => sources.add(element),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelIdle();
      abort.abort();
      mutations.disconnect();
      documentObserver.disconnect();
      resizes.disconnect();
      sources.dispose();
      store.dispose();
      dirty.clear();
      forced.clear();
      animating.clear();
      stickies.clear();
    },
  };
}
