import { GlassSurface } from "@glass-sdk/liquid-glass/react";
import { gradients } from "../lib/content";
import { Section, Stage } from "../lib/ui";

/** Hard stops, conic seams and fine stripes under one long piece of glass. */
export function Gradients() {
  return (
    <Section
      id="gradients"
      title="Gradients"
      note="Hard stops, a conic seam and 10 px stripes; the frost should blend them without banding."
    >
      <Stage className="gradient-stage" height={280}>
        {gradients.map((gradient, i) => (
          <div key={i} className="gradient-tile" style={{ background: gradient }} />
        ))}
        <GlassSurface className="gradient-glass" radius="capsule">
          <strong>Across four gradients</strong>
          <span className="secondary">Regular glass</span>
        </GlassSurface>
        <GlassSurface className="gradient-glass gradient-clear" radius="capsule" material="clear">
          <strong>Clear</strong>
        </GlassSurface>
      </Stage>
    </Section>
  );
}
