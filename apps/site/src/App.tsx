import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, ReactNode, RefObject } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Menu } from "@base-ui/react/menu"
import {
  BoltIcon,
  DashedLine01Icon,
  SolidLine01Icon,
  ComputerIcon,
  ArrowUpRight01Icon,
  Copy01Icon,
  Tick02Icon,
  Moon02Icon,
  Sun03Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  AlignStartVerticalIcon,
  AlignHorizontalCenterIcon,
  AlignEndVerticalIcon,
  MinusSignIcon,
  MoreHorizontalIcon,
  Image03Icon,
  Grid02Icon,
  CaseSensitiveIcon,
  MoreHorizontalCircle01Icon,
  LayoutBottomIcon,
} from "@hugeicons/core-free-icons"
import type {
  GlassMaterial,
  GlassAppearance,
} from "@glass-sdk/liquid-glass"
import {
  GlassScene,
  GlassShape,
  GlassCorner,
  GlassSurface,
  GlassContent,
  GlassTabsList,
  GlassTabsTrigger,
  GlassTabsIndicator,
  GlassToolbar,
  GlassToolbarButton,
  GlassToolbarSpacer,
  GlassMenu,
  GlassMenuTrigger,
  GlassMenuContent,
  GlassSwitch,
  GlassMenuSubmenu,
  GlassMenuSubmenuContent,
} from "@glass-sdk/liquid-glass"
import "@glass-sdk/liquid-glass/styles.css"
import glassHeart from "./assets/icons/credit-heart.svg"
import glassHeartLight from "./assets/icons/credit-heart-light.svg"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  DropdownMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { Example, toolbarVariants } from "./Examples"
import { PageEdgeBlur } from "./PageEdgeBlur"
import { defaultProgressiveOptions, progressiveModes } from "./ProgressiveScenes"
import type { ProgressiveOptions } from "./ProgressiveScenes"
import type { ExampleKind, ToolbarVariant, MenuOptions } from "./Examples"
import { ApiReference } from "./ApiReference"
import { SiteMaterialProvider, useSiteMaterial } from "./SiteMaterial"
import { highlight } from "./highlight"
import { installCommand, usageCode } from "./usage"
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
const repo = "https://github.com/Glass-HQ/liquid-glass"
function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={copied ? "Copied" : "Copy code"}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={16} />
    </Button>
  )
}
type ThemePreference = GlassAppearance | "system"
type SiteThemeProps = {
  theme: GlassAppearance
  preference: ThemePreference
  onPreferenceChange: (value: ThemePreference) => void
}
const sidebarRadius = 29
function SidebarCornerControl({ corner, shapeRef, label, children }: {
  corner: "top-left" | "top-right"
  shapeRef: RefObject<HTMLElement | null>
  label: string
  children: ReactNode
}) {
  return (
    <GlassCorner corner={corner} gap={10} container={shapeRef}>
      <GlassToolbar className="sidebar-corner-toolbar" aria-label={label}>{children}</GlassToolbar>
    </GlassCorner>
  )
}
function SiteMenu({ theme, preference, onPreferenceChange }: SiteThemeProps) {
  const { material: siteMaterial, setMaterial } = useSiteMaterial()
  return (
      <GlassMenu>
        <GlassToolbarButton aria-label="Site options" render={<GlassMenuTrigger />}>
          <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
        </GlassToolbarButton>
        <GlassMenuContent material={siteMaterial} className="site-glass-choice sidebar-options-menu" align="start">
          <DropdownMenuRadioGroup value={preference} onValueChange={(value) => onPreferenceChange(value as ThemePreference)}>
            <DropdownMenuRadioItem value="light" closeOnClick><HugeiconsIcon icon={Sun03Icon} size={14} />Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" closeOnClick><HugeiconsIcon icon={Moon02Icon} size={14} />Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system" closeOnClick><HugeiconsIcon icon={ComputerIcon} size={14} />System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <GlassShape concentric={{ contentPadding: 8 }} className="site-material-toggle">
            <span id="site-material-label">Clear glass</span>
            <Menu.Item closeOnClick={false} render={<GlassSwitch
              aria-labelledby="site-material-label"
              material={siteMaterial}
              appearance={theme}
              checked={siteMaterial === "clear"}
              onCheckedChange={(checked) => setMaterial(checked ? "clear" : "regular")}
              aria-description="Off uses Regular glass. Applies only to site controls."
            />} />
          </GlassShape>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="sidebar-github-link" render={<a href={repo} target="_blank" rel="noopener noreferrer" aria-label="GitHub, open source MIT, opens in a new tab" />}>
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width={14} height={14} fill="none" aria-hidden="true">
            {theme === "dark" ? (
              <path fillRule="evenodd" clipRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" transform="scale(64)" fill="#fff" />
            ) : (
              <path fill="#1b1f23" fillRule="evenodd" d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0" clipRule="evenodd" />
            )}
          </svg>
            <span className="sidebar-github-label">GitHub<span>Open source · MIT</span></span>
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} className="sidebar-external-icon" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <GlassShape concentric={{ inset: 4, contentPadding: 8 }} render={<p />} className="sidebar-menu-credit">Made with <img src={theme === "light" ? glassHeartLight : glassHeart} width={16} height={16} alt="love" /> by Glass</GlassShape>
        </GlassMenuContent>
      </GlassMenu>
  )
}
function PreviewToolbar({
  value,
  onChange,
  children,
}: {
  value: GlassMaterial
  onChange: (m: GlassMaterial) => void
  children: ReactNode
}) {
  const { material: siteMaterial } = useSiteMaterial()
  return (
    <GlassToolbar material={siteMaterial} aria-label="Preview controls" className="preview-toolbar">
      <GlassMenu>
        <GlassToolbarButton aria-label="Customize demo" render={<GlassMenuTrigger />}>
          <HugeiconsIcon icon={BoltIcon} size={16} />
        </GlassToolbarButton>
        <GlassMenuContent material={siteMaterial} className="site-glass-choice demo-customize-menu" align="end">
          <GlassChoice label="Material" value={value} onChange={onChange} items={[{ value: "clear", label: "Clear" }, { value: "regular", label: "Regular" }]} />
          {children}
        </GlassMenuContent>
      </GlassMenu>
    </GlassToolbar>
  )
}
type Background = "landscape" | "type" | "grid"
function GlassChoice<T extends string>({
  label,
  value,
  onChange,
  items,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  items: readonly { value: T; label: string; icon?: typeof Image03Icon }[]
}) {
  const { material: siteMaterial } = useSiteMaterial()
  const selected = items.find((item) => item.value === value)
  return (
    <GlassMenuSubmenu>
      <DropdownMenuSubTrigger className="demo-customize-row">
        <span>{label}</span>
        <span className="demo-choice-value">{selected?.label}</span>
      </DropdownMenuSubTrigger>
      <GlassMenuSubmenuContent material={siteMaterial} className="site-glass-choice">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as T)}
        >
          {items.map((item) => (
            <DropdownMenuRadioItem
              key={item.value}
              value={item.value}
              closeOnClick
            >
              {item.icon && <HugeiconsIcon icon={item.icon} size={14} aria-hidden="true" />}
              {item.value.startsWith("#") && <span className="tint-swatch" style={{ backgroundColor: item.value }} aria-hidden="true" />}
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </GlassMenuSubmenuContent>
    </GlassMenuSubmenu>
  )
}
const tintChoices = [
  { value: "none", label: "No tint" },
  { value: "#007aff", label: "Blue" },
  { value: "#af52de", label: "Purple" },
  { value: "#ff2d55", label: "Pink" },
  { value: "#ff3b30", label: "Red" },
  { value: "#ff9500", label: "Orange" },
  { value: "#34c759", label: "Green" },
  { value: "#ffcc00", label: "Yellow" },
] as const
function TintChoice({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <GlassChoice label="Tint color" value={value} onChange={onChange} items={tintChoices} />
}

function ToolbarChoice({ value, onChange }: {
  value: ToolbarVariant
  onChange: (value: ToolbarVariant) => void
}) {
  return <GlassChoice label="Toolbar variant" value={value} onChange={onChange} items={toolbarVariants} />
}
function BackgroundChoice({
  value,
  onChange,
}: {
  value: Background
  onChange: (value: Background) => void
}) {
  return (
    <GlassChoice
      label="Background"
      value={value}
      onChange={onChange}
      items={[
        { value: "landscape", label: "Landscape", icon: Image03Icon },
        { value: "type", label: "Typography", icon: CaseSensitiveIcon },
        { value: "grid", label: "Test grid", icon: Grid02Icon },
      ]}
    />
  )
}
function AppearanceChoice({
  value,
  onChange,
}: {
  value: GlassAppearance
  onChange: (value: GlassAppearance) => void
}) {
  return (
    <GlassChoice
      label="Appearance"
      value={value}
      onChange={onChange}
      items={[
        { value: "light", label: "Light", icon: Sun03Icon },
        { value: "dark", label: "Dark", icon: Moon02Icon },
      ]}
    />
  )
}
function CodeSample({ title, text, language = "tsx" }: { title: string; text: string; language?: "tsx" | "bash" }) {
  const tokens = useMemo(() => highlight(text, language), [text, language])
  return <section className="code-section">
    <h3>{title}</h3>
    <GlassShape radius={12} className="code-sample">
    <Copy text={text} />
    <pre><code>{tokens.map((line, i) => <span className="code-line" key={i}>{line.map((token, j) => <span key={j} style={token.htmlStyle as CSSProperties}>{token.content}</span>)}{i < tokens.length - 1 ? "\n" : ""}</span>)}</code></pre>
    </GlassShape>
  </section>
}
function MenuControls({ value, onChange, trigger = false }: { value: MenuOptions; onChange: (value: MenuOptions) => void; trigger?: boolean }) {
  const { material: siteMaterial } = useSiteMaterial()
  const groups = [
    [
      { label: "Expand up", active: value.side === "top", icon: ArrowUp01Icon, select: () => onChange({ ...value, side: "top" }) },
      { label: "Expand down", active: value.side === "bottom", icon: ArrowDown01Icon, select: () => onChange({ ...value, side: "bottom" }) },
      { label: "Expand left", active: value.side === "left", icon: ArrowLeft01Icon, select: () => onChange({ ...value, side: "left" }) },
      { label: "Expand right", active: value.side === "right", icon: ArrowRight01Icon, select: () => onChange({ ...value, side: "right" }) },
    ],
    [
      { label: "Align to start", active: value.align === "start", icon: AlignStartVerticalIcon, select: () => onChange({ ...value, align: "start" }) },
      { label: "Align to center", active: value.align === "center", icon: AlignHorizontalCenterIcon, select: () => onChange({ ...value, align: "center" }) },
      { label: "Align to end", active: value.align === "end", icon: AlignEndVerticalIcon, select: () => onChange({ ...value, align: "end" }) },
    ],
    [
      { label: "No submenu", active: !value.submenu, icon: MinusSignIcon, select: () => onChange({ ...value, submenu: false }) },
      { label: "With submenu", active: value.submenu, icon: ArrowRight01Icon, select: () => onChange({ ...value, submenu: true }) },
    ],
    ...(trigger ? [[
      { label: "Glass button becomes the menu", active: value.trigger === "button", icon: MoreHorizontalCircle01Icon, select: () => onChange({ ...value, trigger: "button" as const }) },
      { label: "Menu detaches from a toolbar", active: value.trigger === "toolbar", icon: LayoutBottomIcon, select: () => onChange({ ...value, trigger: "toolbar" as const }) },
    ]] : []),
  ]
  return <GlassToolbar material={siteMaterial} aria-label="Menu options" className="menu-options-toolbar">
    {groups.map((group, index) => <Fragment key={index}>
      {index > 0 && <GlassToolbarSpacer sizing="fixed" />}
      {group.map(({ label, active, icon, select }) => <GlassToolbarButton key={label} aria-label={label} title={label} aria-pressed={active} onClick={select} render={<Button variant="ghost" size="icon" />}>
        <HugeiconsIcon icon={icon} size={16} strokeWidth={1.7} />
      </GlassToolbarButton>)}
    </Fragment>)}
  </GlassToolbar>
}

function ExamplePreview({
  kind,
  theme,
}: {
  kind: ExampleKind
  theme: GlassAppearance
}) {
  const { material: siteMaterial } = useSiteMaterial()
  const [material, setMaterial] = useState<GlassMaterial>("clear")
  const [tint, setTint] = useState("none")
  const [background, setBackground] = useState<Background>("landscape")
  const [menuOptions, setMenuOptions] = useState<MenuOptions>({ side: "bottom", align: "end", submenu: false, trigger: "button" })
  const [sliderStepped, setSliderStepped] = useState(false)
  const [toolbarVariant, setToolbarVariant] = useState<ToolbarVariant>("normal")
  const [surfaceDrag, setSurfaceDrag] = useState<"move" | "anchor">("move")
  const [progressive, setProgressive] = useState<ProgressiveOptions>(defaultProgressiveOptions)
  const [appearance, setAppearance] = useState<{
    value: GlassAppearance
    theme: GlassAppearance
  } | null>(null)
  if (appearance && appearance.theme !== theme) setAppearance(null)
  const title =
    kind === "slider" ? "Slider" : kind === "switch" ? "Switch" : kind === "progressive-blur" ? "Progressive blur" : kind === "surface"
      ? "Surface"
      : kind === "tabs"
        ? "Tab bar"
        : kind === "menu"
          ? "Menu"
          : kind === "toolbar"
            ? "Toolbar"
            : "Buttons"
  return (
    <section id={kind} aria-label={`${title} example`}>
      <h2 className="component-title"><ComponentIcon kind={kind} theme={theme} />{title}</h2>
      <Tabs
        defaultValue={location.hash === "#usage" ? "usage" : "preview"}
        className="component-views"
      >
        <GlassScene
          appearance={theme}
          material={siteMaterial}
          maxSurfaces={2}
          className="site-tabs-scene"
        >
          <GlassContent>
            <div className="chrome-content" />
          </GlassContent>
          <GlassTabsList
            size="lg"
            radius="capsule"
            refraction={8}
            aria-label={`${title} view`}
          >
            <GlassTabsIndicator material={siteMaterial} radius="capsule" refraction={8} />
            <GlassTabsTrigger value="preview">Preview</GlassTabsTrigger>
            <GlassTabsTrigger value="usage">
              Install &amp; Usage
            </GlassTabsTrigger>
          </GlassTabsList>
        </GlassScene>
        <TabsContent value="preview">
          <Example
            controls={
              <fieldset
                className="preview-controls component-controls"
                aria-label={`${title} controls`}
              >
                <PreviewToolbar value={material} onChange={setMaterial}>
                  {kind === "progressive-blur" ? <>
                    <GlassChoice label="Layout" value={progressive.mode} onChange={(mode) => setProgressive({ ...progressive, mode })} items={progressiveModes} />
                    {progressive.mode === "image" && <GlassChoice label="Edge" value={progressive.edge} onChange={(edge) => setProgressive({ ...progressive, edge })} items={[{ value: "bottom", label: "Bottom edge" }, { value: "top", label: "Top edge" }]} />}
                    <DropdownMenuSeparator />
                    <GlassChoice label="Blur" value={progressive.blur} onChange={(blur) => setProgressive({ ...progressive, blur })} items={[{ value: "off", label: "No blur" }, { value: "soft", label: "Soft blur" }, { value: "balanced", label: "Balanced blur" }, { value: "strong", label: "Strong blur" }]} />
                    <GlassChoice label="Refraction" value={progressive.refraction ? "on" : "off"} onChange={(value) => setProgressive({ ...progressive, refraction: value === "on" })} items={[{ value: "off", label: "No refraction" }, { value: "on", label: "Refraction" }]} />
                  </> : <>
                    <TintChoice value={tint} onChange={setTint} />
                    <BackgroundChoice value={background} onChange={setBackground} />
                  </>}
                  <AppearanceChoice
                    value={appearance?.value ?? theme}
                    onChange={(value) => setAppearance({ value, theme })}
                  />
                  {kind === "toolbar" && (
                    <>
                      <DropdownMenuSeparator />
                      <ToolbarChoice value={toolbarVariant} onChange={setToolbarVariant} />
                    </>
                  )}
                  {kind === "surface" && (
                    <>
                      <DropdownMenuSeparator />
                      <GlassChoice label="Dragging" value={surfaceDrag} onChange={setSurfaceDrag} items={[{ value: "move", label: "Move" }, { value: "anchor", label: "Anchor" }]} />
                    </>
                  )}
                </PreviewToolbar>
              </fieldset>
            }
            bottomControls={kind === "slider" ? <GlassToolbar material={siteMaterial} aria-label="Slider options" className="menu-options-toolbar">
              {[false, true].map((stepped) => <GlassToolbarButton key={String(stepped)} aria-label={stepped ? "Stepped" : "Continuous"} title={stepped ? "Stepped" : "Continuous"} aria-pressed={sliderStepped === stepped} onClick={() => setSliderStepped(stepped)} render={<Button variant="ghost" size="icon" />}>
                <HugeiconsIcon icon={stepped ? DashedLine01Icon : SolidLine01Icon} size={16} strokeWidth={1.7} />
              </GlassToolbarButton>)}
            </GlassToolbar> : (kind === "menu" || (kind === "toolbar" && toolbarVariant === "menu")) ? <MenuControls value={menuOptions} onChange={setMenuOptions} trigger={kind === "menu"} /> : undefined}
            material={material}
            tint={tint === "none" ? undefined : tint}
            appearance={appearance?.value ?? theme}
            background={background}
            example={kind}
            toolbarVariant={toolbarVariant}
            sliderStepped={sliderStepped}
            menuOptions={menuOptions}
            progressive={progressive}
            draggable={kind === "surface" && surfaceDrag === "move"}
            className={kind === "surface" ? "hero-scene" : undefined}
          />
        </TabsContent>
        <TabsContent value="usage" className="component-usage documentation">
          <CodeSample title="Installation" text={installCommand} language="bash" />
          <CodeSample
            title="Usage"
            text={usageCode(kind, material, appearance?.value ?? theme, toolbarVariant, menuOptions, tint === "none" ? undefined : tint, sliderStepped, progressive)}
          />
          <ApiReference kind={kind} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
// Sidebar tiles generated by scripts/site-icons.mjs.
const sidebarIcons = import.meta.glob<string>("./assets/icons/*.svg", { eager: true, query: "?url", import: "default" })
function ComponentIcon({ kind, theme }: { kind: SiteView; theme: GlassAppearance }) {
  return <img className="component-icon" src={sidebarIcons[`./assets/icons/${kind}-${theme}.svg`]} width={30} height={30} alt="" />
}
const exampleLinks = [
  { value: "all", label: "All" },
  { value: "surface", label: "Surface" },
  { value: "buttons", label: "Buttons" },
  { value: "toolbar", label: "Toolbar" },
  { value: "tabs", label: "Tab Bar" },
  { value: "menu", label: "Menu" },
  { value: "slider", label: "Slider" },
  { value: "switch", label: "Switch" },
  { value: "progressive-blur", label: "Progressive Blur" },
] as const
type SiteView = "introduction" | "all" | ExampleKind
function viewFromHash(): SiteView {
  const hash = location.hash.slice(1)
  if (hash === "usage") return "surface"
  if (hash === "stepped-slider") return "slider"
  return hash === "introduction" ||
    exampleLinks.some(({ value }) => value === hash)
    ? (hash as SiteView)
    : "all"
}
function Introduction() {
  return (
    <article className="documentation">
      <h1>Liquid Glass</h1>
      <p>Glass surfaces and controls for React, the web, and Electron. Choose Clear for transparent glass or Regular for a frosted finish. Both support light and dark appearances.</p>
      <p>The content behind the glass stays live. Buttons respond to presses and drags, menus animate from their triggers, and tab indicators move between selections.</p>
      <p>Explore the <a href="#examples">examples</a> for installation, usage, and component props. Liquid Glass is <a href={repo}>open source</a> and MIT licensed.</p>
    </article>
  )
}
function SiteNavigation({ view, theme, preference, onPreferenceChange, shapeRef }: SiteThemeProps & { view: SiteView; shapeRef: RefObject<HTMLElement | null> }) {
  const { material: siteMaterial } = useSiteMaterial()
  const { isMobile, setOpenMobile } = useSidebar()
  const link = (value: SiteView, label: string) => (
    <SidebarMenuItem key={value}>
      <SidebarMenuButton
        isActive={view === value}
        render={<a aria-label={label} href={value === "all" ? "#examples" : `#${value}`} aria-current={view === value ? "page" : undefined} />}
        onClick={() => { if (isMobile) setOpenMobile(false) }}
      >
        <span className="sidebar-icon"><img src={sidebarIcons[`./assets/icons/${value}-${theme}.svg`]} width={30} height={30} alt="" /></span>
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
  const navigation = (
        <GlassSurface ref={shapeRef} radius={sidebarRadius} material={siteMaterial} className="sidebar-glass-surface">
          <GlassScene className="sidebar-menu-scene" material={siteMaterial} appearance={theme}>
            <GlassContent layout="flow" className="sidebar-menu-content">
      <div className="sidebar-actions" />
      <SidebarContent>
        <nav aria-label="Documentation navigation">
          <SidebarGroup>
            <SidebarGroupLabel>Getting Started</SidebarGroupLabel>
            <SidebarMenu>{link("introduction", "Introduction")}</SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Examples</SidebarGroupLabel>
            <SidebarMenu>{exampleLinks.map(({ value, label }) => link(value, label))}</SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
            </GlassContent>
            <SidebarCornerControl corner="top-left" shapeRef={shapeRef} label="Site options">
              <SiteMenu theme={theme} preference={preference} onPreferenceChange={onPreferenceChange} />
            </SidebarCornerControl>
          </GlassScene>
        </GlassSurface>
  )
  // The stock Sidebar handles desktop and mobile; the glass material lives inside it.
  return (
    <Sidebar className="site-sidebar">
      <GlassScene className="sidebar-glass-scene" material={siteMaterial} appearance={theme}>
        <GlassContent><GlassShape radius={sidebarRadius} className="sidebar-glass-backdrop" /></GlassContent>
        {navigation}
      </GlassScene>
    </Sidebar>
  )
}

function Home({ theme, preference, onPreferenceChange }: SiteThemeProps) {
  const sidebarShape = useRef<HTMLElement>(null)
  const pageViewport = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<SiteView>(viewFromHash)
  useEffect(() => {
    const navigate = () => {
      if (location.hash === "#main-content") return
      setView(viewFromHash())
      pageViewport.current?.scrollTo({ top: 0, behavior: "instant" })
    }
    window.addEventListener("hashchange", navigate)
    return () => window.removeEventListener("hashchange", navigate)
  }, [])
  return (
    <SidebarProvider className="site-shell" style={{ "--sidebar-width": "14rem" } as CSSProperties}>
      <SiteNavigation shapeRef={sidebarShape} view={view} theme={theme} preference={preference} onPreferenceChange={onPreferenceChange} />
      <div className="site-main">
        <GlassShape radius={8} render={<a href="#main-content" aria-label="Skip to content" />} className="skip-link">Skip to content</GlassShape>
        <div className="page-scroll-frame">
          <div ref={pageViewport} className="docs-viewport">
            <div className="site-topbar"><SidebarTrigger aria-label="Toggle navigation" /></div>
            <div className="page docs-page">
              <main id="main-content" className="docs-content" tabIndex={-1}>
                {view === "introduction" ? (
                  <Introduction />
                ) : (
                  <div id="examples" className="example-list">
                    {(["surface", "buttons", "toolbar", "tabs", "menu", "slider", "switch", "progressive-blur"] as const)
                      .filter((kind) => view === "all" || view === kind)
                      .map((kind) => (
                        <ExamplePreview key={kind} kind={kind} theme={theme} />
                      ))}
                  </div>
                )}
              </main>
            </div>
          </div>
          <PageEdgeBlur target={pageViewport} />
        </div>
      </div>
    </SidebarProvider>
  )
}

export default function App() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem("liquid-glass-theme")
      return saved === "light" || saved === "dark" ? saved : "system"
    } catch {
      return "system"
    }
  })
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches)
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  const theme: GlassAppearance = preference === "system" ? (systemDark ? "dark" : "light") : preference
  const onPreferenceChange = setPreference
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    document.documentElement.style.colorScheme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#191918" : "#faf9f6")
    try {
      localStorage.setItem("liquid-glass-theme", preference)
    } catch {
      /* Storage may be disabled. */
    }
  }, [theme, preference])
  if (location.pathname !== "/") {
    return (
      <div className="page">
        <main className="intro">
          <h1>Page not found.</h1>
          <a href="/" className="intro-link">
            Back to Liquid Glass
          </a>
        </main>
      </div>
    )
  }
  return <SiteMaterialProvider><Home theme={theme} preference={preference} onPreferenceChange={onPreferenceChange} /></SiteMaterialProvider>
}
