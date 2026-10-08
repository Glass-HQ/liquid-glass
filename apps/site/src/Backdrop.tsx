import { backdropSizes, wallpaperImage } from "./wallpapers"

export function Backdrop({
  kind = "landscape",
  appearance = "light",
}: {
  kind?: "landscape" | "type" | "grid"
  appearance?: "light" | "dark"
}) {
  if (kind === "type")
    return (
      <div className="type-backdrop">
        <div className="type-specimen">
          {["ABCDEFGHIJKLMN", "OPQRSTUVWXYZ", "abcdefghijklm", "nopqrstuvwxyz", "0123456789 &→!"].map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
    )
  if (kind === "grid")
    return (
      <div className="grid-backdrop">
        <div className="grid-colors" />
        <div className="grid-type">Aa</div>
      </div>
    )
  return (
    <div className="landscape-backdrop">
      <img
        {...wallpaperImage(appearance === "dark" ? "night" : "day", backdropSizes)}
        alt=""
      />
    </div>
  )
}
