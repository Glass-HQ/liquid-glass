import type { MaterialMaps } from "./maps.js";
import { touchMaps } from "./maps.js";

/** Where the light is, shared by every scene of a window: the pointer, or the
 * device's tilt where the browser reports it without asking for permission. */
interface Light {
  pointer?: { x: number; y: number };
  /** Tilt away from how the device was being held, in degrees. */
  tilt?: { x: number; y: number };
}
interface Source {
  light: Light;
  wakes: Set<() => void>;
  dispose: () => void;
}
const sources = new WeakMap<Window, Source>();

/** Follow the light for as long as `wake` is subscribed. */
export function subscribeLight(view: Window, wake: () => void): { light: Light; release(): void } {
  let source = sources.get(view);
  if (!source) {
    const light: Light = {};
    const wakes = new Set<() => void>();
    const notify = () => wakes.forEach((w) => w());
    const move = (event: PointerEvent) => {
      // A touch lights the glass only while the finger is down.
      if (event.pointerType === "touch" && event.type === "pointermove" && !event.buttons) return;
      light.pointer = { x: event.clientX, y: event.clientY };
      notify();
    };
    const leave = () => {
      light.pointer = undefined;
      notify();
    };
    const lift = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      light.pointer = undefined;
      notify();
    };
    // The tilt is measured from a resting orientation that slowly follows
    // the device, so the light starts above the glass however it is held.
    let rest: { beta: number; gamma: number } | undefined;
    const orient = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      rest ??= { beta: event.beta, gamma: event.gamma };
      rest.beta += (event.beta - rest.beta) * 0.02;
      rest.gamma += (event.gamma - rest.gamma) * 0.02;
      light.tilt = { x: event.gamma - rest.gamma, y: event.beta - rest.beta };
      notify();
    };
    // The pointer left the window.
    const out = (event: MouseEvent) => {
      if (!event.relatedTarget) leave();
    };
    const options = { capture: true, passive: true } as const;
    view.addEventListener("pointermove", move, options);
    view.addEventListener("pointerdown", move, options);
    view.addEventListener("pointerup", lift, options);
    view.addEventListener("pointercancel", lift, options);
    view.document.addEventListener("mouseout", out, options);
    view.addEventListener("blur", leave);
    // iOS asks for permission to read motion; there the light follows touch.
    const ask = (view as Window & { DeviceOrientationEvent?: { requestPermission?: unknown } })
      .DeviceOrientationEvent?.requestPermission;
    const tilts = typeof ask !== "function" && "DeviceOrientationEvent" in view;
    if (tilts) view.addEventListener("deviceorientation", orient, { passive: true });
    source = {
      light,
      wakes,
      dispose() {
        view.removeEventListener("pointermove", move, options);
        view.removeEventListener("pointerdown", move, options);
        view.removeEventListener("pointerup", lift, options);
        view.removeEventListener("pointercancel", lift, options);
        view.document.removeEventListener("mouseout", out, options);
        view.removeEventListener("blur", leave);
        if (tilts) view.removeEventListener("deviceorientation", orient);
      },
    };
    sources.set(view, source);
  }
  const current = source;
  current.wakes.add(wake);
  return {
    light: current.light,
    release() {
      current.wakes.delete(wake);
      if (!current.wakes.size) {
        current.dispose();
        sources.delete(view);
      }
    },
  };
}

/** The axis of the two highlights at rest: top left and bottom right, as on iOS. */
export const restingAngle = (-3 * Math.PI) / 4;
/** Axis of the highlights, in radians on screen (y down), for glass centered
 * at `x`, `y`: toward the pointer, else turned by the device's tilt. Both
 * ends of the axis are lit alike, so an angle and its opposite are the same. */
export function lightAngle(light: Light, x: number, y: number): number {
  if (light.pointer) {
    const dx = light.pointer.x - x,
      dy = light.pointer.y - y;
    if (Math.hypot(dx, dy) > 1) return Math.atan2(dy, dx);
  }
  if (light.tilt) {
    // Tilting turns the axis around the glass, as the light stays put.
    const dx = -Math.SQRT1_2 + light.tilt.x / 40,
      dy = -Math.SQRT1_2 + light.tilt.y / 40;
    if (Math.hypot(dx, dy) > 0.05) return Math.atan2(dy, dx);
  }
  return restingAngle;
}
/** Turn `angle` toward `target` the short way. The axis repeats every half turn. */
export function approachAngle(angle: number, target: number, dt: number, time = 0.09): number {
  let delta = (target - angle) % Math.PI;
  if (delta > Math.PI / 2) delta -= Math.PI;
  if (delta < -Math.PI / 2) delta += Math.PI;
  // Within a tenth of a degree it holds still, so the scene can rest.
  if (Math.abs(delta) < 0.002) return angle;
  return angle + delta * (1 - Math.exp(-dt / time));
}

/** Brightness of the rim for v, the rim's facing along the axis scaled by
 * its closeness to the edge. Both ends of the axis are lit the same. */
export function specularResponse(v: number): number {
  const t = Math.max(0, Math.min(1, (Math.abs(v) - 0.12) / 0.68));
  return (t * t * (3 - 2 * t)) ** 1.3;
}
const table = Array.from({ length: 33 }, (_, i) => specularResponse((i / 32) * 2 - 1).toFixed(4));

/** The field map stores each pixel's outward normal, scaled by how close it
 * is to the rim, as 0.5 − n/2 in red and green. One color matrix takes its
 * dot product with the light; a table shapes the lobes; coverage cuts the
 * result to the glass. Moving the light only rewrites the matrix. */
export function specularMatrix(angle: number): string {
  const lx = Math.cos(angle),
    ly = Math.sin(angle);
  const f = (n: number) => (Math.abs(n) < 1e-5 ? "0" : n.toFixed(4));
  return `0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${f(-lx)} ${f(-ly)} 0 0 ${f(0.5 + 0.5 * lx + 0.5 * ly)}`;
}
export function specularFilterMarkup(id: string): string {
  return `<filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="${specularMatrix(restingAngle)}" result="facing"/><feComponentTransfer in="facing" result="lit"><feFuncA type="table" tableValues="${table.join(" ")}"/></feComponentTransfer><feComposite in="lit" in2="SourceAlpha" operator="in"/></filter>`;
}

const ns = "http://www.w3.org/2000/svg";
const voidElements = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
const owned = new WeakSet<Node>();
/** Whether a node is a specular layer this library wrote. */
export const ownsSpecular = (node: Node): boolean => owned.has(node);

export interface SpecularLayer {
  /** Draw the rim of these maps over a surface of this layout size. */
  place(maps: MaterialMaps | undefined, width: number, height: number): void;
  /** Point the light at `angle` and set how bright it is. */
  aim(angle: number, strength: number): void;
  dispose(): void;
}
/** A thin layer inside the surface, beneath its children, that lights the
 * rim. It filters only itself, so moving the light never redraws the
 * glass's content filter. */
export function createSpecularLayer(
  element: HTMLElement,
  defs: SVGDefsElement,
  id: string,
): SpecularLayer | undefined {
  if (voidElements.test(element.tagName)) return;
  const document = element.ownerDocument;
  const holder = document.createElementNS(ns, "g");
  holder.innerHTML = specularFilterMarkup(id);
  const filter = holder.firstElementChild!;
  const matrix = filter.querySelector("feColorMatrix")!;
  defs.append(filter);
  const layer = document.createElement("span");
  layer.className = "lg-specular";
  layer.setAttribute("aria-hidden", "true");
  layer.style.filter = `url("#${id}")`;
  owned.add(layer);
  owned.add(filter);
  element.append(layer);
  let written = "",
    shown: MaterialMaps | undefined,
    size = "",
    opacity = "";
  return {
    place(maps, width, height) {
      const key = `${width},${height},${element.clientLeft},${element.clientTop}`;
      if (maps === shown && key === size) return;
      shown = maps;
      size = key;
      if (!maps) {
        layer.style.display = "none";
        return;
      }
      touchMaps(maps);
      layer.style.removeProperty("display");
      const w = width + 4,
        h = height + 4;
      layer.style.left = `${-2 - element.clientLeft}px`;
      layer.style.top = `${-2 - element.clientTop}px`;
      layer.style.width = `${w}px`;
      layer.style.height = `${h}px`;
      const slices = maps.capsule;
      const cap = slices ? (slices.cap * h) / slices.height : 0;
      if (!slices || w < cap * 2) {
        layer.style.backgroundImage = `url("${maps.field}")`;
        layer.style.backgroundPosition = "0 0";
        layer.style.backgroundSize = `${w}px ${h}px`;
        return;
      }
      const [left, middle, right] = slices.planes.field;
      layer.style.backgroundImage = `url("${right}"), url("${left}"), url("${middle}")`;
      layer.style.backgroundPosition = `${w - cap}px 0, 0 0, ${cap - 0.5}px 0`;
      layer.style.backgroundSize = `${cap}px ${h}px, ${cap}px ${h}px, ${w - cap * 2 + 1}px ${h}px`;
    },
    aim(angle, strength) {
      const values = specularMatrix(angle);
      if (values !== written) {
        written = values;
        matrix.setAttribute("values", values);
      }
      const next = strength.toFixed(3);
      if (next !== opacity) {
        opacity = next;
        layer.style.opacity = next;
      }
    },
    dispose() {
      layer.remove();
      filter.remove();
    },
  };
}
