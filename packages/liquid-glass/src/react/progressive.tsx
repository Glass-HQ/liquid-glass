import { Fragment } from "react";
import type { ComponentPropsWithRef, CSSProperties } from "react";
import type { BlurEdge } from "../protocol";

/**
 * Progressive blur: content is blurred most at one side and not at all a little way in, the way
 * it softens as it scrolls under a toolbar. Five blurs, each twice the last, are laid over one
 * another; each fades out along the same eased curve, and the stronger ones reach less far in, so
 * the blur deepens towards the edge without a visible step and the heaviest pull colours into one
 * another right at the edge.
 *
 * Two forms draw the same thing:
 * - `GlassProgressiveBlur` lays the blurs over what's behind it (the browser's backdrop blur).
 *   It needs an opaque surface behind: over a see-through one, the sharp content still shows
 *   through the blurred copy.
 * - `GlassProgressiveBlurFilter` is an SVG filter that blurs the element it's applied to, which
 *   works over see-through surfaces too, at the cost of filtering that element's pixels.
 */

/** How each layer fades: an ease-out run of opacities, at these points along its reach (%). */
const FADE = [
  1, 0.99, 0.953, 0.894, 0.824, 0.74, 0.647, 0.55, 0.45, 0.353, 0.26, 0.176, 0.106, 0.047, 0.01, 0,
];
const STOPS = [
  0, 8.1, 15.5, 22.5, 29, 35.3, 41.2, 47.1, 52.9, 58.8, 64.7, 71, 77.5, 84.5, 91.9, 100,
];

/** The layers, lightest first: a blur radius (CSS px) and how far in it reaches (0 to 1). */
const LAYERS = [
  { blur: 4, reach: 1 },
  { blur: 8, reach: 0.82 },
  { blur: 16, reach: 0.66 },
  { blur: 32, reach: 0.5 },
  { blur: 64, reach: 0.36 },
] as const;

const TOWARDS: Record<BlurEdge, string> = {
  top: "to bottom",
  bottom: "to top",
  left: "to right",
  right: "to left",
};

const gradient = (edge: BlurEdge, reach: number) =>
  `linear-gradient(${TOWARDS[edge]}, ${FADE.map(
    (alpha, index) => `rgba(0,0,0,${alpha}) ${+((STOPS[index] ?? 100) * reach).toFixed(2)}%`,
  ).join(", ")})`;

const GRADIENTS: Record<BlurEdge, readonly string[]> = {
  top: LAYERS.map((layer) => gradient("top", layer.reach)),
  bottom: LAYERS.map((layer) => gradient("bottom", layer.reach)),
  left: LAYERS.map((layer) => gradient("left", layer.reach)),
  right: LAYERS.map((layer) => gradient("right", layer.reach)),
};

export interface GlassProgressiveBlurProps extends ComponentPropsWithRef<"div"> {
  /** The side the blur is strongest at; it fades out towards the opposite side. Default: "top". */
  edge?: BlurEdge;
  /** CSS color the blur fades into at its strong side, its alpha the strength (a bar's color). */
  tint?: string | null;
}

const layerStyle = (blur: number, maskImage: string): CSSProperties => ({
  position: "absolute",
  inset: 0,
  backdropFilter: `blur(${blur}px)`,
  WebkitBackdropFilter: `blur(${blur}px)`,
  maskImage,
  WebkitMaskImage: maskImage,
});

/**
 * Blurs what's behind it, most at `edge`. Size and place it with CSS (a plain `div`,
 * `pointer-events: none` by default, which its layers fill). Needs no glass scene.
 */
export function GlassProgressiveBlur({
  edge = "top",
  tint = null,
  style,
  ...props
}: GlassProgressiveBlurProps) {
  const masks = GRADIENTS[edge];
  return (
    <div
      aria-hidden="true"
      data-lg-progressive=""
      {...props}
      style={{ pointerEvents: "none", ...style }}
    >
      {LAYERS.map((layer, index) => (
        <div key={layer.blur} style={layerStyle(layer.blur, masks[index] ?? "none")} />
      ))}
      {tint === null ? null : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(${TOWARDS[edge]}, ${tint}, transparent)`,
          }}
        />
      )}
    </div>
  );
}

/** One blurred band of a filtered element: its strong `edge`, `size` deep, `at` px along its axis. */
export type GlassProgressiveBlurBand = Readonly<{
  edge: BlurEdge;
  /** Where the band starts along its axis, in the filtered element's CSS px (top or left). */
  at: number;
  size: number;
}>;

export interface GlassProgressiveBlurFilterProps {
  /** The filter's id: the element to blur takes `filter: url(#id)`. */
  id: string;
  bands: ReadonlyArray<GlassProgressiveBlurBand>;
}

/** Rows of a band's mask image; the filter stretches it over the band. */
const MASK_LENGTH = 256;
const maskCache = new Map<string, string>();

/**
 * A layer's mask as a PNG: an SVG image would be drawn again each time the filter runs, which
 * makes scrolling under it stutter; a PNG is decoded once.
 */
const maskImage = (edge: BlurEdge, reach: number): string => {
  const key = `${edge}:${reach}`;
  const known = maskCache.get(key);
  if (known !== undefined) return known;
  if (typeof document === "undefined") return "";
  const sideways = edge === "left" || edge === "right";
  const canvas = document.createElement("canvas");
  canvas.width = sideways ? MASK_LENGTH : 1;
  canvas.height = sideways ? 1 : MASK_LENGTH;
  const context = canvas.getContext("2d");
  if (context === null) return "";
  const end = sideways ? [MASK_LENGTH, 0] : [0, MASK_LENGTH];
  const fill =
    edge === "top" || edge === "left"
      ? context.createLinearGradient(0, 0, end[0] ?? 0, end[1] ?? 0)
      : context.createLinearGradient(end[0] ?? 0, end[1] ?? 0, 0, 0);
  FADE.forEach((alpha, index) =>
    fill.addColorStop(((STOPS[index] ?? 100) * reach) / 100, `rgba(255,255,255,${alpha})`),
  );
  context.fillStyle = fill;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/png");
  maskCache.set(key, url);
  return url;
};

/** The band's box: along its axis from `at` for `size`, and the element's whole width across. */
const box = (edge: BlurEdge, at: number, size: number) =>
  edge === "top" || edge === "bottom"
    ? { x: "0", y: at, width: "100%", height: size }
    : { x: at, y: "0", width: size, height: "100%" };

/**
 * The same blur as `GlassProgressiveBlur`, as an SVG filter for the element to blur. Each layer
 * blurs what the layers before it made, inside the band, and is kept only where its mask is, so
 * the result matches the layers laid over one another.
 */
export function GlassProgressiveBlurFilter({ id, bands }: GlassProgressiveBlurFilterProps) {
  // Every band's layers in one chain: each step reads what the step before it made.
  const steps = bands.flatMap(({ edge, at, size }) =>
    LAYERS.map(({ blur, reach }) => ({ edge, at, size, blur, reach })),
  );
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <defs>
        <filter
          id={id}
          x="0"
          y="0"
          width="100%"
          height="100%"
          primitiveUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          {steps.map(({ edge, at, size, blur, reach }, index) => {
            const from = index === 0 ? "SourceGraphic" : `lg-pb-${index - 1}`;
            // The blur reads past the band on both sides, so the band's inner edge pulls in
            // what's beside it.
            const reachOut = blur * 3;
            const start = Math.max(0, at - reachOut);
            return (
              <Fragment key={`${edge}-${at}-${blur}`}>
                <feImage
                  href={maskImage(edge, reach)}
                  {...box(edge, at, size)}
                  preserveAspectRatio="none"
                  result={`lg-pm-${index}`}
                />
                {/* CSS's blur radius is the Gaussian's standard deviation. */}
                <feGaussianBlur
                  in={from}
                  stdDeviation={blur}
                  edgeMode="duplicate"
                  {...box(edge, start, size + reachOut * 2)}
                  result={`lg-pg-${index}`}
                />
                <feComposite
                  in={`lg-pg-${index}`}
                  in2={`lg-pm-${index}`}
                  operator="in"
                  result={`lg-ps-${index}`}
                />
                <feComposite
                  in={from}
                  in2={`lg-pm-${index}`}
                  operator="out"
                  result={`lg-pr-${index}`}
                />
                {/* The kept blur and what's left of the layer before add up exactly, rather
                      than a translucent blur being laid over a sharp copy. */}
                <feComposite
                  in={`lg-ps-${index}`}
                  in2={`lg-pr-${index}`}
                  operator="arithmetic"
                  k2="1"
                  k3="1"
                  result={`lg-pb-${index}`}
                />
              </Fragment>
            );
          })}
        </filter>
      </defs>
    </svg>
  );
}
