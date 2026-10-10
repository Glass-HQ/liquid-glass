/** Rendering engine, which decides how SVG filters on HTML are painted:
 * Chromium on the GPU, WebKit and Gecko mostly in software. */
/** iOS browser brands can report a different vendor while still using WebKit. */
export function isWebKit(agent: Pick<Navigator, "vendor" | "userAgent">): boolean {
  return agent.vendor === "Apple Computer, Inc." ||
    /AppleWebKit\//.test(agent.userAgent) && !/(?:Chrome|Chromium|Edg|OPR|SamsungBrowser)\//.test(agent.userAgent);
}
export const webkit = typeof navigator !== "undefined" && isWebKit(navigator);
/** Gecko caps a filter chain at 64 operations and renders graphs with images
 * or displacement in software. */
export const gecko = typeof navigator !== "undefined" && /Gecko\//.test(navigator.userAgent) && !/like Gecko/.test(navigator.userAgent);
export const chromium = typeof navigator !== "undefined" && !webkit && !gecko;
