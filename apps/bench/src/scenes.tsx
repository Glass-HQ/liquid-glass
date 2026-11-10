import { useRef } from "react"
import type { CSSProperties, ReactNode } from "react"
import {
  GlassButton, GlassContent, GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuTrigger, GlassScene,
  GlassScrollEdges, GlassSurface, GlassSwitch, GlassTabs, GlassToolbar, GlassToolbarButton,
} from "@glass-sdk/liquid-glass"
import photo from "../../site/public/wallpapers/duo-day-2048.webp"

/** What a scene's script can do. Motion is a function of time, never of the
 * frame count, so a build that drops frames still does the same journey. */
export interface Driver {
  root: HTMLElement
  /** Call `step` every frame for `seconds`, with the seconds elapsed. */
  animate(seconds: number, step: (t: number) => void): Promise<void>
  sleep(ms: number): Promise<void>
  /** A full press: pointer and mouse events, then the click. */
  click(element: Element | null | undefined): void
  find<T extends Element = HTMLElement>(selector: string, text?: string): T | undefined
  waitFor<T extends Element = HTMLElement>(selector: string, text?: string): Promise<T | undefined>
}
/** A scene isolates one cost, named in scenes.json. */
export interface BenchScene {
  render(): ReactNode
  run(driver: Driver): Promise<void>
}

const size: CSSProperties = { position: "relative", width: 1100, height: 640, overflow: "hidden" }
const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" }
const at = (left: number, top: number, extra?: CSSProperties): CSSProperties => ({ position: "absolute", left, top, ...extra })
const Photo = () => <img src={photo} alt="" style={fill} />
const wave = (t: number, period: number) => Math.sin((t / period) * 2 * Math.PI)

/** Live DOM, not a picture: text and boxes the glass has to refract. */
function Page({ rows }: { rows: number }) {
  return <div className="page">
    {Array.from({ length: rows }, (_, row) => <section key={row} className="page-row">
      {Array.from({ length: 4 }, (_, column) => <article key={column} style={{ background: `hsl(${(row * 47 + column * 83) % 360} 70% ${52 + (column % 2) * 10}%)` }}>
        <h3>Card {row * 4 + column + 1}</h3>
        <p>The quick brown fox jumps over the lazy dog, then reads the fine print twice.</p>
      </article>)}
    </section>)}
  </div>
}
function Player({ style }: { style?: CSSProperties }) {
  return <GlassSurface radius={38} className="bench-panel" style={{ width: 300, height: 170, padding: 20, ...style }}>
    <strong>Now playing</strong>
    <p>Refracting what is behind it</p>
  </GlassSurface>
}
function Bar({ style }: { style?: CSSProperties }) {
  return <GlassToolbar aria-label="Tools" style={style}>
    <GlassToolbarButton aria-label="One">A</GlassToolbarButton>
    <GlassToolbarButton aria-label="Two">B</GlassToolbarButton>
    <GlassToolbarButton aria-label="Three">C</GlassToolbarButton>
  </GlassToolbar>
}
function Scroller({ edges }: { edges: boolean }) {
  const viewport = useRef<HTMLDivElement>(null)
  return <GlassScene material="regular" style={size}>
    <GlassContent layout="scroll" ref={viewport} tabIndex={0} aria-label="Cards" className="bench-scroller"><Page rows={40} /></GlassContent>
    {edges && <GlassScrollEdges target={viewport} size={80} blur={20} />}
    <Bar style={at(430, 560)} />
  </GlassScene>
}
const scroll = (driver: Driver) => {
  const viewport = driver.find(".bench-scroller")!
  const travel = Math.min(1800, viewport.scrollHeight - viewport.clientHeight)
  return driver.animate(4, (t) => { viewport.scrollTop = (1 - Math.cos((t / 2) * Math.PI)) / 2 * travel })
}

/** The photo drawn once into a canvas: pixels the page owns instead of an image the browser lays out. */
function Canvas() {
  const draw = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return
    const image = new Image()
    image.onload = () => {
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height)
      canvas.getContext("2d")!.drawImage(image, (canvas.width - image.width * scale) / 2, (canvas.height - image.height * scale) / 2, image.width * scale, image.height * scale)
    }
    image.src = photo
  }
  return <canvas ref={draw} width={2200} height={1280} style={fill} />
}
function Dragged({ children, canvas }: { children?: ReactNode; canvas?: boolean }) {
  return <GlassScene material="regular" style={size}>
    <GlassContent>{canvas ? <Canvas /> : <Photo />}</GlassContent>
    {children}
    <Player style={at(400, 235)} />
  </GlassScene>
}
/** No library at all: the same stage and motion with a plain panel, to show
 * what the page costs by itself and what a CSS blur costs. */
function Plain({ blur }: { blur?: boolean }) {
  const look: CSSProperties = blur
    ? { background: "rgb(255 255 255 / 0.35)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }
    : { background: "#f2f2f2" }
  return <div style={size}>
    <Photo />
    <div className="bench-panel" style={{ ...at(400, 235), width: 300, height: 170, padding: 20, boxSizing: "border-box", borderRadius: 38, ...look }}>
      <strong>Now playing</strong>
    </div>
  </div>
}
/** Moves the panel by transform, as an app dragging it would. */
const drag = (driver: Driver) => {
  const panel = driver.find(".bench-panel")!
  return driver.animate(4, (t) => { panel.style.transform = `translate(${300 * wave(t, 2)}px, ${180 * wave(t, 1.3)}px)` })
}

export const scenes: Record<string, BenchScene> = {
  drag: {
    render: () => <Dragged />,
    run: (driver) => drag(driver),
  },
  "drag-over-canvas": {
    render: () => <Dragged canvas />,
    run: drag,
  },
  "drag-half-stage": {
    render: () => <GlassScene material="regular" style={{ ...size, width: 550, height: 640 }}>
      <GlassContent><Photo /></GlassContent>
      <Player style={at(125, 235)} />
    </GlassScene>,
    run: (driver) => {
      const panel = driver.find(".bench-panel")!
      return driver.animate(4, (t) => { panel.style.transform = `translate(${100 * wave(t, 2)}px, ${180 * wave(t, 1.3)}px)` })
    },
  },
  "drag-among-many": {
    render: () => <Dragged>
      {Array.from({ length: 12 }, (_, i) => <GlassButton key={i} style={at(40 + (i % 6) * 175, i < 6 ? 30 : 560)}>Button {i + 1}</GlassButton>)}
    </Dragged>,
    run: (driver) => drag(driver),
  },
  "content-change": {
    render: () => <GlassScene material="regular" style={size}>
      <GlassContent><Photo /><div className="bench-ticker" /></GlassContent>
      <Player style={at(400, 235)} />
      <Bar style={at(430, 560)} />
    </GlassScene>,
    run: (driver) => {
      const ticker = driver.find(".bench-ticker")!
      return driver.animate(4, (t) => { ticker.style.left = `${550 + 400 * wave(t, 2)}px`; ticker.textContent = t.toFixed(2) })
    },
  },
  scroll: {
    render: () => <Scroller edges={false} />,
    run: scroll,
  },
  "scroll-edges": {
    render: () => <Scroller edges />,
    run: scroll,
  },
  menu: {
    render: () => <GlassScene material="regular" style={size}>
      <GlassContent><Photo /></GlassContent>
      <div style={at(500, 120)}>
        <GlassMenu>
          <GlassMenuTrigger render={<GlassButton aria-label="Options" />}>Options</GlassMenuTrigger>
          <GlassMenuContent>
            {["Save", "Share", "Download", "Rename", "Delete"].map((label) => <GlassMenuItem key={label}>{label}</GlassMenuItem>)}
          </GlassMenuContent>
        </GlassMenu>
      </div>
    </GlassScene>,
    run: async (driver) => {
      for (let i = 0; i < 3; i++) {
        driver.click(await driver.waitFor('button[aria-label="Options"]'))
        await driver.sleep(900)
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))
        await driver.sleep(700)
      }
    },
  },
  controls: {
    render: () => <GlassScene material="regular" style={size}>
      <GlassContent><Photo /></GlassContent>
      <div style={at(380, 250)}>
        <GlassTabs aria-label="Views" items={[{ value: "one", label: "Listen" }, { value: "two", label: "Browse" }, { value: "three", label: "Library" }]} />
      </div>
      <div style={at(520, 360)}><GlassSwitch aria-label="Switch" /></div>
    </GlassScene>,
    run: async (driver) => {
      for (let i = 0; i < 6; i++) {
        driver.click([...driver.root.querySelectorAll('[role="tab"]')][(i + 1) % 3])
        driver.click(driver.find('[role="switch"]'))
        await driver.sleep(650)
      }
    },
  },
  resize: {
    render: () => <GlassScene material="regular" style={size}>
      <GlassContent><Photo /></GlassContent>
      <Player style={at(120, 80)} />
    </GlassScene>,
    run: (driver) => {
      const panel = driver.find(".bench-panel")!
      const seconds = Number(new URLSearchParams(location.search).get("seconds") ?? 4)
      return driver.animate(seconds, (t) => { panel.style.width = `${360 + 200 * wave(t, 2)}px`; panel.style.height = `${260 + 120 * wave(t, 1.3)}px` })
    },
  },
  "reference-opaque": {
    render: () => <Plain />,
    run: drag,
  },
  "reference-css-blur": {
    render: () => <Plain blur />,
    run: drag,
  },
}
