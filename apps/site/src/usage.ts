import type { ExampleKind, ToolbarVariant, MenuOptions } from "./Examples"
import { progressiveBlurLevels, defaultProgressiveOptions } from "./ProgressiveScenes"
import type { ProgressiveOptions } from "./ProgressiveScenes"
import type { GlassMaterial, GlassAppearance } from "@glass-sdk/liquid-glass"

export const installCommand = "npm install @glass-sdk/liquid-glass@~0.0.1"

const imports = {
  slider: "GlassSlider",
  switch: "GlassSwitch",
  "progressive-blur": "GlassScrollEdges",
  surface: "GlassSurface",
  buttons: "GlassButton",
  toolbar: "GlassToolbar, GlassToolbarButton",
  tabs: "GlassTabs",
  menu: "GlassButton, GlassMenu, GlassMenuTrigger, GlassMenuContent, GlassMenuItem",
}
const snippets = {
  slider: `<GlassSlider aria-label="Volume" defaultValue={50} onValueCommitted={(value) => console.log(value)} />`,
  switch: `<label style={{ display: "flex", alignItems: "center", gap: 12 }}>
  Notifications <GlassSwitch defaultChecked name="notifications" />
</label>`,
  "progressive-blur": "",
  surface: `<GlassSurface interactive radius={28} style={{ width: 280, padding: 20 }}>
  Your content
</GlassSurface>`,
  buttons: `<GlassButton>Get started</GlassButton>`,
  toolbar: "",
  tabs: `<GlassTabs
  aria-label="Music"
  items={[
    { value: "listen", label: "Listen" },
    { value: "browse", label: "Browse" },
    { value: "library", label: "Library" },
  ]}
/>`,
  menu: "",
}
function menuContentCode(material: GlassMaterial, options: MenuOptions) {
  const share = options.submenu ? `<GlassMenuSubmenu>
  <GlassMenuSubmenuTrigger>Share ›</GlassMenuSubmenuTrigger>
  <GlassMenuSubmenuContent material="${material}">
    <GlassMenuItem>Copy link</GlassMenuItem>
    <GlassMenuItem>Email</GlassMenuItem>
    <GlassMenuSubmenu>
      <GlassMenuSubmenuTrigger>More ›</GlassMenuSubmenuTrigger>
      <GlassMenuSubmenuContent material="${material}">
        <GlassMenuItem>Messages</GlassMenuItem>
        <GlassMenuItem disabled>AirDrop</GlassMenuItem>
      </GlassMenuSubmenuContent>
    </GlassMenuSubmenu>
  </GlassMenuSubmenuContent>
</GlassMenuSubmenu>` : "<GlassMenuItem>Share</GlassMenuItem>"
  return `<GlassMenuContent material="${material}" side="${options.side}" align="${options.align}">
  <GlassMenuItem>Save to library</GlassMenuItem>
${share.split("\n").map((line) => `  ${line}`).join("\n")}
  <GlassMenuItem>Download</GlassMenuItem>
</GlassMenuContent>`
}
function menuCode(material: GlassMaterial, options: MenuOptions) {
  if (options.trigger === "toolbar") return `<GlassToolbar aria-label="Playback">
  <GlassToolbarButton aria-label="Play">▶</GlassToolbarButton>
  <GlassToolbarButton aria-label="Favorite">♡</GlassToolbarButton>
  <GlassMenu>
    <GlassToolbarButton aria-label="Options" render={<GlassMenuTrigger />}>
      ⋯
    </GlassToolbarButton>
${menuContentCode(material, options).split("\n").map((line) => `    ${line}`).join("\n")}
  </GlassMenu>
</GlassToolbar>`
  return `<GlassMenu>
  <GlassMenuTrigger render={<GlassButton size="icon" aria-label="Options" />}>
    ⋯
  </GlassMenuTrigger>
${menuContentCode(material, options).split("\n").map((line) => `  ${line}`).join("\n")}
</GlassMenu>`
}
function toolbarCode(variant: ToolbarVariant, material: GlassMaterial, options: MenuOptions) {
  return `<GlassToolbar aria-label="Playback"${variant === "flexible" ? ' style={{ width: 196 }}' : ""}>
  <GlassToolbarButton aria-label="Play">▶</GlassToolbarButton>
  <GlassToolbarButton aria-label="Volume">♪</GlassToolbarButton>${
    variant === "fixed" ? '\n  <GlassToolbarSpacer sizing="fixed" />' :
    variant === "flexible" ? '\n  <GlassToolbarSpacer sizing="flexible" />' : ""
  }
  <GlassToolbarButton aria-label="Favorite">♡</GlassToolbarButton>${variant === "menu" ? `
  <GlassMenu>
    <GlassToolbarButton aria-label="Playback options" render={<GlassMenuTrigger />}>
      ⋯
    </GlassToolbarButton>
${menuContentCode(material, options).split("\n").map((line) => `    ${line}`).join("\n")}
  </GlassMenu>` : ""}
</GlassToolbar>`
}
export function usageCode(
  kind: ExampleKind,
  material: GlassMaterial,
  appearance: GlassAppearance,
  toolbarVariant: ToolbarVariant = "normal",
  menuOptions: MenuOptions = { side: "bottom", align: "end", submenu: false, trigger: "button" },
  tint?: string,
  sliderStepped = false,
  progressive: ProgressiveOptions = defaultProgressiveOptions
) {
  if (kind === "progressive-blur") return progressiveCode(progressive, appearance)
  const extraImports = kind === "menu" ? (menuOptions.trigger === "toolbar" ? ", GlassToolbar, GlassToolbarButton" : "") :
    kind !== "toolbar" || toolbarVariant === "normal" ? "" :
    toolbarVariant === "menu" ? ", GlassMenu, GlassMenuTrigger, GlassMenuContent, GlassMenuItem" : ", GlassToolbarSpacer"
  const submenuImports = menuOptions.submenu && (kind === "menu" || (kind === "toolbar" && toolbarVariant === "menu")) ? ", GlassMenuSubmenu, GlassMenuSubmenuTrigger, GlassMenuSubmenuContent" : ""
  const snippet = kind === "toolbar" ? toolbarCode(toolbarVariant, material, menuOptions) : kind === "menu" ? menuCode(material, menuOptions) : kind === "slider" && sliderStepped ? `<GlassSlider aria-label="Volume" min={0} max={100} step={25} ticks defaultValue={50} />` : snippets[kind]
  const tintedSnippet = tint ? snippet.replace(/<(GlassSurface|GlassButton|GlassToolbar|GlassTabs|GlassSlider|GlassSwitch|GlassMenuContent|GlassMenuSubmenuContent)(?=[\s>])/g, `<$1 tint="${tint}"`) : snippet
  return `import {
${["GlassScene", "GlassContent", ...`${kind === "menu" && menuOptions.trigger === "toolbar" ? imports.menu.replace("GlassButton, ", "") : imports[kind]}${extraImports}${submenuImports}`.split(", ")].map((name) => `  ${name},`).join("\n")}
} from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

<GlassScene material="${material}" appearance="${appearance}" style={{ height: 400 }}>
  <GlassContent>
    <img src="/landscape.jpg" alt="Mountain landscape"
      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </GlassContent>
  <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 24 }}>
${tintedSnippet
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
  </div>
</GlassScene>`
}

function progressiveCode(options: ProgressiveOptions, appearance: GlassAppearance) {
  const props = [options.blur === "off" ? "disabled" : `blur={${progressiveBlurLevels[options.blur]}}`, options.refraction && "refraction={6}"].filter(Boolean).join(" ")
  if (options.mode === "image") return `import { GlassScene, GlassContent, GlassProgressiveBlur } from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

<GlassScene appearance="${appearance}" style={{ height: 390, overflow: "hidden", borderRadius: 16 }}>
  <GlassContent>
    <img src="/landscape.jpg" alt="Mountain landscape"
      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </GlassContent>
  <GlassProgressiveBlur edge="${options.edge}" size={260} ${props} />
  <p style={{ position: "absolute", ${options.edge}: 28, left: 28 }}>A little further away.</p>
</GlassScene>`
  return `import { useRef, type ReactNode } from "react";
import { GlassScene, GlassContent, GlassButton, GlassScrollEdges } from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

export function Reader({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLElement>(null);
  return (
    <GlassScene appearance="${appearance}" style={{ height: 390, overflow: "hidden" }}>
      <GlassContent>
        <section ref={scrollRef} tabIndex={0} aria-label="Article"
          style={{ height: "100%", overflowY: "auto", scrollPaddingBlock: 110 }}>
          {children}
        </section>
      </GlassContent>
      <GlassScrollEdges target={scrollRef} size={110} ${props} />
      <GlassButton size="icon" aria-label="Back"
        style={{ position: "absolute", top: 14, left: 16 }}>‹</GlassButton>
    </GlassScene>
  );
}`
}
