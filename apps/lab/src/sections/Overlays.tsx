import { GlassHighlight, GlassSurface } from "@glass-sdk/liquid-glass/react";
import { useState } from "react";
import { Section, Stage, Toggle } from "../lib/ui";

const bubbles = [
  "Every menu, dialog and popover here is glass, drawn from a copy of the page.",
  "Text, images, borders, gradients, shadows and icons all go under it.",
  "Español, 日本語, العربية, and emoji 🫧✨ go through the same text raster.",
  "A longer one, so the conversation fills the stage behind the glass: the quick brown fox jumps over the lazy dog, again and again, while panels open over it.",
  "Short one.",
  "Last one, at the bottom, so a menu near the edge has something to sit on.",
] as const;

const actions = ["Files", "Projects", "Bookmarks", "New page", "New folder", "Settings", "Help"];
const rows = ["Open beside", "Mute", "Rename", "Duplicate", "Archive", "Delete chat"];

/**
 * Overlays the way apps build them: a palette and a context menu that scale in with a CSS
 * animation and scroll their own lists (the glass element is the scroll container).
 */
export function Overlays({ params }: { params: URLSearchParams }) {
  const [palette, setPalette] = useState(params.has("open"));
  const [menu, setMenu] = useState(params.has("open"));
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return (
    <Section
      id="overlays"
      title="Overlays"
      note="Glass that scrolls its own content and scales in with CSS, over a conversation."
    >
      <Stage
        className="overlays-stage"
        height={460}
        controls={
          <>
            <Toggle label="Palette" on={palette} onChange={setPalette} />
            <Toggle label="Menu" on={menu} onChange={setMenu} />
          </>
        }
      >
        <div className="chat">
          {bubbles.map((text, index) => (
            <p key={index} className={index % 2 ? "bubble mine" : "bubble"}>
              {text}
            </p>
          ))}
        </div>
        {menu && (
          <GlassSurface
            className="context-menu"
            radius={16}
            floating
            role="menu"
            aria-label="Conversation"
            onPointerLeave={() => setTarget(null)}
          >
            <GlassHighlight target={target} />
            {rows.map((row) => (
              <button
                key={row}
                type="button"
                role="menuitem"
                className={row.startsWith("Delete") ? "row danger" : "row"}
                onPointerEnter={(event) => setTarget(event.currentTarget)}
                onFocus={(event) => setTarget(event.currentTarget)}
              >
                {row}
              </button>
            ))}
          </GlassSurface>
        )}
        {palette && (
          <GlassSurface className="palette" radius={24} floating role="dialog" aria-label="Palette">
            <input className="palette-search" placeholder="Search…" aria-label="Search" />
            <p className="palette-group">Go to</p>
            {actions.map((item) => (
              <button key={item} type="button" className="row">
                {item}
              </button>
            ))}
          </GlassSurface>
        )}
      </Stage>
    </Section>
  );
}
