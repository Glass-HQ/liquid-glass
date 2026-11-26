import { EDGE_COVER_END, edgeCover } from "./material";

/**
 * The CSS mask for an element whose content a replacing progressive blur stands in for (a
 * see-through scroller under `GlassProgressiveBlur` with `replace`). Under the blur the content
 * fades out exactly as the blur fades in, so the sharp content never shows through the blurred
 * copy drawn over it, and the two add up to the content where they cross.
 *
 * `start` and `end` are the sizes (CSS px) of the blurs at the element's start (top, or left
 * along "x") and end; zero or nothing for none. With neither, there is no mask.
 */
export function progressiveBlurMask(options: {
  readonly axis?: "x" | "y";
  readonly start?: number;
  readonly end?: number;
}): string {
  const { axis = "y", start = 0, end = 0 } = options;
  if (start <= 0 && end <= 0) return "none";
  // Points along a blur from its faint side, as far as it takes to cover the page fully.
  const points = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((share) => share * EDGE_COVER_END);
  const alpha = (along: number) => +(1 - edgeCover(along)).toFixed(3);
  const stops = [
    ...(start > 0
      ? points
          .toReversed()
          .map((along) => `rgba(0,0,0,${alpha(along)}) ${+((1 - along) * start).toFixed(2)}px`)
      : ["#000 0px"]),
    ...(end > 0
      ? points.map(
          (along) =>
            `rgba(0,0,0,${alpha(along)}) calc(100% - ${+((1 - along) * end).toFixed(2)}px)`,
        )
      : ["#000 100%"]),
  ];
  return `linear-gradient(to ${axis === "y" ? "bottom" : "right"}, ${stops.join(", ")})`;
}
