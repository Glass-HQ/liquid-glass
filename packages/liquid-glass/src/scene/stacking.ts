/**
 * Ranks glass surfaces in the order the browser paints them, so each surface sees exactly the
 * surfaces painted below it.
 *
 * Two surfaces are compared inside their nearest common stacking context: whichever of the
 * contexts that contain them (directly under the common one) has the higher z-index paints
 * later, and on a tie the later one in the document does. Every surface is a stacking context
 * itself (`isolation: isolate`), and a stacking context without a z-index paints at level 0, so
 * this matches CSS painting order for everything a surface can be inside. A surface nested in
 * another paints above it.
 */

interface Info {
  readonly context: boolean;
  readonly z: number;
}

const zApplies = (style: CSSStyleDeclaration, parent: CSSStyleDeclaration | null): boolean =>
  style.position !== "static" ||
  (parent !== null && /^(inline-)?(flex|grid)$/.test(parent.display));

function createsContext(
  element: Element,
  style: CSSStyleDeclaration,
  parent: CSSStyleDeclaration | null,
): boolean {
  if (element === element.ownerDocument.documentElement) return true;
  if (style.position === "fixed" || style.position === "sticky") return true;
  if (style.zIndex !== "auto" && zApplies(style, parent)) return true;
  if (parseFloat(style.opacity) < 1) return true;
  if (
    style.transform !== "none" ||
    style.translate !== "none" ||
    style.rotate !== "none" ||
    style.scale !== "none"
  )
    return true;
  if (style.filter !== "none" || (style.backdropFilter ?? "none") !== "none") return true;
  if (style.clipPath !== "none" || (style.maskImage ?? "none") !== "none") return true;
  if (style.mixBlendMode !== "normal" || style.isolation === "isolate") return true;
  if (/\b(transform|opacity|filter|translate|rotate|scale)\b/.test(style.willChange)) return true;
  if (/\b(layout|paint|strict|content)\b/.test(style.contain)) return true;
  if (style.containerType === "size" || style.containerType === "inline-size") return true;
  return false;
}

export function rankSurfaces(surfaces: readonly HTMLElement[]): Map<HTMLElement, number> {
  const infos = new Map<Element, Info>();
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (element: Element) => {
    let style = styles.get(element);
    if (!style) {
      style = getComputedStyle(element);
      styles.set(element, style);
    }
    return style;
  };
  const infoOf = (element: Element): Info => {
    let info = infos.get(element);
    if (!info) {
      const style = styleOf(element);
      const parent = element.parentElement ? styleOf(element.parentElement) : null;
      const z =
        style.zIndex !== "auto" && zApplies(style, parent) ? parseInt(style.zIndex, 10) || 0 : 0;
      info = { context: createsContext(element, style, parent), z };
      infos.set(element, info);
    }
    return info;
  };
  // Each surface's stacking contexts, from itself up to the root.
  const chains = new Map<HTMLElement, Element[]>();
  for (const surface of surfaces) {
    const chain: Element[] = [surface];
    for (let node = surface.parentElement; node; node = node.parentElement)
      if (infoOf(node).context) chain.push(node);
    chains.set(surface, chain);
  }

  const compare = (a: HTMLElement, b: HTMLElement): number => {
    if (a === b) return 0;
    if (a.contains(b)) return -1;
    if (b.contains(a)) return 1;
    const ca = chains.get(a) ?? [a];
    const cb = chains.get(b) ?? [b];
    const inB = new Set(cb);
    let i = 0;
    while (i < ca.length && !inB.has(ca[i]!)) i += 1;
    const common = ca[i];
    const childA = ca[i - 1] ?? a;
    const childB = common ? (cb[cb.indexOf(common) - 1] ?? b) : (cb.at(-1) ?? b);
    const za = infoOf(childA).z;
    const zb = infoOf(childB).z;
    if (za !== zb) return za - zb;
    return childA.compareDocumentPosition(childB) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  };

  const sorted = [...surfaces].sort(compare);
  return new Map(sorted.map((surface, index) => [surface, index + 1]));
}
