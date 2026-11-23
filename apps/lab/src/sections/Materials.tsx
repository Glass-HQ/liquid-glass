import { GlassButton, GlassSurface } from "@glass-sdk/liquid-glass/react";
import { Section, Stage } from "../lib/ui";

/** The two materials side by side over the same photo. */
export function Materials({ night }: { night: boolean }) {
  return (
    <Section
      id="materials"
      title="Materials"
      note="Regular frosts and tones what is behind it; clear only bends it at the rim."
    >
      <Stage photo="50% 62%" night={night} className="materials">
        <MaterialCard material="regular" />
        <MaterialCard material="clear" />
      </Stage>
    </Section>
  );
}

function MaterialCard({ material }: { material: "regular" | "clear" }) {
  return (
    <GlassSurface className="material-card" radius={28} material={material}>
      <span className="eyebrow">{material === "regular" ? "Regular" : "Clear"}</span>
      <strong>{material === "regular" ? "Frosted and legible" : "Just the rim"}</strong>
      <span className="secondary">
        {material === "regular"
          ? "Text on it stays readable over anything."
          : "The photo shows through, bent at the edge."}
      </span>
      <GlassButton material={material}>Button</GlassButton>
    </GlassSurface>
  );
}
