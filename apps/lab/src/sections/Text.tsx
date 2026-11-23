import {
  GlassTab,
  GlassTabBar,
  useGlassScene,
  useGlassSurface,
} from "@glass-sdk/liquid-glass/react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { paragraphs, rtl } from "../lib/content";
import { Section, Stage } from "../lib/ui";

const tabs = [
  {
    value: "home",
    label: "Home",
    icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  },
  {
    value: "search",
    label: "Search",
    icon: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16.5 16.5L21 21",
  },
  { value: "library", label: "Library", icon: "M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 15-4-1z" },
  {
    value: "profile",
    label: "Profile",
    icon: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21c1-4 4-6 8-6s7 2 8 6",
  },
] as const;

/** Small type in several scripts under a lens and a tab bar: the hardest thing to refract. */
export function Text({ auto }: { auto: boolean }) {
  const [tab, setTab] = useState<string>("home");
  useEffect(() => {
    if (!auto) return;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setTab(tabs[step % tabs.length]?.value ?? "home");
    }, 1200);
    return () => clearInterval(timer);
  }, [auto]);
  return (
    <Section
      id="text"
      title="Text"
      note="Drag the lens across the paragraphs; letters should bend at the rim and stay crisp in the middle."
    >
      <Stage className="text-stage" height={420}>
        <div className="text-body">
          {paragraphs.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
          <p dir="rtl" lang="ar">
            {rtl}
          </p>
        </div>
        <DraggableLens auto={auto} />
        <GlassTabBar
          value={tab}
          onValueChange={setTab}
          aria-label="Sections"
          className="text-tabbar"
        >
          {tabs.map((item) => (
            <GlassTab
              key={item.value}
              value={item.value}
              icon={
                <svg viewBox="0 0 24 24" aria-hidden="true" className="glyph">
                  <path d={item.icon} />
                </svg>
              }
              label={item.label}
            />
          ))}
        </GlassTabBar>
      </Stage>
    </Section>
  );
}

function placeAt(element: HTMLElement | null, point: { x: number; y: number }) {
  if (element) element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
}

/** A lens the pointer drags over the text; with Auto motion it sweeps by itself. */
function DraggableLens({ auto }: { auto: boolean }) {
  const scene = useGlassScene();
  const mover = useRef<HTMLDivElement>(null);
  const position = useRef({ x: 120, y: 60 });

  useEffect(() => {
    const element = mover.current;
    placeAt(element, position.current);
    const stage = element?.parentElement;
    if (!auto || !scene || !element || !stage) return;
    const start = performance.now();
    return scene.animate((now) => {
      const t = (now - start) / 1000;
      const w = stage.clientWidth - element.offsetWidth;
      const h = stage.clientHeight - element.offsetHeight - 90;
      position.current = {
        x: (w / 2) * (1 + Math.sin(t * 0.9)),
        y: (h / 2) * (1 + Math.sin(t * 0.37)),
      };
      placeAt(element, position.current);
      return true;
    });
  }, [auto, scene]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const pointer = { x: event.clientX, y: event.clientY };
    const from = position.current;
    const onMove = (e: PointerEvent) => {
      position.current = { x: from.x + e.clientX - pointer.x, y: from.y + e.clientY - pointer.y };
      placeAt(element, position.current);
    };
    const onUp = () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="lens-mover" ref={mover} onPointerDown={onPointerDown}>
      <Lens />
    </div>
  );
}

/** A lifted lens with no body of its own, like a pressed tab's or switch's. */
function Lens() {
  const { ref, surface } = useGlassSurface({ material: "clear", body: false, lensHeight: 72 });
  useEffect(() => {
    if (!surface) return;
    const { width, height } = surface.element.getBoundingClientRect();
    const radius = Math.min(width, height) / 2;
    surface.setShapes([
      {
        role: "lens",
        rect: { x: 0, y: 0, width, height },
        radii: [radius, radius, radius, radius],
        lift: 1,
        magnify: 1.1,
        alpha: 1,
        merge: 0,
        tint: null,
        light: 0,
      },
    ]);
  }, [surface]);
  return <div className="lens" ref={ref} aria-label="Lens" role="img" />;
}
