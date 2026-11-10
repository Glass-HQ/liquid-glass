/** Several scenes can filter one element: a nested scene filters its own
 * content, and in WebKit an outer scene adds its glass to the same element
 * once it is composited apart from the outer content. Each writes its part;
 * the element's `filter` chains them inner scene first, after the authored
 * value, and returns to the authored value when every part is released. */
interface Chain {
  original: string;
  base: string;
  priority: string;
  parts: Map<string, { depth: number; value: string }>;
  applied?: string;
}
const chains = new WeakMap<HTMLElement, Chain>();

function chainOf(element: HTMLElement): Chain {
  let chain = chains.get(element);
  if (!chain) {
    const original = element.style.getPropertyValue("filter");
    // CSS-wide keywords cannot be concatenated with filter functions. Keep
    // the authored declaration for cleanup and compose its resolved value.
    const base = /^(initial|inherit|unset|revert|revert-layer)$/i.test(original.trim())
      ? element.ownerDocument.defaultView?.getComputedStyle(element).filter ?? "" : original;
    chain = { original, base: base.trim().toLowerCase() === "none" ? "" : base, priority: element.style.getPropertyPriority("filter"), parts: new Map() };
    chains.set(element, chain);
  }
  return chain;
}

function write(element: HTMLElement, chain: Chain) {
  const parts = [...chain.parts.values()].filter((part) => part.value).sort((a, b) => b.depth - a.depth).map((part) => part.value);
  const next = parts.length ? [chain.base, ...parts].filter(Boolean).join(" ") : chain.original;
  if (element.style.getPropertyValue("filter") !== next || element.style.getPropertyPriority("filter") !== chain.priority)
    element.style.setProperty("filter", next, chain.priority);
  chain.applied = element.style.getPropertyValue("filter");
}

/** Set one owner's filters on an element; an empty value draws nothing but keeps the claim. */
export function setFilterPart(element: HTMLElement, owner: string, depth: number, value: string): void {
  const chain = chainOf(element);
  const part = chain.parts.get(owner);
  if (part?.value === value && part.depth === depth && chain.applied === element.style.getPropertyValue("filter")) return;
  chain.parts.set(owner, { depth, value });
  write(element, chain);
}

export function releaseFilterPart(element: HTMLElement, owner: string): void {
  const chain = chains.get(element);
  if (!chain?.parts.delete(owner)) return;
  if (chain.parts.size) { write(element, chain); return; }
  chains.delete(element);
  if (chain.applied !== undefined && element.style.getPropertyValue("filter") === chain.applied && element.style.getPropertyPriority("filter") === chain.priority) {
    if (chain.original) element.style.setProperty("filter", chain.original, chain.priority);
    else element.style.removeProperty("filter");
  }
}

const roots = new WeakSet<Element>();
export function registerSceneRoot(root: Element): () => void {
  roots.add(root);
  return () => roots.delete(root);
}
/** How many glass scenes enclose this one; inner scenes filter first. */
export function sceneDepth(root: Element): number {
  let depth = 0;
  for (let node = root.parentElement; node; node = node.parentElement) if (roots.has(node)) depth++;
  return depth;
}
