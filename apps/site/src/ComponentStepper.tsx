import { generateClipPath, observeResize } from "@lisse/core"
import { useLayoutEffect, useRef } from "react"
import { Stepper } from "pasito"
import "pasito/styles.css"
import { GlassContent, GlassScene, GlassSurface } from "@glass-sdk/liquid-glass"
import type { GlassAppearance } from "@glass-sdk/liquid-glass"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"

type Item = { value: string; label: string }

/** Pasito owns the steps; the public glass surface supplies the material. */
export function ComponentStepper({ items, active, onNavigate, theme }: {
  items: readonly Item[]
  active: number
  onNavigate: (index: number) => void
  theme: GlassAppearance
}) {
  const root = useRef<HTMLElement>(null)
  const focusStep = useRef(false)
  // Pasito 0.1 has no label or keyboard props. Adapt its rendered tabs here.
  useLayoutEffect(() => {
    const tabs = root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    root.current?.querySelector('[role="tablist"]')?.setAttribute("aria-label", "Components")
    const stop = Array.from(tabs ?? [], (tab, index) => {
      tab.setAttribute("aria-label", items[index]!.label)
      tab.title = items[index]!.label
      tab.setAttribute("aria-controls", "main-content")
      return observeResize(tab, (size) => {
        if (size) tab.style.setProperty("--step-clip", generateClipPath(Math.max(0, size.width - 16), 8, { radius: 4, smoothing: 0.8125, preserveSmoothing: true }))
      })
    })
    if (focusStep.current) {
      tabs?.[active]?.focus({ preventScroll: true })
      focusStep.current = false
    }
    return () => stop.forEach(unsubscribe => unsubscribe())
  }, [active, items])

  // The stepper carries its own small scene: a page-wide scene would push
  // the whole column through a software filter on WebKit.
  return <div className="component-stepper-position">
    <GlassScene className="component-stepper-scene" material="regular" appearance={theme}>
    <GlassContent><div className="component-stepper-backdrop" /></GlassContent>
    <GlassSurface ref={root} render={<nav />} aria-label="Component navigation" material="regular" radius="capsule" interactive className="component-stepper"
      onKeyDown={(event) => {
        if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return
        const next = event.key === "ArrowRight" ? (active + 1) % items.length
          : event.key === "ArrowLeft" ? (active - 1 + items.length) % items.length
          : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null
        if (next === null) return
        event.preventDefault()
        if (next !== active) {
          focusStep.current = true
          onNavigate(next)
        }
      }}>
      <Button variant="ghost" size="icon" aria-label={`Previous component: ${items[(active - 1 + items.length) % items.length]!.label}`} onClick={() => onNavigate((active - 1 + items.length) % items.length)}>
        <HugeiconsIcon icon={ArrowLeft01Icon} size={18} />
      </Button>
      <Stepper count={items.length} active={active} onStepClick={onNavigate} className="component-stepper-dots" />
      <Button variant="ghost" size="icon" aria-label={`Next component: ${items[(active + 1) % items.length]!.label}`} onClick={() => onNavigate((active + 1) % items.length)}>
        <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
      </Button>
    </GlassSurface>
    </GlassScene>
  </div>
}
