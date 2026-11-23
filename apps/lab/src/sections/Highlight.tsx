import { GlassButton, GlassHighlight, GlassSurface } from "@glass-sdk/liquid-glass/react";
import { useEffect, useState } from "react";
import { Section, Stage } from "../lib/ui";

const rows = ["New window", "Duplicate", "Rename…", "Move to…", "Share", "Delete"] as const;

/** A panel whose highlight follows the row under the pointer, and a popup scaled in with CSS. */
export function Highlight({ auto, night }: { auto: boolean; night: boolean }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [popup, setPopup] = useState(false);
  useEffect(() => {
    if (!auto) return;
    let step = 0;
    const timer = setInterval(() => setPopup(++step % 3 === 0), 1200);
    return () => clearInterval(timer);
  }, [auto]);
  return (
    <Section
      id="highlight"
      title="Highlight and popup"
      note="The pill keeps the panel's corners near them; the popup's CSS animation is followed every frame."
    >
      <Stage photo="70% 55%" night={night} className="highlight-stage">
        <GlassSurface
          className="panel"
          radius={20}
          role="menu"
          aria-label="Actions"
          onPointerLeave={() => setTarget(null)}
        >
          <GlassHighlight target={target} />
          {rows.map((row) => (
            <button
              key={row}
              type="button"
              role="menuitem"
              className={row === "Delete" ? "row danger" : "row"}
              onPointerEnter={(event) => setTarget(event.currentTarget)}
              onFocus={(event) => setTarget(event.currentTarget)}
            >
              {row}
            </button>
          ))}
        </GlassSurface>
        <div className="popup-anchor">
          <GlassButton onClick={() => setPopup(!popup)} aria-expanded={popup}>
            {popup ? "Close popup" : "Open popup"}
          </GlassButton>
          {popup && (
            <GlassSurface className="popup" radius={24} floating role="dialog" aria-label="Popup">
              <strong>Scaled in with CSS</strong>
              <span className="secondary">The glass draws where the surface really is.</span>
              <GlassButton onClick={() => setPopup(false)}>Done</GlassButton>
            </GlassSurface>
          )}
        </div>
      </Stage>
    </Section>
  );
}
