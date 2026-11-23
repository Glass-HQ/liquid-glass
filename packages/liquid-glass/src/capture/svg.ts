/**
 * Inline `<svg>` icons and illustrations, rasterised on the page. The element is cloned with
 * every element's computed paint (`currentColor`, CSS fills and strokes, opacity) written inline,
 * sized to its layout box, serialised and decoded as an image at device resolution. References
 * to `<symbol>`s, gradients, clip paths and masks elsewhere in the document are copied in.
 *
 * Serialising costs more than a lookup, so each element keeps a signature of what can change its
 * pixels without a mutation inside it (root color, fill, stroke, size); while that and the
 * element's mutation version stay the same, the previous markup is reused.
 */

import { snapshot } from "./snapshot";

const PAINT = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "opacity",
  "color",
  "stop-color",
  "stop-opacity",
  "flood-color",
  "flood-opacity",
  "clip-rule",
  "paint-order",
  "vector-effect",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
] as const;

const versions = new WeakMap<Element, number>();
const memo = new WeakMap<Element, { signature: string; markup: string }>();
let serializer: XMLSerializer | null = null;

/** Note a mutation inside an svg, so its markup is serialised again. */
export function touchSvg(svg: Element): void {
  versions.set(svg, (versions.get(svg) ?? 0) + 1);
}

const REFERENCE = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/g;

/** Serialised markup of an inline svg at a layout size, with computed paint inlined. */
export function svgMarkup(
  svg: SVGSVGElement,
  style: CSSStyleDeclaration,
  width: number,
  height: number,
): string {
  const signature = [
    versions.get(svg) ?? 0,
    style.color,
    style.fill,
    style.stroke,
    style.strokeWidth,
    style.opacity,
    Math.round(width * 100),
    Math.round(height * 100),
  ].join("|");
  const known = memo.get(svg);
  if (known && known.signature === signature) return known.markup;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  for (let index = 0; index < originals.length; index += 1) {
    const original = originals[index];
    const copy = copies[index];
    if (!original || !copy || !(copy instanceof SVGElement)) continue;
    const computed = index === 0 ? style : getComputedStyle(original);
    if (computed.display === "none") {
      copy.setAttribute("display", "none");
      continue;
    }
    // The root's own style (sizes, margins) means nothing inside an image; descendants keep
    // theirs, with the computed paint after it so it wins.
    let css = index === 0 ? "" : (original.getAttribute("style") ?? "");
    if (css && !css.trimEnd().endsWith(";")) css += ";";
    for (const name of PAINT) {
      const value = computed.getPropertyValue(name);
      if (value) css += `${name}:${value};`;
    }
    // A CSS transform from a class; an attribute transform is kept by the clone as it is.
    if (index > 0 && !original.hasAttribute("transform") && computed.transform !== "none") {
      css += `transform:${computed.transform};transform-origin:${computed.transformOrigin};transform-box:${computed.transformBox};`;
    }
    copy.setAttribute("style", css);
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", `${width}`);
  clone.setAttribute("height", `${height}`);
  clone.removeAttribute("class");

  // Pull in things referenced from elsewhere in the document.
  const missing = new Set<string>();
  for (const use of clone.querySelectorAll("use")) {
    const href = use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
    if (href.startsWith("#")) missing.add(href.slice(1));
  }
  const raw = clone.outerHTML;
  for (const match of raw.matchAll(REFERENCE)) if (match[1]) missing.add(match[1]);
  const defs: Element[] = [];
  for (const id of missing) {
    if (clone.querySelector(`#${CSS.escape(id)}`)) continue;
    const found: Element | null = svg.ownerDocument.getElementById(id);
    if (found && found !== svg && !found.contains(svg)) defs.push(found.cloneNode(true) as Element);
  }
  if (defs.length) {
    const holder = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "defs");
    for (const def of defs) holder.appendChild(def);
    clone.insertBefore(holder, clone.firstChild);
  }
  serializer ??= new XMLSerializer();
  const markup = serializer.serializeToString(clone);
  memo.set(svg, { signature, markup });
  return markup;
}

/** Decode markup into a bitmap of the given pixel size. */
export async function rasteriseSvg(
  markup: string,
  width: number,
  height: number,
): Promise<ImageBitmap | null> {
  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return snapshot(canvas);
}
