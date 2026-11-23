import { GlassSurface } from "@glass-sdk/liquid-glass/react";
import { Section, Stage } from "../lib/ui";

/** Emoji with joiners and text set right to left, under glass. */
export function Scripts() {
  return (
    <Section
      id="scripts"
      title="Emoji and right to left"
      note="Every run is drawn as the browser shaped it: joiners, skin tones and right-to-left lines."
    >
      <Stage className="scripts-stage" height={240}>
        <p className="emoji-line">👩🏽‍💻 🧑🏻‍🚀 🏳️‍🌈 🐙 🍣 🎸 🧪 🌋 🫧 🪩 🦜 🌈</p>
        <p dir="rtl" lang="he" className="rtl-line">
          שלום עולם — טקסט מימין לשמאל מתחת לזכוכית
        </p>
        <GlassSurface className="scripts-glass" radius="capsule">
          🫧 Bubbles
        </GlassSurface>
      </Stage>
    </Section>
  );
}
