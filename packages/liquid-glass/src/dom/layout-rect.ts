/** A box on screen as layout placed it, before any `scale` that glass writes
 * while it is pressed. Interactive glass grows under a press; a popup
 * anchored to something inside it would otherwise move with it. */
export interface LayoutRect {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function scaleOf(element: HTMLElement): [number, number] | undefined {
  const value = element.style.scale;
  if (!value || value === "none") return;
  const [sx = 1, sy = sx] = value.split(/\s+/).map(Number);
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || (sx === 1 && sy === 1) || !sx || !sy) return;
  return [sx, sy];
}

/** `element`'s client rect with every inline `scale` on it and its ancestors
 * undone. Each scale is undone about its own transform origin, outermost
 * first, so nested pressed glass resolves too. */
export function layoutRect(element: HTMLElement): LayoutRect {
  const scaled: { node: HTMLElement; scale: [number, number] }[] = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const scale = scaleOf(node);
    if (scale) scaled.unshift({ node, scale });
  }
  const undo: { ox: number; oy: number; sx: number; sy: number }[] = [];
  const map = (x: number, y: number): [number, number] => {
    for (const { ox, oy, sx, sy } of undo) {
      x = ox + (x - ox) / sx;
      y = oy + (y - oy) / sy;
    }
    return [x, y];
  };
  for (const { node, scale } of scaled) {
    const box = node.getBoundingClientRect();
    const [left, top] = map(box.left, box.top);
    const origin = getComputedStyle(node).transformOrigin.split(" ").map(parseFloat);
    const [ox = 0, oy = 0] = origin;
    // The origin's layout offset, in px, scaled into where it sits now.
    undo.push({ ox: left + ox * scale[0], oy: top + oy * scale[1], sx: scale[0], sy: scale[1] });
  }
  const box = element.getBoundingClientRect();
  const [left, top] = map(box.left, box.top);
  const [right, bottom] = map(box.right, box.bottom);
  return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}
