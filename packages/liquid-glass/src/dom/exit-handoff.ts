const exits = new WeakMap<Element, () => void>();

/** Once a replacement starts entering, its sibling no longer owns the
 * submenu slot. Finish the old return before painting the new glass. */
export function finishRetainedExit(parent: Element): void {
  const complete = exits.get(parent);
  exits.delete(parent);
  complete?.();
}

/** A submenu's newest outgoing sibling keeps its return animation. Older
 * exits have already been superseded: finish them before another panel
 * starts returning, rather than accumulating overlapping optical layers. */
export function retainLatestExit(parent: Element, complete: () => void): () => void {
  const previous = exits.get(parent);
  exits.set(parent, complete);
  previous?.();
  return () => { if (exits.get(parent) === complete) exits.delete(parent); };
}
