/** Native AppKit tracking: midpoint crossing, or 40% travel from an opposite-half press. */
export function switchDragState(drag: { start: number; x: number; left: number; width: number; rtl: boolean; oppositeHalf: boolean }, x: number): boolean {
  if (!drag.oppositeHalf) return (x >= drag.left + drag.width / 2) !== drag.rtl;
  const delta = (x - drag.x) * (drag.rtl ? -1 : 1);
  if (drag.start === 0) return delta > drag.width * 0.4;
  return delta >= -drag.width * 0.4;
}
