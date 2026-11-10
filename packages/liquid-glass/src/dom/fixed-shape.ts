import { observeLayoutSize } from "./layout-size.js";
import { cornerOptions, shapeClip } from "../core/shape.js";
import type { GlassRadius } from "../core/shape.js";
import type { createShapeEffects } from "./shape-effects.js";

/** Whether the element has a border or box shadow its clip would cut. */
function hasEdgeEffects(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const border = style.borderTopStyle !== "none" && style.borderTopStyle !== "hidden" && parseFloat(style.borderTopWidth) > 0;
  return border || Boolean(style.boxShadow) && style.boxShadow !== "none";
}

/** Apply Lisse geometry without taking ownership of component data-slot/data-state. */
export function observeFixedShape(element: HTMLElement, radius: GlassRadius) {
  const options = cornerOptions(radius);
  const savedClip = element.style.clipPath;
  let effects: ReturnType<typeof createShapeEffects> | undefined;
  let last: { width: number; height: number } | undefined;
  // Measured once the effects have positioned the parent, which the offset is relative to.
  const offset = () => ({ x: element.offsetLeft, y: element.offsetTop });
  let stopped = false;
  // Most shapes have neither, so the code that redraws them loads on demand.
  if (hasEdgeEffects(element)) import("./shape-effects.js").then(({ createShapeEffects }) => {
    if (stopped) return;
    effects = createShapeEffects(element);
    if (last) effects.update(options, last.width, last.height, offset());
  }, () => undefined);
  const stop = observeLayoutSize(element, ({ width, height }) => {
    if (width <= 0 || height <= 0) return;
    element.style.clipPath = shapeClip(width, height, radius);
    last = { width, height };
    effects?.update(options, width, height, offset());
  });
  return () => {
    stopped = true;
    stop();
    effects?.dispose();
    element.style.clipPath = savedClip;
  };
}
