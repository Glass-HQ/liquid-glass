/** Crops and resamples a wallpaper to a box's device size, off the main
 * thread: encoding a full-window image takes tens of milliseconds. */
self.onmessage = async (event: MessageEvent<{ id: number; src: string; width: number; height: number }>) => {
  const { id, src, width, height } = event.data
  try {
    const blob = await (await fetch(src)).blob()
    const size = await createImageBitmap(blob)
    const scale = Math.max(width / size.width, height / size.height)
    const sw = width / scale, sh = height / scale
    const bitmap = await createImageBitmap(blob, (size.width - sw) / 2, (size.height - sh) / 2, sw, sh,
      { resizeWidth: width, resizeHeight: height, resizeQuality: "high" })
    size.close()
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
    bitmap.close()
    self.postMessage({ id, blob: await canvas.convertToBlob({ type: "image/png" }) })
  } catch {
    self.postMessage({ id })
  }
}
