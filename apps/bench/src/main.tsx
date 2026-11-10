import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@glass-sdk/liquid-glass/styles.css"
import "./bench.css"
import measures from "../scenes.json"
import { scenes } from "./scenes"
import type { Driver } from "./scenes"

const params = new URLSearchParams(location.search)
const name = params.get("scene") ?? ""
const scene = scenes[name]
/** Present when the runner opened this page; a scene opened by hand only plays. */
const run = params.get("run")
const root = document.getElementById("root")!
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))

/** Frames the page produced. In Safari and Firefox filters render after the
 * frame callback, so this counts frames started, not frames shown. */
function recordFrames() {
  const times: number[] = []
  let recording = true, hidden = document.visibilityState !== "visible"
  const step = (now: number) => {
    if (!recording) return
    times.push(now)
    hidden ||= document.visibilityState !== "visible"
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
  return () => {
    recording = false
    const gaps = times.slice(1).map((time, i) => time - times[i]!).sort((a, b) => a - b)
    const at = (p: number) => +(gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] ?? 0).toFixed(2)
    return { frames: times.length, median: at(0.5), p95: at(0.95), max: at(1), over50: gaps.filter((gap) => gap > 50).length, hidden }
  }
}
/** What one redraw of the page's glass filters has to compute: the area of
 * every filter step, in megapixels of the screen. Safari and Firefox compute
 * filters on the CPU, where time follows this number; unlike a timing, it is
 * the same on every machine and every run. */
function filterWork() {
  let filters = 0, steps = 0, megapixels = 0
  for (const element of document.querySelectorAll<HTMLElement>('[style*="url("]')) {
    const box = { width: element.offsetWidth, height: element.offsetHeight }
    for (const [, id] of element.style.filter.matchAll(/url\("?#([^")]+)"?\)/g)) {
      const filter = document.getElementById(id!)
      if (!filter) continue
      filters++
      const part = (name: string, fallback: number) => Number(filter.getAttribute(name) ?? fallback)
      const region = box.width * part("width", 1.2) * box.height * part("height", 1.2)
      for (const step of filter.children) {
        const width = step.getAttribute("width"), height = step.getAttribute("height")
        steps++
        megapixels += Math.min(region, width && height ? Number(width) * Number(height) : region) * devicePixelRatio ** 2 / 1e6
      }
    }
  }
  return { filters, steps, megapixels }
}
/** Counts the frames in which any filter changed, and the most work one of them asked for. */
function watchFilters() {
  const dump = new URLSearchParams(location.search).has("dump")
  let redraws = 0, changed = false, peak = filterWork(), markup: string[] | undefined
  const observer = new MutationObserver((records) => {
    if (changed || !records.some((record) => record.target instanceof SVGElement || (record.target as HTMLElement).style?.filter.includes("url("))) return
    changed = true
    requestAnimationFrame(() => {
      changed = false
      redraws++
      const now = filterWork()
      if (now.megapixels > peak.megapixels) { peak = now; if (dump) markup = [...document.querySelectorAll("filter")].map((filter) => filter.outerHTML) }
    })
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "x", "y", "width", "height", "href", "scale", "stdDeviation", "values", "slope", "dx", "dy", "in", "in2"] })
  return () => { observer.disconnect(); return { redraws, ...peak, markup } }
}
const driver: Driver = {
  root,
  sleep,
  async animate(seconds, step) {
    const start = performance.now()
    for (;;) {
      const t = (performance.now() - start) / 1000
      step(Math.min(t, seconds))
      if (t >= seconds) return
      await nextFrame()
    }
  },
  click(element) {
    if (!element) return
    const box = element.getBoundingClientRect()
    const init = { bubbles: true, cancelable: true, composed: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 }
    element.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }))
    element.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }))
    element.dispatchEvent(new PointerEvent("pointerup", init))
    element.dispatchEvent(new MouseEvent("mouseup", init))
    if (element instanceof HTMLElement) element.click()
  },
  find: <T extends Element>(selector: string, text?: string) =>
    [...root.ownerDocument.querySelectorAll<T>(selector)].find((element) => element.getBoundingClientRect().width > 0 && (!text || element.textContent?.trim().startsWith(text))),
  async waitFor<T extends Element>(selector: string, text?: string) {
    for (const end = performance.now() + 4000; ;) {
      const element = driver.find<T>(selector, text)
      if (element || performance.now() > end) return element
      await sleep(50)
    }
  },
}
// Synthetic pointers cannot be captured; a handler that tries must not throw.
for (const method of ["setPointerCapture", "releasePointerCapture"] as const) {
  const original = Element.prototype[method]
  Element.prototype[method] = function (pointerId: number) { try { original.call(this, pointerId) } catch { /* synthetic pointer */ } }
}

const post = (path: string, body: unknown) => fetch(path, { method: "POST", body: JSON.stringify(body) }).then((response) => response.json())
/** The runner reads its process counters before it answers, so a phase's cost is what lies between two answers. */
const mark = (phase: string, edge: "start" | "end") => run ? post("/__mark", { run, phase, edge }) : Promise.resolve()
async function ready() {
  for (const end = performance.now() + 20_000; performance.now() < end; await sleep(50)) {
    const glass = [...document.querySelectorAll<HTMLElement>("[data-glass-ready]")]
    if (glass.length && glass.every((element) => element.dataset.glassReady === "true")) return true
    // A reference scene has no glass to wait for.
    if (name.startsWith("reference-") && performance.now() > 800) return true
  }
  return false
}
async function measure(phase: string, action: () => Promise<void>) {
  await mark(phase, "start")
  const stop = recordFrames(), start = performance.now()
  await action()
  const seconds = (performance.now() - start) / 1000
  const frames = stop()
  await mark(phase, "end")
  return { seconds, ...frames }
}
/** Nothing runs, not even a frame callback: what the glass costs a page that is doing nothing. */
async function rest() {
  await mark("rest", "start")
  await sleep(2000)
  await mark("rest", "end")
}
async function play() {
  const errors: string[] = []
  addEventListener("error", (event) => errors.push(String(event.message)))
  addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)))
  const isReady = await ready()
  await sleep(1500)
  if (isReady) await rest()
  // Half a second of bare frames gives the window's refresh rate, and shows a covered window.
  const idle = isReady ? await measure("idle", () => sleep(500)) : undefined
  const still = filterWork()
  const stopWatching = watchFilters()
  const active = isReady ? await measure("active", () => scene!.run(driver)) : undefined
  const moving = stopWatching()
  if (!run) { status.textContent = `${name}: played. Reload to play again.`; return }
  // The runner answers after the machine has rested; rest on an empty page.
  view.unmount()
  const { next } = await post("/__done", {
    run, ready: isReady, idle, active, errors, filters: { still, moving },
    webgpu: "gpu" in navigator, hidden: document.visibilityState !== "visible", agent: navigator.userAgent,
    window: { width: innerWidth, height: innerHeight, ratio: devicePixelRatio },
  })
  if (next) location.replace(next); else document.title = "Bench done"
}

const view = createRoot(root)
const status = document.createElement("div")
status.className = "bench-status"
document.body.append(status)
if (scene) {
  status.textContent = `${name}${run ? ` · run ${run}` : ""}`
  view.render(<StrictMode>{scene.render()}</StrictMode>)
  void play()
} else {
  view.render(<div className="bench-index">
    <h1>Liquid Glass bench scenes</h1>
    <p>Each scene isolates one cost. Open one to watch it play; <code>bun run bench</code> measures them.</p>
    <ul>{Object.entries(measures).map(([key, text]) => <li key={key}><a href={`?scene=${key}`}>{key}</a>: {text}</li>)}</ul>
  </div>)
}
