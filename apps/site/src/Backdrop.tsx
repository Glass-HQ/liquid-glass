import { useEffect, useRef } from "react"
import { backdropSizes, wallpaperImage } from "./wallpapers"

let worker: Worker | undefined
let requests = 0
const pending = new Map<number, (blob: Blob | undefined) => void>()
/** The cover crop of `src` at exactly `width` × `height` pixels. */
function cropWallpaper(src: string, width: number, height: number): Promise<Blob | undefined> {
  if (!worker) {
    worker = new Worker(new URL("./wallpaper-crop.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (event: MessageEvent<{ id: number; blob?: Blob }>) => {
      pending.get(event.data.id)?.(event.data.blob)
      pending.delete(event.data.id)
    }
  }
  const id = ++requests
  return new Promise((resolve) => {
    pending.set(id, resolve)
    worker!.postMessage({ id, src, width, height })
  })
}

/** Glass in Safari repaints the content beneath it on every animation frame,
 * and drawing a photo at a size other than its own costs several
 * milliseconds each time. Once the image loads, and when its box resizes,
 * replace it with its cover crop at the box's exact device size. */
function useDeviceSizedImage() {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const img = ref.current
    if (!img || typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return
    let source = "", url = "", timer = 0, generation = 0
    const render = async () => {
      const run = ++generation
      const box = img.getBoundingClientRect()
      const width = Math.round(box.width * devicePixelRatio), height = Math.round(box.height * devicePixelRatio)
      if (!source || !width || !height) return
      const blob = await cropWallpaper(source, width, height)
      if (!blob || run !== generation || !img.isConnected) return
      const previous = url
      url = URL.createObjectURL(blob)
      // Declare the crop's density, or the image keeps the one chosen for
      // its original source and is painted rescaled.
      img.removeAttribute("sizes")
      img.srcset = `${url} ${devicePixelRatio}x`
      img.src = url
      if (previous) URL.revokeObjectURL(previous)
    }
    const load = () => {
      // Keep the responsive source the browser chose, independent of the swap.
      if (source || !img.currentSrc) return
      source = img.currentSrc
      render()
    }
    if (img.complete) load()
    img.addEventListener("load", load)
    const sizes = new ResizeObserver(() => { clearTimeout(timer); timer = window.setTimeout(render, 150) })
    sizes.observe(img)
    return () => {
      generation++
      clearTimeout(timer)
      sizes.disconnect()
      img.removeEventListener("load", load)
      if (url) URL.revokeObjectURL(url)
    }
  }, [])
  return ref
}

export function Backdrop({
  kind = "landscape",
  appearance = "light",
}: {
  kind?: "landscape" | "type" | "grid"
  appearance?: "light" | "dark"
}) {
  if (kind === "type")
    return (
      <div className="type-backdrop">
        <div className="type-specimen">
          {["ABCDEFGHIJKLMN", "OPQRSTUVWXYZ", "abcdefghijklm", "nopqrstuvwxyz", "0123456789 &→!"].map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
    )
  if (kind === "grid")
    return (
      <div className="grid-backdrop">
        <div className="grid-colors" />
        <div className="grid-type">Aa</div>
      </div>
    )
  return <Landscape key={appearance} appearance={appearance} />
}

function Landscape({ appearance }: { appearance: "light" | "dark" }) {
  const ref = useDeviceSizedImage()
  return (
    <div className="landscape-backdrop">
      <img
        ref={ref}
        {...wallpaperImage(appearance === "dark" ? "night" : "day", backdropSizes)}
        alt=""
      />
    </div>
  )
}
