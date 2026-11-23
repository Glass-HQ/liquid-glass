/**
 * The DOM walker: turns an element and its subtree into records and drafts.
 *
 * `walk(el, input, parent, deep)` (re)captures one element in place. With `deep`, every
 * descendant is captured again; without, the element's own drafts and direct text are captured
 * again and each child element that kept its inherited state is only checked for movement
 * (`reconcile`): unchanged children cost one rect read, moved ones are shifted rigidly, resized
 * ones are refreshed the same way, recursively. That is how a layout change spreads through
 * siblings and ancestors without restyling the page.
 */

import { parseColor, TRANSPARENT } from "../core/color";
import type { BoxShadow, Radii, Rect, Rgba } from "../protocol";
import { backgroundOf } from "./paint";
import type { BitmapStore } from "./bitmaps";
import {
  expand,
  insetRadii,
  insetRect,
  intersects,
  px,
  radiiOf,
  rectEqual,
  scaleOf,
  shadowsOf,
  shift,
  ZERO_RADII,
} from "./css";
import { FIXED, type Frames, VIEWPORT } from "./frames";
import type { Ledger } from "./ledger";
import {
  bitmapOf,
  bitmapSize,
  canvasReadable,
  fitObject,
  imageReadable,
  loadImage,
  naturalSize,
  videoReadable,
} from "./media";
import { rasteriseSvg, svgMarkup } from "./svg";
import {
  drawRun,
  hasVisibleText,
  lineStarts,
  linesOf,
  lineText,
  measure,
  metricsOf,
  rasterScale,
  runKey,
  runRect,
  spaceRendered,
  type TextStyle,
  textStyleOf,
  transformText,
  truncate,
} from "./text";
import type {
  BitmapDraft,
  Decoration,
  Draft,
  ElementRecord,
  Ellipsis,
  Frame,
  Resource,
  TextRecord,
  Walk,
} from "./types";

export interface WalkHost {
  surfaceOf(element: Element): { id: number; labelsInGlass: boolean } | null;
  /** The live frames of an element added with addSource (grabbed at `size` px), or null. */
  sourceOf(element: Element, size: { width: number; height: number }): Resource | null;
  /** Something an element draws finished loading: capture it again. */
  loaded(element: Element): void;
  /** A shadow root was found: observe it too. */
  shadow(root: ShadowRoot): void;
  /** An element whose size should be watched (scrollers). */
  watch(element: Element): void;
  tainted(): void;
}

const SKIP = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "TITLE",
  "HEAD",
  "BASE",
  "NOSCRIPT",
  "TEMPLATE",
  "SOURCE",
  "TRACK",
  "PARAM",
  "AREA",
  "MAP",
  "DATALIST",
  "BR",
  "WBR",
  "AUDIO",
  "OPTION",
  "OPTGROUP",
]);

const NO_INPUT_TEXT = new Set(["checkbox", "radio", "range", "color", "file", "hidden", "image"]);
const BUTTON_TYPES = new Set(["button", "submit", "reset"]);
const PLACEHOLDER: Rgba = [0.5, 0.5, 0.5, 0.18];
/** Clip rects for an axis that does not clip. */
const HUGE = 1e7;
const LABELS = "data-lg-labels";

// Key parts for an element's drafts. Text nodes use the line index as their part.
const PART_BOX = 0;
const PART_BACKGROUND = 1;
const PART_MARKER = 2;
const partFragment = (index: number) => (index === 0 ? PART_BOX : 4 + index * 2);
const partContent = (line: number) => 3 + line * 2;

const isElement = (node: Node): node is Element => node.nodeType === 1;
const isText = (node: Node): node is Text => node.nodeType === 3;

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function sameWalk(a: Walk, b: Walk): boolean {
  return (
    a.owner === b.owner &&
    a.flow.scroller === b.flow.scroller &&
    a.flow.clip === b.flow.clip &&
    a.abs.scroller === b.abs.scroller &&
    a.abs.clip === b.abs.clip &&
    a.fixed.scroller === b.fixed.scroller &&
    a.fixed.clip === b.fixed.clip &&
    Math.abs(a.opacity - b.opacity) < 1e-4 &&
    Math.abs(a.zoom - b.zoom) < 1e-4 &&
    a.flexItem === b.flexItem &&
    a.decorations.length === b.decorations.length &&
    a.decorations.every((d, i) => {
      const e = b.decorations[i];
      return (
        !!e &&
        d.underline === e.underline &&
        d.overline === e.overline &&
        d.lineThrough === e.lineThrough &&
        d.color === e.color &&
        d.thickness === e.thickness &&
        d.offset === e.offset
      );
    }) &&
    (a.ellipsis === b.ellipsis ||
      (!!a.ellipsis &&
        !!b.ellipsis &&
        a.ellipsis.left === b.ellipsis.left &&
        a.ellipsis.right === b.ellipsis.right))
  );
}

export function rootWalk(): Walk {
  const frame = { scroller: VIEWPORT, clip: 0 };
  return {
    owner: 0,
    flow: frame,
    abs: frame,
    fixed: { scroller: FIXED, clip: 0 },
    opacity: 1,
    zoom: 1,
    decorations: [],
    ellipsis: null,
    flexItem: false,
  };
}

function childNodesOf(element: Element): ArrayLike<Node> {
  if (element.shadowRoot) return element.shadowRoot.childNodes;
  if (element instanceof HTMLSlotElement) {
    const assigned = element.assignedNodes({ flatten: true });
    return assigned.length ? assigned : element.childNodes;
  }
  return element.childNodes;
}

export class Walker {
  readonly records = new Map<Element, ElementRecord>();
  /** Glass surfaces met while walking, for "is this under glass" checks. */
  readonly surfaces = new Set<Element>();
  /** Surfaces whose labels the worker draws (their DOM text is transparent). */
  readonly labelHosts = new Set<Element>();
  /** Form fields, to notice values set from script. */
  readonly forms = new Set<ElementRecord>();
  private readonly keys = new WeakMap<Node, number[]>();
  private nextKey = 1;
  private readonly range = document.createRange();
  private lifted: Element[] = [];
  private snapshots = new WeakMap<Element, number>();
  dpr = 1;
  /** Prefix of text-run cache keys; bumped when fonts load so stale runs are not reused. */
  epoch = 0;

  constructor(
    readonly root: Element,
    private readonly frames: Frames,
    private readonly store: BitmapStore,
    private readonly ledger: Ledger,
    private readonly host: WalkHost,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Passes
  // -------------------------------------------------------------------------------------------

  /** Prepare for a pass that walks below `targets`: read scroll positions, lift label colors. */
  begin(targets: readonly Element[], fresh: boolean): void {
    this.dpr = devicePixelRatio || 1;
    this.frames.begin();
    const viewport = this.frames.scrollers.get(VIEWPORT);
    const fixed = this.frames.scrollers.get(FIXED);
    if (viewport && (fresh || !viewport.cull)) {
      const chain = this.frames.chain(VIEWPORT);
      const w = innerWidth;
      const h = innerHeight;
      viewport.cull = expand({ x: chain.x, y: chain.y, width: w, height: h }, w, h);
    }
    if (fixed && (fresh || !fixed.cull)) {
      fixed.cull = expand(
        { x: 0, y: 0, width: innerWidth, height: innerHeight },
        innerWidth / 4,
        innerHeight / 4,
      );
    }
    for (const host of this.labelHosts) {
      if (!host.isConnected) {
        this.labelHosts.delete(host);
        continue;
      }
      if (targets.some((target) => host.contains(target) || target.contains(host))) this.lift(host);
    }
  }

  /** Put back what `begin` and the walk lifted. Always called, in the same task. */
  end(): void {
    for (const host of this.lifted) host.setAttribute(LABELS, "");
    this.lifted = [];
  }

  private lift(host: Element): void {
    if (!host.hasAttribute(LABELS)) return;
    host.removeAttribute(LABELS);
    this.lifted.push(host);
  }

  private key(node: Node, part: number): number {
    let parts = this.keys.get(node);
    if (!parts) this.keys.set(node, (parts = []));
    let key = parts[part];
    if (key === undefined) {
      key = this.nextKey++;
      parts[part] = key;
    }
    return key;
  }

  private cullOf(scroller: number): Rect | null {
    return this.frames.scrollers.get(scroller)?.cull ?? null;
  }

  private visible(rect: Rect, frame: Frame): boolean {
    const cull = this.cullOf(frame.scroller);
    if (cull && !intersects(rect, cull)) return false;
    if (frame.clip && this.frames.clipScroller(frame.clip) === frame.scroller) {
      const clip = this.frames.clipRect(frame.clip);
      if (clip && !intersects(rect, clip)) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Records
  // -------------------------------------------------------------------------------------------

  /** Capture an element in place (creating its record on first sight). */
  walk(el: Element, input: Walk, parent: ElementRecord | null, deep: boolean): ElementRecord {
    let record = this.records.get(el);
    const previous = record ? record.children : [];
    if (record) {
      this.retireOwn(record);
      record.parent = parent;
      record.input = input;
    } else {
      record = {
        kind: "element",
        el,
        parent,
        input,
        state: "hidden",
        rect: { x: 0, y: 0, width: 0, height: 0 },
        boxScroller: VIEWPORT,
        drafts: [],
        children: [],
        layered: false,
        context: false,
        z: 0,
        top: false,
        fixed: false,
        scroller: 0,
        clip: 0,
        value: null,
      };
      this.records.set(el, record);
    }
    record.drafts = [];
    record.children = [];
    record.layered = false;
    record.context = false;
    record.z = 0;
    record.top = false;
    record.fixed = false;
    record.scroller = 0;
    record.clip = 0;
    record.value = null;
    this.fill(record, deep);
    if (previous.length) {
      const kept = new Set<ElementRecord | TextRecord>(record.children);
      for (const child of previous) {
        if (kept.has(child)) continue;
        if (child.kind === "element" && child.parent !== record) continue; // moved elsewhere
        this.drop(child);
      }
    }
    return record;
  }

  /** Check an element that should not have changed for movement; refresh it if it resized. */
  reconcile(record: ElementRecord): void {
    if (record.state === "hidden") return;
    const bounds = record.el.getBoundingClientRect();
    const rect = this.frames.normalise(bounds, record.boxScroller);
    if (record.state === "culled") {
      const cull = this.cullOf(record.boxScroller);
      if (!cull || intersects(rect, cull)) this.walk(record.el, record.input, record.parent, true);
      else record.rect = rect;
      return;
    }
    if (rectEqual(rect, record.rect)) return;
    if (
      Math.abs(rect.width - record.rect.width) < 0.01 &&
      Math.abs(rect.height - record.rect.height) < 0.01
    ) {
      this.translate(record, rect.x - record.rect.x, rect.y - record.rect.y);
      return;
    }
    this.walk(record.el, record.input, record.parent, false);
  }

  /** Move a whole subtree rigidly (a sibling above it grew). */
  translate(record: ElementRecord, dx: number, dy: number): void {
    record.rect = shift(record.rect, dx, dy);
    for (const draft of record.drafts) this.move(draft, dx, dy);
    if (record.clip) this.frames.shiftClip(record.clip, dx, dy);
    if (record.scroller) {
      const state = this.frames.scrollers.get(record.scroller);
      if (state?.cull) state.cull = shift(state.cull, dx, dy);
    }
    for (const child of record.children) {
      if (child.kind === "text") {
        for (const draft of child.drafts) this.move(draft, dx, dy);
        if (child.covered)
          child.covered = { top: child.covered.top + dy, bottom: child.covered.bottom + dy };
      } else if (!child.fixed && !child.top) {
        this.translate(child, dx, dy);
      }
    }
  }

  private move(draft: Draft, dx: number, dy: number): void {
    draft.rect = shift(draft.rect, dx, dy);
    this.ledger.touch(draft);
  }

  private retireOwn(record: ElementRecord): void {
    for (const draft of record.drafts) this.ledger.retire(draft);
    record.drafts = [];
    this.frames.scrollers.get(record.boxScroller)?.sticky.delete(record);
    this.forms.delete(record);
  }

  /** Forget a record that left the tree, with everything below it. */
  drop(node: ElementRecord | TextRecord): void {
    if (node.kind === "text") {
      for (const draft of node.drafts) this.ledger.retire(draft);
      node.drafts = [];
      return;
    }
    if (this.records.get(node.el) === node) this.records.delete(node.el);
    this.retireOwn(node);
    for (const child of node.children) {
      if (child.kind === "element" && child.parent !== node) continue;
      this.drop(child);
    }
    node.children = [];
    this.surfaces.delete(node.el);
  }

  private adopt(draft: Draft, record: { drafts: Draft[] }): void {
    record.drafts.push(draft);
    this.ledger.adopt(draft);
  }

  // -------------------------------------------------------------------------------------------
  // One element
  // -------------------------------------------------------------------------------------------

  private fill(record: ElementRecord, deep: boolean): void {
    const el = record.el;
    const input = record.input;
    const surface = this.host.surfaceOf(el);
    if (surface?.labelsInGlass) {
      this.labelHosts.add(el);
      this.lift(el);
    }
    const style = getComputedStyle(el);
    const position = style.position;
    const tag = el.tagName;
    record.top =
      (tag === "DIALOG" && matches(el, ":modal")) ||
      (el.hasAttribute("popover") && matches(el, ":popover-open"));
    const frame: Frame = record.top
      ? { scroller: FIXED, clip: 0 }
      : position === "absolute"
        ? input.abs
        : position === "fixed"
          ? input.fixed
          : input.flow;
    record.boxScroller = frame.scroller;
    record.fixed = position === "fixed" || record.top;
    const bounds = el.getBoundingClientRect();
    const rect = this.frames.normalise(bounds, frame.scroller);
    record.rect = rect;
    const display = style.display;
    if (display === "none") {
      record.state = "hidden";
      return;
    }
    if (bounds.width > 0 && bounds.height > 0 && !this.visible(rect, frame)) {
      record.state = "culled";
      return;
    }
    const visibility = style.visibility;
    const opacity = Number.parseFloat(style.opacity);
    if (visibility !== "visible" || !(opacity > 0)) {
      record.state = "hidden";
      return;
    }
    record.state = "drawn";
    if (surface) this.surfaces.add(el);

    const transform = style.transform;
    const scale = style.scale;
    const rotate = style.rotate;
    const translate = style.translate;
    const zoom = input.zoom * scaleOf(transform, scale, style.zoom);
    const positioned = position !== "static";
    const zText = style.zIndex;
    const zIndex =
      (positioned || input.flexItem) && zText !== "auto" ? Number.parseInt(zText, 10) || 0 : null;
    const set = (value: string | undefined) => !!value && value !== "none";
    const transformed = transform !== "none" || set(scale) || set(rotate) || set(translate);
    const filter = style.filter;
    const contain = style.contain;
    const paintContained = contain !== "none" && /paint|strict|content|layout/.test(contain);
    record.context =
      el === this.root ||
      zIndex !== null ||
      position === "fixed" ||
      position === "sticky" ||
      opacity < 1 ||
      transformed ||
      filter !== "none" ||
      style.isolation === "isolate" ||
      style.mixBlendMode !== "normal" ||
      paintContained;
    record.layered = el !== this.root && (positioned || record.context);
    record.z = zIndex ?? 0;
    if (position === "sticky") this.frames.scrollers.get(frame.scroller)?.sticky.add(record);

    const alpha = input.opacity * opacity;
    const base = { owner: input.owner, scroller: frame.scroller, clip: frame.clip, opacity: alpha };
    const borders: [number, number, number, number] = [
      px(style.borderTopWidth) * zoom,
      px(style.borderRightWidth) * zoom,
      px(style.borderBottomWidth) * zoom,
      px(style.borderLeftWidth) * zoom,
    ];
    let radii: Radii | null = null;
    const radiiNow = (): Radii =>
      (radii ??= radiiOf(style, rect.width / zoom, rect.height / zoom, zoom));

    const root = el === document.documentElement || el === document.body;
    this.box(record, style, rect, borders, base, display, zoom, radiiNow, root);
    const image = style.backgroundImage;
    if (image !== "none" && !root)
      this.background(record, style, image, rect, borders, base, zoom, radiiNow);
    const childOwner = surface ? surface.id : input.owner;
    if (display === "list-item")
      this.marker(record, style, rect, borders, { ...base, owner: childOwner }, zoom);
    const replaced = this.content(record, style, tag, rect, borders, base, zoom, radiiNow);
    if (replaced) return;

    // What the children inherit.
    let inner: Frame = frame;
    const ox = style.overflowX;
    const oy = style.overflowY;
    let ellipsis: Ellipsis | null = display === "inline" ? input.ellipsis : null;
    if ((ox !== "visible" || oy !== "visible") && !root) {
      const padding = insetRect(rect, borders[0], borders[1], borders[2], borders[3]);
      const clipRect: Rect = {
        x: ox === "visible" ? padding.x - HUGE : padding.x,
        y: oy === "visible" ? padding.y - HUGE : padding.y,
        width: ox === "visible" ? padding.width + HUGE * 2 : padding.width,
        height: oy === "visible" ? padding.height + HUGE * 2 : padding.height,
      };
      const clip = this.frames.ensureClip(
        el,
        frame.clip,
        frame.scroller,
        clipRect,
        insetRadii(radiiNow(), borders[0], borders[1], borders[2], borders[3]),
      );
      record.clip = clip;
      const scrollable = /^(auto|scroll)$/.test(ox) || /^(auto|scroll)$/.test(oy);
      const scrolled =
        (ox === "hidden" || oy === "hidden") &&
        (el.scrollTop !== 0 || el.scrollLeft !== 0 || !!this.frames.scrollerFor(el));
      if (scrollable || scrolled) {
        const state = this.frames.ensureScroller(el, frame.scroller, zoom, clip);
        record.scroller = state.id;
        // The window to capture: the visible area plus one of its own size beyond every edge.
        const parentChain = this.frames.chain(frame.scroller);
        const ownChain = this.frames.chain(state.id);
        const visible = shift(padding, ownChain.x - parentChain.x, ownChain.y - parentChain.y);
        state.cull = expand(visible, Math.max(visible.width, 256), Math.max(visible.height, 256));
        inner = { scroller: state.id, clip };
        this.host.watch(el);
      } else {
        inner = { scroller: frame.scroller, clip };
        if (style.textOverflow === "ellipsis" && ox !== "visible") {
          const content = insetRect(
            padding,
            px(style.paddingTop) * zoom,
            px(style.paddingRight) * zoom,
            px(style.paddingBottom) * zoom,
            px(style.paddingLeft) * zoom,
          );
          ellipsis = {
            scroller: frame.scroller,
            left: content.x,
            right: content.x + content.width,
          };
        }
      }
    }

    const line = style.textDecorationLine;
    const atomic = display.startsWith("inline-") || position === "absolute" || position === "fixed";
    let decorations = atomic ? [] : input.decorations;
    if (line && line !== "none") {
      const decoration: Decoration = {
        underline: line.includes("underline"),
        overline: line.includes("overline"),
        lineThrough: line.includes("line-through"),
        color: style.textDecorationColor,
        thickness: style.textDecorationThickness.endsWith("px")
          ? px(style.textDecorationThickness)
          : 0,
        offset: style.textUnderlineOffset.endsWith("px") ? px(style.textUnderlineOffset) : 0,
      };
      decorations = [...decorations, decoration];
    }
    const childInput: Walk = {
      owner: childOwner,
      flow: inner,
      abs: positioned || record.top ? inner : input.abs,
      fixed: transformed || filter !== "none" || paintContained || record.top ? inner : input.fixed,
      opacity: alpha,
      zoom,
      decorations,
      ellipsis,
      flexItem: /flex|grid/.test(display),
    };
    if (el.shadowRoot) this.host.shadow(el.shadowRoot);
    this.children(record, style, childInput, deep);
  }

  private children(
    record: ElementRecord,
    style: CSSStyleDeclaration,
    input: Walk,
    deep: boolean,
  ): void {
    const nodes = childNodesOf(record.el);
    let textStyle: TextStyle | null | undefined;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node) continue;
      if (isText(node)) {
        if (!hasVisibleText(node.data)) continue;
        if (textStyle === undefined) textStyle = textStyleOf(style, input.decorations);
        if (!textStyle) continue;
        record.children.push(this.text(node, textStyle, input));
        continue;
      }
      if (!isElement(node)) continue;
      if (
        SKIP.has(node.tagName) ||
        node.hasAttribute("data-lg-ignore") ||
        node.hasAttribute("data-lg-canvas")
      )
        continue;
      const known = this.records.get(node);
      if (!deep && known && known.parent === record && sameWalk(known.input, input)) {
        this.reconcile(known);
        record.children.push(known);
      } else {
        record.children.push(this.walk(node, input, record, true));
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Boxes and backgrounds
  // -------------------------------------------------------------------------------------------

  private box(
    record: ElementRecord,
    style: CSSStyleDeclaration,
    rect: Rect,
    borders: [number, number, number, number],
    base: { owner: number; scroller: number; clip: number; opacity: number },
    display: string,
    zoom: number,
    radii: () => Radii,
    root: boolean,
  ): void {
    const fill = parseColor(style.backgroundColor) ?? TRANSPARENT;
    let borderColor: Rgba = TRANSPARENT;
    const sides = ["Top", "Right", "Bottom", "Left"] as const;
    for (let side = 0; side < 4; side += 1) {
      if ((borders[side] ?? 0) <= 0) continue;
      const name = sides[side] ?? "Top";
      borderColor =
        parseColor(style.getPropertyValue(`border-${name.toLowerCase()}-color`)) ?? TRANSPARENT;
      break;
    }
    const bordered = borderColor[3] > 0;
    const shadows: BoxShadow[] = root ? [] : shadowsOf(style.boxShadow, zoom);
    if (fill[3] <= 0 && !bordered && !shadows.length) return;
    const make = (key: number, r: Rect, rr: Radii): Draft => ({
      kind: "box",
      key,
      ...base,
      order: Number.NaN,
      rect: r,
      radii: rr,
      fill,
      border: bordered ? borders : [0, 0, 0, 0],
      borderColor,
      shadows,
    });
    if (root) {
      // The root background paints the whole canvas, which does not scroll.
      if (fill[3] <= 0) return;
      const draft = make(
        this.key(record.el, PART_BOX),
        { x: 0, y: 0, width: innerWidth, height: innerHeight },
        ZERO_RADII,
      );
      draft.scroller = FIXED;
      draft.clip = 0;
      if (draft.kind === "box") draft.border = [0, 0, 0, 0];
      this.adopt(draft, record);
      return;
    }
    if (display === "inline") {
      const fragments = record.el.getClientRects();
      if (fragments.length > 1) {
        for (let index = 0; index < fragments.length; index += 1) {
          const fragment = fragments[index];
          if (!fragment || fragment.width <= 0 || fragment.height <= 0) continue;
          const r = this.frames.normalise(fragment, base.scroller);
          this.adopt(
            make(
              this.key(record.el, partFragment(index)),
              r,
              radiiOf(style, r.width / zoom, r.height / zoom, zoom),
            ),
            record,
          );
        }
        return;
      }
    }
    if (rect.width <= 0 || rect.height <= 0) return;
    this.adopt(make(this.key(record.el, PART_BOX), rect, radii()), record);
  }

  private background(
    record: ElementRecord,
    style: CSSStyleDeclaration,
    image: string,
    rect: Rect,
    borders: [number, number, number, number],
    base: { owner: number; scroller: number; clip: number; opacity: number },
    zoom: number,
    radii: () => Radii,
  ): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    const background = backgroundOf(
      record.el,
      style,
      image,
      rect.width,
      rect.height,
      borders,
      zoom,
      this.dpr,
      (el) => this.host.loaded(el),
    );
    if (!background) return;
    let resource = this.store.get(background.key);
    if (!resource) {
      const bitmap = background.draw();
      if (!bitmap) return;
      resource = this.store.putSync(background.key, bitmap);
    }
    this.adopt(
      this.bitmap(this.key(record.el, PART_BACKGROUND), base, rect, radii(), resource),
      record,
    );
  }

  private bitmap(
    key: number,
    base: { owner: number; scroller: number; clip: number; opacity: number },
    rect: Rect,
    radii: Radii,
    res: Resource,
    source?: Rect,
  ): BitmapDraft {
    return {
      kind: "bitmap",
      key,
      ...base,
      order: Number.NaN,
      rect,
      radii,
      res,
      source: source ?? { x: 0, y: 0, width: res.width, height: res.height },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Text
  // -------------------------------------------------------------------------------------------

  private text(node: Text, style: TextStyle, input: Walk): TextRecord {
    const frame = input.flow;
    const record: TextRecord = {
      kind: "text",
      node,
      drafts: [],
      covered: null,
      scroller: frame.scroller,
    };
    const range = this.range;
    range.selectNodeContents(node);
    const lines = linesOf(range.getClientRects());
    if (!lines.length) return record;
    const chain = this.frames.chain(frame.scroller);
    const cull = this.cullOf(frame.scroller);
    const clip =
      frame.clip && this.frames.clipScroller(frame.clip) === frame.scroller
        ? this.frames.clipRect(frame.clip)
        : null;
    const boxes: Rect[] = [];
    const needed: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      const box = {
        x: line.left + chain.x,
        y: line.top + chain.y,
        width: line.right - line.left,
        height: line.bottom - line.top,
      };
      boxes.push(box);
      if ((!cull || intersects(box, cull)) && (!clip || intersects(box, clip))) needed.push(index);
    }
    if (needed.length < lines.length && cull)
      record.covered = { top: cull.y, bottom: cull.y + cull.height };
    if (!needed.length) return record;
    const data = node.data;
    const starts =
      lines.length === 1
        ? [0, data.length]
        : lineStarts(range, node, lines, needed, style.whiteSpace);
    const collapse = !/^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace);
    const base = {
      owner: input.owner,
      scroller: frame.scroller,
      clip: frame.clip,
      opacity: input.opacity,
    };
    for (const index of needed) {
      const start = starts[index] ?? -1;
      const end = starts[index + 1] ?? -1;
      let box = boxes[index];
      if (start < 0 || end <= start || !box) continue;
      const raw = data.slice(start, end);
      const keepLeading = collapse && /^\s/.test(raw) && spaceRendered(range, node, start);
      let text = lineText(raw, style, keepLeading, index === lines.length - 1);
      if (!text) continue;
      const ellipsis = input.ellipsis;
      if (ellipsis && ellipsis.scroller === frame.scroller) {
        if (style.direction === "ltr" && box.x + box.width > ellipsis.right + 0.5) {
          const width = Math.max(0, ellipsis.right - box.x);
          text = truncate(text, style, width / input.zoom);
          box = { ...box, width };
        } else if (style.direction === "rtl" && box.x < ellipsis.left - 0.5) {
          const width = Math.max(0, box.x + box.width - ellipsis.left);
          text = truncate(text, style, width / input.zoom);
          box = { ...box, x: ellipsis.left, width };
        }
      }
      const fill = style.justify && index < lines.length - 1;
      const draft = this.run(this.key(node, index), text, style, box, input.zoom, base, fill);
      if (draft) this.adopt(draft, record);
    }
    return record;
  }

  /** A text run's draft, drawing its bitmap unless an identical run is cached. */
  private run(
    key: number,
    text: string,
    style: TextStyle,
    box: Rect,
    zoom: number,
    base: { owner: number; scroller: number; clip: number; opacity: number },
    fill: boolean,
  ): BitmapDraft | null {
    if (box.width <= 0 || box.height <= 0) return null;
    const run = { text, style, box, zoom, dpr: this.dpr, fill };
    const cacheKey = `${this.epoch}${runKey(run)}`;
    let resource = this.store.get(cacheKey);
    if (!resource) {
      const drawn = drawRun(run);
      if (!drawn) return null;
      resource = this.store.putSync(cacheKey, drawn.image);
      resource.meta = drawn.meta;
    }
    const meta = resource.meta;
    if (!meta) return null;
    return this.bitmap(
      key,
      base,
      runRect(box, zoom, this.dpr, meta, resource),
      ZERO_RADII,
      resource,
    );
  }

  /** The list marker of a list item: a bullet or a number, drawn as a text run. */
  private marker(
    record: ElementRecord,
    style: CSSStyleDeclaration,
    rect: Rect,
    borders: [number, number, number, number],
    base: { owner: number; scroller: number; clip: number; opacity: number },
    zoom: number,
  ): void {
    const type = style.listStyleType;
    if (type === "none") return;
    const markerStyle =
      textStyleOf(getComputedStyle(record.el, "::marker"), []) ?? textStyleOf(style, []);
    if (!markerStyle) return;
    const metrics = metricsOf(markerStyle);
    // Sit on the first line of the item's text: its line box gives the baseline.
    let top = rect.y + borders[0] + px(style.paddingTop) * zoom;
    let height = (metrics.ascent + metrics.descent) * zoom;
    const first = firstText(record.el);
    if (first) {
      this.range.selectNodeContents(first);
      const line = linesOf(this.range.getClientRects())[0];
      if (line) {
        top = line.top + this.frames.chain(base.scroller).y;
        height = line.bottom - line.top;
      }
    }
    const inside = style.listStylePosition === "inside";
    const rtl = style.direction === "rtl";
    const contentLeft = rect.x + borders[3] + px(style.paddingLeft) * zoom;
    const contentRight = rect.x + rect.width - borders[1] - px(style.paddingRight) * zoom;
    const key = this.key(record.el, PART_MARKER);

    if (type === "disc" || type === "circle" || type === "square") {
      // Browsers draw these as shapes sized from the font's ascent, not as glyphs.
      const ascent = metrics.ascent;
      const size = ((ascent * 2) / 3 + 1) / 2;
      const baseline = top + height * (ascent / (ascent + metrics.descent || 1));
      const gap = markerStyle.size * 0.78;
      const d = size * zoom;
      const x = rtl
        ? inside
          ? contentRight - d
          : contentRight + gap * zoom
        : inside
          ? contentLeft
          : contentLeft - (size + gap) * zoom;
      // Centered half the ascent above the baseline, plus half its own size.
      const y = baseline - (ascent / 2) * zoom;
      const color = parseColor(markerStyle.color) ?? TRANSPARENT;
      const ring = type === "circle";
      const line = Math.max(1, size / 5) * zoom;
      this.adopt(
        {
          kind: "box",
          key,
          ...base,
          order: Number.NaN,
          rect: { x, y, width: d, height: d },
          radii: type === "square" ? ZERO_RADII : [d / 2, d / 2, d / 2, d / 2],
          fill: ring ? TRANSPARENT : color,
          border: ring ? [line, line, line, line] : [0, 0, 0, 0],
          borderColor: ring ? color : TRANSPARENT,
          shadows: [],
        },
        record,
      );
      return;
    }

    const text = markerText(record.el, type);
    if (!text) return;
    const width = measure(text, markerStyle) * zoom;
    const gap = measure(" ", markerStyle) * zoom;
    const x = rtl
      ? inside
        ? contentRight - width
        : contentRight + gap
      : inside
        ? contentLeft
        : contentLeft - gap - width;
    const draft = this.run(key, text, markerStyle, { x, y: top, width, height }, zoom, base, false);
    if (draft) this.adopt(draft, record);
  }

  // -------------------------------------------------------------------------------------------
  // Replaced content
  // -------------------------------------------------------------------------------------------

  /** Draw an element's replaced content. Returns true when its children are not rendered. */
  private content(
    record: ElementRecord,
    style: CSSStyleDeclaration,
    tag: string,
    rect: Rect,
    borders: [number, number, number, number],
    base: { owner: number; scroller: number; clip: number; opacity: number },
    zoom: number,
    radii: () => Radii,
  ): boolean {
    const el = record.el;
    const contentBox = () =>
      insetRect(
        rect,
        borders[0] + px(style.paddingTop) * zoom,
        borders[1] + px(style.paddingRight) * zoom,
        borders[2] + px(style.paddingBottom) * zoom,
        borders[3] + px(style.paddingLeft) * zoom,
      );
    const contentRadii = (box: Rect) =>
      insetRadii(
        radii(),
        box.y - rect.y,
        rect.x + rect.width - box.x - box.width,
        rect.y + rect.height - box.y - box.height,
        box.x - rect.x,
      );
    if (el instanceof HTMLImageElement) {
      this.image(record, el, style, contentBox(), base, zoom, contentRadii);
      return true;
    }
    if (el instanceof SVGSVGElement) {
      this.svg(record, el, style, rect, base, zoom);
      return true;
    }
    if (el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement) {
      this.media(record, el, style, contentBox(), base, zoom, contentRadii);
      return true;
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      this.form(record, el, style, rect, borders, contentBox(), base, zoom, radii);
      return true;
    }
    if (tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED" || el instanceof SVGElement)
      return true;
    return false;
  }

  private placeholder(
    record: ElementRecord,
    rect: Rect,
    radii: Radii,
    base: { owner: number; scroller: number; clip: number; opacity: number },
  ): void {
    this.host.tainted();
    this.adopt(
      {
        kind: "box",
        key: this.key(record.el, partContent(0)),
        ...base,
        order: Number.NaN,
        rect,
        radii,
        fill: PLACEHOLDER,
        border: [0, 0, 0, 0],
        borderColor: TRANSPARENT,
        shadows: [],
      },
      record,
    );
  }

  private image(
    record: ElementRecord,
    img: HTMLImageElement,
    style: CSSStyleDeclaration,
    content: Rect,
    base: { owner: number; scroller: number; clip: number; opacity: number },
    zoom: number,
    contentRadii: (box: Rect) => Radii,
  ): void {
    const src = img.currentSrc || img.src;
    if (!src || !img.complete) return;
    const natural = naturalSize(img, content);
    if (img.naturalWidth === 0 && !natural.vector) return;
    const place = fitObject(style.objectFit, style.objectPosition, content, natural, zoom);
    if (!place) return;
    const radii = rectEqual(place.dest, content) ? contentRadii(content) : ZERO_RADII;
    if (!imageReadable(img, src)) {
      this.placeholder(record, place.dest, radii, base);
      return;
    }
    const size = bitmapSize(natural, place.object, this.dpr, natural.vector);
    const key = `img|${size.width}x${size.height}|${src}`;
    const resource =
      this.store.get(key) ?? this.store.putAsync(key, () => bitmapOf(img, size.width, size.height));
    const k = size.width / natural.width;
    const source = {
      x: place.source.x * k,
      y: place.source.y * k,
      width: place.source.width * k,
      height: place.source.height * k,
    };
    this.adopt(
      this.bitmap(this.key(img, partContent(0)), base, place.dest, radii, resource, source),
      record,
    );
  }

  private svg(
    record: ElementRecord,
    svg: SVGSVGElement,
    style: CSSStyleDeclaration,
    rect: Rect,
    base: { owner: number; scroller: number; clip: number; opacity: number },
    zoom: number,
  ): void {
    const width = rect.width / zoom;
    const height = rect.height / zoom;
    if (!(width > 0 && height > 0)) return;
    const scale = Math.min(rasterScale(zoom, this.dpr), 4096 / width, 4096 / height);
    const pixelWidth = Math.max(1, Math.round(width * scale));
    const pixelHeight = Math.max(1, Math.round(height * scale));
    const markup = svgMarkup(svg, style, width, height);
    const key = `svg|${pixelWidth}x${pixelHeight}|${markup}`;
    const resource =
      this.store.get(key) ??
      this.store.putAsync(key, () => rasteriseSvg(markup, pixelWidth, pixelHeight));
    const source = { x: 0, y: 0, width: pixelWidth, height: pixelHeight };
    this.adopt(
      this.bitmap(this.key(svg, partContent(0)), base, rect, ZERO_RADII, resource, source),
      record,
    );
  }

  private media(
    record: ElementRecord,
    el: HTMLVideoElement | HTMLCanvasElement,
    style: CSSStyleDeclaration,
    content: Rect,
    base: { owner: number; scroller: number; clip: number; opacity: number },
    zoom: number,
    contentRadii: (box: Rect) => Radii,
  ): void {
    const video = el instanceof HTMLVideoElement ? el : null;
    const natural = video
      ? { width: video.videoWidth, height: video.videoHeight }
      : { width: el.width, height: el.height };
    if (!(natural.width > 0 && natural.height > 0)) {
      if (video?.poster) this.poster(record, video, style, content, base, zoom, contentRadii);
      return;
    }
    const place = fitObject(style.objectFit, style.objectPosition, content, natural, zoom);
    if (!place) return;
    const radii = rectEqual(place.dest, content) ? contentRadii(content) : ZERO_RADII;
    const key = this.key(el, partContent(0));
    const size = bitmapSize(natural, place.object, this.dpr, false);
    const live = this.host.sourceOf(el, size);
    if (live) {
      const k = live.state === "ready" ? live.width / natural.width : 0;
      const source = {
        x: place.source.x * k,
        y: place.source.y * k,
        width: place.source.width * k,
        height: place.source.height * k,
      };
      this.adopt(this.bitmap(key, base, place.dest, radii, live, source), record);
      return;
    }
    // Not a live source: one still frame per capture.
    const readable = video
      ? videoReadable(video) && video.readyState >= 2
      : canvasReadable(el as HTMLCanvasElement);
    if (!readable) {
      if (video?.poster) this.poster(record, video, style, content, base, zoom, contentRadii);
      else if (video) this.placeholder(record, place.dest, radii, base);
      return;
    }
    const version = (this.snapshots.get(el) ?? 0) + 1;
    this.snapshots.set(el, version);
    const resource = this.store.putAsync(`still|${key}|${version}`, () =>
      bitmapOf(el, size.width, size.height),
    );
    const k = size.width / natural.width;
    const source = {
      x: place.source.x * k,
      y: place.source.y * k,
      width: place.source.width * k,
      height: place.source.height * k,
    };
    this.adopt(this.bitmap(key, base, place.dest, radii, resource, source), record);
  }

  private poster(
    record: ElementRecord,
    video: HTMLVideoElement,
    style: CSSStyleDeclaration,
    content: Rect,
    base: { owner: number; scroller: number; clip: number; opacity: number },
    zoom: number,
    contentRadii: (box: Rect) => Radii,
  ): void {
    const image = loadImage(video.poster, video, (el) => this.host.loaded(el));
    if (!image) return;
    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    const place = fitObject(style.objectFit, style.objectPosition, content, natural, zoom);
    if (!place) return;
    const size = bitmapSize(natural, place.object, this.dpr, false);
    const key = `img|${size.width}x${size.height}|${video.poster}`;
    const resource =
      this.store.get(key) ??
      this.store.putAsync(key, () => bitmapOf(image, size.width, size.height));
    const k = size.width / natural.width;
    const source = {
      x: place.source.x * k,
      y: place.source.y * k,
      width: place.source.width * k,
      height: place.source.height * k,
    };
    const radii = rectEqual(place.dest, content) ? contentRadii(content) : ZERO_RADII;
    this.adopt(
      this.bitmap(this.key(video, partContent(0)), base, place.dest, radii, resource, source),
      record,
    );
  }

  /** The value (or placeholder) of an input, textarea or select, drawn in its content box. */
  private form(
    record: ElementRecord,
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    style: CSSStyleDeclaration,
    rect: Rect,
    borders: [number, number, number, number],
    content: Rect,
    base: { owner: number; scroller: number; clip: number; opacity: number },
    zoom: number,
    radii: () => Radii,
  ): void {
    let value: string;
    if (el instanceof HTMLSelectElement) value = el.selectedOptions[0]?.text ?? "";
    else if (el instanceof HTMLInputElement) {
      if (NO_INPUT_TEXT.has(el.type)) return;
      value = el.value;
      if (BUTTON_TYPES.has(el.type) && !value)
        value = el.type === "reset" ? "Reset" : el.type === "submit" ? "Submit" : "";
      else if (el.type === "password") value = "•".repeat([...value].length);
    } else value = el.value;
    record.value = el instanceof HTMLSelectElement ? `${el.selectedIndex}` : el.value;
    this.forms.add(record);
    const placeholder = !value && !(el instanceof HTMLSelectElement) ? el.placeholder : "";
    const text = value || placeholder;
    if (!text) return;
    const textStyle = textStyleOf(placeholder ? getComputedStyle(el, "::placeholder") : style, []);
    if (!textStyle) return;
    // Values are clipped to the padding box, like the field's own scrolling.
    const padding = insetRect(rect, borders[0], borders[1], borders[2], borders[3]);
    const clip = this.frames.ensureClip(
      el,
      base.clip,
      base.scroller,
      padding,
      insetRadii(radii(), borders[0], borders[1], borders[2], borders[3]),
    );
    record.clip = clip;
    const textBase = { ...base, clip };
    const metrics = metricsOf(textStyle);
    const lineBox = (metrics.ascent + metrics.descent) * zoom;
    const rtl = textStyle.direction === "rtl";
    const align = textStyle.align;
    const place = (line: string, y: number, part: number) => {
      const width = measure(line, textStyle) * zoom;
      const end = align === "right" || (align === "end" && !rtl) || (align === "start" && rtl);
      let x =
        align === "center"
          ? content.x + (content.width - width) / 2
          : end
            ? content.x + content.width - width
            : content.x;
      x -= el.scrollLeft * zoom;
      const draft = this.run(
        this.key(el, partContent(part)),
        line,
        textStyle,
        { x, y, width, height: lineBox },
        zoom,
        textBase,
        false,
      );
      if (draft) this.adopt(draft, record);
    };
    const shown = transformText(text, textStyle.transform);
    if (!(el instanceof HTMLTextAreaElement)) {
      place(shown.replace(/[\r\n]+/g, " "), content.y + (content.height - lineBox) / 2, 0);
      return;
    }
    const lineHeight =
      (style.lineHeight === "normal" ? textStyle.size * 1.2 : px(style.lineHeight)) * zoom;
    const lines = wrap(shown, textStyle, content.width / zoom);
    const top = content.y - el.scrollTop * zoom + (lineHeight - lineBox) / 2;
    for (let index = 0; index < lines.length; index += 1) {
      const y = top + index * lineHeight;
      if (y > content.y + content.height) break;
      if (y + lineBox < content.y) continue;
      place(lines[index] ?? "", y, index);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Recull
  // -------------------------------------------------------------------------------------------

  /**
   * A scroller moved far: capture what entered its window and let go of what is now far outside.
   * Records keep their normalised rects, so nothing already captured is read again.
   */
  recull(record: ElementRecord, scroller: number): void {
    const cull = this.cullOf(scroller);
    if (!cull) return;
    const keep = expand(cull, cull.width / 3, cull.height / 3);
    const visit = (node: ElementRecord) => {
      for (const child of node.children) {
        if (child.kind === "text") continue;
        if (child.boxScroller === scroller) {
          if (child.state === "culled" && intersects(child.rect, cull)) {
            this.walk(child.el, child.input, child.parent, true);
            continue;
          }
          if (
            child.state === "drawn" &&
            child.rect.width > 0 &&
            child.rect.height > 0 &&
            !intersects(child.rect, keep)
          ) {
            this.release(child);
            continue;
          }
          if (child.state === "drawn" && this.partial(child, cull)) {
            this.walk(child.el, child.input, child.parent, false);
            continue;
          }
        }
        if (child.state === "drawn") visit(child);
      }
    };
    if (this.partial(record, cull)) this.walk(record.el, record.input, record.parent, false);
    visit(record);
  }

  /** Whether an element's text was captured only partly and the window now needs more of it. */
  private partial(record: ElementRecord, cull: Rect): boolean {
    for (const child of record.children) {
      if (child.kind !== "text" || !child.covered) continue;
      if (child.covered.top > cull.y || child.covered.bottom < cull.y + cull.height) return true;
    }
    return false;
  }

  /** Turn a captured element back into a culled one, freeing its items. */
  private release(record: ElementRecord): void {
    for (const child of record.children) {
      if (child.kind === "element" && child.parent !== record) continue;
      this.drop(child);
    }
    this.retireOwn(record);
    record.children = [];
    record.state = "culled";
  }
}

function firstText(element: Element): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      hasVisibleText((node as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  const node = walker.nextNode();
  return node instanceof Text ? node : null;
}

function alpha(n: number, upper: boolean): string {
  let out = "";
  let value = n;
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return upper ? out.toUpperCase() : out;
}

function roman(n: number, upper: boolean): string {
  if (n <= 0 || n >= 4000) return `${n}`;
  const table: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let value = n;
  for (const [amount, letters] of table) {
    while (value >= amount) {
      out += letters;
      value -= amount;
    }
  }
  return upper ? out.toUpperCase() : out;
}

function ordinal(item: Element): number {
  const list = item.parentElement;
  if (item instanceof HTMLLIElement && item.hasAttribute("value")) return item.value;
  if (!list) return 1;
  const items = [...list.children].filter((child) => child.tagName === "LI");
  const reversed = list instanceof HTMLOListElement && list.reversed;
  let n =
    list instanceof HTMLOListElement && list.hasAttribute("start")
      ? list.start
      : reversed
        ? items.length
        : 1;
  for (const child of items) {
    if (child instanceof HTMLLIElement && child.hasAttribute("value")) n = child.value;
    if (child === item) return n;
    n += reversed ? -1 : 1;
  }
  return n;
}

function markerText(item: Element, type: string): string {
  switch (type) {
    case "disc":
      return "•";
    case "circle":
      return "◦";
    case "square":
      return "▪";
    case "disclosure-closed":
      return "▸";
    case "disclosure-open":
      return "▾";
  }
  if (type.startsWith('"') || type.startsWith("'")) return type.slice(1, -1);
  const n = ordinal(item);
  switch (type) {
    case "decimal-leading-zero":
      return `${n < 10 && n >= 0 ? "0" : ""}${n}.`;
    case "lower-alpha":
    case "lower-latin":
      return `${alpha(n, false)}.`;
    case "upper-alpha":
    case "upper-latin":
      return `${alpha(n, true)}.`;
    case "lower-roman":
      return `${roman(n, false)}.`;
    case "upper-roman":
      return `${roman(n, true)}.`;
    default:
      return `${n}.`;
  }
}

/** Greedy word wrap for textarea values (explicit newlines kept). */
function wrap(text: string, style: TextStyle, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/(?<=\s)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd(), style) > width) {
        out.push(line.trimEnd());
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line.trimEnd());
    if (out.length > 500) break;
  }
  return out;
}
