import type { FilterBounds } from "./filter-bounds.js";

/** Source pixels a displacement map can read, including its image border.
 * `box` is the positioned feImage rectangle, including the two-pixel map
 * border. Only a symmetric Lisse field may opt into the inward bound;
 * arbitrary outlines and outward (negative) refraction keep full reach. */
export function refractionSamplingBounds(box: FilterBounds, amount: number, symmetric = false): FilterBounds {
  const reach = Math.abs(amount);
  const outset = (extent: number) => {
    if (!symmetric || amount < 0) return reach + 3;
    // The left half points right, and the right half points left. Thus a
    // sample remains within [center - reach, center + reach] or the image
    // itself. An 8-bit map's neutral 128 introduces at most reach / 255 of
    // outward bias. Three pixels preserve interpolation and AA support.
    return Math.min(reach, Math.max(0, reach - extent / 2) + reach / 255) + 3;
  };
  const x = outset(box.width), y = outset(box.height);
  return { x: box.x - x, y: box.y - y, width: box.width + 2 * x, height: box.height + 2 * y };
}

/** Combine independently proven sampling regions. Arithmetic map blends
 * can quantize premultiplied channels at low alpha; callers must use full
 * reach for such blends unless their opaque coverage is known to coincide. */
export function unionSamplingBounds(boxes: readonly FilterBounds[]): FilterBounds {
  if (!boxes.length) throw new RangeError("At least one sampling box is required.");
  const x = Math.min(...boxes.map((box) => box.x)), y = Math.min(...boxes.map((box) => box.y));
  return {
    x, y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}
