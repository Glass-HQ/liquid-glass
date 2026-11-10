import type { LayerBox, MirroredMedia } from "./composited.js";

/** WebKit hands video and canvas pixels straight to its compositor, above the
 * content's glass filter, and ignores filters on the element itself. While
 * glass is over one, a canvas just beneath it holds the same frame where the
 * glass samples, and a hole in the media's clip shows that canvas. Everywhere
 * else the media stays as it is, controls included.
 *
 * The canvas is a layer of its own that takes the glass on itself, like any
 * other composited layer: a new frame repaints only that layer, never the
 * content's filter, which WebKit would evaluate over the whole repaint and
 * fail for lenses far from it. Drawing a frame onto a visible canvas never
 * reads its pixels back, so cross-origin media mirror too. Encrypted media
 * cannot be drawn at all. */
export type { MirroredMedia } from "./composited.js";

/** A lens over the media, in the media's border-box coordinates. */
export interface MediaHole extends LayerBox { radius: number }

export interface MediaMirrorPlan {
  /** Content to mirror, in the media's border-box coordinates; one canvas each. */
  regions: readonly LayerBox[];
  holes: readonly MediaHole[];
  /** Where each canvas measured relative to the media's border box, to correct
   * its placement inside the containing block it shares with the media. */
  measured?: readonly ({ x: number; y: number } | undefined)[];
}

interface Tile {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  region?: LayerBox;
  left?: number;
  top?: number;
}

interface Mirror {
  tiles: Tile[];
  active: boolean;
  clip: { value: string; priority: string };
  hole?: string;
  /** An authored clip cannot take a hole; the media is hidden instead and
   * mirrored whole. */
  authored?: boolean;
  hidden?: { value: string; priority: string };
  poster?: HTMLImageElement;
  /** The pending video frame callback. */
  callback?: number;
  /** One converted frame that several tiles copy from. */
  frame?: HTMLCanvasElement;
  /** The pixels a canvas last showed where it is mirrored. */
  seen?: Uint32Array;
  /** Checks in a row that found the canvas unchanged. */
  still: number;
  stale: boolean;
  listeners: (() => void)[];
}

/** Where replaced content lands in its box for `object-fit` and `object-position`. */
export function objectBox(box: LayerBox, intrinsic: { width: number; height: number }, fit: string, position: string): LayerBox {
  if (!intrinsic.width || !intrinsic.height) return box;
  let w = box.w, h = box.h;
  const ratio = intrinsic.width / intrinsic.height;
  const contain = () => { if (box.w / box.h > ratio) { h = box.h; w = h * ratio; } else { w = box.w; h = w / ratio; } };
  const cover = () => { if (box.w / box.h > ratio) { w = box.w; h = w / ratio; } else { h = box.h; w = h * ratio; } };
  if (fit === "contain") contain();
  else if (fit === "cover") cover();
  else if (fit === "none") { w = intrinsic.width; h = intrinsic.height; }
  else if (fit === "scale-down") { if (intrinsic.width > box.w || intrinsic.height > box.h) contain(); else { w = intrinsic.width; h = intrinsic.height; } }
  const [px = "50%", py = "50%"] = position.trim().split(/\s+/);
  const place = (value: string, free: number) => value.endsWith("%") ? free * parseFloat(value) / 100 : parseFloat(value) || 0;
  return { x: box.x + place(px, box.w - w), y: box.y + place(py, box.h - h), w, h };
}

/** An even-odd clip path: the whole box, less a rounded rectangle per hole. */
export function holeClip(width: number, height: number, holes: readonly MediaHole[]): string {
  const n = (value: number) => Math.round(value * 100) / 100;
  const shapes = holes.map(({ x, y, w, h, radius }) => {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    if (!r) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
    return `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}`
      + `H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`;
  });
  return `path(evenodd, "M0 0H${n(width)}V${n(height)}H0Z${shapes.join("")}")`;
}

export interface MediaMirrors {
  /** Mirror exactly the planned media this frame; every other mirror rests. */
  update(plans: ReadonlyMap<MirroredMedia, MediaMirrorPlan>): void;
  /** Whether a mirrored canvas is changing, which follows the page's frames. */
  animating(): boolean;
  ownsCanvas(node: Node): boolean;
  /** The mirror canvases of a media element, in plan order, while shown. */
  canvasesOf(media: MirroredMedia): readonly HTMLCanvasElement[];
  /** Whether the media's own clip keeps it from taking holes; it is then mirrored whole. */
  whole(media: MirroredMedia): boolean;
  dispose(): void;
}

const RESTING_AFTER = 30;
const RESTING_INTERVAL = 6;

export function createMediaMirrors(onFrame: () => void): MediaMirrors {
  const mirrors = new Map<MirroredMedia, Mirror>();
  const canvases = new WeakSet<Node>();
  const ratio = () => Math.min(typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1, 2);

  /** With `changedOnly`, the tiles are left alone while the media shows the
   * pixels it showed last time: repainting a tile reruns its glass. */
  const draw = (media: MirroredMedia, mirror: Mirror, changedOnly = false) => {
    const tiles = mirror.tiles.filter((tile) => tile.region);
    if (!tiles.length) return;
    const view = media.ownerDocument.defaultView ?? window;
    const style = view.getComputedStyle(media);
    // Replaced content sits in the content box and is clipped to the
    // rounded padding box, as the media itself is.
    const px = (value: string) => parseFloat(value) || 0;
    const borderBox = { w: media.offsetWidth, h: media.offsetHeight };
    const inset = { l: px(style.borderLeftWidth), t: px(style.borderTopWidth), r: px(style.borderRightWidth), b: px(style.borderBottomWidth) };
    const padding = { l: px(style.paddingLeft), t: px(style.paddingTop), r: px(style.paddingRight), b: px(style.paddingBottom) };
    const contentBox = { x: inset.l + padding.l, y: inset.t + padding.t, w: borderBox.w - inset.l - inset.r - padding.l - padding.r, h: borderBox.h - inset.t - inset.b - padding.t - padding.b };
    const radius = Math.max(0, px(style.borderTopLeftRadius) - Math.max(inset.l, inset.t));
    const clipBox = { x: inset.l, y: inset.t, w: borderBox.w - inset.l - inset.r, h: borderBox.h - inset.t - inset.b };
    let source: CanvasImageSource | undefined = media;
    let intrinsic = media instanceof HTMLVideoElement ? { width: media.videoWidth, height: media.videoHeight } : { width: media.width, height: media.height };
    if (media instanceof HTMLVideoElement && media.readyState < 2) {
      // Until its first frame decodes, a video shows its poster.
      const poster = mirror.poster;
      source = poster?.complete && poster.naturalWidth ? poster : undefined;
      intrinsic = poster ? { width: poster.naturalWidth, height: poster.naturalHeight } : intrinsic;
    }
    const box = source && intrinsic.width && intrinsic.height ? objectBox(contentBox, intrinsic, style.objectFit, style.objectPosition) : undefined;
    const scale = ratio();
    const paint = (context: CanvasRenderingContext2D, region: LayerBox, width: number, height: number) => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!box) return;
      context.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
      context.save();
      context.beginPath();
      if (radius > 0 && typeof context.roundRect === "function") context.roundRect(clipBox.x, clipBox.y, clipBox.w, clipBox.h, radius);
      else context.rect(clipBox.x, clipBox.y, clipBox.w, clipBox.h);
      context.clip();
      // Only the part of the frame this region shows is scaled and drawn.
      const x = Math.max(box.x, clipBox.x, region.x), y = Math.max(box.y, clipBox.y, region.y);
      const w = Math.min(box.x + box.w, clipBox.x + clipBox.w, region.x + region.w) - x, h = Math.min(box.y + box.h, clipBox.y + clipBox.h, region.y + region.h) - y;
      const kx = intrinsic.width / box.w, ky = intrinsic.height / box.h;
      if (w > 0 && h > 0) try { context.drawImage(source!, (x - box.x) * kx, (y - box.y) * ky, w * kx, h * ky, x, y, w, h); } catch { /* A detached or broken source draws nothing. */ }
      context.restore();
    };
    const size = (region: LayerBox) => [Math.max(1, Math.ceil(region.w * scale)), Math.max(1, Math.ceil(region.h * scale))] as const;
    // Drawing a video frame converts all of it to the canvas's pixel format
    // and color space. Several tiles share one conversion, then copy from it.
    let shared: { region: LayerBox; canvas: HTMLCanvasElement } | undefined;
    if ((tiles.length > 1 || changedOnly) && box) {
      const x = Math.min(...tiles.map((tile) => tile.region!.x)), y = Math.min(...tiles.map((tile) => tile.region!.y));
      const region = { x, y, w: Math.max(...tiles.map((tile) => tile.region!.x + tile.region!.w)) - x, h: Math.max(...tiles.map((tile) => tile.region!.y + tile.region!.h)) - y };
      const [width, height] = size(region);
      const canvas = mirror.frame ??= media.ownerDocument.createElement("canvas");
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      paint(context, region, width, height);
      shared = { region, canvas };
      if (changedOnly) {
        // A canvas that drew cross-origin images cannot be read; it is copied every frame.
        let now: Uint32Array | undefined;
        try { now = new Uint32Array(context.getImageData(0, 0, width, height).data.buffer); } catch { /* Unreadable. */ }
        const seen = mirror.seen;
        mirror.seen = now;
        if (now && seen?.length === now.length) {
          let index = now.length;
          while (index-- && now[index] === seen[index]);
          if (index < 0) { mirror.still++; return; }
        }
        mirror.still = 0;
      }
    }
    for (const tile of tiles) {
      const region = tile.region!;
      const [width, height] = size(region);
      const { canvas, context } = tile;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      if (!shared) { paint(context, region, width, height); continue; }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.drawImage(shared.canvas, Math.round((region.x - shared.region.x) * scale), Math.round((region.y - shared.region.y) * scale), width, height, 0, 0, width, height);
    }
    mirror.stale = false;
  };

  const createTile = (media: MirroredMedia): Tile => {
    const canvas = media.ownerDocument.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.glassMirror = "";
    // A canvas WebKit cannot accelerate is painted, so a filter applies to it.
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    Object.assign(canvas.style, { position: "absolute", pointerEvents: "none", margin: "0", padding: "0", border: "0", left: "0px", top: "0px", willChange: "transform" });
    canvases.add(canvas);
    media.before(canvas);
    return { canvas, context };
  };

  const create = (media: MirroredMedia): Mirror => {
    const mirror: Mirror = { tiles: [], active: false, clip: { value: "", priority: "" }, stale: true, still: 0, listeners: [] };
    if (media instanceof HTMLVideoElement) {
      if (media.poster) { mirror.poster = new Image(); mirror.poster.src = media.poster; mirror.poster.decode().then(() => { mirror.stale = true; onFrame(); }, () => undefined); }
      const redraw = () => { mirror.stale = true; onFrame(); };
      for (const type of ["loadeddata", "seeked", "emptied", "resize"]) {
        media.addEventListener(type, redraw);
        mirror.listeners.push(() => media.removeEventListener(type, redraw));
      }
    }
    return mirror;
  };

  const watchFrames = (media: MirroredMedia, mirror: Mirror) => {
    if (!(media instanceof HTMLVideoElement) || mirror.callback !== undefined || typeof media.requestVideoFrameCallback !== "function") return;
    const next = () => {
      mirror.callback = media.requestVideoFrameCallback(() => {
        mirror.callback = undefined;
        if (!mirrors.has(media) || !mirror.active) return;
        draw(media, mirror);
        next();
      });
    };
    next();
  };

  /** A WebGL or WebGPU canvas keeps its frame only until it is presented.
   * Frame callbacks run in the order they were requested; requesting from a
   * task after each paint puts the copy after the page's own drawing. */
  let canvasLoop: ReturnType<typeof setTimeout> | undefined;
  let skipped = 0;
  const scheduleCanvases = () => {
    if (canvasLoop !== undefined) return;
    canvasLoop = setTimeout(() => {
      const view = [...mirrors.keys()][0]?.ownerDocument.defaultView ?? window;
      view.requestAnimationFrame(() => {
        canvasLoop = undefined;
        let active = false;
        skipped = (skipped + 1) % RESTING_INTERVAL;
        for (const [media, mirror] of mirrors) if (media instanceof HTMLCanvasElement && mirror.active) {
          // A canvas that has stopped changing is checked a few times a second.
          if (mirror.still < RESTING_AFTER || !skipped) draw(media, mirror, true);
          active = true;
        }
        if (active) scheduleCanvases();
      });
    }, 0);
  };

  const restoreOpacity = (media: MirroredMedia, mirror: Mirror) => {
    const hidden = mirror.hidden;
    if (!hidden) return;
    mirror.hidden = undefined;
    if (media.style.getPropertyValue("opacity") !== "0") return;
    if (hidden.value) media.style.setProperty("opacity", hidden.value, hidden.priority);
    else media.style.removeProperty("opacity");
  };

  const restoreClip = (media: MirroredMedia, mirror: Mirror) => {
    if (mirror.hole === undefined) return;
    if (media.style.getPropertyValue("clip-path") === mirror.hole) {
      if (mirror.clip.value) media.style.setProperty("clip-path", mirror.clip.value, mirror.clip.priority);
      else media.style.removeProperty("clip-path");
    }
    mirror.hole = undefined;
  };

  const rest = (media: MirroredMedia, mirror: Mirror) => {
    if (!mirror.active) return;
    mirror.active = false;
    mirror.authored = undefined;
    if (mirror.callback !== undefined && media instanceof HTMLVideoElement) media.cancelVideoFrameCallback(mirror.callback);
    mirror.callback = undefined;
    mirror.frame = undefined;
    mirror.seen = undefined;
    restoreClip(media, mirror);
    restoreOpacity(media, mirror);
    for (const tile of mirror.tiles) { tile.region = undefined; tile.canvas.style.display = "none"; }
  };

  const remove = (media: MirroredMedia, mirror: Mirror) => {
    rest(media, mirror);
    mirror.listeners.forEach((stop) => stop());
    for (const tile of mirror.tiles) tile.canvas.remove();
    mirrors.delete(media);
  };

  return {
    update(plans) {
      for (const [media, mirror] of mirrors) {
        if (!media.isConnected) remove(media, mirror);
        else if (!plans.has(media)) rest(media, mirror);
      }
      for (const [media, plan] of plans) {
        let mirror = mirrors.get(media);
        if (!mirror) { mirror = create(media); mirrors.set(media, mirror); }
        if (!mirror.active) {
          // An authored clip on the media cannot take holes.
          const clip = (media.ownerDocument.defaultView ?? window).getComputedStyle(media).clipPath;
          mirror.authored = Boolean(clip) && clip !== "none";
          mirror.active = true;
        }
        const regions = mirror.authored ? [{ x: 0, y: 0, w: media.offsetWidth, h: media.offsetHeight }] : plan.regions;
        while (mirror.tiles.length < regions.length) mirror.tiles.push(createTile(media));
        let changed = mirror.stale;
        mirror.tiles.forEach((tile, index) => {
          const region = regions[index];
          // Every tile paints just beneath the media.
          if (tile.canvas.parentNode !== media.parentNode || tile.canvas.compareDocumentPosition(media) & Node.DOCUMENT_POSITION_PRECEDING) media.before(tile.canvas);
          if (!region) {
            if (tile.region) { tile.region = undefined; tile.canvas.style.display = "none"; }
            return;
          }
          // The mirror shares the media's containing block. Offsets start it
          // close; its measured position corrects whatever they miss.
          const measured = tile.left !== undefined && tile.top !== undefined && tile.region ? plan.measured?.[index] : undefined;
          const left = measured ? tile.left! - measured.x + region.x : media.offsetLeft + region.x;
          const top = measured ? tile.top! - measured.y + region.y : media.offsetTop + region.y;
          if (!tile.region || ["x", "y", "w", "h"].some((key) => Math.abs(tile.region![key as keyof LayerBox] - region[key as keyof LayerBox]) > 0.01)) changed = true;
          tile.left = left;
          tile.top = top;
          tile.region = region;
          Object.assign(tile.canvas.style, { display: "block", left: `${left}px`, top: `${top}px`, width: `${region.w}px`, height: `${region.h}px` });
        });
        if (changed) draw(media, mirror);
        if (media instanceof HTMLCanvasElement) scheduleCanvases();
        watchFrames(media, mirror);
        if (mirror.authored) {
          if (!mirror.hidden) {
            mirror.hidden = { value: media.style.getPropertyValue("opacity"), priority: media.style.getPropertyPriority("opacity") };
            media.style.setProperty("opacity", "0", "important");
          }
          continue;
        }
        const hole = holeClip(media.offsetWidth, media.offsetHeight, plan.holes);
        if (mirror.hole === undefined) mirror.clip = { value: media.style.getPropertyValue("clip-path"), priority: media.style.getPropertyPriority("clip-path") };
        if (mirror.hole !== hole) { media.style.setProperty("clip-path", hole, "important"); mirror.hole = media.style.getPropertyValue("clip-path"); }
      }
    },
    animating: () => [...mirrors].some(([media, mirror]) => mirror.active && media instanceof HTMLCanvasElement && mirror.still < RESTING_AFTER),
    ownsCanvas: (node) => canvases.has(node),
    canvasesOf: (media) => mirrors.get(media)?.tiles.filter((tile) => tile.region).map((tile) => tile.canvas) ?? [],
    whole: (media) => Boolean(mirrors.get(media)?.authored),
    dispose() {
      if (canvasLoop !== undefined) clearTimeout(canvasLoop);
      for (const [media, mirror] of mirrors) remove(media, mirror);
    },
  };
}
