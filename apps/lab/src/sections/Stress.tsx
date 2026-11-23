import { GlassSurface, useGlassScene } from "@glass-sdk/liquid-glass/react";
import { useEffect, useRef, useState } from "react";
import { BusyContent } from "../lib/content";
import { setParam } from "../lib/flags";
import { Options, Section, Stage, Toggle } from "../lib/ui";

const most = 64;
const counts = [
  [1, "1"],
  [8, "8"],
  [16, "16"],
  [32, "32"],
  [64, "64"],
] as const;

interface Path {
  readonly ax: number;
  readonly ay: number;
  readonly px: number;
  readonly py: number;
  readonly kind: "chip" | "orb" | "card";
}

/** Deterministic paths, so runs with the same count are comparable. */
const paths: readonly Path[] = Array.from({ length: most }, (_, i) => ({
  ax: 0.21 + ((i * 0.618034) % 1) * 0.37,
  ay: 0.17 + ((i * 0.414214) % 1) * 0.41,
  px: i * 1.7,
  py: i * 2.3,
  kind: i % 3 === 0 ? "card" : i % 3 === 1 ? "chip" : "orb",
}));

const sizes = { chip: { w: 120, h: 40 }, orb: { w: 56, h: 56 }, card: { w: 168, h: 96 } } as const;

/**
 * Up to 64 surfaces gliding over busy content, each on its own path: the heaviest steady load,
 * every surface measured, refracted and presented every frame. `?n=` and `?scroll` on load.
 */
export function Stress({ params, night }: { params: URLSearchParams; night: boolean }) {
  const [count, setCount] = useState(() => {
    const n = Number(params.get("n"));
    return counts.find(([c]) => c === n)?.[0] ?? 8;
  });
  const [scroll, setScroll] = useState(params.has("scroll"));
  const scene = useGlassScene();
  const stage = useRef<HTMLDivElement>(null);
  const movers = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const frame = stage.current;
    const scroller = frame?.querySelector<HTMLElement>(".busy-scroller");
    if (!scene || !frame) return;
    const start = performance.now();
    return scene.animate((now) => {
      const t = (now - start) / 1000;
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      for (let i = 0; i < count; i++) {
        const element = movers.current[i];
        const path = paths[i];
        if (!element || !path) continue;
        const size = sizes[path.kind];
        const x = ((width - size.w) / 2) * (1 + Math.sin(t * path.ax * Math.PI + path.px));
        const y = ((height - 64 - size.h) / 2) * (1 + Math.sin(t * path.ay * Math.PI + path.py));
        element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      }
      if (scroll && scroller) {
        const range = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = (range / 2) * (1 - Math.cos(t * 0.25 * Math.PI));
      }
      return true;
    });
  }, [scene, count, scroll]);

  return (
    <Section
      id="stress"
      title="Stress"
      note="Many surfaces moving at once over busy content. Turn on Telemetry to read the frame rate."
    >
      <div ref={stage}>
        <Stage
          className="stress-stage"
          height={520}
          controls={
            <>
              <Options
                label="Surfaces"
                value={count}
                onChange={(next) => {
                  setCount(next);
                  setParam("n", String(next));
                }}
                items={counts}
              />
              <Toggle
                label="Scroll"
                on={scroll}
                onChange={(next) => {
                  setScroll(next);
                  setParam("scroll", next);
                }}
              />
            </>
          }
        >
          <div className="busy-scroller">
            <BusyContent night={night} />
          </div>
          <div className="stress-layer" aria-hidden="true">
            {paths.slice(0, count).map((path, i) => {
              const size = sizes[path.kind];
              return (
                <div
                  key={i}
                  className="stress-mover"
                  ref={(element) => {
                    movers.current[i] = element;
                  }}
                  style={{ width: size.w, height: size.h }}
                >
                  <GlassSurface
                    className="stress-glass"
                    radius={path.kind === "card" ? 22 : "capsule"}
                    material={i % 4 === 3 ? "clear" : undefined}
                  >
                    {path.kind === "orb" ? null : <span>Glass {i + 1}</span>}
                  </GlassSurface>
                </div>
              );
            })}
          </div>
        </Stage>
      </div>
    </Section>
  );
}
