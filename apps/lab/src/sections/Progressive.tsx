import { progressiveBlurMask } from "@glass-sdk/liquid-glass";
import { GlassProgressiveBlur } from "@glass-sdk/liquid-glass/react";
import { Section, Stage } from "../lib/ui";

const BLUR = 96;

const messages = [
  "A solid bubble, so any light lost where the blur takes over from the page shows as a band.",
  "Plain text straight on the photo is the other half: only the letters are there to blur.",
  "Scroll slowly and watch a bubble cross each blur. It should soften evenly, with no stripe.",
  "The blur draws only what scrolls here, as see-through as it was, so the photo stays sharp.",
  "At the faint side of each blur the page shows exactly as it is.",
  "One more, so there is something under the bottom blur too.",
  "And a last one to scroll to.",
];

/** A see-through scroller under two replacing progressive blurs. */
export function Progressive({ night }: { night: boolean }) {
  return (
    <Section
      id="progressive"
      title="Progressive blur"
      note="Replacing blurs over see-through content: bubbles and text soften evenly into each end, with no darker or lighter band where the blur begins."
    >
      <Stage photo="50% 40%" night={night} height={420} className="progressive-stage">
        <div
          className="progressive-scroller"
          style={{ maskImage: progressiveBlurMask({ start: BLUR, end: BLUR }) }}
        >
          {messages.map((message, i) => (
            <div key={i} className="progressive-row">
              <p className="progressive-bubble">{message}</p>
              <p className="progressive-text">{message}</p>
            </div>
          ))}
        </div>
        <GlassProgressiveBlur replace edge="top" className="progressive-band" />
        <GlassProgressiveBlur
          replace
          edge="bottom"
          className="progressive-band progressive-band-end"
        />
      </Stage>
    </Section>
  );
}
