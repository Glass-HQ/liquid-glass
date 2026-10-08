import { Spring, settleTime, springs } from "../core/spring.js";
import type { SpringOptions } from "../core/spring.js";
import type { GlassRadius } from "../core/shape.js";
import { contentReveal, morphDraw, morphShape, openingAxis, planMorph, radiusPixels, sourceConceal } from "../core/morph-path.js";
import type { Box, MorphEndpoints, MorphGeometry, MorphStop } from "../core/morph-path.js";
import type { GlassMotion, SurfaceAnimator } from "./interaction.js";
export { radiusPixels } from "../core/morph-path.js";

/** A shape an animation passes through, for its maps to be prepared ahead. */
export type LensWaypoint = MorphGeometry;
/** A prepared shape drawn in a box: stretched to the live outline, or fixed
 * where a traced union or an absorbed glass lies. */
export interface LensPlacement extends Box { shape: LensWaypoint }
/** One frame of an animated outline. */
export interface LensFrame extends Box {
  /** Pixels, or a capsule whose ends stay exact at every width. */
  radius: number | "capsule";
  /** The material to draw: the two prepared shapes around this frame,
   * blended by `mix`. Absent while nothing should be drawn yet. */
  draw?: { a: LensPlacement; b?: LensPlacement; mix: number };
  /** Glass this frame draws in its place, and how much of it. */
  absorbs?: { element: Element; weight: number };
}
export interface GeometryAnimator extends SurfaceAnimator {
  /** The animated outline, or undefined when the surface rests at its layout box. */
  geometry(): LensFrame | undefined;
  /** Shapes along the current animation's path. A new array starts a new path. */
  waypoints(): readonly LensWaypoint[];
  /** Material opacity while materializing or leaving a non-glass source. */
  opacity(): number;
  /** Waiting for the maps of its path before moving. */
  pending(): boolean;
}
/** How a surface relates to the glass it grows out of. */
export type GlassMorph = "become" | "detach";
export interface GeometryMotionOptions {
  /** Grow out of this element on entry and shrink back into it on exit. */
  from?: () => Element | null | undefined;
  /** `become`: the source's glass is this surface, and withdraws its own
   * content while the surface is present. `detach`: this surface leaves the
   * source's glass as a drop, joined by a liquid neck until they part.
   * Default: a glass source is become; a source inside glass is detached from. */
  morph?: GlassMorph;
  /** Spring between layout boxes when the surface moves or resizes within its parent. */
  layout?: boolean;
  radius: GlassRadius;
  motion: () => GlassMotion;
  /** Whether a shape's maps are ready to draw. An entrance waits briefly for its path. */
  prepared?: (shape: LensWaypoint) => boolean;
  /** How far a detaching drop stays joined to its glass by a liquid neck, in
   * pixels. `0` lets it grow as a plain shape, with no union to trace. */
  neck?: number;
  /** Grow out of the source when attached. `false` only runs the exit back
   * into it, for an element that was already in place. Default: true. */
  enter?: boolean;
}
/** Longest an entrance waits for the maps of its path. */
const maxWait = 140;
const frame = 1 / 60;
const sourceCount = new WeakMap<Element, number>();
/** Mark glass whose material has become another surface; its content follows `--lg-morph-source`. */
function hold(glass: Element): () => void {
  if (!(glass instanceof HTMLElement)) return () => {};
  sourceCount.set(glass, (sourceCount.get(glass) ?? 0) + 1);
  glass.dataset.glassMorphSource = "";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (sourceCount.get(glass) ?? 1) - 1;
    if (count > 0) sourceCount.set(glass, count);
    else { sourceCount.delete(glass); delete glass.dataset.glassMorphSource; glass.style.removeProperty("--lg-morph-source"); }
  };
}
function rectOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}
const declaredRadius = (element: Element): GlassRadius => {
  const value = element.getAttribute("data-lg-container-radius");
  if (value === "capsule" || value === "circle") return value;
  const number = Number(value);
  return Number.isFinite(number) && value !== null ? number : element.classList.contains("lg-surface") ? 8 : 0;
};
const layoutSize = (element: Element) => ({ width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight });
const moved = (a: Box, b: Box) => Math.hypot(a.left - b.left, a.top - b.top) > 1 || resized(a, b);
const resized = (a: Box, b: Box) => Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5;
interface Plan {
  endpoints: MorphEndpoints;
  stops: MorphStop[];
  shapes: LensWaypoint[];
  /** Glass drawn as part of the path: the become source, or the glass a drop leaves. */
  glass?: Element;
  /** Where that glass was when the path was planned; fixed stops follow it. */
  glassRect?: Box;
  /** Offsets layout plans from their offset parent to the viewport each frame. */
  layout?: { x: number; y: number; width: number; height: number };
}

/** Animate a surface's optical outline independently of its layout box.
 * Entry grows the glass out of a source shape along a planned path; Base UI
 * `data-ending-style` runs the same path back before the popup unmounts, so
 * an exit needs no new maps. Each frame names the two prepared shapes around
 * it, which the scene blends, so the material never jumps between maps.
 * Layout changes spring along a path from the previous outline. Content is
 * clipped by the outline, so the glass opens to reveal it rather than
 * scaling it. */
export function attachGeometryMotion(element: HTMLElement, options: GeometryMotionOptions): GeometryAnimator {
  // A slight bounce keeps the return from trailing off; the last percent is never shown.
  const settle: SpringOptions = { duration: 0.32, bounce: 0.1 };
  const progress = new Spring(0, springs.morph);
  // Reduced motion materializes in place: only the content fades.
  const fade = new Spring(1, springs.glow);
  let source: Element | null = null, glass: Element | null = null, morph: GlassMorph = "become";
  let sourceRect: Box = { left: 0, top: 0, width: 0, height: 0 };
  let release: (() => void) | undefined;
  let holding: Animation | undefined;
  let previous = 0, now = 0;
  let plan: Plan | undefined;
  let lastFrame: LensFrame | undefined;
  let morphing = false, exiting = false, materialize = false;
  /** Waiting for the path's maps before the glass starts to move. */
  let waiting = 0;
  // After an exit the popup waits, invisible at its source, to be unmounted.
  let closed = false;
  let box: { x: number; y: number; width: number; height: number } | undefined;
  const ownRadius = (width: number, height: number): number | "capsule" =>
    options.radius === "capsule" ? "capsule" : radiusPixels(options.radius, width, height);
  const dpr = () => Math.min(devicePixelRatio || 1, 2);

  /** Resolve the source, the glass it belongs to, and how this surface relates to it. */
  const resolve = () => {
    source = options.from?.() ?? null;
    const own = source?.classList.contains("lg-surface") ? source : null;
    const enclosing = source?.parentElement?.closest(".lg-surface") ?? null;
    morph = options.morph ?? (own ? "become" : "detach");
    // A drop leaves the glass its source is, or the glass its source sits in.
    glass = morph === "become" ? own : own ?? (enclosing && !enclosing.contains(element) ? enclosing : null);
    if (morph === "become" && glass) source = glass;
    if (source?.isConnected) sourceRect = rectOf(source);
    materialize = !source?.isConnected || !sourceRect.width || !sourceRect.height;
  };
  /** Plan the path from the source to the surface's current placement. */
  const planEntry = () => {
    const target = rectOf(element);
    const to = layoutSize(element);
    if (!to.width || !to.height || materialize || !source) { plan = undefined; return; }
    const endpoints: MorphEndpoints = {
      from: { ...sourceRect }, fromRadius: declaredRadius(source),
      to: target, toRadius: options.radius, along: openingAxis(sourceRect, target),
    };
    const drop = morph === "detach" && glass?.isConnected ? (() => {
      const rect = rectOf(glass!), size = layoutSize(glass!);
      return { ...rect, radius: declaredRadius(glass!), layoutWidth: size.width || rect.width, layoutHeight: size.height || rect.height };
    })() : undefined;
    const neck = options.neck ?? 18;
    const stops = planMorph(endpoints, neck > 0 ? drop : undefined, { dpr: 1, restDpr: dpr(), neck, stops: neck > 0 ? 14 : 10 });
    // The resting endpoints use layout sizes, which the maps are keyed by.
    if (morph === "become" && glass) { const size = layoutSize(glass); if (size.width && size.height) Object.assign(stops[0]!.shape, { width: size.width, height: size.height }); }
    Object.assign(stops.at(-1)!.shape, { width: to.width, height: to.height });
    const joined = neck > 0 && drop ? glass ?? undefined : undefined;
    plan = { endpoints, stops, shapes: stops.map((stop) => stop.shape), glass: morph === "become" ? glass ?? undefined : joined, glassRect: joined && drop ? { left: drop.left, top: drop.top, width: drop.width, height: drop.height } : undefined };
  };
  /** The path can start once its maps are ready, or, for a path of plain
   * shapes, once its destination's map is: stretched, it stands in for the
   * shapes on the way while theirs arrive, so a menu seen before opens at once. */
  const ready = () => {
    if (!plan || !options.prepared) return true;
    if (plan.stops.every((stop) => options.prepared!(stop.shape))) return true;
    return !plan.stops.some((stop) => stop.shape.outline) && options.prepared(plan.stops.at(-1)!.shape);
  };
  function enter() {
    if (options.motion() === "none") return;
    resolve();
    if (morph === "become" && glass && !materialize) { release?.(); release = hold(glass); }
    morphing = true;
    exiting = false;
    closed = false;
    const still = materialize || options.motion() === "reduced";
    progress.configure(springs.morph).jump(still ? 1 : 0);
    if (still) { plan = undefined; waiting = 0; }
    else { planEntry(); waiting = now || performance.now(); }
    fade.jump(still ? 0 : 1).target = 1;
    element.dataset.glassMorph = "enter";
    element.style.setProperty("--lg-morph", "0");
  }
  function exit() {
    if (options.motion() === "none") return;
    if (!morphing) {
      // Return to the shape it came from, even if the trigger lost its open state.
      resolve();
      if (!materialize && options.motion() !== "reduced") {
        if (morph === "become" && glass) release ??= hold(glass);
        // The popup may have moved or resized while open; a source that only
        // moved, such as a trigger settling after its press, keeps the planned
        // shapes and their prepared maps.
        if (!plan || moved(plan.endpoints.to, rectOf(element))) planEntry();
        else plan.endpoints.from = { ...sourceRect };
        progress.jump(1);
      } else plan = undefined;
    }
    morphing = true;
    exiting = true;
    waiting = 0;
    const still = !plan || materialize || options.motion() === "reduced";
    progress.configure(settle).target = still ? 1 : 0;
    fade.target = still ? 0 : 1;
    element.dataset.glassMorph = "exit";
    // Base UI keeps the popup mounted until its animations finish.
    const seconds = still ? settleTime(springs.glow, fade.value, 0, fade.velocity)
      : settleTime(settle, progress.value, 0, progress.velocity, 0.01);
    holding?.cancel();
    holding = element.animate([{}, {}], { duration: Math.max(16, seconds * 1000 + 40) });
  }
  function finish() {
    morphing = false;
    exiting = false;
    waiting = 0;
    holding = undefined;
    delete element.dataset.glassMorph;
    element.style.removeProperty("--lg-morph");
  }
  const observer = new MutationObserver(() => {
    const ending = element.hasAttribute("data-ending-style");
    if (ending && !exiting) exit();
    else if (!ending && exiting) {
      // Reopened mid-exit: run the same path forward from here.
      if (closed) { closed = false; if (morph === "become" && glass) release ??= hold(glass); }
      holding?.cancel();
      holding = undefined;
      exiting = false;
      morphing = true;
      progress.configure(springs.morph).target = 1;
      fade.target = 1;
      element.dataset.glassMorph = "enter";
    }
  });
  // Resolve the source on the first frame, once refs and placement have
  // settled; until then the content waits, hidden, for its glass.
  // Attached to an element already leaving: run the exit from its first frame.
  const leaving = Boolean(options.from) && element.hasAttribute("data-ending-style");
  let entering = Boolean(options.from) && options.enter !== false && !leaving && options.motion() !== "none";
  let placement: Box | undefined, waited = 0;
  if (options.from) observer.observe(element, { attributes: true, attributeFilter: ["data-ending-style"] });
  if (leaving && options.motion() !== "none") exit();
  if (entering) {
    element.dataset.glassMorph = "enter";
    element.style.setProperty("--lg-morph", "0");
  }
  /** Where a stop is drawn: stretched to the live outline, or fixed in its
   * own box, which follows the glass it was traced around. */
  const place = (stop: MorphStop, live: Box): LensPlacement => {
    if (!stop.box) return { shape: stop.shape, ...live };
    const planned = plan?.glassRect, current = planned && plan?.glass?.isConnected ? rectOf(plan.glass) : undefined;
    const dx = current && planned ? current.left - planned.left : 0, dy = current && planned ? current.top - planned.top : 0;
    return { shape: stop.shape, left: stop.box.left + dx, top: stop.box.top + dy, width: stop.box.width, height: stop.box.height };
  };
  const frameOf = (p: number, live: Box & { radius: number }): LensFrame => {
    const draw = plan ? morphDraw(plan.stops, p) : undefined;
    // A become source is replaced for the whole path; a drop's glass only while they are joined.
    const absorbed = !plan?.glass || !draw ? 0 : morph === "become" ? 1 : draw.absorb;
    return {
      ...live,
      draw: draw && { a: place(draw.a, live), b: draw.b && place(draw.b, live), mix: draw.mix },
      absorbs: absorbed > 0 && plan?.glass ? { element: plan.glass, weight: absorbed } : undefined,
    };
  };

  return {
    frame(at) {
      const dt = previous ? Math.min((at - previous) / 1000, 1 / 20) : frame;
      previous = at;
      now = at;
      if (entering) {
        // Placement can settle a frame after mount: plan from where it lands.
        const rect = rectOf(element);
        const stable = placement && Math.hypot(rect.left - placement.left, rect.top - placement.top) < 0.5;
        placement = rect;
        if (stable || ++waited > 3) {
          entering = false;
          if (!element.hasAttribute("data-ending-style")) enter();
          if (!morphing) finish();
        }
      }
      if (options.layout && !morphing) {
        // Layout boxes are relative to the offset parent, so scrolling and
        // ancestor movement never animate; only real layout changes do.
        const next = { x: element.offsetLeft, y: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
        if (box && next.width && next.height && options.motion() === "full" &&
          [next.x - box.x, next.y - box.y, next.width - box.width, next.height - box.height].some((d) => Math.abs(d) > 0.5)) {
          // Continue from the outline currently on screen, including mid-flight.
          const current = plan?.layout && lastFrame
            ? { left: lastFrame.left - plan.layout.x, top: lastFrame.top - plan.layout.y, width: lastFrame.width, height: lastFrame.height }
            : { left: box.x, top: box.y, width: box.width, height: box.height };
          const endpoints: MorphEndpoints = { from: current, fromRadius: ownRadius(current.width, current.height), to: { left: next.x, top: next.y, width: next.width, height: next.height }, toRadius: options.radius };
          const stops = planMorph(endpoints, undefined, { stops: 12, dpr: 1, restDpr: dpr() });
          plan = { endpoints, stops, shapes: stops.map((stop) => stop.shape), layout: next };
          progress.configure(springs.layout).jump(0).target = 1;
        }
        if (next.width && next.height) box = next;
      }
      if (waiting && (ready() || at - waiting > maxWait)) { waiting = 0; progress.target = 1; }
      progress.step(dt);
      fade.step(dt);
      const active = () => entering || morphing || waiting > 0 || !progress.settled || !fade.settled;
      // An exit is complete once the outline is back within 1% of its source.
      const returned = exiting && plan && !materialize && options.motion() === "full"
        && progress.value <= 0.012 && Math.abs(progress.velocity) <= 0.15;
      if (morphing && !waiting && (returned || (progress.settled && fade.settled))) {
        if (exiting) {
          morphing = false;
          closed = true;
          if (plan) progress.jump(0);
          // Owners that keep an element mounted for its exit, such as a
          // toolbar merging a cluster back, unmount it on this.
          element.dispatchEvent(new CustomEvent("glass:exited"));
        } else finish();
      }
      if (plan?.layout) {
        if (progress.settled && progress.value === 1) { plan = undefined; lastFrame = undefined; return active(); }
        const rect = rectOf(element), p = progress.value;
        const shape = morphShape(plan.endpoints, p);
        const layout = plan.layout;
        const live = { left: rect.left + shape.left - layout.x, top: rect.top + shape.top - layout.y, width: shape.width, height: shape.height, radius: shape.radius };
        // Plain layout shapes keep their own corners: capsules stay capsules.
        lastFrame = { ...frameOf(p, live), radius: ownRadius(shape.width, shape.height) };
        return true;
      }
      if (closed) {
        // Parked, invisible, at the source until the popup unmounts.
        lastFrame = undefined;
        return active();
      }
      if (morphing && plan) {
        if (source?.isConnected && !exiting) {
          // A popup that moves with its wobbling trigger keeps its planned
          // shapes and simply follows; only a resize plans again.
          const target = rectOf(element);
          if (resized(plan.endpoints.to, target)) { if (!waiting) { sourceRect = rectOf(source); planEntry(); if (!ready()) waiting = at; } }
          else if (moved(plan.endpoints.to, target)) plan.endpoints.to = target;
        }
        const p = progress.value;
        const shape = morphShape(plan.endpoints, p);
        // Content follows the glass: it appears once the outline has room for it.
        element.style.setProperty("--lg-morph", (contentReveal(p) * fade.value).toFixed(3));
        if (morph === "become" && glass instanceof HTMLElement) glass.style.setProperty("--lg-morph-source", sourceConceal(p).toFixed(3));
        lastFrame = frameOf(p, shape);
        return active();
      }
      if (morphing) {
        // Materializing in place: the resting outline fades.
        element.style.setProperty("--lg-morph", fade.value.toFixed(3));
        lastFrame = undefined;
        return active();
      }
      lastFrame = undefined;
      return active();
    },
    geometry: () => lastFrame,
    waypoints: () => plan?.shapes ?? [],
    pending: () => waiting > 0,
    opacity() {
      // Waiting for placement, or parked at the source after an exit.
      if (closed || entering) return 0;
      if (!morphing) return 1;
      if (!plan) return fade.value;
      // A bubble from a plain element condenses over its first moments instead of popping in.
      return plan.glass ? 1 : Math.min(1, Math.max(0, progress.value / 0.2));
    },
    dispose() {
      observer.disconnect();
      holding?.cancel();
      release?.();
      finish();
    },
  };
}
