import { Spring, rubberBand, springs } from "../core/spring.js";
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
   * the animation is in motion and needs the next frame. While the scene is
   * `quiet`, an animator leaves the page as it is: nothing moves, so the GPU
   * is free for the maps another surface is waiting on. */
  frame(now: number, quiet?: boolean): boolean | void;
  dispose(): void;
}

// The innermost interactive surface owns a press; ancestors see the same event.
const claimed = new WeakSet<Event>();
const hoverQuery = "(hover: hover) and (pointer: fine)";

function disabled(element: HTMLElement): boolean {
  return element.matches(":disabled, [data-disabled], [aria-disabled='true']");
}

/** Elastic, illuminated response to touch and pointer input: the surface grows
 * under a press, stretches toward a drag with constant volume, and settles with
 * gel-like overshoot on release. Writes only `translate`, `scale` and custom
 * properties, so consumer `transform` styles continue to compose. */
export function attachInteraction(element: HTMLElement, motion: () => GlassMotion): SurfaceAnimator {
  const view = element.ownerDocument.defaultView!;
  const saved = { translate: element.style.translate, scale: element.style.scale };
  const tx = new Spring(0, springs.track), ty = new Spring(0, springs.track);
  const press = new Spring(0, springs.press), glow = new Spring(0, springs.glow);
  // Press origin, latest client position, and the element's last sampled center.
  let pointer: { id: number; x: number; y: number; cx: number; cy: number; clientX: number; clientY: number; lastX: number; lastY: number } | null = null;
  let keyboard = false, hovering = false, previous = 0, written = false;
  let glowX = 0, glowY = 0;
  // Velocity of the surface itself while held, for surfaces the application drags.
  let carriedX = 0, carriedY = 0;

  const size = () => ({ width: element.offsetWidth || 1, height: element.offsetHeight || 1 });
  /** Untransformed center and the visual-to-layout ratio of the live element. */
  const layout = () => {
    const rect = element.getBoundingClientRect(), { width, height } = size();
    return {
      cx: rect.left + rect.width / 2 - tx.value, cy: rect.top + rect.height / 2 - ty.value,
      width, height, rect, ratioX: width / (rect.width || 1), ratioY: height / (rect.height || 1),
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
    set(tx, 0, springs.release);
    set(ty, 0, springs.release);
    set(glow, hovering ? 0.35 : 0, springs.glow);
  }
  function down(event: PointerEvent) {
    if (claimed.has(event) || event.button !== 0 || disabled(element)) return;
    claimed.add(event);
    const { cx, cy } = layout();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, cx, cy,
      clientX: event.clientX, clientY: event.clientY, lastX: cx, lastY: cy };
    carriedX = carriedY = 0;
    light(event.clientX, event.clientY);
    set(press, 1, springs.press);
    set(glow, 1, springs.press);
    // Larger glass is heavier: it follows a drag more slowly.
    const { width, height } = size();
    const follow = { duration: springs.track.duration + 0.0005 * Math.max(width, height), bounce: 0 };
    set(tx, 0, follow);
    set(ty, 0, follow);
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
      glowX = width / 2; glowY = height / 2;
      set(press, 1, springs.press);
      set(glow, 1, springs.press);
    } else if (keyboard) {
      keyboard = false;
      set(press, 0, springs.release);
      set(glow, hovering ? 0.35 : 0, springs.glow);
    }
  }
  const blur = () => { if (keyboard) { keyboard = false; set(press, 0, springs.release); set(glow, 0, springs.glow); } };

  element.addEventListener("pointerdown", down);
  element.addEventListener("pointerenter", hover);
  element.addEventListener("pointermove", hover);
  element.addEventListener("pointerleave", hover);
  element.addEventListener("keydown", key);
  element.addEventListener("keyup", key);
  element.addEventListener("focusout", blur);

  return {
    frame(now, quiet) {
      // Held still: the springs resume from here once the scene moves again.
      if (quiet) { previous = now; return true; }
      const dt = previous ? Math.min((now - previous) / 1000, 1 / 20) : 1 / 60;
      previous = now;
      const level = motion();
      const { width, height } = size();
      if (pointer) {
        // Measure the drag against the element's live position, so a surface
        // the application moves with the pointer stretches only with velocity.
        const { cx, cy } = layout();
        const small = Math.max(width, height) <= 72;
        const ox = small ? pointer.clientX - pointer.x - (cx - pointer.cx)
          : pointer.clientX - Math.max(cx - width / 2, Math.min(cx + width / 2, pointer.clientX));
        const oy = small ? pointer.clientY - pointer.y - (cy - pointer.cy)
          : pointer.clientY - Math.max(cy - height / 2, Math.min(cy + height / 2, pointer.clientY));
        // Controls give a little under the finger; surfaces only at their edges.
        const limit = small ? 4 + 0.15 * Math.max(width, height) : Math.min(10, 3 + 0.04 * Math.max(width, height));
        tx.target = rubberBand(ox, limit);
        ty.target = rubberBand(oy, limit);
        light(pointer.clientX, pointer.clientY);
        carriedX += ((cx - pointer.lastX) / dt - carriedX) * Math.min(1, dt * 12);
        carriedY += ((cy - pointer.lastY) / dt - carriedY) * Math.min(1, dt * 12);
        pointer.lastX = cx; pointer.lastY = cy;
      } else {
        carriedX *= Math.exp(-dt * 10); carriedY *= Math.exp(-dt * 10);
      }
      for (const spring of [tx, ty, press, glow]) spring.step(dt);
      const elastic = level === "full";
      const grow = elastic ? Math.min(0.16, 8 / Math.max(width, height)) * press.value : 0;
      const cap = Math.max(width, height) <= 72 ? 0.2 : 0.12;
      const ex = elastic ? Math.min(cap, 0.5 * Math.abs(tx.value) / width + 0.00007 * Math.abs(tx.velocity) + 0.00005 * Math.abs(carriedX)) : 0;
      const ey = elastic ? Math.min(cap, 0.5 * Math.abs(ty.value) / height + 0.00007 * Math.abs(ty.velocity) + 0.00005 * Math.abs(carriedY)) : 0;
      const sx = (1 + grow) * (1 + ex) / Math.sqrt(1 + ey), sy = (1 + grow) * (1 + ey) / Math.sqrt(1 + ex);
      const moved = elastic && (Math.abs(tx.value) > 0.01 || Math.abs(ty.value) > 0.01);
      const scaled = Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4;
      const lit = glow.value > 0.001;
      if (moved || scaled || lit || pointer || keyboard) {
        written = true;
        element.style.translate = moved ? `${tx.value.toFixed(3)}px ${ty.value.toFixed(3)}px` : saved.translate;
        element.style.scale = scaled ? `${sx.toFixed(5)} ${sy.toFixed(5)}` : saved.scale;
        element.style.setProperty("--lg-glow", lit ? glow.value.toFixed(4) : "0");
        element.style.setProperty("--lg-glow-x", `${glowX.toFixed(2)}px`);
        element.style.setProperty("--lg-glow-y", `${glowY.toFixed(2)}px`);
        element.style.setProperty("--lg-glow-size", `${Math.max(36, Math.min(180, Math.max(width, height) * 0.9)).toFixed(1)}px`);
        if (pointer || keyboard) element.dataset.glassPressed = "";
        else delete element.dataset.glassPressed;
      } else if (written) {
        written = false;
        element.style.translate = saved.translate;
        element.style.scale = saved.scale;
        for (const name of ["--lg-glow", "--lg-glow-x", "--lg-glow-y", "--lg-glow-size"]) element.style.removeProperty(name);
        delete element.dataset.glassPressed;
      }
      return Boolean(pointer || keyboard) || written || [tx, ty, press, glow].some((spring) => !spring.settled);
    },
    dispose() {
      release();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointerenter", hover);
      element.removeEventListener("pointermove", hover);
      element.removeEventListener("pointerleave", hover);
      element.removeEventListener("keydown", key);
      element.removeEventListener("keyup", key);
      element.removeEventListener("focusout", blur);
      element.style.translate = saved.translate;
      element.style.scale = saved.scale;
      for (const name of ["--lg-glow", "--lg-glow-x", "--lg-glow-y", "--lg-glow-size"]) element.style.removeProperty(name);
      delete element.dataset.glassPressed;
    },
  };
}
