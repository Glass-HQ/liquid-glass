export function edgeDisplacement(
  distance: number,
  amount: number,
  inverseHeight: number,
): number {
  const depth = Math.max(0, Math.min(1, -distance * inverseHeight));
  return (
    amount * (1 - Math.max(0, Math.min(1, Math.sqrt((2 - depth) * depth))))
  );
}
