import { useEffect, useRef } from "react"
import type { CSSProperties, RefObject } from "react"

const bands = [0.5, 1, 2, 4, 8, 16]

/** Fixed page-edge blur; scrolling demo scenes keep their own paint layers. */
export function PageEdgeBlur({ target }: { target: RefObject<HTMLElement | null> }) {
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const viewport = target.current
    if (!viewport) return
    let frame = 0
    let previous = ""
    const update = () => {
      frame = 0
      const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const start = Math.min(1, Math.max(0, viewport.scrollTop) / 32)
      const end = Math.min(1, Math.max(0, maximum - viewport.scrollTop) / 32)
      const key = `${start},${end}`
      if (key === previous) return
      previous = key
      top.current?.style.setProperty("--page-blur-top", String(start))
      bottom.current?.style.setProperty("--page-blur-bottom", String(end))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const resize = new ResizeObserver(schedule)
    resize.observe(viewport)
    for (const child of viewport.children) resize.observe(child)
    viewport.addEventListener("scroll", schedule, { passive: true })
    update()
    return () => {
      viewport.removeEventListener("scroll", schedule)
      resize.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [target])
  const layers = bands.map((blur, index) => <span key={blur} style={{
    "--edge-blur": `${blur}px`,
    "--edge-start": `${index * 12}%`,
    "--edge-end": `${(index + 2) * 12}%`,
  } as CSSProperties} />)
  return <>
    <div ref={top} className="page-edge-blur is-top" aria-hidden="true">{layers}</div>
    <div ref={bottom} className="page-edge-blur is-bottom" aria-hidden="true">{layers}</div>
  </>
}
