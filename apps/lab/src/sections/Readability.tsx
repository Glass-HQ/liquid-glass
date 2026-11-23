import { GlassButton, GlassSurface, useGlassScene } from "@glass-sdk/liquid-glass/react";
import { useEffect, useRef, useState } from "react";
import { paragraphs, Photo } from "../lib/content";
import { Options, Section, Stage } from "../lib/ui";

const backdrops = [
  ["black", "Black"],
  ["white", "White"],
  ["gray", "Gray"],
  ["text", "Text"],
  ["night", "Night text"],
  ["photo", "Photo"],
  ["video", "Video"],
] as const;
type Backdrop = (typeof backdrops)[number][0];

const busy = paragraphs.join(" ").repeat(3);

/**
 * Labels on glass over the backdrops that make them hard to read. Small regular glass follows
 * what is behind it; clear glass dims bright content. `?backdrop=` picks one on load.
 */
export function Readability({ params, night }: { params: URLSearchParams; night: boolean }) {
  const [backdrop, setBackdrop] = useState<Backdrop>(
    () => backdrops.find(([id]) => id === params.get("backdrop"))?.[0] ?? "photo",
  );
  return (
    <Section
      id="readability"
      title="Readability"
      note="The same labels on regular and clear glass, over the backdrops that make them hard to read."
    >
      <Stage
        className={`readability-stage rd-${backdrop}`}
        height={420}
        controls={
          <Options label="Backdrop" value={backdrop} onChange={setBackdrop} items={backdrops} />
        }
      >
        <Behind backdrop={backdrop} night={night} />
        <div className="rd-sets">
          <Set material="regular" />
          <Set material="clear" />
        </div>
      </Stage>
    </Section>
  );
}

function Behind({ backdrop, night }: { backdrop: Backdrop; night: boolean }) {
  const scene = useGlassScene();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!scene || !element) return;
    return scene.addSource(element);
  }, [scene, backdrop]);
  if (backdrop === "text" || backdrop === "night") return <p className="rd-busy">{busy}</p>;
  if (backdrop === "photo") return <Photo position="50% 55%" night={night} />;
  if (backdrop === "video")
    return (
      <video ref={video} className="stage-photo" src="./clip.mp4" autoPlay muted loop playsInline />
    );
  return null;
}

function Set({ material }: { material: "regular" | "clear" }) {
  return (
    <div className="rd-set">
      <GlassButton material={material}>
        <Star />
        Label
      </GlassButton>
      <GlassSurface material={material} radius="capsule" className="rd-bar">
        <Star />
        <strong>Toolbar</strong>
        <span className="secondary">Secondary</span>
      </GlassSurface>
      <GlassSurface material={material} radius={24} className="rd-panel">
        <strong>{material === "regular" ? "Regular" : "Clear"}</strong>
        <span>Body text on a larger piece of glass.</span>
        <span className="secondary">Secondary label · 12:45</span>
      </GlassSurface>
    </div>
  );
}

function Star() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"
      />
    </svg>
  );
}
