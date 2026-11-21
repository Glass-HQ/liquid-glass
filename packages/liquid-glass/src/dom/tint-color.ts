/** A tint written as a six-digit hex color, which the glass filter reads
 * directly. Any other CSS color, including `var(--accent)` or `oklch(…)`, is
 * resolved on the surface it tints (see `resolveTint`). */
export const hexTint = /^#[\da-f]{6}$/i;

const resolved = new Map<string, string | undefined>();
let context: CanvasRenderingContext2D | null | undefined;

/** A computed CSS color as a six-digit hex color, or undefined for none or a
 * fully transparent one. A 1×1 canvas parses every color syntax the browser
 * knows; results are cached, so a theme's few colors are read once. */
export function colorToHex(color: string): string | undefined {
  const value = color.trim();
  if (hexTint.test(value)) return value.toLowerCase();
  if (!value) return undefined;
  if (resolved.has(value)) return resolved.get(value);
  context ??=
    typeof document === "undefined"
      ? null
      : document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  let hex: string | undefined;
  if (context) {
    context.canvas.width = context.canvas.height = 1;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    hex =
      a === 0
        ? undefined
        : `#${[r!, g!, b!].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  resolved.set(value, hex);
  return hex;
}

/** The hex color `tint` is on `element`, which carries it as `--lg-tint`, so
 * custom properties resolve where the glass is and follow theme changes. */
export function resolveTint(element: HTMLElement, tint: string): string | undefined {
  if (hexTint.test(tint)) return tint;
  if (element.style.getPropertyValue("--lg-tint") !== tint)
    element.style.setProperty("--lg-tint", tint);
  return colorToHex(getComputedStyle(element).getPropertyValue("--lg-tint"));
}
