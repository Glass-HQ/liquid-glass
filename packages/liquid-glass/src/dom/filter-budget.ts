/** WebKit paints CSS reference filters in software and adds up the outsets of
 * every blur and displacement primitive in an element's filters: along a
 * chain of `url()` filters, and across the branches of one filter's graph,
 * whose walk folds only one level at a time and sums what it leaves behind.
 * It then clamps the whole filter buffer to 4096 × 4096 device pixels, and
 * past that clamp draws the result stretched, so glass lands away from its
 * surface. Keeping the sum of outsets inside the budget keeps the geometry
 * exact; the material only softens on scenes that would otherwise overflow. */
/** iOS browser brands can report a different vendor while still using WebKit. */
export function isWebKit(agent: Pick<Navigator, "vendor" | "userAgent">): boolean {
  return agent.vendor === "Apple Computer, Inc." ||
    /AppleWebKit\//.test(agent.userAgent) && !/(?:Chrome|Chromium|Edg|OPR|SamsungBrowser)\//.test(agent.userAgent);
}
export const webkit = typeof navigator !== "undefined" && isWebKit(navigator);
/** Outsets WebKit charges for one Gaussian blur of this sigma, in the blur's own pixels. */
export const blurOutsets = (sigma: number): number => 3 * (sigma * 0.75 * Math.sqrt(2 * Math.PI)) / 2;
const limit = 4096 * 4096 * 0.9;
/** Factor to apply to every blur sigma and displacement amount so a filtered
 * box of `width` × `height` device pixels with `outsets` device pixels of
 * accumulated outsets stays inside WebKit's buffer clamp. 1 when it already fits. */
export function filterBudgetFactor(width: number, height: number, outsets: number): number {
  if (!webkit || outsets <= 0 || (width + 2 * outsets) * (height + 2 * outsets) <= limit) return 1;
  const fit = (-(width + height) + Math.sqrt((width + height) ** 2 - 4 * (width * height - limit))) / 4;
  return Math.max(0.1, Math.min(1, fit / outsets));
}
