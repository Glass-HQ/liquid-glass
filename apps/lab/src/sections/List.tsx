import { GlassSurface, useGlassScene } from "@glass-sdk/liquid-glass/react";
import { useEffect, useRef, useState } from "react";
import { listItems } from "../lib/content";
import { Section, Stage } from "../lib/ui";

/** A glass header inside a scroller, and a video fed to the scene as a live source. */
export function Media() {
  return (
    <Section
      id="media"
      title="Scrolling and video"
      note="The header is glass inside its scroller; the video's frames reach the worker as it plays."
    >
      <div className="two-up">
        <Stage className="list-stage">
          <div className="list-scroller">
            <GlassSurface className="list-header" radius="capsule">
              <strong>Recents</strong>
              <span className="secondary">{listItems.length} items</span>
            </GlassSurface>
            <ul className="list">
              {listItems.map((item) => (
                <li key={item.id}>
                  <span className="list-icon" style={{ background: `hsl(${item.hue} 75% 55%)` }} />
                  <span className="list-text">
                    <strong>{item.title}</strong>
                    <span className="secondary">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Stage>
        <Video />
      </div>
    </Section>
  );
}

function Video() {
  const scene = useGlassScene();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const element = video.current;
    if (!scene || !element) return;
    return scene.addSource(element);
  }, [scene]);
  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
    setPlaying(!element.paused);
  };
  return (
    <Stage className="video-stage">
      <video ref={video} src="./clip.mp4" autoPlay muted loop playsInline />
      <GlassSurface className="video-bar" radius="capsule" material="clear">
        <button type="button" className="text-button" onClick={toggle}>
          {playing ? "Pause" : "Play"}
        </button>
        <span className="secondary">Test pattern · 60 fps</span>
      </GlassSurface>
    </Stage>
  );
}
