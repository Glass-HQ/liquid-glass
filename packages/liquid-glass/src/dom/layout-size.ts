/** An element's border-box size as layout gave it, before any transform. */
export function getLayoutSize(element: HTMLElement, style = window.getComputedStyle(element)): { width: number; height: number } {
  const px = (value: string) => value.endsWith("px") ? parseFloat(value) : NaN;
  const width = px(style.width), height = px(style.height);
  if (Number.isNaN(width) || Number.isNaN(height)) return { width: element.offsetWidth, height: element.offsetHeight };
  if (style.boxSizing === "border-box") return { width, height };
  const sum = (...values: string[]) => values.reduce((total, value) => total + (parseFloat(value) || 0), 0);
  return {
    width: width + sum(style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth),
    height: height + sum(style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth),
  };
}

/** Call back with the element's layout size once now and after each resize,
 * at most once per frame. */
export function observeLayoutSize(element: HTMLElement, callback: (size: { width: number; height: number }) => void): () => void {
  let frame: number | undefined;
  const measure = () => { frame = undefined; callback(getLayoutSize(element)); };
  const schedule = () => { frame ??= requestAnimationFrame(measure); };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : undefined;
  observer?.observe(element);
  schedule();
  return () => {
    observer?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
