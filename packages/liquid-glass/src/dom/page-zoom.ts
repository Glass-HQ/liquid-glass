import { webkit } from "./engine.js";

/** WebKit lays out a zoomed page in larger units but reads a reference
 * filter's user-space lengths unzoomed, so every lens lands scaled toward the
 * element's origin. Its `devicePixelRatio` includes both page zoom and pinch
 * magnification, while the `resolution` media feature reports only the
 * screen's and `visualViewport.scale` only the pinch. */
let measured = { ratio: 0, pinch: 0, zoom: 1 };

const pinch = () => (webkit && typeof visualViewport === "object" && visualViewport && visualViewport.scale > 0 ? visualViewport.scale : 1);

/** Whether pinch magnification is active. WebKit repaints a magnified page
 * whole, but fails tiles at a magnified element's edge whose filter region
 * reaches far past it, so repaint padding must stay off while magnified. */
export function magnified(): boolean {
  return pinch() > 1.001;
}

/** Device pixels per CSS pixel that WebKit filters render at: pinch
 * magnification enlarges the page's tiles but not its filter buffers. */
export function filterPixelRatio(): number {
  const ratio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return ratio / pinch();
}

/** WebKit splits a composited layer into tiles once its size, outsets
 * included, times pinch magnification passes 2048 points (1280, or 1024 under
 * memory pressure, on iOS). Each tile then filters its own region, and tiles
 * fail where that region misses the filter's primitives. Largest outsets, in
 * CSS pixels, that keep a `width` × `height` element in one layer. */
export function untiledOutsets(width: number, height: number, margin = 1): number {
  if (!webkit) return Infinity;
  const touch = typeof navigator === "object" && navigator.maxTouchPoints > 1;
  const limit = (touch ? 1024 : 2048) * margin;
  return Math.max(0, (limit / (pageZoom() * pinch()) - Math.max(width, height)) / 2);
}

/** The factor WebKit's page zoom applies to filter user space; 1 elsewhere. */
export function pageZoom(): number {
  if (!webkit || typeof matchMedia !== "function") return 1;
  const ratio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const magnification = pinch();
  if (ratio === measured.ratio && magnification === measured.pinch) return measured.zoom;
  let low = 0.25, high = 16;
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2;
    if (matchMedia(`(min-resolution: ${middle}dppx)`).matches) low = middle;
    else high = middle;
  }
  const zoom = Math.round(ratio / magnification / low * 1000) / 1000;
  measured = { ratio, pinch: magnification, zoom: Math.abs(zoom - 1) < 0.005 ? 1 : zoom };
  return measured.zoom;
}

const lengths = new Set(["x", "y", "width", "height", "dx", "dy", "stdDeviation", "scale"]);
/** Scale the user-space lengths of every primitive, leaving the filter's
 * own bounding-box region alone. */
export function zoomFilterMarkup(markup: string, zoom: number): string {
  if (zoom === 1) return markup;
  return markup.replace(/<(fe\w+)\b([^>]*)>/g, (_, tag: string, attributes: string) =>
    `<${tag}${attributes.replace(/([\w-]+)="([^"]*)"/g, (whole, name: string, value: string) =>
      lengths.has(name) ? `${name}="${value.split(/[\s,]+/).filter(Boolean).map((part) => Number(part) * zoom).join(" ")}"` : whole)}>`);
}
