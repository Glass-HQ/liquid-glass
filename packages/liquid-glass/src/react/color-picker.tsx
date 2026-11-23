import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithRef, CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { Appearance } from "../protocol";
import {
  prefersReducedMotion,
  useGlassEngine,
  useGlassScene,
  useGlassSurface,
  useMergedRef,
  useSurfaceMotion,
} from "./hooks";

/**
 * A wheel position: hue angle in degrees, saturation (radius) and value, 0..1. The wheel shows
 * every color at full value and picks at full value; a darker color given to the picker places
 * the knob by its hue and saturation.
 */
interface Hsv {
  h: number;
  s: number;
  v: number;
}

// HSV ramps each channel linearly across its 60° sector, which leaves a crease at every primary
// and secondary: bright spokes at yellow, cyan and magenta. The wheel eases each ramp instead,
// so hues blend without creases and every primary and secondary stays where HSV puts it.
const ease = (t: number) => t * t * (3 - 2 * t);
const unease = (y: number) => 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const wrap = (h: number) => ((h % 360) + 360) % 360;

function wheelRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * ease(Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

const hexPattern = /^#?([\da-f]{6})$/i;

function hexToHsv(hex: string): Hsv | undefined {
  const match = hexPattern.exec(hex);
  if (!match?.[1]) return undefined;
  const n = Number.parseInt(match[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let sector = 0;
  if (d) {
    if (max === r) sector = ((g - b) / d + 6) % 6;
    else if (max === g) sector = (b - r) / d + 2;
    else sector = (r - g) / d + 4;
  }
  const whole = Math.floor(sector);
  return { h: (whole + unease(sector - whole)) * 60, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  return `#${wheelRgb(h, s, v)
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * The wheel's pixels, drawn once per size: a gradient can't draw it (its stops crease and band
 * in eight bits). Dithered below one step so the soft blends don't band either.
 */
const wheels = new Map<number, Promise<string>>();
function wheelImage(pixels: number): Promise<string> {
  let image = wheels.get(pixels);
  if (image) return image;
  image = new Promise<string>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = pixels;
    const context = canvas.getContext("2d");
    if (!context) return reject(new Error("Canvas 2D is unavailable."));
    const data = context.createImageData(pixels, pixels);
    const radius = pixels / 2;
    let seed = 1;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    for (let y = 0; y < pixels; y += 1)
      for (let x = 0; x < pixels; x += 1) {
        const dx = x + 0.5 - radius;
        const dy = y + 0.5 - radius;
        const distance = Math.hypot(dx, dy);
        const coverage = clamp01(radius - distance + 0.5);
        if (!coverage) continue;
        const [r, g, b] = wheelRgb(
          wrap((Math.atan2(dy, dx) * 180) / Math.PI),
          Math.min(1, distance / radius),
          1,
        );
        const i = (y * pixels + x) * 4;
        data.data[i] = r * 255 + noise();
        data.data[i + 1] = g * 255 + noise();
        data.data[i + 2] = b * 255 + noise();
        data.data[i + 3] = coverage * 255;
      }
    context.putImageData(data, 0, 0);
    canvas.toBlob((blob) =>
      blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Wheel encoding failed.")),
    );
  });
  image.catch(() => wheels.delete(pixels));
  wheels.set(pixels, image);
  return image;
}

/** The lens over the knob: its size at rest (the knob) and lifted, px. */
const KNOB = 14;
const LENS = 60;
/** A finger hides the lens's middle, so under one it lifts a little higher. */
const TOUCH_GROWTH = 1.1;
/** The lift: a quick, slightly bouncy rise and a smooth fall. */
const RISE = { dampingRatio: 0.62, response: 0.3 };
const FALL = { dampingRatio: 1, response: 0.22 };

export interface GlassColorPickerProps extends Omit<
  ComponentPropsWithRef<"div">,
  "onChange" | "defaultValue" | "children"
> {
  /** A six-digit hex color, such as "#34c759". */
  value?: string;
  defaultValue?: string;
  /** Called as the color changes, with a lowercase six-digit hex color. */
  onValueChange?: (value: string) => void;
  /** Called when a drag or key press ends. */
  onValueCommit?: (value: string) => void;
  /** The wheel's diameter, px. Default: 240. */
  size?: number;
  /** Submit the hex value with a form under this name. */
  name?: string;
  disabled?: boolean;
  /** Light or dark glass whatever the scene's appearance. Default: the scene's. */
  appearance?: Appearance;
  /** Highlights on the lens that follow the pointer. Default: the scene's. */
  specular?: boolean;
}

/**
 * A hue and saturation wheel. A small knob of the chosen color marks it; pressing the wheel lifts
 * the knob into a clear glass lens that follows the pointer, a point at its middle on the exact
 * color, so the colors around it show bent at its rim. Keyboard: left and right turn the hue, up
 * and down change the saturation (Shift for steps of 10).
 */
export function GlassColorPicker({
  value,
  defaultValue = "#007aff",
  onValueChange,
  onValueCommit,
  size = 240,
  name,
  disabled = false,
  appearance,
  specular,
  "aria-label": label = "Color",
  style,
  ref,
  ...props
}: GlassColorPickerProps) {
  const engine = useGlassEngine();
  const scene = useGlassScene();
  // Hue and saturation survive a black or gray color, which has neither.
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(value ?? defaultValue) ?? { h: 211, s: 1, v: 1 },
  );
  const current = hsvToHex(hsv);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    const next = value === undefined ? undefined : hexToHsv(value);
    if (next && hsvToHex(next) !== current)
      setHsv({ h: next.s && next.v ? next.h : hsv.h, s: next.v ? next.s : hsv.s, v: next.v });
  }
  const latest = useRef(hsv);
  latest.current = hsv;
  const [pressed, setPressed] = useState<"pointer" | "touch" | "key" | null>(null);
  const [image, setImage] = useState<string>();

  // The glass: the wheel's overlay is a surface with no body, only the lens over the knob.
  const { ref: surfaceRef, surface } = useGlassSurface({
    body: false,
    material: "clear",
    appearance,
    specular,
    lensHeight: LENS * TOUCH_GROWTH,
    overhang: (LENS * TOUCH_GROWTH) / 2 + 4,
    radius: undefined,
    smoothing: undefined,
    tint: undefined,
    labelsInGlass: undefined,
    bleed: undefined,
    floating: undefined,
  });
  const overlay = useRef<HTMLDivElement | null>(null);
  const mergedRef = useMergedRef<HTMLDivElement>(overlay, surfaceRef);

  useEffect(() => {
    let live = true;
    const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    wheelImage(Math.round(size * density)).then(
      (url) => live && setImage(url),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [size]);

  // The lift springs between the knob (0) and the lens (1, or a little more under a finger).
  const lift = useRef({ value: 0, velocity: 0 });
  const target = pressed === null ? 0 : pressed === "touch" ? TOUCH_GROWTH : 1;
  const knob = useRef<HTMLSpanElement | null>(null);
  const point = useRef<HTMLSpanElement | null>(null);
  useSurfaceMotion(surface, "lens", (_now, dt) => {
    const state = lift.current;
    if (prefersReducedMotion()) {
      state.value = target;
      state.velocity = 0;
    } else {
      const params = target > state.value ? RISE : FALL;
      const w = (2 * Math.PI) / params.response;
      for (let t = 0; t < dt; t += 1 / 240) {
        const h = Math.min(1 / 240, dt - t);
        const accel = w * w * (target - state.value) - 2 * params.dampingRatio * w * state.velocity;
        state.velocity += accel * h;
        state.value += state.velocity * h;
      }
    }
    const moving = Math.abs(target - state.value) > 1e-3 || Math.abs(state.velocity) > 1e-3;
    if (!moving) {
      state.value = target;
      state.velocity = 0;
    }
    const p = Math.max(0, state.value);
    const shown = Math.min(1, p);
    if (knob.current) knob.current.style.opacity = String(1 - Math.min(1, shown * 3));
    if (point.current)
      point.current.style.opacity = String(Math.min(1, Math.max(0, shown * 2 - 1)));
    if (p < 0.004 || !engine) return { shapes: [], moving };
    const radians = (latest.current.h * Math.PI) / 180;
    const cx = size / 2 + Math.cos(radians) * latest.current.s * (size / 2);
    const cy = size / 2 + Math.sin(radians) * latest.current.s * (size / 2);
    const d = KNOB + (LENS - KNOB) * p;
    const rect = { x: cx - d / 2, y: cy - d / 2, width: d, height: d };
    const r = d / 2;
    return {
      shapes: [
        {
          role: "thumb",
          rect,
          radii: [r, r, r, r],
          lift: shown,
          magnify: 1,
          alpha: Math.min(1, p * 4),
          merge: 0,
          tint: null,
          light: 0,
        },
      ],
      moving,
    };
  });

  // The lens's motion rests once it settles: a press, a release or a new color wakes it.
  useLayoutEffect(() => {
    scene?.requestFrame();
  }, [scene, target, hsv.h, hsv.s]);

  const change = (next: Hsv) => {
    const before = hsvToHex(latest.current);
    latest.current = next;
    setHsv(next);
    const hex = hsvToHex(next);
    if (hex !== before) onValueChange?.(hex);
  };
  const commit = () => onValueCommit?.(hsvToHex(latest.current));
  const pick = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    change({
      h: wrap((Math.atan2(dy, dx) * 180) / Math.PI),
      s: clamp01(Math.hypot(dx, dy) / (box.width / 2)),
      v: 1,
    });
  };
  const release = (event: PointerEvent<HTMLElement>) => {
    if (pressed === null || pressed === "key") return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPressed(null);
    commit();
  };
  const key = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const { h, s } = latest.current;
    const next =
      event.key === "ArrowRight"
        ? { h: wrap(h + step), s, v: 1 }
        : event.key === "ArrowLeft"
          ? { h: wrap(h - step), s, v: 1 }
          : event.key === "ArrowUp"
            ? { h, s: clamp01(s + step / 100), v: 1 }
            : event.key === "ArrowDown"
              ? { h, s: clamp01(s - step / 100), v: 1 }
              : undefined;
    if (!next) return;
    event.preventDefault();
    if (pressed === null) setPressed("key");
    change(next);
  };

  const radians = (hsv.h * Math.PI) / 180;
  const at: CSSProperties = {
    left: `${50 + Math.cos(radians) * hsv.s * 50}%`,
    top: `${50 + Math.sin(radians) * hsv.s * 50}%`,
  };
  const wheelBackground = useMemo<CSSProperties>(
    () => (image ? { backgroundImage: `url("${image}")`, backgroundSize: "100% 100%" } : {}),
    [image],
  );

  return (
    <div
      {...props}
      ref={ref}
      data-lg-color-picker=""
      data-disabled={disabled || undefined}
      style={
        { ...style, "--lg-color-wheel-size": `${size}px`, "--lg-color": current } as CSSProperties
      }
    >
      <div data-lg-color-wheel-colors="" aria-hidden="true" style={wheelBackground} />
      <div
        ref={mergedRef}
        data-lg-color-wheel=""
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-roledescription="color wheel"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`${current}, hue ${Math.round(hsv.h)} degrees, saturation ${Math.round(hsv.s * 100)} percent`}
        aria-disabled={disabled || undefined}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          // Focused for the keys, without the keyboard's focus ring.
          event.currentTarget.focus({ preventScroll: true, focusVisible: false });
          event.currentTarget.setPointerCapture(event.pointerId);
          setPressed(event.pointerType === "touch" ? "touch" : "pointer");
          pick(event);
        }}
        onPointerMove={(event) => {
          if (pressed === "pointer" || pressed === "touch") pick(event);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={disabled ? undefined : key}
        onKeyUp={() => {
          if (pressed !== "key") return;
          setPressed(null);
          commit();
        }}
        onBlur={() => {
          if (pressed === "key") setPressed(null);
        }}
      >
        <span ref={knob} data-lg-color-knob="" style={at} aria-hidden="true" />
        <span ref={point} data-lg-color-point="" style={{ ...at, opacity: 0 }} aria-hidden="true" />
      </div>
      {name !== undefined && (
        <input type="hidden" name={name} value={current} disabled={disabled} />
      )}
    </div>
  );
}
