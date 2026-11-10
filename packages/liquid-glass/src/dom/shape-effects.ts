import {
  acquirePosition, createDropShadow, createSvgEffects, extractAndStripEffects,
  hasEffects, observeAnchor, releasePosition, restoreStyles,
} from "@lisse/core";
import type { SmoothCornerOptions } from "@lisse/core";

/** Redraw an element's border and box shadows along its continuous outline,
 * which its clip would otherwise cut. Loaded only for shapes that have them. */
export function createShapeEffects(element: HTMLElement) {
  const extracted = extractAndStripEffects(element);
  const anchor = hasEffects(extracted.effects) ? element.parentElement : null;
  const acquired = anchor ? acquirePosition(anchor) : false;
  const effects = anchor ? createSvgEffects(anchor, element) : null;
  const shadow = anchor && extracted.effects.shadow ? createDropShadow(anchor, element) : null;
  const stopAnchor = anchor ? observeAnchor(anchor, element) : null;
  return {
    update(options: SmoothCornerOptions, width: number, height: number, offset: { x: number; y: number }) {
      effects?.update(options, extracted.effects, width, height, offset);
      if (shadow && extracted.effects.shadow) shadow.update(options, extracted.effects.shadow, width, height, offset);
    },
    dispose() {
      stopAnchor?.();
      effects?.destroy();
      shadow?.destroy();
      if (acquired && anchor) releasePosition(anchor);
      restoreStyles(element, extracted.savedStyles);
    },
  };
}
