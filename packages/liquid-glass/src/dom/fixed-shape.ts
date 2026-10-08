import {
  acquirePosition, createDropShadow, createSvgEffects, extractAndStripEffects,
  getLayoutSize, hasEffects, observeAnchor, observeResize,
  releasePosition, restoreStyles,
} from "@lisse/core";
import { cornerOptions, shapeClip } from "../core/shape.js";
import type { GlassRadius } from "../core/shape.js";

/** Apply Lisse geometry without taking ownership of component data-slot/data-state. */
export function observeFixedShape(element: HTMLElement, radius: GlassRadius) {
  const options = cornerOptions(radius);
  const savedClip = element.style.clipPath;
  // Preserve the existing static CSS-effects behavior. Dynamic state styling
  // must not be confused with the geometry observer's resize lifecycle.
  const extracted = extractAndStripEffects(element);
  const anchor = hasEffects(extracted.effects) ? element.parentElement : null;
  const acquired = anchor ? acquirePosition(anchor) : false;
  const effects = anchor ? createSvgEffects(anchor, element) : null;
  const shadow = anchor && extracted.effects.shadow ? createDropShadow(anchor, element) : null;
  const stopAnchor = anchor ? observeAnchor(anchor, element) : null;
  const stop = observeResize(element, measured => {
    const { width, height } = measured ?? getLayoutSize(element);
    if (width <= 0 || height <= 0) return;
    element.style.clipPath = shapeClip(width, height, radius);
    if (effects) {
      const offset = { x: measured?.offsetLeft ?? element.offsetLeft, y: measured?.offsetTop ?? element.offsetTop };
      effects.update(options, extracted.effects, width, height, offset);
      if (shadow && extracted.effects.shadow)
        shadow.update(options, extracted.effects.shadow, width, height, offset);
    }
  });
  return () => {
    stop();
    stopAnchor?.();
    effects?.destroy();
    shadow?.destroy();
    if (acquired && anchor) releasePosition(anchor);
    restoreStyles(element, extracted.savedStyles);
    element.style.clipPath = savedClip;
  };
}
