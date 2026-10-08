interface PaintRootClaim {
  count: number;
  original: string;
  priority: string;
  owned: string | null;
}

const claims = new WeakMap<HTMLElement, PaintRootClaim>();

/** Keep WebKit's CSS reference filter in its target's own paint coordinates.
 * Acquire before applying the filter, and release when that filter is removed.
 * A shared target can be claimed by both scene and foreground filtering.
 */
export function acquireFilterPaintRoot(element: HTMLElement): () => void {
  let claim = claims.get(element);
  if (!claim) {
    const style = element.style;
    claim = {
      count: 0,
      original: style.getPropertyValue("will-change"),
      priority: style.getPropertyPriority("will-change"),
      owned: null,
    };
    const resolved = element.ownerDocument.defaultView?.getComputedStyle(element).willChange ?? claim.original;
    const tokens = resolved.split(",").map((token) => token.trim()).filter((token) => token && token !== "auto");
    if (!tokens.includes("transform")) {
      tokens.push("transform");
      // Retain the author's other hints, including stylesheet declarations.
      // Important is needed when the original hint comes from an important
      // stylesheet rule. The exact inline declaration is restored on release.
      style.setProperty("will-change", tokens.join(", "), "important");
      claim.owned = style.getPropertyValue("will-change");
    }
    claims.set(element, claim);
  }
  claim.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--claim.count) return;
    claims.delete(element);
    const style = element.style;
    // An author can change this property while glass is active. Do not erase
    // a newer declaration when releasing our claim.
    if (claim.owned === null || style.getPropertyValue("will-change") !== claim.owned || style.getPropertyPriority("will-change") !== "important") return;
    if (claim.original) style.setProperty("will-change", claim.original, claim.priority);
    else style.removeProperty("will-change");
  };
}
