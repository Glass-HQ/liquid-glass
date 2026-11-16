import { useRef, useState } from "react";
import { nowPlaying } from "./music";
import type { ReactNode, RefObject } from "react";
import {
  GlassShape,
  GlassContent,
  GlassSurface,
  GlassButton,
  GlassTabs,
  GlassScrollEdges,
} from "@glass-sdk/liquid-glass";
import type { GlassAppearance, GlassBlurEdge } from "@glass-sdk/liquid-glass";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GridViewIcon,
  ListViewIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";

export const progressiveBlurLevels = { off: 0, soft: 10, balanced: 20, strong: 32 } as const;
export type ProgressiveOptions = {
  blur: keyof typeof progressiveBlurLevels;
  refraction: boolean;
};
export const defaultProgressiveOptions: ProgressiveOptions = {
  blur: "balanced",
  refraction: false,
};

type BlurProps = { blur: number; refraction: number; disabled: boolean };
const Icon = ({ icon }: { icon: typeof PlayIcon }) => (
  <HugeiconsIcon icon={icon} size={18} strokeWidth={1.8} />
);

/** The preview and its controls share the surrounding public GlassScene. */
export function ProgressiveScene({
  options,
  appearance,
}: {
  options: ProgressiveOptions;
  appearance: GlassAppearance;
}) {
  const blur = {
    blur: progressiveBlurLevels[options.blur] || 20,
    refraction: options.refraction ? 6 : 0,
    disabled: options.blur === "off",
  };
  return (
    <div className={`progressive-scene is-library ${appearance === "dark" ? "glass-dark" : ""}`}>
      <LibraryScene blur={blur} appearance={appearance} />
    </div>
  );
}

// The public scroll layout keeps native scrolling and stationary optical
// layers in the same paint pass on Safari.
function ScrollFrame({
  scroller,
  label,
  className,
  children,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  label: string;
  className: string;
  children: ReactNode;
}) {
  // GlassContent owns the filtered div and its scene registration.
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
  return (
    <GlassContent
      layout="scroll"
      ref={scroller}
      role="region"
      tabIndex={0}
      aria-label={label}
      className={`progressive-viewport ${className}`}
    >
      {children}
    </GlassContent>
  );
}

const cover = (path: string) => `https://is1-ssl.mzstatic.com/image/thumb/${path}/400x400bb.jpg`;
const albums = [
  { title: "Random Access Memories", artist: nowPlaying.artist, art: nowPlaying.art },
  {
    title: "SOS",
    artist: "SZA",
    art: cover("Music122/v4/62/93/13/6293132e-20ff-67ab-3d1f-96bb6797a6ba/196589564955.jpg"),
  },
  {
    title: "Currents",
    artist: "Tame Impala",
    art: cover("Music124/v4/64/48/5c/64485cc9-968c-68cc-764e-9a7c71733def/00602567155454.rgb.jpg"),
  },
  {
    title: "Short n' Sweet",
    artist: "Sabrina Carpenter",
    art: cover("Music221/v4/a1/1c/ca/a11ccab6-7d4c-e041-d028-998bcebeb709/24UMGIM61704.rgb.jpg"),
  },
  {
    title: "In Rainbows",
    artist: "Radiohead",
    art: cover("Music126/v4/dd/50/c7/dd50c790-99ac-d3d0-5ab8-e3891fb8fd52/634904032463.png"),
  },
  {
    title: "Melodrama",
    artist: "Lorde",
    art: cover("Music124/v4/58/11/b1/5811b172-e180-25a6-69e6-4385fbbfb5dc/17UM1IM02207.rgb.jpg"),
  },
  {
    title: "To Pimp a Butterfly",
    artist: "Kendrick Lamar",
    art: cover("Music112/v4/b5/a6/91/b5a69171-5232-3d5b-9c15-8963802f83dd/15UMGIM15814.rgb.jpg"),
  },
  {
    title: "Hit Me Hard and Soft",
    artist: "Billie Eilish",
    art: cover("Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg"),
  },
  {
    title: "Rumours",
    artist: "Fleetwood Mac",
    art: cover("Music124/v4/4d/13/ba/4d13bac3-d3d5-7581-2c74-034219eadf2b/081227970949.jpg"),
  },
  {
    title: "Renaissance",
    artist: "Beyoncé",
    art: cover("Music112/v4/fe/ba/43/feba43be-99e8-ad8c-9fad-1bfdea7a4e98/196589344267.jpg"),
  },
  {
    title: "folklore",
    artist: "Taylor Swift",
    art: cover("Music124/v4/8c/ef/c2/8cefc23a-61b7-05ff-b52a-bb1e4922087c/20UMGIM64216.rgb.jpg"),
  },
  {
    title: "After Hours",
    artist: "The Weeknd",
    art: cover("Music125/v4/2b/b9/fe/2bb9fef5-d7f3-8345-25a9-db0e79fde4e4/20UMGIM11048.rgb.jpg"),
  },
  {
    title: "Discovery",
    artist: "Daft Punk",
    art: cover("Music221/v4/fd/4a/77/fd4a77db-0ebc-d043-41a2-f32fa1bb0fb4/dj.qrikkdwj.jpg"),
  },
  {
    title: "GNX",
    artist: "Kendrick Lamar",
    art: cover("Music221/v4/54/28/14/54281424-eece-0935-299d-fdd2ab403f92/24UM1IM28978.rgb.jpg"),
  },
  {
    title: "AM",
    artist: "Arctic Monkeys",
    art: cover("Music211/v4/69/9c/b5/699cb5d6-115c-ff73-9d26-e57ea4350d72/887828031795.png"),
  },
  {
    title: "SOUR",
    artist: "Olivia Rodrigo",
    art: cover("Music115/v4/02/ed/8c/02ed8cab-c089-2fdd-7ce6-ab334a9a4e19/21UMGIM26093.rgb.jpg"),
  },
  {
    title: "Kid A",
    artist: "Radiohead",
    art: cover("Music122/v4/bd/8e/13/bd8e1358-b367-a689-cb84-cebd0b067dc4/634904078263.png"),
  },
  {
    title: "Thriller",
    artist: "Michael Jackson",
    art: cover("Music115/v4/32/4f/fd/324ffda2-9e51-8f6a-0c2d-c6fd2b41ac55/074643811224.jpg"),
  },
  {
    title: "Abbey Road",
    artist: "The Beatles",
    art: cover("Music211/v4/48/53/43/485343e3-dd6a-0034-faec-f4b6403f8108/13UMGIM63890.rgb.jpg"),
  },
];
const libraryEdges: Record<"grid" | "row", GlassBlurEdge[]> = {
  grid: ["top", "bottom"],
  row: ["inline-start", "inline-end"],
};
function LibraryScene({ blur, appearance }: { blur: BlurProps; appearance: GlassAppearance }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"grid" | "row">("grid");
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <ScrollFrame
        key={`frame-${layout}`}
        scroller={scroller}
        label="Albums"
        className={`is-library is-${layout}`}
      >
        <ul className="library-albums">
          {albums.map((album) => (
            <li key={album.title} className="library-album">
              <GlassShape
                radius={19}
                render={
                  <img
                    src={album.art}
                    alt={`${album.title} by ${album.artist}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                }
              />
              <strong>{album.title}</strong>
              <span>{album.artist}</span>
            </li>
          ))}
        </ul>
      </ScrollFrame>
      <GlassScrollEdges
        key={`edges-${layout}`}
        target={scroller}
        size={96}
        {...blur}
        edges={libraryEdges[layout]}
      />
      <div className="library-header">
        <h3>Library</h3>
        <GlassTabs
          aria-label="Library layout"
          appearance={appearance}
          value={layout}
          onValueChange={(value) => setLayout(value as "grid" | "row")}
          items={[
            {
              value: "grid",
              label: (
                <>
                  <Icon icon={GridViewIcon} />
                  <span className="sr-only">Grid</span>
                </>
              ),
            },
            {
              value: "row",
              label: (
                <>
                  <Icon icon={ListViewIcon} />
                  <span className="sr-only">Row</span>
                </>
              ),
            },
          ]}
        />
      </div>
      <GlassSurface radius="capsule" className="library-player">
        <GlassShape
          radius="circle"
          render={<img src={nowPlaying.art} alt="" referrerPolicy="no-referrer" />}
        />
        <span className="library-player-track">
          <strong>{nowPlaying.title}</strong>
          <span>{nowPlaying.artist}</span>
        </span>
        <GlassButton
          size="icon"
          className="chrome-button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying(!playing)}
        >
          <Icon icon={playing ? PauseIcon : PlayIcon} />
        </GlassButton>
        <GlassButton size="icon" className="chrome-button" aria-label="Next track">
          <Icon icon={NextIcon} />
        </GlassButton>
      </GlassSurface>
    </>
  );
}
