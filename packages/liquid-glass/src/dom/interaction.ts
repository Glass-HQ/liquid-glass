import { Spring, springs } from "../core/spring.js";
import type { SpringOptions } from "../core/spring.js";

/** `full` follows the system: reduced motion always removes elasticity. */
export type GlassMotion = "full" | "reduced" | "none";

/** Resolve a requested motion level against the user's system preference. */
let reducedQuery: MediaQueryList | undefined;
export function resolveMotion(motion: GlassMotion | undefined): GlassMotion {
  if (motion === "none" || motion === "reduced") return motion;
  if (typeof matchMedia !== "function") return "full";
  reducedQuery ??= matchMedia("(prefers-reduced-motion: reduce)");
  return reducedQuery.matches ? "reduced" : "full";
}

export interface SurfaceAnimator {
  /** Advance to `now` before the scene samples geometry. Returns true while
   * the animation is in motion and needs the next frame. */
  frame(now: number): boolean | void;
  dispose(): void;
}

// The innermost interactive surface owns a press; ancestors see the same event.
const claimed = new WeakSet<Event>();
const hoverQuery = "(hover: hover) and (pointer: fine)";

function disabled(element: HTMLElement): boolean {
  return element.matches(":disabled, [data-disabled], [aria-disabled='true']");
}

/** The response of interactive glass to touch and pointer input, as macOS
 * draws it: under a press the glass grows 2.5 points wider, keeping its
 * proportions, and a soft light gathers under the finger; on release it
 * settles back, dipping just under its size. A drag neither moves nor
 * stretches it. Writes only `scale` and custom properties, so consumer
 * `transform` and `translate` styles continue to compose. */
export function attachInteraction(
  element: HTMLElement,
  motion: () => GlassMotion,
): SurfaceAnimator {
  const view = element.ownerDocument.defaultView!;
  const saved = { scale: element.style.scale };
  const press = new Spring(0, springs.press),
    glow = new Spring(0, springs.glow);
  // The pointer holding the glass and its latest client position.
  let pointer: { id: number; clientX: number; clientY: number } | null = null;
  let keyboard = false,
    hovering = false,
    previous = 0,
    written = false;
  let glowX = 0,
    glowY = 0;
  // A settled light remains visible without another style mutation or frame.
  const writeStyle = (name: string, value: string) => {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  };

  const size = () => ({ width: element.offsetWidth || 1, height: element.offsetHeight || 1 });
  /** Untransformed center and the visual-to-layout ratio of the live element. */
  const layout = () => {
    const rect = element.getBoundingClientRect(),
      { width, height } = size();
    return {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      width,
      height,
      rect,
      ratioX: width / (rect.width || 1),
      ratioY: height / (rect.height || 1),
    };
  };
  const light = (x: number, y: number) => {
    const { rect, ratioX, ratioY } = layout();
    glowX = (x - rect.left) * ratioX;
    glowY = (y - rect.top) * ratioY;
  };
  const set = (spring: Spring, target: number, options: SpringOptions) => {
    spring.configure(options).target = target;
  };

  function move(event: PointerEvent) {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer.clientX = event.clientX;
    pointer.clientY = event.clientY;
  }
  function release(event?: PointerEvent) {
    if (event && (!pointer || event.pointerId !== pointer.id)) return;
    pointer = null;
    view.removeEventListener("pointermove", move);
    view.removeEventListener("pointerup", release);
    view.removeEventListener("pointercancel", release);
    set(press, 0, springs.release);
    set(glow, hovering ? 0.35 : 0, springs.glow);
  }
  function down(event: PointerEvent) {
    if (claimed.has(event) || event.button !== 0 || disabled(element)) return;
    claimed.add(event);
    pointer = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    light(event.clientX, event.clientY);
    set(press, 1, springs.press);
    set(glow, 1, springs.press);
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", release);
    view.addEventListener("pointercancel", release);
  }
  function hover(event: PointerEvent) {
    if (event.pointerType === "touch" || !view.matchMedia(hoverQuery).matches) return;
    hovering = event.type !== "pointerleave";
    if (hovering) light(event.clientX, event.clientY);
    if (!pointer && !keyboard) set(glow, hovering ? 0.35 : 0, springs.glow);
  }
  function key(event: KeyboardEvent) {
    if (event.key !== " " && event.key !== "Enter") return;
    if (event.type === "keydown") {
      if (event.repeat || claimed.has(event) || disabled(element) || pointer) return;
      claimed.add(event);
      keyboard = true;
      const { width, height } = size();
      glowX = width / 2;
      glowY = height / 2;
      set(press, 1, springs.press);
      set(glow, 1, springs.press);
    } else if (keyboard) {
      keyboard = false;
      set(press, 0, springs.release);
      set(glow, hovering ? 0.35 : 0, springs.glow);
    }
  }
  // Links and images are natively draggable; a browser drag would cancel the
  // press with `pointercancel` and carry a ghost of the URL. Content the
  // application marks `draggable="true"` keeps its drag.
  function drag(event: DragEvent) {
    if (!pointer) return;
    const origin = event.target as Node | null;
    const source = origin?.nodeType === 1 ? (origin as Element) : origin?.parentElement;
    if (!source?.closest('[draggable="true"]')) event.preventDefault();
  }
  const blur = () => {
    if (keyboard) {
      keyboard = false;
      set(press, 0, springs.release);
      set(glow, 0, springs.glow);
    }
  };

  element.addEventListener("pointerdown", down);
  element.addEventListener("dragstart", drag);
  element.addEventListener("pointerenter", hover);
  element.addEventListener("pointermove", hover);
  element.addEventListener("pointerleave", hover);
  element.addEventListener("keydown", key);
  element.addEventListener("keyup", key);
  element.addEventListener("focusout", blur);

  return {
    frame(now) {
      // The analytic springs are stable across dropped frames. Capping time
      // here would make a slow paint stretch the gesture's wall-clock duration.
      const dt = previous ? Math.max(0, (now - previous) / 1000) : 1 / 60;
      previous = now;
      const level = motion();
      const { width } = size();
      if (pointer) light(pointer.clientX, pointer.clientY);
      for (const spring of [press, glow]) spring.step(dt);
      // The glass grows by the same 2.5 points at any size, keeping its shape.
      const grow = level === "full" ? (2.5 / Math.max(width, 1)) * press.value : 0;
      const sx = 1 + grow,
        sy = 1 + grow;
      const scaled = Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4;
      const lit = glow.value > 0.001;
      if (scaled || lit || pointer || keyboard) {
        written = true;
        writeStyle("scale", scaled ? `${sx.toFixed(5)} ${sy.toFixed(5)}` : saved.scale);
        writeStyle("--lg-glow", lit ? glow.value.toFixed(4) : "0");
        writeStyle("--lg-glow-x", `${glowX.toFixed(2)}px`);
        writeStyle("--lg-glow-y", `${glowY.toFixed(2)}px`);
        writeStyle("--lg-glow-size", "36px");
        if (pointer || keyboard) {
          if (element.dataset.glassPressed !== "") element.dataset.glassPressed = "";
        } else if (element.dataset.glassPressed !== undefined) delete element.dataset.glassPressed;
      } else if (written) {
        written = false;
        element.style.scale = saved.scale;
        for (const name of ["--lg-glow", "--lg-glow-x", "--lg-glow-y", "--lg-glow-size"])
          element.style.removeProperty(name);
        delete element.dataset.glassPressed;
      }
      const active = Boolean(pointer) || [press, glow].some((spring) => !spring.settled);
      // An input after the ticker slept starts now, not at its last heartbeat.
      if (!active) previous = 0;
      return active;
    },
    dispose() {
      release();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("dragstart", drag);
      element.removeEventListener("pointerenter", hover);
      element.removeEventListener("pointermove", hover);
      element.removeEventListener("pointerleave", hover);
      element.removeEventListener("keydown", key);
      element.removeEventListener("keyup", key);
      element.removeEventListener("focusout", blur);
      element.style.scale = saved.scale;
      for (const name of ["--lg-glow", "--lg-glow-x", "--lg-glow-y", "--lg-glow-size"])
        element.style.removeProperty(name);
      delete element.dataset.glassPressed;
    },
  };
}
