import type { ExampleKind, ToolbarVariant, MenuOptions } from "./Examples";
import { progressiveBlurLevels, defaultProgressiveOptions } from "./ProgressiveScenes";
import type { ProgressiveOptions } from "./ProgressiveScenes";
import type { GlassMaterial, GlassAppearance } from "@glass-sdk/liquid-glass";

export const installCommand = "npm install @glass-sdk/liquid-glass@~0.0.2";

const imports = {
  slider: "GlassSlider",
  switch: "GlassSwitch",
  "progressive-blur": "GlassScrollEdges",
  surface: "GlassSurface",
  buttons: "GlassButton",
  toolbar: "GlassToolbar, GlassToolbarButton",
  tabs: "GlassTabs",
  menu: "GlassButton, GlassMenu, GlassMenuTrigger, GlassMenuContent, GlassMenuItem",
  "color-picker": "GlassColorPicker",
};
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
  "color-picker": `<GlassColorPicker defaultValue="#0a84ff" onValueCommitted={(color) => console.log(color)} />`,
};
function menuContentCode(material: GlassMaterial, options: MenuOptions) {
  const share = options.submenu
    ? `<GlassMenuSubmenu>
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
</GlassMenuSubmenu>`
    : "<GlassMenuItem>Share</GlassMenuItem>";
  return `<GlassMenuContent material="${material}" side="${options.side}" align="${options.align}">
  <GlassMenuItem>Save to library</GlassMenuItem>
${share
  .split("\n")
  .map((line) => `  ${line}`)
  .join("\n")}
  <GlassMenuItem>Download</GlassMenuItem>
</GlassMenuContent>`;
}
function menuCode(material: GlassMaterial, options: MenuOptions) {
  return `<GlassMenu>
  <GlassMenuTrigger render={<GlassButton size="icon" aria-label="Options" />}>
    ⋯
  </GlassMenuTrigger>
${menuContentCode(material, options)
  .split("\n")
  .map((line) => `  ${line}`)
  .join("\n")}
</GlassMenu>`;
}
function toolbarCode(variant: ToolbarVariant, material: GlassMaterial, options: MenuOptions) {
  return `<GlassToolbar aria-label="Playback"${variant === "flexible" ? " style={{ width: 196 }}" : ""}>
  <GlassToolbarButton aria-label="Play">▶</GlassToolbarButton>
  <GlassToolbarButton aria-label="Volume">♪</GlassToolbarButton>${
    variant === "fixed"
      ? '\n  <GlassToolbarSpacer sizing="fixed" />'
      : variant === "flexible"
        ? '\n  <GlassToolbarSpacer sizing="flexible" />'
        : ""
  }
  <GlassToolbarButton aria-label="Favorite">♡</GlassToolbarButton>${
    variant === "menu"
      ? `
  <GlassMenu>
    <GlassToolbarButton aria-label="Playback options" render={<GlassMenuTrigger />}>
      ⋯
    </GlassToolbarButton>
${menuContentCode(material, options)
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
  </GlassMenu>`
      : ""
  }
</GlassToolbar>`;
}
export function usageCode(
  kind: ExampleKind,
  material: GlassMaterial,
  appearance: GlassAppearance,
  toolbarVariant: ToolbarVariant = "normal",
  menuOptions: MenuOptions = { side: "bottom", align: "end", submenu: false },
  tint?: string,
  sliderStepped = false,
  progressive: ProgressiveOptions = defaultProgressiveOptions,
  specular = false,
) {
  if (kind === "progressive-blur") return progressiveCode(progressive, material, appearance);
  if (kind === "color-picker")
    return `import { useState } from "react";
import { GlassColorPicker } from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

export function ColorField() {
  const [color, setColor] = useState("#0a84ff");
  return (
    <GlassColorPicker
      appearance="${appearance}"
      value={color}
      onValueChange={setColor}
      name="color"
    />
  );
}`;
  const extraImports =
    kind === "menu"
      ? ""
      : kind !== "toolbar" || toolbarVariant === "normal"
        ? ""
        : toolbarVariant === "menu"
          ? ", GlassMenu, GlassMenuTrigger, GlassMenuContent, GlassMenuItem"
          : ", GlassToolbarSpacer";
  const submenuImports =
    menuOptions.submenu && (kind === "menu" || (kind === "toolbar" && toolbarVariant === "menu"))
      ? ", GlassMenuSubmenu, GlassMenuSubmenuTrigger, GlassMenuSubmenuContent"
      : "";
  const snippet =
    kind === "toolbar"
      ? toolbarCode(toolbarVariant, material, menuOptions)
      : kind === "menu"
        ? menuCode(material, menuOptions)
        : kind === "slider" && sliderStepped
          ? `<GlassSlider aria-label="Volume" min={0} max={100} step={25} ticks defaultValue={50} />`
          : snippets[kind];
  const tintedSnippet = tint
    ? snippet.replace(
        /<(GlassSurface|GlassButton|GlassToolbar|GlassTabs|GlassSlider|GlassSwitch|GlassMenuContent|GlassMenuSubmenuContent)(?=[\s>])/g,
        `<$1 tint="${tint}"`,
      )
    : snippet;
  return `import {
${["GlassScene", "GlassContent", ...`${imports[kind]}${extraImports}${submenuImports}`.split(", ")].map((name) => `  ${name},`).join("\n")}
} from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

<GlassScene material="${material}" appearance="${appearance}"${specular ? " specular" : ""} style={{ height: 400 }}>
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
</GlassScene>`;
}

function progressiveCode(
  options: ProgressiveOptions,
  material: GlassMaterial,
  appearance: GlassAppearance,
) {
  const props = [
    options.blur === "off" ? "disabled" : `blur={${progressiveBlurLevels[options.blur]}}`,
    options.refraction && "refraction={6}",
  ]
    .filter(Boolean)
    .join(" ");
  return `import { useRef, type ReactNode } from "react";
import { GlassScene, GlassContent, GlassSurface, GlassScrollEdges } from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

export function Library({ albums, nowPlaying }: { albums: ReactNode; nowPlaying: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <GlassScene material="${material}" appearance="${appearance}" style={{ height: 390, overflow: "hidden" }}>
      <GlassContent layout="scroll" ref={scrollRef} tabIndex={0} role="region"
        aria-label="Albums" style={{ scrollPaddingBlock: 96 }}>
        {albums}
      </GlassContent>
      <GlassScrollEdges target={scrollRef} size={96} ${props} />
      <GlassSurface radius="capsule"
        style={{ position: "absolute", bottom: 14, left: 16, right: 16, padding: 6 }}>
        {nowPlaying}
      </GlassSurface>
    </GlassScene>
  );
}`;
}
