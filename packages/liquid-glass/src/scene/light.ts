/**
 * Where the light comes from for specular glass, shared by every scene of a window: the pointer,
 * or the device's tilt where the browser reports it without asking (not iOS, where the light
 * follows touch instead).
 */
export interface Light {
  pointer?: { x: number; y: number };
  /** Tilt away from how the device was being held, degrees. */
  tilt?: { x: number; y: number };
}

interface Source {
  readonly light: Light;
  readonly wakes: Set<() => void>;
  dispose(): void;
}

const sources = new WeakMap<Window, Source>();

/** Follow the light while subscribed; `wake` runs whenever it moves. */
export function subscribeLight(view: Window, wake: () => void): { light: Light; release(): void } {
  let source = sources.get(view);
  if (!source) {
    const light: Light = {};
    const wakes = new Set<() => void>();
    const notify = () => wakes.forEach((w) => w());
    const move = (event: PointerEvent) => {
      // A finger lights the glass only while it is down.
      if (event.pointerType === "touch" && event.type === "pointermove" && !event.buttons) return;
      light.pointer = { x: event.clientX, y: event.clientY };
      notify();
    };
    const leave = () => {
      light.pointer = undefined;
      notify();
    };
    const lift = (event: PointerEvent) => {
      if (event.pointerType === "touch") leave();
    };
    const out = (event: MouseEvent) => {
      if (!event.relatedTarget) leave();
    };
    // The tilt is measured from a resting orientation that slowly follows the device, so the
    // light starts above the glass however it is held.
    let rest: { beta: number; gamma: number } | undefined;
    const orient = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      rest ??= { beta: event.beta, gamma: event.gamma };
      rest.beta += (event.beta - rest.beta) * 0.02;
      rest.gamma += (event.gamma - rest.gamma) * 0.02;
      light.tilt = { x: event.gamma - rest.gamma, y: event.beta - rest.beta };
      notify();
    };
    const options = { capture: true, passive: true } as const;
    view.addEventListener("pointermove", move, options);
    view.addEventListener("pointerdown", move, options);
    view.addEventListener("pointerup", lift, options);
    view.addEventListener("pointercancel", lift, options);
    view.document.addEventListener("mouseout", out, options);
    view.addEventListener("blur", leave);
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
      if (current.wakes.size === 0) {
        current.dispose();
        sources.delete(view);
      }
    },
  };
}

/** The highlights' axis at rest: top left and bottom right, as on iOS. */
export const RESTING_ANGLE = (-3 * Math.PI) / 4;

/**
 * The axis of the two highlights, radians on screen (y down), for glass centred at `x`, `y`:
 * towards the pointer, else turned by the device's tilt, else at rest. Both ends of the axis
 * are lit alike.
 */
export function lightAngle(light: Light, x: number, y: number): number {
  if (light.pointer) {
    const dx = light.pointer.x - x;
    const dy = light.pointer.y - y;
    if (Math.hypot(dx, dy) > 1) return Math.atan2(dy, dx);
  }
  if (light.tilt) {
    const dx = -Math.SQRT1_2 + light.tilt.x / 40;
    const dy = -Math.SQRT1_2 + light.tilt.y / 40;
    if (Math.hypot(dx, dy) > 0.05) return Math.atan2(dy, dx);
  }
  return RESTING_ANGLE;
}

/**
 * Turn `angle` towards `target` the short way (the axis repeats every half turn), easing over
 * about `time` seconds. Returns the new angle and whether it is still turning.
 */
export function approachAngle(
  angle: number,
  target: number,
  dt: number,
  time = 0.09,
): { angle: number; moving: boolean } {
  let delta = (target - angle) % Math.PI;
  if (delta > Math.PI / 2) delta -= Math.PI;
  if (delta < -Math.PI / 2) delta += Math.PI;
  if (Math.abs(delta) < 0.002) return { angle: angle + delta, moving: false };
  return { angle: angle + delta * (1 - Math.exp(-Math.max(0, dt) / time)), moving: true };
}
