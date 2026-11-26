import {
  GlassMenu,
  GlassMenuItem,
  GlassMenuPopup,
  GlassMenuSubmenu,
  GlassMenuSubmenuPopup,
  GlassMenuSubmenuTrigger,
  GlassMenuTrigger,
  GlassScene,
} from "@glass-sdk/liquid-glass/react";
import { useEffect, useLayoutEffect, useState } from "react";
import { Hud } from "./hud/Hud";
import { Problems } from "./hud/Problems";
import { setParam, useAppearance, useSettings, type LabSettings } from "./lib/flags";
import { Controls } from "./sections/Controls";
import { Gradients } from "./sections/Gradients";
import { Highlight } from "./sections/Highlight";
import { Media } from "./sections/List";
import { Materials } from "./sections/Materials";
import { Overlays } from "./sections/Overlays";
import { Progressive } from "./sections/Progressive";
import { Readability } from "./sections/Readability";
import { Scripts } from "./sections/Scripts";
import { Stress } from "./sections/Stress";
import { Text } from "./sections/Text";

const sections = [
  ["materials", "Materials"],
  ["text", "Text"],
  ["gradients", "Gradients"],
  ["media", "Scrolling and video"],
  ["progressive", "Progressive blur"],
  ["controls", "Controls"],
  ["highlight", "Highlight and popup"],
  ["scripts", "Emoji and right to left"],
  ["overlays", "Overlays"],
  ["readability", "Readability"],
  ["stress", "Stress"],
] as const;

const backdrops = { light: "#fafafa", dark: "#09090b" } as const;

export function App() {
  const settings = useSettings();
  const appearance = useAppearance(settings.theme);
  const night = appearance === "dark";
  const active = useActiveSection();

  // Layout effect: stages read the theme's colors in their own effects, which run after this.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = appearance;
    document.documentElement.style.colorScheme = appearance;
  }, [appearance]);

  return (
    <GlassScene
      appearance={appearance}
      material={settings.material}
      tintAmount={settings.tint}
      specular={settings.specular}
      backdrop={backdrops[appearance]}
      telemetry={settings.hud}
      className="lab"
    >
      <div className="page">
        <aside className="aside" aria-label="Sections">
          <ul className="toc">
            {sections.map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`} aria-current={active === id ? "true" : undefined}>
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </aside>
        <main className="main">
          <header className="intro">
            <h1>Lab</h1>
            <p>
              Every component over the content that is hardest to draw glass over. Settings in the
              corner apply to the whole page and stay in the address, so a view can be shared.
            </p>
          </header>
          <Materials night={night} />
          <Text auto={settings.auto} />
          <Gradients />
          <Media />
          <Progressive night={night} />
          <Controls auto={settings.auto} night={night} />
          <Highlight auto={settings.auto} night={night} />
          <Scripts />
          <Overlays params={settings.params} />
          <Readability params={settings.params} night={night} />
          <Stress params={settings.params} night={night} />
        </main>
      </div>
      <Settings settings={settings} />
      {settings.hud && <Hud />}
      <Problems />
    </GlassScene>
  );
}

/** The section being read: the last one whose top has passed a third of the window. */
function useActiveSection(): string {
  const [active, setActive] = useState<string>(sections[0][0]);
  useEffect(() => {
    const update = () => {
      let current: string = sections[0][0];
      for (const [id] of sections) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top < window.innerHeight / 3) current = id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2)
        current = sections[sections.length - 1]?.[0] ?? current;
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return active;
}

/** The page's settings, in a glass menu in the top right corner. */
function Settings({ settings }: { settings: LabSettings }) {
  const tint = typeof settings.tint === "number" ? String(settings.tint) : settings.tint;
  return (
    <div className="settings">
      <GlassMenu>
        <GlassMenuTrigger radius="capsule" aria-label="Settings" className="settings-button">
          <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
          </svg>
        </GlassMenuTrigger>
        <GlassMenuPopup align="end" className="settings-menu">
          <Setting
            label="Appearance"
            value={settings.theme}
            onChange={(value) => setParam("theme", value === "auto" ? null : value)}
            options={[
              ["auto", "System"],
              ["light", "Light"],
              ["dark", "Dark"],
            ]}
          />
          <Setting
            label="Material"
            value={settings.material}
            onChange={(value) => setParam("material", value === "regular" ? null : value)}
            options={[
              ["regular", "Regular"],
              ["clear", "Clear"],
            ]}
          />
          <Setting
            label="Tint amount"
            value={tint}
            onChange={(value) => setParam("tint", value === "default" ? null : value)}
            options={[
              ["clear", "Clear"],
              ["default", "Default"],
              ["tinted", "Tinted"],
            ]}
          />
          <Setting
            label="Specular highlights"
            value={settings.specular ? "on" : "off"}
            onChange={(value) => setParam("specular", value === "on")}
            options={[
              ["on", "On"],
              ["off", "Off"],
            ]}
          />
          <Setting
            label="Auto motion"
            value={settings.auto ? "on" : "off"}
            onChange={(value) => setParam("auto", value === "on")}
            options={[
              ["on", "On"],
              ["off", "Off"],
            ]}
          />
          <Setting
            label="Telemetry"
            value={settings.hud ? "on" : "off"}
            onChange={(value) => setParam("hud", value === "on")}
            options={[
              ["on", "On"],
              ["off", "Off"],
            ]}
          />
        </GlassMenuPopup>
      </GlassMenu>
    </div>
  );
}

/** One setting: its name and value, opening the values to choose from, the chosen one ticked. */
function Setting<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  const current = options.find(([option]) => option === value)?.[1] ?? value;
  return (
    <GlassMenuSubmenu>
      <GlassMenuSubmenuTrigger detail={current}>{label}</GlassMenuSubmenuTrigger>
      <GlassMenuSubmenuPopup side="left">
        {options.map(([option, name]) => (
          <GlassMenuItem
            key={option}
            role="menuitemradio"
            checked={option === value}
            onSelect={() => onChange(option)}
          >
            {name}
          </GlassMenuItem>
        ))}
      </GlassMenuSubmenuPopup>
    </GlassMenuSubmenu>
  );
}
