/**
 * Controllers: 120 Hz finger positions on iOS.
 *
 * iOS Safari delivers touch and pointer events at 60 Hz, but a native scroller's position moves
 * at the display's 120 Hz and can be read at any time. So a draggable glass control lays an
 * invisible, endless native scroller (a pad) over itself; the finger scrolls it, and the frame
 * loop reads its position twice per 120 Hz frame. Moving the finger right scrolls the content
 * left, so the finger is at `origin − scrolled`.
 *
 * - DPR-scaled: the scroller is laid out `dpr` times larger and scaled down by the same factor,
 *   so one scroll unit is one device pixel and positions have sub-point precision.
 * - Endless: 400 000 units of content, re-centred in multiples of 120 units whenever the pad has
 *   been idle for 150 ms, with the jump folded into an offset so readings stay continuous.
 * - Momentum is stopped on release by hiding overflow for one frame, unless the control asks to
 *   coast, in which case native momentum keeps feeding positions until the scroller settles.
 *
 * Touches only: mouse and pen events pass through to the control's own pointer handling.
 */

import { TelemetryCounter } from "../telemetry";
import type { Telemetry } from "../telemetry";
import { padClass, padScrollerClass } from "../styles";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface DragPadHandlers {
  /** A finger went down at `point` (the host's border-box px). Return false to ignore it. */
  down(point: Point): boolean;
  /** The finger moved; called from the frame loop, up to twice per 120 Hz frame. */
  move(point: Point): void;
  /** The finger lifted (`commit`) or the touch was cancelled. */
  up(commit: boolean): void;
  /** With this, native momentum continues after the lift and keeps reporting positions. */
  coast?(point: Point): void;
  /** Momentum came to rest (only with `coast`). */
  rest?(): void;
}

export interface DragPad {
  readonly element: HTMLElement;
  /** Whether a finger is on the pad. */
  readonly active: boolean;
  destroy(): void;
}

/** Scroll content extent, re-centre period and idle time. */
export const pad = { extent: 4e5, period: 120, idleMs: 150, haltFrames: 1 } as const;

export interface DragPadEnvironment {
  /** Run `read` at the start of every loop tick until the returned function is called. */
  addSampler(read: () => void): () => void;
  /** Make sure the loop is running. */
  wake(): void;
  readonly telemetry: Telemetry;
}

/** Hide overflow for a few frames: the one way to stop native momentum where it is. */
export function haltScroll(scroller: HTMLElement, frames: number): void {
  const left = scroller.scrollLeft;
  const top = scroller.scrollTop;
  scroller.style.overflow = "hidden";
  scroller.scrollLeft = left;
  scroller.scrollTop = top;
  const wait = (n: number) =>
    requestAnimationFrame(() => {
      if (n > 1) wait(n - 1);
      else scroller.style.overflow = "";
    });
  wait(frames);
}

export function createDragPad(
  host: HTMLElement,
  handlers: DragPadHandlers,
  env: DragPadEnvironment,
): DragPad {
  const container = document.createElement("div");
  container.className = padClass;
  container.setAttribute("aria-hidden", "true");
  container.setAttribute("data-lg-ignore", "");
  const scroller = document.createElement("div");
  scroller.className = padScrollerClass;
  const content = document.createElement("div");
  content.style.width = `${pad.extent}px`;
  content.style.height = `${pad.extent}px`;
  scroller.append(content);
  container.append(scroller);
  host.append(container);

  const middle = pad.extent / 2 - ((pad.extent / 2) % pad.period);
  const abort = new AbortController();
  const listen = { passive: true, signal: abort.signal } as const;

  let unit = 1;
  let offsetX = 0;
  let offsetY = 0;
  let origin: { x: number; y: number; left: number; top: number } | null = null;
  let coasting = false;
  let touches = 0;
  let timer = 0;
  let sampled = { left: 0, top: 0 };
  let stopSampling: (() => void) | null = null;
  let on = false;

  const left = () => scroller.scrollLeft + offsetX;
  const top = () => scroller.scrollTop + offsetY;
  const position = (): Point | null =>
    origin
      ? { x: origin.x - (left() - origin.left) / unit, y: origin.y - (top() - origin.top) / unit }
      : null;

  // Size the scroller in device pixels and scale it back down to the host's size.
  const size = () => {
    unit = Math.max(1, window.devicePixelRatio || 1);
    scroller.style.width = `${host.clientWidth * unit}px`;
    scroller.style.height = `${host.clientHeight * unit}px`;
    scroller.style.transform = `scale(${1 / unit})`;
  };

  /** Jump back near the middle in whole periods, folding the jump into the offsets. */
  const recentre = (force = false) => {
    if (!force && (touches > 0 || origin || coasting)) return;
    const step = (value: number) => {
      const from = value - middle;
      return from - (from % pad.period);
    };
    const dx = step(scroller.scrollLeft);
    const dy = step(scroller.scrollTop);
    if (dx === 0 && dy === 0) return;
    const before = { left: scroller.scrollLeft, top: scroller.scrollTop };
    scroller.scrollLeft = before.left - dx;
    scroller.scrollTop = before.top - dy;
    offsetX += before.left - scroller.scrollLeft;
    offsetY += before.top - scroller.scrollTop;
  };

  const idleSoon = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (coasting) {
        coasting = false;
        stopSampling?.();
        stopSampling = null;
        origin = null;
        handlers.rest?.();
      }
      recentre();
    }, pad.idleMs);
  };

  const read = () => {
    const point = position();
    env.telemetry.tick(TelemetryCounter.inputSample);
    if (!point) return;
    const now = { left: left(), top: top() };
    if (now.left === sampled.left && now.top === sampled.top) return;
    sampled = now;
    env.telemetry.tick(TelemetryCounter.inputUnique);
    if (coasting) handlers.coast?.(point);
    else handlers.move(point);
  };

  const begin = (point: Point) => {
    window.clearTimeout(timer);
    coasting = false;
    if (!origin) recentre(true);
    origin = { x: point.x, y: point.y, left: left(), top: top() };
    sampled = { left: origin.left, top: origin.top };
    stopSampling ??= env.addSampler(read);
    env.wake();
  };

  const end = (commit: boolean) => {
    if (!on) return;
    on = false;
    handlers.up(commit);
    if (commit && handlers.coast) {
      // Keep reading while native momentum carries on; `idleSoon` ends it.
      coasting = true;
      idleSoon();
      return;
    }
    origin = null;
    stopSampling?.();
    stopSampling = null;
    haltScroll(scroller, pad.haltFrames);
    idleSoon();
  };

  const localPoint = (event: PointerEvent): Point => {
    const rect = host.getBoundingClientRect();
    const sx = host.offsetWidth / (rect.width || 1);
    const sy = host.offsetHeight / (rect.height || 1);
    return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
  };

  scroller.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "touch" || on) return;
      const point = localPoint(event);
      if (!handlers.down(point)) return;
      on = true;
      begin(point);
    },
    { signal: abort.signal },
  );
  // Native panning cancels the pointer stream, so the end of a touch comes from touch events.
  const touchEnd = (event: TouchEvent) => {
    touches = event.targetTouches.length;
    if (touches === 0) {
      end(event.type === "touchend");
      idleSoon();
    }
  };
  scroller.addEventListener(
    "touchstart",
    (event) => {
      touches = event.targetTouches.length;
      env.wake();
    },
    listen,
  );
  scroller.addEventListener("touchend", touchEnd, listen);
  scroller.addEventListener("touchcancel", touchEnd, listen);
  scroller.addEventListener(
    "scroll",
    () => {
      idleSoon();
      env.wake();
    },
    listen,
  );
  // A long press on the pad must not open the callout or a context menu.
  scroller.addEventListener("contextmenu", (event) => event.preventDefault(), {
    signal: abort.signal,
  });

  const resize = new ResizeObserver(size);
  resize.observe(host);
  let resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onResolution = () => {
    resolution.removeEventListener("change", onResolution);
    resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    resolution.addEventListener("change", onResolution);
    size();
  };
  resolution.addEventListener("change", onResolution);

  size();
  recentre(true);

  return {
    element: container,
    get active() {
      return on;
    },
    destroy() {
      abort.abort();
      resize.disconnect();
      resolution.removeEventListener("change", onResolution);
      window.clearTimeout(timer);
      stopSampling?.();
      container.remove();
    },
  };
}
