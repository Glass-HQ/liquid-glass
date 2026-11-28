/**
 * Images, videos and canvases: whether the page may read their pixels, how `object-fit` and
 * `object-position` place them, and turning them into bitmaps at the size they are shown.
 *
 * A cross-origin image without CORS taints any canvas it touches, and the worker cannot upload a
 * tainted bitmap, so those are never sent. Same-origin, `data:` and `blob:` sources are readable,
 * except an SVG, which the browser marks unreadable when it holds a `foreignObject` (HTML drawn as
 * an image), whatever its origin; it and anything else are probed once by drawing one pixel and
 * reading it back.
 */

import type { Rect } from "../protocol";
import { lengthOf, splitTop } from "./css";
import { snapshot } from "./snapshot";

const readable = new Map<string, boolean>();
let probeContext: OffscreenCanvasRenderingContext2D | null | undefined;

const sameOrigin = (src: string): boolean => {
  if (src.startsWith("data:") || src.startsWith("blob:")) return true;
  try {
    return new URL(src, location.href).origin === location.origin;
  } catch {
    return false;
  }
};

/** An SVG given inline, which may hold a `foreignObject` and so taint what it's drawn into. */
const inlineSvg = (src: string): boolean => /^data:image\/svg\+xml[;,]/i.test(src);

/** Whether a loaded image's pixels can be read (and so sent to the worker). */
export function imageReadable(image: HTMLImageElement, src: string): boolean {
  if (sameOrigin(src) && !inlineSvg(src)) return true;
  const known = readable.get(src);
  if (known !== undefined) return known;
  probeContext ??= new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  let ok = false;
  if (probeContext) {
    try {
      probeContext.clearRect(0, 0, 1, 1);
      probeContext.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1);
      probeContext.getImageData(0, 0, 1, 1);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (readable.size > 2048) readable.clear();
  readable.set(src, ok);
  return ok;
}

/** Whether a video's frames can be read: same origin, CORS, or a media stream. */
export function videoReadable(video: HTMLVideoElement): boolean {
  if (video.srcObject) return true;
  const src = video.currentSrc || video.src;
  if (!src) return false;
  return sameOrigin(src) || video.crossOrigin !== null;
}

/** Canvases whose snapshot couldn't be read: tainting is permanent, so they're never sent again. */
const taintedCanvases = new WeakSet<HTMLCanvasElement>();

/**
 * Whether a canvas can be read. It's never asked for a context to find out: asking a canvas that
 * has none yet claims it, for 2D, and a WebGPU or WebGL renderer starting on it a moment later is
 * left without one. Its snapshot is checked instead (`bitmapOf`), and one that couldn't be read
 * is remembered here.
 */
export function canvasReadable(canvas: HTMLCanvasElement): boolean {
  return !taintedCanvases.has(canvas);
}

/** Whether a bitmap's pixels can be read, so the worker can take it: a one-pixel readback. */
function bitmapReadable(bitmap: ImageBitmap): boolean {
  probeContext ??= new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  if (!probeContext) return false;
  try {
    probeContext.clearRect(0, 0, 1, 1);
    probeContext.drawImage(bitmap, 0, 0, 1, 1, 0, 0, 1, 1);
    probeContext.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

export interface Placement {
  /** Where the visible part goes, CSS px. */
  readonly dest: Rect;
  /** The visible part of the source, in natural pixels. */
  readonly source: Rect;
  /** The whole object's size on screen, CSS px (for choosing a bitmap size). */
  readonly object: { readonly width: number; readonly height: number };
}

function positionAlong(token: string | undefined, free: number, zoom: number): number {
  if (!token) return free / 2;
  switch (token) {
    case "left":
    case "top":
      return 0;
    case "right":
    case "bottom":
      return free;
    case "center":
      return free / 2;
  }
  const calc = /^calc\(\s*(-?[\d.]+)%\s*([+-])\s*(-?[\d.]+)px\s*\)$/.exec(token);
  if (calc) {
    const offset = Number(calc[3]) * zoom;
    return (Number(calc[1]) / 100) * free + (calc[2] === "-" ? -offset : offset);
  }
  if (token.endsWith("%")) return (Number.parseFloat(token) / 100) * free;
  return (lengthOf(token, free) ?? free / 2) * (token.endsWith("px") ? zoom : 1);
}

/**
 * Place a source of `natural` size in `content` the way `object-fit` and `object-position` do.
 * Natural sizes are image pixels, which CSS treats as CSS px at 1x (then scaled by `zoom`).
 */
export function fitObject(
  fit: string,
  position: string,
  content: Rect,
  natural: { width: number; height: number },
  zoom: number,
): Placement | null {
  const nw = natural.width;
  const nh = natural.height;
  if (!(nw > 0 && nh > 0 && content.width > 0 && content.height > 0)) return null;
  let width = content.width;
  let height = content.height;
  const contain = Math.min(content.width / nw, content.height / nh);
  const cover = Math.max(content.width / nw, content.height / nh);
  switch (fit) {
    case "contain":
      width = nw * contain;
      height = nh * contain;
      break;
    case "cover":
      width = nw * cover;
      height = nh * cover;
      break;
    case "none":
      width = nw * zoom;
      height = nh * zoom;
      break;
    case "scale-down": {
      const s = Math.min(contain, zoom);
      width = nw * s;
      height = nh * s;
      break;
    }
  }
  const [px = "50%", py = "50%"] = splitTop(position, " ");
  const ox = content.x + positionAlong(px, content.width - width, zoom);
  const oy = content.y + positionAlong(py, content.height - height, zoom);
  const x0 = Math.max(content.x, ox);
  const y0 = Math.max(content.y, oy);
  const x1 = Math.min(content.x + content.width, ox + width);
  const y1 = Math.min(content.y + content.height, oy + height);
  if (x1 <= x0 || y1 <= y0) return null;
  const sx = nw / width;
  const sy = nh / height;
  return {
    dest: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    source: { x: (x0 - ox) * sx, y: (y0 - oy) * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy },
    object: { width, height },
  };
}

const MAX_SIDE = 4096;

/**
 * Bitmap size for a source shown at `object` CSS px: the natural size, scaled down when it is
 * much larger than the device pixels it covers (no point uploading a 4000 px photo for an avatar).
 */
export function bitmapSize(
  natural: { width: number; height: number },
  object: { width: number; height: number },
  dpr: number,
  vector: boolean,
): { width: number; height: number } {
  const wanted = Math.max(1, object.width * dpr);
  let scale = vector ? wanted / natural.width : Math.min(1, wanted / natural.width);
  scale = Math.min(scale, MAX_SIDE / natural.width, MAX_SIDE / natural.height);
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

const isVectorSrc = (src: string) =>
  /\.svgz?(\?|#|$)/i.test(src) || src.startsWith("data:image/svg");

/** The size an image is drawn from: natural size, or the shown size for SVGs without one. */
export function naturalSize(
  image: HTMLImageElement,
  content: Rect,
): { width: number; height: number; vector: boolean } {
  const src = image.currentSrc || image.src;
  const vector = isVectorSrc(src);
  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    return { width: image.naturalWidth, height: image.naturalHeight, vector };
  }
  return { width: Math.max(1, content.width), height: Math.max(1, content.height), vector: true };
}

/** Decode an element into a premultiplied bitmap of the given size. */
export async function bitmapOf(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  width: number,
  height: number,
): Promise<ImageBitmap | null> {
  try {
    const bitmap = await createImageBitmap(source, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
      premultiplyAlpha: "premultiply",
    });
    // A canvas or video can hold pixels from another origin: such a bitmap can't go to the worker.
    if (source instanceof HTMLImageElement || bitmapReadable(bitmap)) return bitmap;
    bitmap.close();
    if (source instanceof HTMLCanvasElement) taintedCanvases.add(source);
    return null;
  } catch {
    // Some engines refuse SVG images here; drawing them through a canvas works everywhere.
    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(source, 0, 0, width, height);
      const bitmap = snapshot(canvas);
      if (bitmapReadable(bitmap)) return bitmap;
      bitmap.close();
      return null;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Images that are not elements (CSS backgrounds, video posters)
// ---------------------------------------------------------------------------------------------

interface Loaded {
  readonly image: HTMLImageElement;
  state: "loading" | "ready" | "failed";
  readonly waiting: Set<Element>;
}

const loaded = new Map<string, Loaded>();

/**
 * A decoded image for a URL, loaded with CORS when cross-origin so it can be read. Null while
 * loading (the element is invalidated when it arrives) or when it cannot be read.
 */
export function loadImage(
  url: string,
  element: Element,
  onLoad: (element: Element) => void,
): HTMLImageElement | null {
  let entry = loaded.get(url);
  if (!entry) {
    const image = new Image();
    if (!sameOrigin(url)) image.crossOrigin = "anonymous";
    image.decoding = "async";
    const created: Loaded = { image, state: "loading", waiting: new Set() };
    entry = created;
    loaded.set(url, created);
    image.src = url;
    image.decode().then(
      () => {
        // Decoded but unreadable (an SVG holding HTML): drawn as a placeholder, like a failure.
        created.state = imageReadable(image, url) ? "ready" : "failed";
        for (const waiting of created.waiting) onLoad(waiting);
        created.waiting.clear();
      },
      () => {
        created.state = "failed";
        created.waiting.clear();
      },
    );
  }
  if (entry.state === "ready") return entry.image;
  if (entry.state === "loading") entry.waiting.add(element);
  return null;
}

/** Whether a URL could not be loaded or read. */
export function imageFailed(url: string): boolean {
  return loaded.get(url)?.state === "failed";
}
