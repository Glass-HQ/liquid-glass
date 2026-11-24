/**
 * The glass scene: owns the render worker's client, the DOM capture, telemetry and the frame
 * loop, and turns the app's glass elements into one `frame` message per tick.
 *
 * A frame: run motion callbacks (they may write styles), then read: measure the surfaces that
 * might have moved, flush pending capture patches, read scroll offsets; then post one message.
 * Layout is never written between the reads and the post; canvas placement changes are applied
 * after posting.
 */

import type {
  Appearance,
  Material,
  MaterialKind,
  Radii,
  Rect,
  Rgba,
  Shape,
  SurfaceFrame,
} from "../protocol";
import type { Capture, CaptureHost } from "../capture";
import { parseColor, resolveColor } from "../core/color";
import {
  adaptMaterial,
  meaningfulChange,
  type AdaptState,
  initialAdapt,
  isSmall,
  mixMaterials,
  readingLevels,
  stepAdapt,
} from "../core/adapt";
import { materialReach, resolveMaterial } from "../core/material";
import type { TintAmount } from "../core/material";
import type { RadiusSpec } from "../core/geometry";
import { capsuleRadii, fromDomRect, resolveRadii } from "../core/geometry";
import type { RenderClient } from "../render/client";
import { createActivity } from "./activity";
import { createBoost } from "./ios/boost";
import { hasGestureEvents, isAppleTouchDevice } from "./ios/detect";
import { createDragPad } from "./ios/drag-pad";
import type { DragPad, DragPadHandlers } from "./ios/drag-pad";
import { createPacer } from "./pacer";
import { rankSurfaces } from "./stacking";
import { freshClass, injectStyles } from "./styles";
import {
  canvasGeometry,
  clipsContent,
  computedRadii,
  createSurfaceCanvas,
  opacityProduct,
  placeCanvas,
  resetSiblingStyles,
  siblingStyles,
} from "./surface";
import type { Bleed, CanvasHost } from "./surface";
import { TelemetryCounter, createTelemetry } from "./telemetry";
import { RESTING_ANGLE, approachAngle, lightAngle, subscribeLight } from "./light";
import type { Telemetry } from "./telemetry";

export interface GlassSceneOptions {
  /** The element whose content glass refracts. Default: `document.body`. */
  readonly root?: HTMLElement;
  /** Default material for surfaces. Default: "regular". */
  readonly material?: MaterialKind;
  /** Default: follows `prefers-color-scheme`. */
  readonly appearance?: Appearance | "auto";
  /**
   * How tinted regular glass is: "clear" shows more of what is behind, "tinted" frosts it more, or a
   * number from 0 (clear) to 1 (tinted). Default: "default" (0.5). Clear
   * glass (`material: "clear"`, meant for controls over media) doesn't change with it.
   */
  readonly tintAmount?: TintAmount;
  /**
   * CSS color drawn where the page is transparent (an app over a see-through window).
   * Default: the first opaque background from the root up, else white or black by appearance.
   */
  readonly backdrop?: string;
  /** Count frames and timings and report them to `telemetry.subscribe`. Default: false. */
  readonly telemetry?: boolean;
  /**
   * Adapt glass to what is behind it: small regular glass flips between
   * light and dark, shadows deepen over text, clear glass dims bright content, and each surface
   * reports the tone its labels should take (`data-lg-tone`, `onTone`). Default: true.
   */
  readonly adaptive?: boolean;
  /**
   * Every surface's default for `specular`: highlights that follow the pointer, or the device's
   * tilt. Default: false.
   */
  readonly specular?: boolean;
}

export interface SurfaceOptions {
  /** Corners: "capsule", one radius, or each corner. Default: the element's border-radius. */
  readonly radius?: RadiusSpec;
  /**
   * How the corners curve, for the body and every shape on the surface that doesn't set its own:
   * 0 for circular arcs, 1 for continuous corners. Default: 1.
   */
  readonly smoothing?: number;
  /** Default: the scene's material. */
  readonly material?: MaterialKind;
  /** CSS color laid over the glass; alpha is its strength. */
  readonly tint?: string | null;
  /**
   * Draw the surface's own text and icons in the glass (their DOM copies turn transparent), so
   * a lens passing over them magnifies them. Default: false.
   */
  readonly labelsInGlass?: boolean;
  /**
   * How far the canvas reaches outside the element on each side, px. Default: room for the
   * material's shadow, plus `overhang`, plus the ring of a `lensHeight` lens.
   */
  readonly bleed?: number;
  /** How far shapes may reach outside the element (press growth, a lifted lens), px. */
  readonly overhang?: number;
  /** The height of the tallest lifted lens the surface shows, so its shadow ring fits. */
  readonly lensHeight?: number;
  /** Glass floating above content (menus, popovers, dialogs): panel look and deeper shadow. */
  readonly floating?: boolean;
  /**
   * Light or dark glass for this surface whatever the scene's appearance (a media viewer that
   * is always dark). Default: the scene's.
   */
  readonly appearance?: Appearance;
  /**
   * Draw the element's own box as glass. Turn off for surfaces that only show extra shapes
   * (a thumb's lens). Default: true.
   */
  readonly body?: boolean;
  /** Adapt to what is behind (see the scene's `adaptive`). Default: the scene's. */
  readonly adaptive?: boolean;
  /** 0..1: the shadow moving from resting glass's towards floating glass's (see material). */
  readonly shadowLift?: number;
  /**
   * Highlights along the rim that follow the pointer, or the device's tilt where the browser
   * reports it. Default: false.
   */
  readonly specular?: boolean;
  /** The shadow will lift (a menu's button): keep room for a floating shadow from the start. */
  readonly liftable?: boolean;
}

/**
 * The tone of a surface's glass as resolved against what is behind it: "dark" glass wants light
 * labels, "light" glass dark ones. Small regular glass flips with its backdrop; large regular
 * glass keeps its appearance; clear glass carries light labels except over flat light content.
 */
export type GlassTone = Appearance;

export interface GlassSurfaceHandle {
  readonly id: number;
  readonly element: HTMLElement;
  /** The element's size before transforms, as last measured. */
  readonly size: { readonly width: number; readonly height: number };
  /** The body's resolved corners at its current size. */
  readonly radii: Radii;
  /** How the corners curve (see `SurfaceOptions.smoothing`). */
  readonly smoothing: number;
  /**
   * The tone labels on this surface should take, resolved against what is behind it. Also on
   * the element as `data-lg-tone`, which the library's styles use for the default label color.
   */
  readonly tone: GlassTone;
  /** Called whenever `tone` changes. Returns a function that stops listening. */
  onTone(listener: (tone: GlassTone) => void): () => void;
  /**
   * Extra shapes (lens, pill, thumb) in the surface's px, replacing those previously set under
   * the same `layer`. A shape with role "body" replaces the default body.
   */
  setShapes(shapes: readonly Shape[], layer?: string): void;
  update(options: SurfaceOptions): void;
  remove(): void;
}

export interface GlassScene {
  readonly root: HTMLElement;
  readonly telemetry: Telemetry;
  readonly material: MaterialKind;
  readonly appearance: Appearance;
  /** Whether the person asked for reduced motion. */
  readonly reducedMotion: boolean;
  /** Whether input can come from 120 Hz controllers (iOS, iPadOS). */
  readonly controllers: boolean;
  /** Why glass is unavailable, once the renderer has failed (surfaces then fall back to CSS). */
  readonly error: string | null;
  addSurface(element: HTMLElement, options?: SurfaceOptions): GlassSurfaceHandle;
  surfaceOf(element: Element): GlassSurfaceHandle | null;
  /**
   * Run `callback` every frame, before surfaces are measured; it may write styles. Return true
   * while still moving, which keeps frames coming. Returns a function that stops it.
   */
  animate(callback: (now: number, dt: number) => boolean): () => void;
  /** Feed a canvas or video element's frames live. Returns a stop function. */
  addSource(element: HTMLCanvasElement | HTMLVideoElement): () => void;
  /** Recapture an element's subtree (or everything) before the next frame. */
  invalidate(element?: Element): void;
  /** Draw a frame soon (something changed that the scene can't see). */
  requestFrame(): void;
  configure(options: Omit<GlassSceneOptions, "root">): void;
  /**
   * Lay an invisible endless scroller over `host` that reports touch drags at the display's
   * rate. Null where controllers aren't used (anything but iOS): use pointer events there.
   */
  createDragPad(host: HTMLElement, handlers: DragPadHandlers): DragPad | null;
  destroy(): void;
}

/** Corner smoothing as given, in 0..1; continuous (1) when not given. */
const smoothingOf = (smoothing: number | undefined): number =>
  smoothing === undefined || !Number.isFinite(smoothing) ? 1 : Math.min(1, Math.max(0, smoothing));

interface SurfaceRecord {
  readonly id: number;
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly options: {
    radius: RadiusSpec | null;
    smoothing: number;
    material: MaterialKind | null;
    /** As given: a CSS color, maybe with `var()`s, resolved on the element every frame. */
    tint: string | null;
    labelsInGlass: boolean;
    bleed: number | null;
    overhang: number;
    lensHeight: number;
    floating: boolean;
    appearance: Appearance | null;
    body: boolean;
    adaptive: boolean | null;
    shadowLift: number;
    specular: boolean | null;
  };
  /** The specular highlights' axis now, easing towards the light. */
  lightAngle: number;
  /** The shadow has lifted towards a floating one at least once; its room is kept. */
  lifted?: boolean;
  /** Adapting to the backdrop: readings, the resolved tone and the flip in progress. */
  adapt: AdaptState;
  /** The tone last written to `data-lg-tone`. */
  tone: Appearance;
  /** The adapting glass this surface sits on, whose tone and flip it follows (this frame). */
  adaptParent: SurfaceRecord | null;
  readonly toneListeners: Set<(tone: Appearance) => void>;
  readonly layers: Map<string, readonly Shape[]>;
  shapes: readonly Shape[] | null;
  cssRadii: Radii | null;
  radii: Radii;
  size: { width: number; height: number };
  border: { left: number; top: number };
  screen: Rect;
  opacity: number;
  visible: boolean;
  measured: boolean;
  material: Material | null;
  materialKey: string;
  /** How far the surface draws past its border box: shadow, overhanging shapes. */
  reach: number;
  /** The reach per side, trimmed where it would make the page scroll further. */
  bleed: Bleed;
  host: CanvasHost;
  /** A sibling canvas's place in the containing block it shares with the surface. */
  offset: { left: number; top: number };
  /** The surface's computed style, kept while its canvas is a sibling (it mirrors it). */
  style: CSSStyleDeclaration | null;
  canvasKey: string;
  /**
   * A new size or place for the canvas, waiting for the worker to present the frame drawn at it:
   * written earlier, the browser would stretch the last frame into the new box for a frame or
   * two (a menu's first open, a shadow growing).
   */
  pendingGeometry: { width: number; height: number; polls: number; write: () => void } | null;
  labelsShown: boolean;
  /** Sequence of the first frame that drew it with labels in glass. */
  labelsFrom: number;
  rank: number;
  handle: GlassSurfaceHandle;
}

/** Keep drawing this long after the page last scrolled, so a fling's last frames aren't missed. */
const coastMs = 120;

const transparent = (color: Rgba | null) => !color || color[3] === 0;

export function createGlassScene(options: GlassSceneOptions = {}): GlassScene {
  const root = options.root ?? document.body;
  const doc = root.ownerDocument;
  injectStyles(doc);

  const gesture = hasGestureEvents();
  const telemetry = createTelemetry({ enabled: options.telemetry ?? false });
  telemetry.mark("liquid-glass:scene");

  const colorScheme = matchMedia("(prefers-color-scheme: dark)");
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let appearanceOption = options.appearance ?? "auto";
  let material: MaterialKind = options.material ?? "regular";
  let tintAmount: TintAmount | undefined = options.tintAmount;
  let backdropOption = options.backdrop;
  let adaptiveOption = options.adaptive ?? true;
  let specularOption = options.specular ?? false;
  const specularOf = (record: SurfaceRecord): boolean => record.options.specular ?? specularOption;
  const appearance = (): Appearance =>
    appearanceOption === "auto" ? (colorScheme.matches ? "dark" : "light") : appearanceOption;

  const lookOf = (record: SurfaceRecord): Appearance => record.options.appearance ?? appearance();
  const adaptsOf = (record: SurfaceRecord): boolean => record.options.adaptive ?? adaptiveOption;
  /** How a surface adapts: its material kind, the appearance it would have, whether it flips. */
  const adaptInputOf = (record: SurfaceRecord) => {
    const kind = record.options.material ?? material;
    return {
      kind,
      appearance: lookOf(record),
      // Tinted glass keeps its color (its label is drawn for that color), a pinned appearance is
      // pinned, and surfaces without a body (a thumb's lens) have nothing to measure.
      flips:
        kind === "regular" &&
        record.options.appearance === null &&
        record.options.tint === null &&
        record.options.body &&
        isSmall(record.size.width, record.size.height, record.options.floating),
    };
  };

  /** The backdrop the current capture was started with. */
  let capturedBackdrop: Rgba | null = null;
  /**
   * The backdrop travels with every patch, so a new one means the capture starts over. It is
   * checked every frame because it can come from a theme variable or the root's background,
   * which change without the scene being told (a theme switch).
   */
  const restartCaptureIfBackdropChanged = (force = false) => {
    if (error || destroyed || !capture || !createCapture) return;
    const next = backdrop();
    const same =
      capturedBackdrop && next.every((value, index) => value === capturedBackdrop?.[index]);
    if (same && !force) return;
    capturedBackdrop = next;
    capture.destroy();
    capture = createCapture(root, host, { backdrop: next });
  };

  const backdrop = (): Rgba => {
    const given = backdropOption ? resolveColor(backdropOption, root) : null;
    if (given) return given;
    for (let node: Element | null = root; node; node = node.parentElement) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color && !transparent(color)) return color;
    }
    return appearance() === "dark" ? [0, 0, 0, 1] : [1, 1, 1, 1];
  };

  const surfaces = new Map<HTMLElement, SurfaceRecord>();
  const animations = new Set<(now: number, dt: number) => boolean>();
  const samplers = new Set<() => void>();
  let nextId = 1;
  let sequence = 0;
  let destroyed = false;
  let error: string | null = null;

  // What the next frame must do.
  let dirty = true;
  let measureAll = true;
  let ranksDirty = true;
  let moving = false;
  let touching = false;
  let lastScrollAt = -Infinity;
  let lastScroll: Float32Array = new Float32Array(0);

  // ------------------------------------------------------------------------------------------
  // Worker, capture, loop
  // ------------------------------------------------------------------------------------------

  // The capture and the render client (with the worker inlined in it) are most of the library's
  // weight, so they load on demand: importing the library costs a few KB, and the engine arrives
  // once a scene exists. Until then the scene keeps its state (surfaces, shapes, motion) and only
  // skips drawing; `startEngine` hands everything over when both modules are in.
  let client: RenderClient | null = null;
  let capture: Capture | null = null;
  let createCapture: typeof import("../capture").createCapture | null = null;
  /** Sources added before the capture exists, and the stop function each one gets from it. */
  const pendingSources = new Set<{
    element: HTMLCanvasElement | HTMLVideoElement;
    stop: (() => void) | null;
  }>();
  let unsubscribePresented: (() => void) | null = null;
  let unsubscribeBackdrop: (() => void) | null = null;
  const recordsById = new Map<number, SurfaceRecord>();

  const host: CaptureHost = {
    surfaceOf(element) {
      const record = element instanceof HTMLElement ? surfaces.get(element) : undefined;
      return record ? { id: record.id, labelsInGlass: record.options.labelsInGlass } : null;
    },
    send(patch, transfer) {
      if (client) client.display(patch, transfer);
      // Nobody will draw them: free the bitmaps now.
      else for (const upload of patch.bitmaps) upload.image.close();
    },
    requestFrame() {
      scene.requestFrame();
    },
    telemetry,
  };

  const startEngine = (
    createRenderClient: typeof import("../render/client").createRenderClient,
    capturing: typeof import("../capture").createCapture,
  ) => {
    // The scene may have been destroyed, or failed, while the modules were loading.
    if (destroyed || error) return;
    telemetry.mark("liquid-glass:engine");
    createCapture = capturing;
    client = createRenderClient({
      desynchronized: isAppleTouchDevice(),
      telemetry,
      // Deferred: the client may fail while it is being created, before it is assigned.
      onError: (message) => queueMicrotask(() => fail(message)),
    });
    unsubscribePresented = client.onPresented(onPresented);
    unsubscribeBackdrop = client.onBackdrop((readings) => {
      let changed = false;
      for (const reading of readings) {
        const record = recordsById.get(reading.id);
        if (!record) continue;
        const target = readingLevels(reading);
        // Readings wobble as content moves under the glass; a change nobody could see would
        // still redraw the whole surface and its shadow every frame.
        if (!meaningfulChange(record.adapt.target, target)) continue;
        record.adapt = { ...record.adapt, target };
        changed = true;
      }
      if (changed) scene.requestFrame();
    });
    for (const record of surfaces.values()) client.attach(record.id, record.canvas);
    // The first capture walks the whole root, so invalidations made before it need no replay.
    capturedBackdrop = backdrop();
    capture = createCapture(root, host, { backdrop: capturedBackdrop });
    for (const source of pendingSources) source.stop = capture.addSource(source.element);
    dirty = true;
    measureAll = true;
    ranksDirty = true;
    pacer.wake();
  };

  Promise.all([import("../render/client"), import("../capture")]).then(
    ([render, captureModule]) =>
      startEngine(render.createRenderClient, captureModule.createCapture),
    (thrown: unknown) =>
      fail(
        `The glass engine failed to load: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      ),
  );

  const boost = gesture ? createBoost(doc.body) : null;
  // A scroll-driven animation of a non-composited property: keeps WebKit sending fresh scroll
  // positions to the main thread while the URL bar resizes.
  const fresh = gesture ? doc.createElement("div") : null;
  if (fresh) {
    fresh.className = freshClass;
    fresh.setAttribute("aria-hidden", "true");
    fresh.setAttribute("data-lg-ignore", "");
    doc.body.append(fresh);
  }

  const activity = createActivity(doc, () => {
    measureAll = true;
    scene.requestFrame();
  });

  const pacer = createPacer({
    gesture,
    boost,
    telemetry,
    sample() {
      for (const read of samplers) read();
    },
    wants(now) {
      // The scroll offsets are read every tick: on iOS scroll events arrive late in a fling.
      if (capture && !sameFloats(capture.scrollDeltas(), lastScroll)) {
        dirty = true;
        measureAll = true;
        lastScrollAt = now;
      }
      const draw = dirty || moving || activity.active;
      return { draw, awake: draw || touching || now - lastScrollAt < coastMs };
    },
    inFlight: () => client?.inFlight() ?? 0,
    draw: (now, dt) => draw(now, dt),
    park() {
      moving = false;
    },
  });

  /**
   * Resized canvases take their new box on the frame their new picture shows: the placeholder's
   * size changes the moment the worker's frame at that size reaches the page, and this checks it
   * every animation frame (giving up after a few, so a lost frame can't strand a canvas).
   */
  let geometryPoll = 0;
  const pollGeometry = () => {
    geometryPoll = 0;
    let waiting = false;
    for (const record of surfaces.values()) {
      const pending = record.pendingGeometry;
      if (!pending) continue;
      pending.polls += 1;
      const canvas = record.canvas;
      const ready =
        Math.abs(canvas.width - pending.width) <= 1 &&
        Math.abs(canvas.height - pending.height) <= 1;
      if (ready || pending.polls > 12) {
        record.pendingGeometry = null;
        pending.write();
      } else waiting = true;
    }
    if (waiting) geometryPoll = requestAnimationFrame(pollGeometry);
  };

  function onPresented(presented: number) {
    for (const record of surfaces.values()) {
      if (record.labelsShown || !record.options.labelsInGlass || record.labelsFrom === 0) continue;
      if (presented >= record.labelsFrom) {
        record.labelsShown = true;
        record.element.setAttribute("data-lg-labels", "");
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Observers
  // ------------------------------------------------------------------------------------------

  const ours = (node: Node | null) =>
    node instanceof Element &&
    (node.hasAttribute("data-lg-canvas") || node.closest("[data-lg-ignore]") !== null);

  const mutations = new MutationObserver((records) => {
    let relevant = false;
    for (const record of records) {
      if (ours(record.target)) continue;
      relevant = true;
      const target = record.target;
      if (record.type === "childList") ranksDirty = true;
      else if (target instanceof HTMLElement) {
        const surface = surfaces.get(target);
        if (surface) surface.cssRadii = null;
        // Only a change on something that contains surfaces can restack them.
        if (!surface && target.querySelector("[data-lg-surface]")) ranksDirty = true;
      }
    }
    if (!relevant) return;
    measureAll = true;
    scene.requestFrame();
  });
  mutations.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "open", "dir"],
  });

  const resizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const record = entry.target instanceof HTMLElement ? surfaces.get(entry.target) : undefined;
      if (record) record.cssRadii = null;
    }
    measureAll = true;
    scene.requestFrame();
  });

  const abort = new AbortController();
  const passive = { passive: true, capture: true, signal: abort.signal } as const;
  const onScroll = () => {
    lastScrollAt = performance.now();
    measureAll = true;
    scene.requestFrame();
  };
  window.addEventListener("scroll", onScroll, passive);
  window.addEventListener("resize", onScroll, passive);
  window.visualViewport?.addEventListener("resize", onScroll, passive);
  window.visualViewport?.addEventListener("scroll", onScroll, passive);
  window.addEventListener(
    "touchstart",
    () => {
      touching = true;
      pacer.pin(true);
      pacer.wake();
    },
    passive,
  );
  const touchEnd = (event: TouchEvent) => {
    if (event.touches.length > 0) return;
    touching = false;
    pacer.pin(false);
    pacer.wake();
  };
  window.addEventListener("touchend", touchEnd, passive);
  window.addEventListener("touchcancel", touchEnd, passive);
  const onScheme = () => {
    if (appearanceOption !== "auto") return;
    for (const record of surfaces.values())
      record.element.setAttribute("data-lg-appearance", lookOf(record));
    scene.requestFrame();
  };
  colorScheme.addEventListener("change", onScheme);

  // ------------------------------------------------------------------------------------------
  // Frames
  // ------------------------------------------------------------------------------------------

  const resolvedRadii = (record: SurfaceRecord): Radii => {
    const { size } = record;
    if (record.options.radius !== null) return resolveRadii(record.options.radius, size);
    record.cssRadii ??= computedRadii(getComputedStyle(record.element), size.width, size.height);
    return record.cssRadii;
  };

  const measure = (record: SurfaceRecord, opacities: Map<Element, number>) => {
    const { element } = record;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    record.visible = element.isConnected && width > 0 && height > 0;
    if (!record.visible) return;
    const sizeChanged = width !== record.size.width || height !== record.size.height;
    record.size = { width, height };
    if (sizeChanged) record.cssRadii = null;
    record.border = { left: element.clientLeft, top: element.clientTop };
    record.screen = fromDomRect(element.getBoundingClientRect());
    // Style changes reset the cached corners; that is also when the canvas may need to move.
    if (record.cssRadii === null || record.host === "sibling") {
      const style = getComputedStyle(element);
      record.host = clipsContent(style) && style.position !== "sticky" ? "sibling" : "child";
      record.style = record.host === "sibling" ? style : null;
      record.offset = { left: element.offsetLeft, top: element.offsetTop };
    }
    record.opacity = opacityProduct(element, opacities);
    const radii = resolvedRadii(record);
    if (sizeChanged || radii.some((r, i) => r !== record.radii[i])) {
      record.radii = radii;
      record.shapes = null;
    }
    record.measured = true;
  };

  const materialOf = (record: SurfaceRecord): Material => {
    const kind = record.options.material ?? material;
    const look = lookOf(record);
    const width = Math.round(record.size.width);
    const height = Math.round(record.size.height);
    // Variables follow the theme, so a tint like `var(--accent)` is resolved each frame.
    const tint = record.options.tint ? resolveColor(record.options.tint, record.element) : null;
    const { floating, overhang, lensHeight, shadowLift } = record.options;
    const adapts = adaptsOf(record);
    const { mix, shown, tone } = record.adapt;
    const levels = adapts ? shown : null;
    const flipping = adapts && adaptInputOf(record.adaptParent ?? record).flips;
    const levelsKey = levels
      ? `${levels.luma.toFixed(3)},${levels.contrast.toFixed(3)},${levels.bright.toFixed(3)},${levels.detail.toFixed(3)}`
      : "";
    const key = `${kind}|${String(tintAmount)}|${look}|${width}|${height}|${tint?.join(",") ?? ""}|${floating}|${flipping ? mix.toFixed(3) : ""}|${levelsKey}|${tone}|${shadowLift.toFixed(3)}`;
    if (!record.material || key !== record.materialKey) {
      const resolve = (appearance: Appearance) =>
        resolveMaterial({
          kind,
          appearance,
          width,
          height,
          tint,
          floating,
          tintAmount,
          shadowLift,
        });
      // A small regular surface shows the glass its backdrop calls for, cross-fading on a flip.
      const base = flipping ? mixMaterials(resolve("light"), resolve("dark"), mix) : resolve(look);
      record.material = adaptMaterial(base, levels, tone);
      record.materialKey = key;
      // The bleed is sized for the deepest shadow the surface can adapt to, so it doesn't change
      // (and resize the canvas) as the shadow follows the backdrop.
      // A surface whose shadow can lift to a floating one keeps room for it all along.
      // Once lifted, keep the room: the shadow falls back at the end of a close (a spring that
      // dips past zero and back), and resizing the canvas each time it does makes it flash.
      if (record.options.shadowLift > 0) record.lifted = true;
      const roomy = record.lifted
        ? resolveMaterial({
            kind,
            appearance: look,
            width,
            height,
            tint,
            floating: true,
            tintAmount,
          })
        : base;
      const deepest = adapts
        ? adaptMaterial(roomy, { luma: 0, contrast: 1, bright: 0, detail: 1 }, tone)
        : roomy;
      record.reach =
        record.options.bleed ?? materialReach(deepest, lensHeight) + Math.ceil(overhang);
    }
    return record.material;
  };

  const shapesOf = (record: SurfaceRecord): readonly Shape[] => {
    if (record.shapes) return record.shapes;
    const extra: Shape[] = [];
    for (const layer of record.layers.values()) extra.push(...layer);
    const hasBody = extra.some((s) => s.role === "body");
    const smoothing = record.options.smoothing;
    const body: Shape[] =
      record.options.body && !hasBody
        ? [
            {
              role: "body",
              rect: { x: 0, y: 0, width: record.size.width, height: record.size.height },
              radii: record.radii,
              smoothing,
              lift: 0,
              magnify: 1,
              alpha: 1,
              merge: 0,
              tint: null,
              light: 0,
            },
          ]
        : [];
    record.shapes = [
      ...body,
      ...extra.map((s) => (s.smoothing === undefined ? { ...s, smoothing } : s)),
    ];
    return record.shapes;
  };

  const writes: (() => void)[] = [];
  /** How far canvases reached past the page's right and bottom edges in the last frame, px. */
  let overhang = 0;
  let overhangBottom = 0;

  // Specular glass: one light shared by the window, followed while any surface asks for it.
  let lightSource: ReturnType<typeof subscribeLight> | null = null;
  let lightTurning = false;
  let lastDt = 1 / 60;
  const syncLight = () => {
    const wanted = [...surfaces.values()].some(specularOf);
    if (wanted && !lightSource) lightSource = subscribeLight(window, () => scene.requestFrame());
    else if (!wanted && lightSource) {
      lightSource.release();
      lightSource = null;
    }
  };

  const draw = (now: number, dt: number): boolean => {
    lastDt = dt;
    lightTurning = false;
    // Motion first: callbacks may write styles that the measurement then reads.
    let stillMoving = false;
    for (const callback of animations) {
      try {
        if (callback(now, dt)) stillMoving = true;
      } catch (thrown) {
        console.error(thrown);
      }
    }
    moving = stillMoving;
    dirty = false;
    // Before the engine has loaded, motion still runs; there is just nothing to draw with yet.
    if (error || destroyed || !client || !capture) return false;

    if (ranksDirty) {
      ranksDirty = false;
      const ranks = rankSurfaces([...surfaces.keys()].filter((element) => element.isConnected));
      for (const record of surfaces.values()) record.rank = ranks.get(record.element) ?? 0;
    }

    // Motion moves elements too, so a frame with motion measures everything.
    // So do CSS animations and transitions that move surfaces (a popup scaling in): the glass
    // must sample where the surface is in this frame, not where it was when they started.
    const all = measureAll || stillMoving || activity.active;
    measureAll = false;
    telemetry.time(TelemetryCounter.measure, () => {
      const opacities = new Map<Element, number>();
      for (const record of surfaces.values())
        if (all || !record.measured) measure(record, opacities);
    });

    // Adapting to the backdrop: ease readings in, resolve tones, run flips. Glass inside glass
    // (a button on a toolbar) takes the tone and flip of the glass it sits on, as symbols on
    // glass follow their glass; it keeps its own readings for dimming, shadow and frost.
    const adapted = new Set<SurfaceRecord>();
    const adapt = (record: SurfaceRecord) => {
      if (adapted.has(record)) return;
      adapted.add(record);
      const parentElement = record.element.parentElement?.closest("[data-lg-surface]");
      const parent = parentElement instanceof HTMLElement ? surfaces.get(parentElement) : undefined;
      record.adaptParent = parent?.visible && adaptsOf(parent) ? parent : null;
      if (record.adaptParent) adapt(record.adaptParent);
      const input = adaptInputOf(record);
      if (!adaptsOf(record)) {
        if (record.adapt.tone !== input.appearance || record.adapt.shown)
          record.adapt = initialAdapt(input.appearance);
      } else {
        const next = stepAdapt(record.adapt, input, dt, motionQuery.matches);
        const host = record.adaptParent;
        record.adapt = host
          ? { ...next.state, tone: host.adapt.tone, mix: host.adapt.mix }
          : next.state;
        if (next.moving) moving = true;
      }
      const tone = adaptsOf(record) ? record.adapt.tone : input.appearance;
      if (tone !== record.tone) {
        record.tone = tone;
        writes.push(() => {
          record.element.setAttribute("data-lg-tone", tone);
          // Label colors may follow the tone; what the capture holds of them must too.
          capture?.invalidate(record.element);
          for (const listener of record.toneListeners) listener(tone);
        });
      }
    };
    for (const record of surfaces.values()) if (record.visible) adapt(record);

    restartCaptureIfBackdropChanged();
    capture.flush();
    const scroll = capture.scrollDeltas();
    lastScroll = scroll;

    const frames: SurfaceFrame[] = [];
    const page = doc.documentElement;
    // Canvases reach past their surfaces; near the right or bottom edge of the page that would
    // make it scroll. When the page's overflow on an axis is no more than what canvases added
    // last frame, it is theirs, and their sides on that axis are trimmed to the page's size.
    const trimRight = page.scrollWidth - page.clientWidth <= overhang + 1;
    const trimBottom = page.scrollHeight - page.clientHeight <= overhangBottom + 1;
    let reached = 0;
    let reachedBottom = 0;
    for (const record of surfaces.values()) {
      // Glass another part draws for a while (a menu's button while it morphs) is hidden.
      const hidden = record.element.hasAttribute("data-lg-hidden");
      if (!record.visible || hidden) {
        if ((hidden || record.host === "sibling") && record.canvas.style.display !== "none") {
          writes.push(() => (record.canvas.style.display = "none"));
          // Shown again, the canvas is placed and shown afresh.
          record.canvasKey = "";
        }
        continue;
      }
      let surfaceMaterial = materialOf(record);
      if (specularOf(record)) {
        const s = record.screen;
        const turn = approachAngle(
          record.lightAngle,
          lightAngle(lightSource?.light ?? {}, s.x + s.width / 2, s.y + s.height / 2),
          lastDt,
        );
        record.lightAngle = turn.angle;
        if (turn.moving) lightTurning = true;
        surfaceMaterial = { ...surfaceMaterial, lightAngle: Math.round(turn.angle * 1000) / 1000 };
      }
      const reach = record.reach;
      const scaleX = record.size.width > 0 ? record.screen.width / record.size.width : 1;
      const scaleY = record.size.height > 0 ? record.screen.height / record.size.height : 1;
      let right = reach;
      let bottom = reach;
      if (record.style?.position !== "fixed") {
        const room = (page.clientWidth - (record.screen.x + record.screen.width)) / (scaleX || 1);
        if (trimRight) right = Math.min(reach, Math.max(0, Math.floor(room)));
        reached = Math.max(reached, (reach - Math.max(0, room)) * scaleX);
        const below =
          (page.clientHeight - (record.screen.y + record.screen.height)) / (scaleY || 1);
        if (trimBottom) bottom = Math.min(reach, Math.max(0, Math.floor(below)));
        reachedBottom = Math.max(reachedBottom, (reach - Math.max(0, below)) * scaleY);
      }
      const bleed: Bleed = [reach, right, bottom, reach];
      if (bleed.some((value, index) => value !== record.bleed[index])) record.bleed = bleed;
      frames.push({
        id: record.id,
        rank: record.rank,
        screen: record.screen,
        size: record.size,
        shapes: shapesOf(record),
        material: surfaceMaterial,
        opacity: record.opacity,
        bleed: record.bleed,
        labelsInGlass: record.options.labelsInGlass,
      });
      const { canvas, element, host } = record;
      const geometry = canvasGeometry(
        record.size,
        record.border,
        record.bleed,
        host,
        record.offset,
      );
      const mirrored = record.style ? siblingStyles(record.style, record.size, record.bleed) : null;
      const key = `${host},${geometry.left},${geometry.top},${geometry.width},${geometry.height},${mirrored ? Object.values(mirrored).join(",") : ""}`;
      const misplaced =
        host === "child"
          ? canvas.parentNode !== element || element.firstChild !== canvas
          : canvas.nextSibling !== element;
      if (key !== record.canvasKey || misplaced) {
        const placed = record.canvasKey !== "" && !misplaced && canvas.style.display !== "none";
        const sized =
          record.canvasKey.split(",").slice(1, 5).join(",") !==
          `${geometry.left},${geometry.top},${geometry.width},${geometry.height}`;
        record.canvasKey = key;
        const place = () => {
          canvas.style.left = `${geometry.left}px`;
          canvas.style.top = `${geometry.top}px`;
          canvas.style.width = `${geometry.width}px`;
          canvas.style.height = `${geometry.height}px`;
        };
        writes.push(() => {
          if (misplaced) {
            placeCanvas(canvas, element, host);
            if (host === "child") resetSiblingStyles(canvas);
          }
          if (mirrored) Object.assign(canvas.style, mirrored);
          canvas.style.display = "";
          // A canvas already showing a frame keeps its box until the frame for the new box is
          // presented; a new or re-shown one takes it at once.
          if (placed && sized) {
            const dpr = window.devicePixelRatio || 1;
            record.pendingGeometry = {
              width: Math.min(8192, Math.max(1, Math.ceil(geometry.width * dpr))),
              height: Math.min(8192, Math.max(1, Math.ceil(geometry.height * dpr))),
              polls: 0,
              write: place,
            };
            if (!geometryPoll) geometryPoll = requestAnimationFrame(pollGeometry);
          } else {
            record.pendingGeometry = null;
            place();
          }
        });
      }
    }
    overhang = reached;
    overhangBottom = reachedBottom;

    sequence += 1;
    for (const record of surfaces.values())
      if (record.visible && record.options.labelsInGlass && record.labelsFrom === 0)
        record.labelsFrom = sequence;
    client.frame({
      sequence,
      time: now,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
      scroll,
      surfaces: frames,
    });
    // Layout writes only after everything was read and posted.
    for (const write of writes.splice(0)) write();
    // Highlights still easing towards the light keep frames coming.
    if (lightTurning) moving = true;
    return true;
  };

  // ------------------------------------------------------------------------------------------
  // Fallback
  // ------------------------------------------------------------------------------------------

  const fallback = (record: SurfaceRecord) => {
    record.element.removeAttribute("data-lg-labels");
    // Surfaces that only show extra shapes (a thumb's lens) have nothing to fall back to.
    if (record.options.body) record.element.setAttribute("data-lg-fallback", "");
  };

  function fail(message: string) {
    if (error || destroyed) return;
    error = message;
    console.warn(
      `Liquid Glass is unavailable, surfaces fall back to a translucent background: ${message}`,
    );
    pacer.destroy();
    capture?.destroy();
    for (const record of surfaces.values()) fallback(record);
  }

  // ------------------------------------------------------------------------------------------
  // Surfaces
  // ------------------------------------------------------------------------------------------

  const addSurface = (
    element: HTMLElement,
    surfaceOptions: SurfaceOptions = {},
  ): GlassSurfaceHandle => {
    const existing = surfaces.get(element);
    if (existing) {
      existing.handle.update(surfaceOptions);
      return existing.handle;
    }
    const id = nextId++;
    const canvas = createSurfaceCanvas(element);
    // Positioned, so the canvas is placed against it; undone on removal.
    const madeRelative = getComputedStyle(element).position === "static";
    if (madeRelative) element.style.position = "relative";
    element.style.isolation = "isolate";
    element.setAttribute("data-lg-surface", "");
    element.setAttribute("data-lg-appearance", surfaceOptions.appearance ?? appearance());
    // Until the first reading arrives (a frame or two), the tone is the appearance.
    const startTone = surfaceOptions.appearance ?? appearance();
    element.setAttribute("data-lg-tone", startTone);

    // The handle reads the record lazily; both are created before anything calls it.
    const handle: GlassSurfaceHandle = {
      id,
      element,
      get size() {
        return record.size;
      },
      get radii() {
        return record.radii;
      },
      get smoothing() {
        return record.options.smoothing;
      },
      get tone() {
        return record.tone;
      },
      onTone(listener) {
        record.toneListeners.add(listener);
        return () => {
          record.toneListeners.delete(listener);
        };
      },
      setShapes(shapes, layer = "") {
        if (shapes.length === 0) record.layers.delete(layer);
        else record.layers.set(layer, shapes);
        record.shapes = null;
        scene.requestFrame();
      },
      update(next) {
        const o = record.options;
        if ("radius" in next) {
          o.radius = next.radius ?? null;
          record.cssRadii = null;
          record.measured = false;
        }
        if ("smoothing" in next) o.smoothing = smoothingOf(next.smoothing);
        if ("material" in next) o.material = next.material ?? null;
        if ("tint" in next) o.tint = next.tint ?? null;
        if ("bleed" in next) o.bleed = next.bleed ?? null;
        if ("overhang" in next) o.overhang = next.overhang ?? 0;
        if ("lensHeight" in next) o.lensHeight = next.lensHeight ?? 0;
        if ("floating" in next) o.floating = next.floating ?? false;
        if ("appearance" in next) {
          o.appearance = next.appearance ?? null;
          element.setAttribute("data-lg-appearance", lookOf(record));
        }
        if ("body" in next) o.body = next.body ?? true;
        if ("adaptive" in next) o.adaptive = next.adaptive ?? null;
        if ("shadowLift" in next) o.shadowLift = next.shadowLift ?? 0;
        if ("specular" in next) {
          o.specular = next.specular ?? null;
          syncLight();
        }
        if ("labelsInGlass" in next && (next.labelsInGlass ?? false) !== o.labelsInGlass) {
          o.labelsInGlass = next.labelsInGlass ?? false;
          record.labelsShown = false;
          record.labelsFrom = 0;
          element.removeAttribute("data-lg-labels");
          capture?.invalidate(element);
        }
        record.material = null;
        record.shapes = null;
        scene.requestFrame();
      },
      remove() {
        if (!surfaces.has(element)) return;
        surfaces.delete(element);
        syncLight();
        recordsById.delete(id);
        record.toneListeners.clear();
        resizes.unobserve(element);
        if (!error && !destroyed) client?.detach(id);
        canvas.remove();
        element.style.isolation = "";
        if (madeRelative) element.style.position = "";
        for (const name of [
          "data-lg-surface",
          "data-lg-labels",
          "data-lg-fallback",
          "data-lg-appearance",
          "data-lg-tone",
        ])
          element.removeAttribute(name);
        ranksDirty = true;
        if (!destroyed) capture?.invalidate(element);
        scene.requestFrame();
      },
    };
    const record: SurfaceRecord = {
      id,
      element,
      canvas,
      options: {
        radius: surfaceOptions.radius ?? null,
        smoothing: smoothingOf(surfaceOptions.smoothing),
        material: surfaceOptions.material ?? null,
        tint: surfaceOptions.tint ?? null,
        labelsInGlass: surfaceOptions.labelsInGlass ?? false,
        bleed: surfaceOptions.bleed ?? null,
        overhang: surfaceOptions.overhang ?? 0,
        lensHeight: surfaceOptions.lensHeight ?? 0,
        floating: surfaceOptions.floating ?? false,
        appearance: surfaceOptions.appearance ?? null,
        body: surfaceOptions.body ?? true,
        adaptive: surfaceOptions.adaptive ?? null,
        shadowLift: surfaceOptions.shadowLift ?? 0,
        specular: surfaceOptions.specular ?? null,
      },
      lightAngle: RESTING_ANGLE,
      lifted: surfaceOptions.liftable ?? false,
      adapt: { ...initialAdapt(surfaceOptions.appearance ?? appearance()), tone: startTone },
      tone: startTone,
      adaptParent: null,
      toneListeners: new Set(),
      layers: new Map(),
      shapes: null,
      cssRadii: null,
      radii: capsuleRadii({ width: 0, height: 0 }),
      size: { width: 0, height: 0 },
      border: { left: 0, top: 0 },
      screen: { x: 0, y: 0, width: 0, height: 0 },
      opacity: 1,
      visible: false,
      measured: false,
      material: null,
      materialKey: "",
      reach: 0,
      bleed: [0, 0, 0, 0],
      host: "child",
      offset: { left: 0, top: 0 },
      style: null,
      canvasKey: "",
      pendingGeometry: null,
      labelsShown: false,
      labelsFrom: 0,
      rank: 0,
      handle,
    };

    surfaces.set(element, record);
    syncLight();
    recordsById.set(id, record);
    resizes.observe(element, { box: "border-box" });
    ranksDirty = true;
    if (error) fallback(record);
    else {
      // Before the engine has loaded, `startEngine` attaches every surface there is.
      client?.attach(id, canvas);
      // Its content now belongs to the surface.
      capture?.invalidate(element);
    }
    scene.requestFrame();
    return handle;
  };

  // ------------------------------------------------------------------------------------------
  // The scene
  // ------------------------------------------------------------------------------------------

  const scene: GlassScene = {
    root,
    telemetry,
    get material() {
      return material;
    },
    get appearance() {
      return appearance();
    },
    get reducedMotion() {
      return motionQuery.matches;
    },
    controllers: gesture,
    get error() {
      return error;
    },
    addSurface,
    surfaceOf(element) {
      return element instanceof HTMLElement ? (surfaces.get(element)?.handle ?? null) : null;
    },
    animate(callback) {
      animations.add(callback);
      scene.requestFrame();
      return () => {
        animations.delete(callback);
      };
    },
    addSource(element) {
      if (capture) return capture.addSource(element);
      if (destroyed || error) return () => {};
      const source = { element, stop: null as (() => void) | null };
      pendingSources.add(source);
      return () => {
        pendingSources.delete(source);
        source.stop?.();
      };
    },
    invalidate(element) {
      capture?.invalidate(element);
      scene.requestFrame();
    },
    requestFrame() {
      if (destroyed || error) return;
      dirty = true;
      pacer.wake();
    },
    configure(next) {
      if (next.material !== undefined) material = next.material;
      if ("tintAmount" in next) tintAmount = next.tintAmount;
      if (next.appearance !== undefined) appearanceOption = next.appearance;
      if (next.telemetry !== undefined) telemetry.setEnabled(next.telemetry);
      if (next.adaptive !== undefined) adaptiveOption = next.adaptive;
      if (next.specular !== undefined) {
        specularOption = next.specular;
        syncLight();
      }
      for (const record of surfaces.values()) {
        record.material = null;
        record.element.setAttribute("data-lg-appearance", lookOf(record));
      }
      if (next.backdrop !== backdropOption && "backdrop" in next) {
        backdropOption = next.backdrop;
        // The backdrop travels with every patch, so the capture starts over with the new one.
        restartCaptureIfBackdropChanged(true);
      }
      scene.requestFrame();
    },
    createDragPad(element, handlers) {
      if (!gesture) return null;
      return createDragPad(element, handlers, {
        addSampler(read) {
          samplers.add(read);
          return () => samplers.delete(read);
        },
        wake: () => pacer.wake(),
        telemetry,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // Removing the current entry while iterating a Map is safe.
      for (const record of surfaces.values()) record.handle.remove();
      pacer.destroy();
      if (!error) capture?.destroy();
      unsubscribePresented?.();
      unsubscribeBackdrop?.();
      client?.dispose();
      mutations.disconnect();
      resizes.disconnect();
      activity.destroy();
      abort.abort();
      colorScheme.removeEventListener("change", onScheme);
      boost?.remove();
      fresh?.remove();
      animations.clear();
      samplers.clear();
    },
  };

  pacer.wake();
  return scene;
}

function sameFloats(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
