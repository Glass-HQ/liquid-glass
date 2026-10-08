const widths = [640, 1024, 1536, 2048, 3072] as const

export function wallpaperImage(tone: "day" | "night", sizes: string) {
  const base = `/wallpapers/duo-${tone}`
  return {
    src: `${base}-2048.webp`,
    srcSet: [
      ...widths.map((width) => `${base}-${width}.webp ${width}w`),
      `${base}.jpg 6016w`,
    ].join(", "),
    sizes,
  }
}

// Cover scales by height on narrow screens: a 520px-tall mobile scene needs
// 803px of source width before applying DPR, even when its box is narrower.
export const backdropSizes = "(max-width: 640px) max(803px, calc(100vw - 32px)), max(679px, min(992px, calc(100vw - 48px)))"
export const articleSizes = "max(402px, min(720px, calc(100vw - 88px)))"
