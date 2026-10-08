import { useEffect, useRef, useState } from "react"
import { nowPlaying } from "./music"
import type { FormEvent, ReactNode, RefObject } from "react"
import {
  GlassScene,
  GlassShape,
  GlassContent,
  GlassSurface,
  GlassButton,
  GlassTabs,
  GlassToolbar,
  GlassToolbarButton,
  GlassProgressiveBlur,
  GlassScrollEdges,
} from "@glass-sdk/liquid-glass"
import type { GlassAppearance, GlassBlurEdge } from "@glass-sdk/liquid-glass"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  GridViewIcon,
  ListViewIcon,
  ArrowUp02Icon,
  Bookmark01Icon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  Share08Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons"
import { Backdrop } from "./Backdrop"
import { articleSizes, wallpaperImage } from "./wallpapers"

export const progressiveBlurLevels = { off: 0, soft: 10, balanced: 20, strong: 32 } as const
export const progressiveModes = [
  { value: "library", label: "Library" },
  { value: "messages", label: "iMessage" },
  { value: "article", label: "Article" },
  { value: "image", label: "Image" },
] as const
export type ProgressiveOptions = {
  mode: (typeof progressiveModes)[number]["value"]
  blur: keyof typeof progressiveBlurLevels
  refraction: boolean
  edge: "top" | "bottom"
}
export const defaultProgressiveOptions: ProgressiveOptions = { mode: "library", blur: "balanced", refraction: false, edge: "bottom" }

type BlurProps = { blur: number; refraction: number; disabled: boolean }
const Icon = ({ icon }: { icon: typeof PlayIcon }) => <HugeiconsIcon icon={icon} size={18} strokeWidth={1.8} />

/** One nested scene per mode; every mode uses the public package exports only. */
export function ProgressiveScene({ options, appearance }: { options: ProgressiveOptions; appearance: GlassAppearance }) {
  const blur = { blur: progressiveBlurLevels[options.blur] || 20, refraction: options.refraction ? 6 : 0, disabled: options.blur === "off" }
  const className = `progressive-scene is-${options.mode} ${appearance === "dark" ? "glass-dark" : ""}`
  return <GlassScene key={options.mode} appearance={appearance} material="regular" maxSurfaces={8} className={className}>
    {options.mode === "messages" ? <MessagesScene blur={blur} />
      : options.mode === "article" ? <ArticleScene blur={blur} appearance={appearance} />
      : options.mode === "library" ? <LibraryScene blur={blur} appearance={appearance} />
      : <>
        <GlassContent><Backdrop appearance={appearance} /></GlassContent>
        <GlassProgressiveBlur edge={options.edge} size={260} {...blur} />
        <p className={`progressive-caption is-${options.edge}`}>A little further away.</p>
      </>}
  </GlassScene>
}

// GlassScrollEdges filters the scroller's still parent inside GlassContent, so
// glass chrome refracts the already-blurred edge and stays sharp above it.
function ScrollFrame({ scroller, label, className, onScroll, children }: {
  scroller: RefObject<HTMLElement | null>
  label: string
  className: string
  onScroll?: () => void
  children: ReactNode
}) {
  return <GlassContent>
    <div className="progressive-frame">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Native keyboard scrolling. */}
      <section ref={scroller} tabIndex={0} aria-label={label} className={`progressive-viewport ${className}`} onScroll={onScroll}>
        {children}
      </section>
    </div>
  </GlassContent>
}

const cover = (path: string) => `https://is1-ssl.mzstatic.com/image/thumb/${path}/400x400bb.jpg`
const albums = [
  { title: "Random Access Memories", artist: nowPlaying.artist, art: nowPlaying.art },
  { title: "SOS", artist: "SZA", art: cover("Music122/v4/62/93/13/6293132e-20ff-67ab-3d1f-96bb6797a6ba/196589564955.jpg") },
  { title: "Currents", artist: "Tame Impala", art: cover("Music124/v4/64/48/5c/64485cc9-968c-68cc-764e-9a7c71733def/00602567155454.rgb.jpg") },
  { title: "Short n' Sweet", artist: "Sabrina Carpenter", art: cover("Music221/v4/a1/1c/ca/a11ccab6-7d4c-e041-d028-998bcebeb709/24UMGIM61704.rgb.jpg") },
  { title: "In Rainbows", artist: "Radiohead", art: cover("Music126/v4/dd/50/c7/dd50c790-99ac-d3d0-5ab8-e3891fb8fd52/634904032463.png") },
  { title: "Melodrama", artist: "Lorde", art: cover("Music124/v4/58/11/b1/5811b172-e180-25a6-69e6-4385fbbfb5dc/17UM1IM02207.rgb.jpg") },
  { title: "To Pimp a Butterfly", artist: "Kendrick Lamar", art: cover("Music112/v4/b5/a6/91/b5a69171-5232-3d5b-9c15-8963802f83dd/15UMGIM15814.rgb.jpg") },
  { title: "Hit Me Hard and Soft", artist: "Billie Eilish", art: cover("Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg") },
  { title: "Rumours", artist: "Fleetwood Mac", art: cover("Music124/v4/4d/13/ba/4d13bac3-d3d5-7581-2c74-034219eadf2b/081227970949.jpg") },
  { title: "Renaissance", artist: "Beyoncé", art: cover("Music112/v4/fe/ba/43/feba43be-99e8-ad8c-9fad-1bfdea7a4e98/196589344267.jpg") },
  { title: "folklore", artist: "Taylor Swift", art: cover("Music124/v4/8c/ef/c2/8cefc23a-61b7-05ff-b52a-bb1e4922087c/20UMGIM64216.rgb.jpg") },
  { title: "After Hours", artist: "The Weeknd", art: cover("Music125/v4/2b/b9/fe/2bb9fef5-d7f3-8345-25a9-db0e79fde4e4/20UMGIM11048.rgb.jpg") },
  { title: "Discovery", artist: "Daft Punk", art: cover("Music221/v4/fd/4a/77/fd4a77db-0ebc-d043-41a2-f32fa1bb0fb4/dj.qrikkdwj.jpg") },
  { title: "GNX", artist: "Kendrick Lamar", art: cover("Music221/v4/54/28/14/54281424-eece-0935-299d-fdd2ab403f92/24UM1IM28978.rgb.jpg") },
  { title: "AM", artist: "Arctic Monkeys", art: cover("Music211/v4/69/9c/b5/699cb5d6-115c-ff73-9d26-e57ea4350d72/887828031795.png") },
  { title: "SOUR", artist: "Olivia Rodrigo", art: cover("Music115/v4/02/ed/8c/02ed8cab-c089-2fdd-7ce6-ab334a9a4e19/21UMGIM26093.rgb.jpg") },
  { title: "Kid A", artist: "Radiohead", art: cover("Music122/v4/bd/8e/13/bd8e1358-b367-a689-cb84-cebd0b067dc4/634904078263.png") },
  { title: "Thriller", artist: "Michael Jackson", art: cover("Music115/v4/32/4f/fd/324ffda2-9e51-8f6a-0c2d-c6fd2b41ac55/074643811224.jpg") },
  { title: "Abbey Road", artist: "The Beatles", art: cover("Music211/v4/48/53/43/485343e3-dd6a-0034-faec-f4b6403f8108/13UMGIM63890.rgb.jpg") },
]
const libraryEdges: Record<"grid" | "row", GlassBlurEdge[]> = { grid: ["top", "bottom"], row: ["inline-start", "inline-end"] }
function LibraryScene({ blur, appearance }: { blur: BlurProps; appearance: GlassAppearance }) {
  const scroller = useRef<HTMLElement>(null)
  const [layout, setLayout] = useState<"grid" | "row">("grid")
  const [playing, setPlaying] = useState(false)
  return <>
    <ScrollFrame key={`frame-${layout}`} scroller={scroller} label="Albums" className={`is-library is-${layout}`}>
      <ul className="library-albums">
        {albums.map((album) => <li key={album.title} className="library-album">
          <GlassShape radius={19} render={<img src={album.art} alt={`${album.title} by ${album.artist}`} loading="lazy" referrerPolicy="no-referrer" />} />
          <strong>{album.title}</strong>
          <span>{album.artist}</span>
        </li>)}
      </ul>
    </ScrollFrame>
    <GlassScrollEdges key={`edges-${layout}`} target={scroller} size={96} {...blur} edges={libraryEdges[layout]} />
    <div className="library-header">
      <h3>Library</h3>
      <GlassTabs aria-label="Library layout" appearance={appearance} value={layout} onValueChange={(value) => setLayout(value as "grid" | "row")}
        items={[{ value: "grid", label: <><Icon icon={GridViewIcon} /><span className="sr-only">Grid</span></> }, { value: "row", label: <><Icon icon={ListViewIcon} /><span className="sr-only">Row</span></> }]} />
    </div>
    <GlassSurface radius="capsule" className="library-player">
      <GlassShape radius="circle" render={<img src={nowPlaying.art} alt="" referrerPolicy="no-referrer" />} />
      <span className="library-player-track"><strong>{nowPlaying.title}</strong><span>{nowPlaying.artist}</span></span>
      <GlassButton size="icon" className="chrome-button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}><Icon icon={playing ? PauseIcon : PlayIcon} /></GlassButton>
      <GlassButton size="icon" className="chrome-button" aria-label="Next track"><Icon icon={NextIcon} /></GlassButton>
    </GlassSurface>
  </>
}

type Message = { id: number; from: "me" | "them"; text?: string; photo?: "day" | "night"; link?: boolean }
const opening: Message[] = [
  { id: 1, from: "them", text: "Are we still on for the desert this weekend?" },
  { id: 2, from: "me", text: "Yes! Leaving Saturday at 6 so we catch the light." },
  { id: 3, from: "them", photo: "day" },
  { id: 4, from: "them", text: "This is the ridge from last year. Same spot?" },
  { id: 5, from: "me", text: "Same spot. I'm bringing the big lens this time." },
  { id: 6, from: "me", link: true },
  { id: 7, from: "them", text: "Clear skies all weekend 🌙" },
  { id: 8, from: "me", photo: "night" },
  { id: 9, from: "me", text: "Stars should look like this after midnight." },
  { id: 10, from: "them", text: "Okay that's unreal. Bring the warm jacket, it gets cold fast." },
]
function MessagesScene({ blur }: { blur: BlurProps }) {
  const scroller = useRef<HTMLElement>(null)
  const [messages, setMessages] = useState(opening)
  const [draft, setDraft] = useState("")
  useEffect(() => {
    const element = scroller.current
    const smooth = messages.length > opening.length && !matchMedia("(prefers-reduced-motion: reduce)").matches
    element?.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "instant" })
  }, [messages.length])
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    setMessages((list) => [...list, { id: list.length + 1, from: "me", text: draft.trim() }])
    setDraft("")
  }
  return <>
    <ScrollFrame scroller={scroller} label="Conversation with Maya" className="is-messages">
      <ol className="messages-thread">
        <li className="messages-day">Today 9:41</li>
        {messages.map((message) => <li key={message.id} className={`messages-row is-${message.from}`}>
          {message.photo ? <GlassShape radius={18} render={<img className="messages-photo" {...wallpaperImage(message.photo === "day" ? "day" : "night", "263px")} alt={message.photo === "day" ? "Desert ridge at dusk" : "Desert ridge at night"} />} />
            : message.link ? <GlassShape radius={18} render={<span />} className="messages-link"><img {...wallpaperImage("night", "260px")} alt="" /><strong>Dark Sky Places</strong><span>darksky.org</span></GlassShape>
            : <GlassShape radius={19} render={<span />} className="messages-bubble">{message.text}</GlassShape>}
        </li>)}
      </ol>
    </ScrollFrame>
    <GlassScrollEdges target={scroller} size={120} {...blur} />
    <div className="messages-bar">
      <GlassButton size="icon" className="chrome-button" aria-label="Back"><Icon icon={ArrowLeft01Icon} /></GlassButton>
      <GlassSurface radius={19} className="messages-contact"><img className="messages-avatar" src="/avatars/maya.svg" alt="" />Maya</GlassSurface>
      <GlassButton size="icon" className="chrome-button" aria-label="FaceTime"><Icon icon={Video01Icon} /></GlassButton>
    </div>
    <form className="messages-composer" onSubmit={send}>
      <GlassButton size="icon" type="button" className="chrome-button" aria-label="Attach"><Icon icon={PlusSignIcon} /></GlassButton>
      <GlassSurface radius={19} className="messages-field">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="iMessage" aria-label="Message" />
      </GlassSurface>
      <GlassButton size="icon" type="submit" className="chrome-button" aria-label="Send" tint="#0a84ff"><Icon icon={ArrowUp02Icon} /></GlassButton>
    </form>
  </>
}

function ArticleScene({ blur, appearance }: { blur: BlurProps; appearance: GlassAppearance }) {
  const scroller = useRef<HTMLElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  // A CSS variable keeps the collapsing title off React's render path while scrolling.
  const collapse = () => {
    const top = scroller.current?.scrollTop ?? 0
    bar.current?.style.setProperty("--collapse", String(Math.min(1, Math.max(0, (top - 60) / 50))))
  }
  const [hero, second] = appearance === "dark" ? ["night", "day"] as const : ["day", "night"] as const
  return <>
    <ScrollFrame scroller={scroller} label="The quiet edge of the desert" className="is-article" onScroll={collapse}>
      <article className="article-body">
        <header className="article-header">
          <h1>The quiet edge of the desert</h1>
          <p className="article-dek">An hour on foot past the end of the road, the dunes keep the last of the light long after the valley has gone blue.</p>
          <p className="article-byline"><img src="/avatars/jonah.svg" alt="" /><span><strong>Jonah Reyes</strong> · October 6 · 6 min read</span></p>
        </header>
        <figure>
          <GlassShape radius={25.5} render={<img className="article-hero" {...wallpaperImage(hero, articleSizes)} alt="Dunes below a mountain ridge" />} />
          <figcaption>The ridge from the last dune, twenty minutes before sunset.</figcaption>
        </figure>
        <p className="article-lede">The road ends where the sand begins. From there it is an hour on foot, past dunes that move <em>a little every night</em>, to a ridge that holds the last of the light long after the valley has gone blue.</p>
        <p>Nobody comes here for the view at noon. The heat flattens everything into one color, and the only shade is your own. It is the hour before sunset that matters.</p>
        <h2>The hour before sunset</h2>
        <p>The light arrives sideways and suddenly the dunes have texture again. <strong>Every ripple throws its own small shadow</strong>, and the ridge turns from beige to rust to violet in the time it takes to set up a tripod.</p>
        <blockquote><p>You stop taking photographs at some point. The light changes faster than you can choose a frame.</p><cite>— Field notes, day two</cite></blockquote>
        <h2>What to bring</h2>
        <ul>
          <li><strong>Water</strong>: more than you think, and a little more after that.</li>
          <li><strong>A warm layer</strong>: the temperature drops twenty degrees after dark.</li>
          <li><strong>A red headlamp</strong>: it keeps your night vision for the stars.</li>
        </ul>
        <h2>After midnight</h2>
        <p>By the time the stars appear the wind has dropped completely. You can hear your own heartbeat and, somewhere far below, a single truck crossing the valley floor. The <a href="https://darksky.org/" tabIndex={-1}>dark sky reserve</a> starts a few miles east.</p>
        <figure>
          <GlassShape radius={25.5} render={<img className="article-inline" {...wallpaperImage(second, articleSizes)} alt="The same ridge at a different hour" />} />
          <figcaption>Same ridge, six hours later.</figcaption>
        </figure>
        <p>We stayed until the cold drove us back to the car. Next year we will bring a second lens, a warmer jacket, and the patience to wait for the moon to rise behind the ridge.</p>
      </article>
    </ScrollFrame>
    <GlassScrollEdges target={scroller} size={110} {...blur} />
    <div ref={bar} className="article-bar">
      <GlassButton size="icon" className="chrome-button" aria-label="Back"><Icon icon={ArrowLeft01Icon} /></GlassButton>
      <span className="article-bar-title" aria-hidden="true">The quiet edge of the desert</span>
    </div>
    <GlassToolbar aria-label="Article actions" className="article-actions">
      <GlassToolbarButton aria-label="Share"><Icon icon={Share08Icon} /></GlassToolbarButton>
      <GlassToolbarButton aria-label="Save"><Icon icon={Bookmark01Icon} /></GlassToolbarButton>
    </GlassToolbar>
  </>
}
