/** WebKit cannot run a CSS reference filter in its compositor. It paints the
 * filtered element with the filter applied, then composites every descendant
 * that has a layer of its own on top, unfiltered. Glass drawn by the content's
 * filter therefore lands beneath any such descendant: a video, a WebGL canvas,
 * a 3D transform, a running transform animation, or a positioned element that
 * overlaps one of them. These rules follow `RenderLayerCompositor`.
 *
 * Media keep their pixels in the compositor and ignore filters of their own,
 * so a mirror paints them into the content instead. Every other layer
 * paints its own pixels and takes a copy of the glass on itself. */
export type CompositingReason = "media" | "layer";

/** The computed style WebKit decides compositing from. */
export type CompositingStyle = Pick<CSSStyleDeclaration,
  "transform" | "translate" | "rotate" | "scale" | "willChange" | "position" | "backfaceVisibility" | "overflowX" | "overflowY" | "zIndex" | "opacity" |
  "filter" | "clipPath" | "mixBlendMode" | "isolation"> & {
  backdropFilter?: string;
  webkitBackdropFilter?: string;
  maskImage?: string;
  webkitMaskImage?: string;
};

const compositedWillChange = new Set(["opacity", "filter", "backdrop-filter", "-webkit-backdrop-filter", "transform", "translate", "rotate", "scale", "offset-path"]);
const animatedProperties = new Set(["opacity", "filter", "backdrop-filter", "-webkit-backdrop-filter", "transform", "translate", "rotate", "scale",
  "offset-anchor", "offset-distance", "offset-path", "offset-position", "offset-rotate"]);

/** Whether a computed `transform` or individual transform property moves in depth. */
export function has3DTransform(style: Pick<CompositingStyle, "transform" | "translate" | "rotate" | "scale">): boolean {
  if (style.transform?.startsWith("matrix3d(")) return true;
  const translate = (style.translate ?? "none").trim().split(/\s+/);
  if (translate.length === 3 && parseFloat(translate[2]!) !== 0) return true;
  const rotate = (style.rotate ?? "none").trim();
  if (rotate !== "none" && /^(?:x|y|[-\d.e]+\s+[-\d.e]+\s+[-\d.e]+)\s/.test(rotate) && !/^0\s+0\s+1\s/.test(rotate)) return true;
  const scale = (style.scale ?? "none").trim().split(/\s+/);
  return scale.length === 3 && parseFloat(scale[2]!) !== 1;
}

const depth = /\b(?:matrix3d|translate3d|translateZ|scale3d|scaleZ|rotate3d|rotateX|rotateY|perspective)\(/i;
let declared: { sheets: unknown[]; selectors: string[] } | undefined;
/** Selectors of rules that declare a 3D transform. Computed styles collapse
 * `translateZ(0)` into a 2D matrix, but WebKit composites by the operations. */
function depthSelectors(document: Document): string[] {
  const sheets = [...document.styleSheets];
  if (declared && declared.sheets.length === sheets.length && declared.sheets.every((sheet, index) => sheet === sheets[index])) return declared.selectors;
  const selectors: string[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      const style = (rule as CSSStyleRule).style;
      if (style && (rule as CSSStyleRule).selectorText && ["transform", "translate", "rotate", "scale"].some((name) => depth.test(style.getPropertyValue(name)) ||
        (name !== "transform" && style.getPropertyValue(name).trim().split(/\s+/).length === 3)))
        selectors.push((rule as CSSStyleRule).selectorText);
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) visit(nested);
    }
  };
  for (const sheet of sheets) {
    // Cross-origin sheets cannot be read; their elements keep computed checks.
    try { visit(sheet.cssRules); } catch { /* unreadable */ }
  }
  declared = { sheets, selectors };
  return selectors;
}

/** Whether the element's transform is declared with 3D operations. */
export function declares3DTransform(element: Element): boolean {
  const inline = (element as HTMLElement).style;
  if (inline && depth.test(inline.transform + inline.translate + inline.rotate + inline.scale)) return true;
  return depthSelectors(element.ownerDocument).some((selector) => { try { return element.matches(selector); } catch { return false; } });
}

/** Why WebKit gives this element a compositing layer of its own, if it does. */
export function compositingReason(element: Element, style: CompositingStyle, scrolls: boolean): CompositingReason | undefined {
  const tag = element.localName;
  if (tag === "video" || tag === "canvas") return "media";
  if (has3DTransform(style) || (style.transform !== "none" || style.translate !== "none" || style.rotate !== "none" || style.scale !== "none") && declares3DTransform(element)) return "layer";
  if ((style.willChange ?? "auto").split(",").some((token) => compositedWillChange.has(token.trim()))) return "layer";
  if (hasValue(style.backdropFilter) || hasValue(style.webkitBackdropFilter)) return "layer";
  // macOS composites a CSS filter when WebKit can run it on the GPU.
  if (hasValue(style.filter) && !/url\(/.test(style.filter)) return "layer";
  if (style.position === "fixed" || style.position === "sticky") return "layer";
  if (style.backfaceVisibility === "hidden" && has3DTransform(style)) return "layer";
  if (scrolls) return "layer";
  return undefined;
}

/** Whether a running animation changes how its element paints, which
 * WebKit redraws, filters included, on every frame it runs. */
export function animatesPaint(properties: Iterable<string>): boolean {
  for (const property of properties) if (!animatedProperties.has(property) && !/^(offset|easing|composite|computed-offset)$/.test(property)) return true;
  return false;
}

/** Whether a running animation is one WebKit runs in its compositor. */
export function animatesInCompositor(properties: Iterable<string>): boolean {
  for (const property of properties) if (animatedProperties.has(property)) return true;
  return false;
}

/** Whether an element paints in a layer of its own, which WebKit must
 * composite once it overlaps an earlier composited layer. */
export function createsLayer(style: CompositingStyle): boolean {
  return style.position !== "static" || Number(style.opacity) < 1 || hasValue(style.transform) || hasValue(style.translate) ||
    hasValue(style.rotate) || hasValue(style.scale) || hasValue(style.filter) || hasValue(style.clipPath) ||
    hasValue(style.maskImage) || hasValue(style.webkitMaskImage) || (style.mixBlendMode ?? "normal") !== "normal" || style.isolation === "isolate";
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value) && value !== "none";
}

export interface LayerBox { x: number; y: number; w: number; h: number }
interface Ordered<T> { item: T; box: LayerBox; order: number }

/** Close a set of composited layers over the layers that paint after and
 * overlap them, as WebKit's overlap testing does. A layer never escapes
 * because of its own ancestor or descendant. */
export function overlapComposited<T>(composited: readonly Ordered<T>[], layered: readonly Ordered<T>[], related: (a: T, b: T) => boolean): T[] {
  const result: T[] = [];
  const layers = [...composited];
  for (const candidate of [...layered].sort((a, b) => a.order - b.order)) {
    if (layers.some((layer) => layer.item === candidate.item)) continue;
    if (!layers.some((layer) => layer.order < candidate.order && !related(layer.item, candidate.item) && intersects(layer.box, candidate.box))) continue;
    result.push(candidate.item);
    layers.push(candidate);
  }
  return result;
}

export function intersects(a: LayerBox, b: LayerBox, margin = 0): boolean {
  return a.x - margin < b.x + b.w && b.x - margin < a.x + a.w && a.y - margin < b.y + b.h && b.y - margin < a.y + a.h;
}

export interface CompositedLayer { element: HTMLElement; reason: CompositingReason }

/** Find the descendants of `content` that WebKit composites apart from it,
 * outermost first. Boxes are in the content's scrolled space, so they stay
 * valid while it scrolls. `skip` excludes nodes the scene owns. */
export function scanCompositedLayers(content: HTMLElement, skip: (element: Element) => boolean): CompositedLayer[] {
  const view = content.ownerDocument.defaultView;
  if (!view) return [];
  const origin = content.getBoundingClientRect();
  const boxOf = (element: Element): LayerBox => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left - origin.left + content.scrollLeft, y: rect.top - origin.top + content.scrollTop, w: rect.width, h: rect.height };
  };
  const composited: Ordered<HTMLElement>[] = [];
  const layered: Ordered<HTMLElement>[] = [];
  const reasons = new Map<HTMLElement, CompositingReason>();
  let order = 0;
  const visit = (parent: Element) => {
    for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
      if (skip(child) || !(child instanceof view.HTMLElement)) continue;
      const style = view.getComputedStyle(child);
      if (style.display === "none") continue;
      const index = order++;
      const scrolls = /auto|scroll/.test(style.overflowX + style.overflowY) && (child.scrollHeight > child.clientHeight + 1 || child.scrollWidth > child.clientWidth + 1);
      const reason = compositingReason(child, style as CompositingStyle, scrolls);
      if (reason) {
        reasons.set(child, reason);
        composited.push({ item: child, box: boxOf(child), order: index });
      } else if (createsLayer(style as CompositingStyle)) layered.push({ item: child, box: boxOf(child), order: index });
      if (reason !== "media" && child.localName !== "svg") visit(child);
    }
  };
  visit(content);
  for (const element of overlapComposited(composited, layered, (a, b) => a.contains(b) || b.contains(a))) reasons.set(element, "layer");
  return [...reasons].map(([element, reason]) => ({ element, reason }));
}

/** Video or canvas, whose pixels WebKit hands straight to its compositor. */
export type MirroredMedia = HTMLVideoElement | HTMLCanvasElement;

/** Whether the media can be drawn onto a canvas at all. */
export function mirrorable(media: Element): media is MirroredMedia {
  if (media.localName === "canvas") return (media as HTMLCanvasElement).width > 0 && (media as HTMLCanvasElement).height > 0;
  if (media.localName !== "video") return false;
  // Protected frames draw as nothing; mirroring would replace them with a hole.
  return !(media as HTMLVideoElement & { mediaKeys?: unknown }).mediaKeys;
}
