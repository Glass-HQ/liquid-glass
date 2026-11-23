/**
 * Bitmaps taken from a 2D canvas with `transferToImageBitmap`. WebKit uploads these to WebGL
 * with straight alpha while other engines premultiply them, so the worker is told which bitmaps
 * came this way and premultiplies them itself where the engine doesn't.
 */
const snapshots = new WeakSet<ImageBitmap>();

export function snapshot(canvas: OffscreenCanvas): ImageBitmap {
  const image = canvas.transferToImageBitmap();
  snapshots.add(image);
  return image;
}

export function isSnapshot(image: ImageBitmap): boolean {
  return snapshots.has(image);
}
