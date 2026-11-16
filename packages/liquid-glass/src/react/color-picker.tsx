import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { GlassMotion } from "../dom/index.js";
import type { MaterialOptions } from "../core/materials.js";
import { GlassContent, GlassScene } from "./scene.js";
import { GlassSurface } from "./surface.js";

/** A wheel position: hue angle in degrees, saturation (radius) and value from
 * 0 to 1. The wheel shows every color at full value, and picks at full value;
 * a darker color given to the picker places the lens by its hue and saturation. */
interface Hsv {
  h: number;
  s: number;
  v: number;
}
// HSV ramps each channel linearly across its 60° sector, which leaves a
// crease at every primary and secondary: bright spokes at yellow, cyan and
// magenta. The wheel eases each ramp instead, so hues blend without creases
// and every primary and secondary stays where HSV puts it.
const ease = (t: number) => t * t * (3 - 2 * t);
const unease = (y: number) => 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3);
/** RGB from 0 to 1 at a wheel position. */
function wheelRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * ease(Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}
const hexPattern = /^#?([\da-f]{6})$/i;
/** The wheel position of a color. */
function hexToHsv(hex: string): Hsv | undefined {
  const match = hexPattern.exec(hex);
  if (!match) return;
  const n = parseInt(match[1]!, 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
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
const wrap = (h: number) => ((h % 360) + 360) % 360;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** The wheel's pixels, drawn once per size and density. A gradient cannot
 * draw it: its stops leave creases between them and band in eight bits. */
const wheels = new Map<string, Promise<string>>();
function wheelImage(size: number, density: number): Promise<string> {
  const pixels = Math.round(size * density);
  const key = String(pixels);
  let image = wheels.get(key);
  if (image) return image;
  image = new Promise<string>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = pixels;
    const context = canvas.getContext("2d");
    if (!context) return reject(new Error("Canvas 2D is unavailable."));
    const data = context.createImageData(pixels, pixels);
    const radius = pixels / 2;
    // A fixed pattern keeps the image the same on every draw.
    let seed = 1;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    for (let y = 0; y < pixels; y++)
      for (let x = 0; x < pixels; x++) {
        const dx = x + 0.5 - radius,
          dy = y + 0.5 - radius;
        const distance = Math.hypot(dx, dy);
        const coverage = clamp(radius - distance + 0.5);
        if (!coverage) continue;
        const [r, g, b] = wheelRgb(
          wrap((Math.atan2(dy, dx) * 180) / Math.PI),
          Math.min(1, distance / radius),
          1,
        );
        const i = (y * pixels + x) * 4;
        // Dither below one step so soft blends do not band.
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
  image.catch(() => wheels.delete(key));
  wheels.set(key, image);
  return image;
}

export interface GlassColorPickerProps extends Pick<
  MaterialOptions,
  "appearance" | "refraction" | "specular"
> {
  /** Six-digit hex color, such as "#34c759". */
  value?: string;
  defaultValue?: string;
  /** Called as the color changes, with a lowercase six-digit hex color. */
  onValueChange?: (value: string) => void;
  /** Called when a drag or key press ends. */
  onValueCommitted?: (value: string) => void;
  /** Wheel diameter in pixels. Default: 240. */
  size?: number;
  /** Name of a hidden input that submits the hex value with a form. */
  name?: string;
  disabled?: boolean;
  motion?: GlassMotion;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

/** A hue and saturation wheel. A small dot of the chosen color marks it
 * exactly; pressing the wheel grows the dot into a Clear glass bubble that
 * follows the pointer, with a point at its center on the exact color. The
 * glass is always Clear, so the color under it is seen as it is. */
export function GlassColorPicker({
  value,
  defaultValue = "#007aff",
  onValueChange,
  onValueCommitted,
  size = 240,
  name,
  disabled = false,
  appearance,
  refraction = 16,
  specular = true,
  motion,
  "aria-label": label = "Color",
  className = "",
  style,
}: GlassColorPickerProps) {
  if (value !== undefined && !hexPattern.test(value))
    throw new RangeError("GlassColorPicker value must be a six-digit hex color.");
  if (!(size > 0) || !Number.isFinite(size))
    throw new RangeError("GlassColorPicker size must be positive and finite.");
  // Hue and saturation survive a black or gray color, which has neither.
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(value ?? defaultValue) ?? { h: 211, s: 1, v: 1 },
  );
  const current = hsvToHex(hsv);
  // A new controlled value moves the lens, unless it is the color shown.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== undefined && `#${hexPattern.exec(value)![1]!.toLowerCase()}` !== current) {
      const next = hexToHsv(value)!;
      setHsv({
        h: next.s && next.v ? next.h : hsv.h,
        s: next.v ? next.s : hsv.s,
        v: next.v,
      });
    }
  }
  const [pressed, setPressed] = useState<"pointer" | "touch" | "key" | false>(false);
  const [image, setImage] = useState<string>();
  const wheel = useRef<HTMLDivElement>(null);
  const latest = useRef(hsv);
  latest.current = hsv;

  useEffect(() => {
    let current = true;
    wheelImage(size, Math.min(2, Math.max(1, window.devicePixelRatio || 1))).then(
      (url) => current && setImage(url),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [size]);

  const change = (next: Hsv) => {
    const previous = hsvToHex(latest.current);
    latest.current = next;
    setHsv(next);
    const hex = hsvToHex(next);
    if (hex !== previous) onValueChange?.(hex);
  };
  const commit = () => onValueCommitted?.(hsvToHex(latest.current));
  const pick = (event: PointerEvent<HTMLElement>) => {
    const box = wheel.current!.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2),
      dy = event.clientY - (box.top + box.height / 2);
    change({
      h: wrap((Math.atan2(dy, dx) * 180) / Math.PI),
      s: clamp(Math.hypot(dx, dy) / (box.width / 2)),
      v: 1,
    });
  };
  const release = (event: PointerEvent<HTMLElement>) => {
    if (!pressed || pressed === "key") return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPressed(false);
    commit();
  };
  const key = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const { h, s } = latest.current;
    const v = 1;
    const next =
      event.key === "ArrowRight"
        ? { h: wrap(h + step), s, v }
        : event.key === "ArrowLeft"
          ? { h: wrap(h - step), s, v }
          : event.key === "ArrowUp"
            ? { h, s: clamp(s + step / 100), v }
            : event.key === "ArrowDown"
              ? { h, s: clamp(s - step / 100), v }
              : undefined;
    if (!next) return;
    event.preventDefault();
    if (!pressed) setPressed("key");
    change(next);
  };

  const radians = (hsv.h * Math.PI) / 180;
  const at = {
    left: `${50 + Math.cos(radians) * hsv.s * 50}%`,
    top: `${50 + Math.sin(radians) * hsv.s * 50}%`,
  };
  const state = {
    "data-open": pressed ? "" : undefined,
    "data-touch": pressed === "touch" ? "" : undefined,
  };
  return (
    <GlassScene
      material="clear"
      appearance={appearance}
      motion={motion}
      maxSurfaces={2}
      className={`lg-color-picker ${className}`}
      data-disabled={disabled ? "" : undefined}
      style={
        {
          "--lg-color-wheel-size": `${size}px`,
          "--lg-color": current,
          ...style,
        } as CSSProperties
      }
    >
      <GlassContent className="lg-color-picker-canvas" aria-hidden="true">
        <div
          className="lg-color-wheel-colors"
          style={image ? { backgroundImage: `url("${image}")` } : undefined}
        />
      </GlassContent>
      <div
        ref={wheel}
        className="lg-color-wheel"
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
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          setPressed(event.pointerType === "touch" ? "touch" : "pointer");
          pick(event);
        }}
        onPointerMove={(event) => {
          if (pressed && pressed !== "key") pick(event);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={disabled ? undefined : key}
        onKeyUp={() => {
          if (pressed !== "key") return;
          setPressed(false);
          commit();
        }}
        onBlur={() => {
          if (pressed === "key") setPressed(false);
        }}
      >
        <span className="lg-color-lens-shadow" style={at} {...state} aria-hidden="true" />
        <GlassSurface
          radius="circle"
          refraction={refraction}
          specular={specular}
          className="lg-color-lens"
          style={at}
          {...state}
          aria-hidden="true"
        >
          <span className="lg-color-lens-point" />
        </GlassSurface>
        <span className="lg-color-knob" style={at} {...state} aria-hidden="true" />
      </div>
      {name && <input type="hidden" name={name} value={current} disabled={disabled} />}
    </GlassScene>
  );
}
