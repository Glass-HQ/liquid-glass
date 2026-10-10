interface PaintRootClaim {
  hints: Map<string, number>;
  tokens: string[];
  original: string;
  priority: string;
  owned: string | null;
  superseded: boolean;
}

const claims = new WeakMap<HTMLElement, PaintRootClaim>();
/** Keep WebKit's CSS reference filter in its target's own paint coordinates.
 * Acquire before applying the filter, and release when that filter is removed.
 * A shared target can be claimed by both scene and foreground filtering.
 */
export function acquireFilterPaintRoot(element: HTMLElement): () => void {
  return acquirePaintHint(element, "transform");
}

/** Keep popup mounting from changing the scene's composited backing in WebKit.
 * Opacity preserves the containing block of fixed-position descendants.
 */
export function acquireSceneCompositingLayer(element: HTMLElement): () => void {
  return acquirePaintHint(element, "opacity");
}

function acquirePaintHint(element: HTMLElement, hint: string): () => void {
  let claim = claims.get(element);
  if (!claim) {
    const style = element.style;
    const resolved = element.ownerDocument.defaultView?.getComputedStyle(element).willChange ?? style.getPropertyValue("will-change");
    claim = {
      hints: new Map(),
      tokens: resolved.split(",").map((token) => token.trim()).filter((token) => token && token !== "auto"),
      original: style.getPropertyValue("will-change"),
      priority: style.getPropertyPriority("will-change"),
      owned: null,
      superseded: false,
    };
    claims.set(element, claim);
  }
  const sync = () => {
    const style = element.style;
    // Later author declarations take precedence over all outstanding claims.
    if (style.getPropertyValue("will-change") !== (claim.owned ?? claim.original)
      || style.getPropertyPriority("will-change") !== (claim.owned === null ? claim.priority : "important")) claim.superseded = true;
    if (claim.superseded) return;
    const additions = [...claim.hints.keys()].filter((token) => !claim.tokens.includes(token));
    if (additions.length) {
      const value = [...claim.tokens, ...additions].join(", ");
      if (value !== claim.owned) style.setProperty("will-change", value, "important");
      claim.owned = style.getPropertyValue("will-change");
    } else if (claim.owned !== null) {
      if (claim.original) style.setProperty("will-change", claim.original, claim.priority);
      else style.removeProperty("will-change");
      claim.owned = null;
    }
  };
  claim.hints.set(hint, (claim.hints.get(hint) ?? 0) + 1);
  sync();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = claim.hints.get(hint)! - 1;
    if (count) claim.hints.set(hint, count);
    else claim.hints.delete(hint);
    sync();
    if (!claim.hints.size) claims.delete(element);
  };
}
