import { useEffect, useRef, useState } from "react"
import { nowPlaying } from "./music"
import type { CSSProperties, PointerEvent, ReactNode } from "react"
import {
  GlassScene,
  GlassShape,
  GlassCorner,
  GlassContent,
  GlassSurface,
  GlassSlider,
  GlassSwitch,
  GlassButton,
  GlassToolbar,
  GlassToolbarButton,
  GlassToolbarSpacer,
  GlassTabs,
  GlassMenu,
  GlassMenuTrigger,
  GlassMenuContent,
  GlassMenuItem,
  GlassMenuSubmenu,
  GlassMenuSubmenuTrigger,
  GlassMenuSubmenuContent,
} from "@glass-sdk/liquid-glass"
import type {
  GlassMaterial,
  GlassAppearance,
} from "@glass-sdk/liquid-glass"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUpRight01Icon,
  PlayIcon,
  FavouriteIcon,
  MoreHorizontalIcon,
  Share01Icon,
  Download01Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Backdrop } from "./Backdrop"
import { ProgressiveScene, defaultProgressiveOptions } from "./ProgressiveScenes"
import type { ProgressiveOptions } from "./ProgressiveScenes"
export const Icon = ({ icon }: { icon: typeof PlayIcon }) => (
  <HugeiconsIcon icon={icon} size={20} strokeWidth={1.7} />
)
export type ExampleKind = "surface" | "buttons" | "toolbar" | "tabs" | "menu" | "progressive-blur" | "slider" | "switch"
export const toolbarVariants = [
  { value: "normal", label: "Normal" },
  { value: "fixed", label: "Fixed spacer" },
  { value: "flexible", label: "Flexible spacer" },
  { value: "menu", label: "With menu" },
] as const
export type MenuOptions = {
  side: "top" | "bottom" | "left" | "right"
  align: "start" | "center" | "end"
  submenu: boolean
  /** A glass button becomes its menu; a button inside a toolbar lets the menu pinch off. */
  trigger: "button" | "toolbar"
}
export type ToolbarVariant = (typeof toolbarVariants)[number]["value"]
export function Example({
  example = "surface",
  toolbarVariant = "normal",
  sliderStepped = false,
  menuOptions = { side: "bottom", align: "end", submenu: false, trigger: "button" },
  progressive = defaultProgressiveOptions,
  material = "clear",
  appearance = "light",
  tint,
  background = "landscape",
  draggable = false,
  className = "",
  controls,
  bottomControls,
}: {
  example?: ExampleKind
  toolbarVariant?: ToolbarVariant
  sliderStepped?: boolean
  menuOptions?: MenuOptions
  progressive?: ProgressiveOptions
  material?: GlassMaterial
  tint?: string
  appearance?: GlassAppearance
  background?: "landscape" | "type" | "grid"
  draggable?: boolean
  className?: string
  controls?: ReactNode
  bottomControls?: ReactNode
}) {
  const [value, setValue] = useState(50)
  const sliderValue = sliderStepped ? Math.round(value / 25) * 25 : value
  const [checked, setChecked] = useState(true)
  const [liked, setLiked] = useState(false)
  const [error, setError] = useState<Error | undefined>()
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const backdropRef = useRef<HTMLElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const constrain = (next: { x: number; y: number }) => {
    const surface = surfaceRef.current
    const frame = surface?.closest(".example-scene")
    if (!surface || !frame) return next
    const bounds = frame.getBoundingClientRect()
    // The surface is centered before its translation; leave a small edge inset.
    const maxX = Math.max(0, (bounds.width - surface.offsetWidth) / 2 - 12)
    const maxY = Math.max(0, (bounds.height - surface.offsetHeight) / 2 - 12)
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) }
  }
  useEffect(() => {
    const surface = surfaceRef.current
    const frame = surface?.closest(".example-scene")
    if (!surface || !frame) return
    const observer = new ResizeObserver(() => setPosition(current => constrain(current)))
    observer.observe(frame)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])
  const dragOrigin = useRef<{
    id: number
    x: number
    y: number
    left: number
    top: number
  } | null>(null)
  const drag = (event: PointerEvent<HTMLElement>) => {
    if (
      !draggable ||
      (event.target instanceof HTMLElement && event.target.closest("button"))
    )
      return
    dragOrigin.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.x,
      top: position.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const origin = dragOrigin.current
    if (!origin || origin.id !== event.pointerId) return
    if (!(event.buttons & 1)) {
      dragOrigin.current = null
      return
    }
    setPosition(constrain({
      x: origin.left + event.clientX - origin.x,
      y: origin.top + event.clientY - origin.y,
    }))
  }
  const finish = () => {
    dragOrigin.current = null
  }
  const options = { material, appearance, tint }
  const style = {
    // An anchored surface stays centered and only stretches under a drag.
    transform: draggable ? `translate(${position.x}px, ${position.y}px)` : undefined,
    touchAction: draggable ? "none" : undefined,
  } as CSSProperties
  return (
    <GlassScene
      material={material}
      appearance={appearance}
      className={`example-scene ${bottomControls ? "has-bottom-controls" : ""} ${controls ? "has-controls" : ""} ${appearance === "dark" ? "glass-dark" : ""} ${className}`}
      onDiagnostic={(d) => {
        setError(d.error)
      }}
    >
      {example === "progressive-blur" ? (
        <GlassShape ref={backdropRef} radius={31} className="example-backdrop">
          <ProgressiveScene options={progressive} appearance={appearance} />
        </GlassShape>
      ) : (
        <GlassContent>
          <GlassShape ref={backdropRef} radius={31} className="example-backdrop">
            <Backdrop kind={background} appearance={appearance} />
          </GlassShape>
        </GlassContent>
      )}
      {controls && (
        <GlassCorner container={backdropRef} gap={12} className="example-controls">
          {controls}
        </GlassCorner>
      )}
      <div className={`example-stage ${example === "progressive-blur" ? "is-passthrough" : ""}`}>
        {example !== "progressive-blur" && <div
          className="example-center"
          style={example === "surface" ? undefined : style}
        >
          {example === "surface" && (
            <GlassSurface
              {...options}
              radius={38}
              interactive
              ref={surfaceRef}
              className={`player-surface ${draggable ? "is-draggable" : ""}`}
              style={style}
              onPointerDown={drag}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={finish}
            >
              <div className="player-top">
                <GlassShape radius={13.5} concentric={{ inset: 12 }} render={<img src={nowPlaying.art} alt="Random Access Memories album cover" referrerPolicy="no-referrer" />} className="album-art" />
                <div>
                  <p className="track-name">{nowPlaying.title}</p>
                  <p className="artist-name">{nowPlaying.artist}</p>
                </div>
                <GlassButton
                  {...options}
                  aria-label={liked ? "Unlike" : "Like"}
                  size="icon-sm"
                  className="player-like"
                  onClick={() => setLiked(!liked)}
                >
                  <Icon icon={FavouriteIcon} />
                </GlassButton>
              </div>
              <GlassShape radius="capsule" className="track-progress">
                <GlassShape radius="capsule" render={<span />} style={{ width: "34%" }} />
              </GlassShape>
              <div className="player-bottom">
                <span>1:51</span>
                <Button
                  variant="ghost"
                  className="player-play"
                  aria-label="Play"
                >
                  <Icon icon={PlayIcon} />
                </Button>
                <span>5:31</span>
              </div>
            </GlassSurface>
          )}
          {(example === "slider" || example === "switch") && (
            <div className={`value-control-example value-control-example-${example}`}>
              {example === "switch"
                ? <GlassSwitch {...options} aria-label="Switch" checked={checked} onCheckedChange={setChecked} />
                : <GlassSlider {...options} aria-label="Slider" value={sliderValue} onValueChange={setValue} step={sliderStepped ? 25 : 0.1} ticks={sliderStepped} />}
            </div>
          )}
          {example === "buttons" && (
            <div className="button-examples">
              <GlassButton {...options}>
                Get started <Icon icon={ArrowUpRight01Icon} />
              </GlassButton>
            </div>
          )}
          {example === "toolbar" && (
            <GlassToolbar
              {...options}
              aria-label="Playback"
              style={toolbarVariant === "flexible" ? { width: 196 } : undefined}
            >
              <GlassToolbarButton aria-label="Play">
                <Icon icon={PlayIcon} />
              </GlassToolbarButton>
              <GlassToolbarButton aria-label="Volume">
                <Icon icon={VolumeHighIcon} />
              </GlassToolbarButton>
              {(toolbarVariant === "fixed" || toolbarVariant === "flexible") && (
                <GlassToolbarSpacer sizing={toolbarVariant} />
              )}
              <GlassToolbarButton aria-label="Favorite">
                <Icon icon={FavouriteIcon} />
              </GlassToolbarButton>
              {toolbarVariant === "menu" && <GlassMenu>
                <GlassToolbarButton
                  aria-label="Playback options"
                  render={<GlassMenuTrigger />}
                >
                  <Icon icon={MoreHorizontalIcon} />
                </GlassToolbarButton>
                <ExampleMenuContent material={material} appearance={appearance} tint={tint} menuOptions={menuOptions} />
              </GlassMenu>}
            </GlassToolbar>
          )}
          {example === "tabs" && (
            <GlassTabs
              {...options}
              items={[
                { value: "listen", label: "Listen" },
                { value: "browse", label: "Browse" },
                { value: "library", label: "Library" },
              ]}
              aria-label="Music"
            />
          )}
          {example === "menu" && menuOptions.trigger === "button" && (
            <GlassMenu>
              <GlassMenuTrigger
                render={
                  <GlassButton {...options} size="icon" aria-label="Options" />
                }
              >
                <Icon icon={MoreHorizontalIcon} />
              </GlassMenuTrigger>
              <ExampleMenuContent material={material} appearance={appearance} tint={tint} menuOptions={menuOptions} />
            </GlassMenu>
          )}
          {example === "menu" && menuOptions.trigger === "toolbar" && (
            <GlassToolbar {...options} aria-label="Playback">
              <GlassToolbarButton aria-label="Play">
                <Icon icon={PlayIcon} />
              </GlassToolbarButton>
              <GlassToolbarButton aria-label="Favorite">
                <Icon icon={FavouriteIcon} />
              </GlassToolbarButton>
              <GlassMenu>
                <GlassToolbarButton aria-label="Options" render={<GlassMenuTrigger />}>
                  <Icon icon={MoreHorizontalIcon} />
                </GlassToolbarButton>
                <ExampleMenuContent material={material} appearance={appearance} tint={tint} menuOptions={menuOptions} />
              </GlassMenu>
            </GlassToolbar>
          )}
        </div>}
      </div>
      {bottomControls && <div className="example-bottom-controls">{bottomControls}</div>}
      {error && (
        <p className="render-error" role="alert">
          {error.message}
        </p>
      )}
    </GlassScene>
  )
}

function ExampleMenuContent({ material, appearance, tint, menuOptions }: { material: GlassMaterial; appearance: GlassAppearance; tint?: string; menuOptions: MenuOptions }) {
  const options = { material, appearance, tint }
  return <GlassMenuContent {...options} side={menuOptions.side} align={menuOptions.align}>
    <GlassMenuItem><Icon icon={FavouriteIcon} />Save to library</GlassMenuItem>
    {menuOptions.submenu ? <GlassMenuSubmenu>
      <GlassMenuSubmenuTrigger><Icon icon={Share01Icon} />Share<span className="submenu-chevron" aria-hidden="true">›</span></GlassMenuSubmenuTrigger>
      <GlassMenuSubmenuContent {...options}>
        <GlassMenuItem>Copy link</GlassMenuItem>
        <GlassMenuItem>Email</GlassMenuItem>
        <GlassMenuSubmenu>
          <GlassMenuSubmenuTrigger>More<span className="submenu-chevron" aria-hidden="true">›</span></GlassMenuSubmenuTrigger>
          <GlassMenuSubmenuContent {...options}><GlassMenuItem>Messages</GlassMenuItem><GlassMenuItem disabled>AirDrop</GlassMenuItem></GlassMenuSubmenuContent>
        </GlassMenuSubmenu>
      </GlassMenuSubmenuContent>
    </GlassMenuSubmenu> : <GlassMenuItem><Icon icon={Share01Icon} />Share</GlassMenuItem>}
    <GlassMenuItem><Icon icon={Download01Icon} />Download</GlassMenuItem>
  </GlassMenuContent>
}
