import {
  GlassButton,
  GlassSegmented,
  GlassSegmentedItem,
  GlassSlider,
  GlassSurface,
  GlassSwitch,
} from "@glass-sdk/liquid-glass/react";
import { useEffect, useState } from "react";
import { Section, Stage } from "../lib/ui";

/** Every control on one panel; with Auto motion they move by themselves. */
export function Controls({ auto, night }: { auto: boolean; night: boolean }) {
  const [on, setOn] = useState(true);
  const [level, setLevel] = useState(40);
  const [range, setRange] = useState("week");
  useEffect(() => {
    if (!auto) return;
    const start = performance.now();
    const timer = setInterval(() => {
      const t = (performance.now() - start) / 1000;
      setLevel(Math.round(50 + 45 * Math.sin(t * 1.3)));
      setOn(Math.sin(t * 1.6) > 0);
    }, 50);
    return () => clearInterval(timer);
  }, [auto]);
  return (
    <Section
      id="controls"
      title="Controls"
      note="Hold a thumb: it lifts into a lens that shows exactly what is under it."
    >
      <Stage photo="50% 70%" night={night} className="center">
        <GlassSurface className="controls-panel" radius={28}>
          <div className="control-row">
            <span id="wifi-label">Wi-Fi</span>
            <GlassSwitch checked={on} onCheckedChange={setOn} aria-labelledby="wifi-label" />
          </div>
          <div className="control-row">
            <span id="level-label">Brightness</span>
            <GlassSlider value={level} onValueChange={setLevel} aria-labelledby="level-label" />
            <output>{level}</output>
          </div>
          <GlassSegmented kind="radio" value={range} onValueChange={setRange} aria-label="Period">
            <GlassSegmentedItem value="day">Day</GlassSegmentedItem>
            <GlassSegmentedItem value="week">Week</GlassSegmentedItem>
            <GlassSegmentedItem value="month">Month</GlassSegmentedItem>
          </GlassSegmented>
          <div className="control-row buttons">
            <GlassButton onClick={() => setLevel(0)}>Off</GlassButton>
            <GlassButton onClick={() => setLevel(100)}>Full</GlassButton>
          </div>
        </GlassSurface>
      </Stage>
    </Section>
  );
}
