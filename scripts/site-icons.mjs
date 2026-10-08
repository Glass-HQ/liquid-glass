import { generatePath } from "../packages/liquid-glass/node_modules/@lisse/core/dist/index.js"
// Generates the site's sidebar tiles: apps/site/src/assets/icons/<name>-<theme>.svg.
// Glyphs are frosted glass
// over an optional dark back shape, with a blurred copy of the back clipped inside the glass.
// Run: bun run icons
import { mkdirSync, writeFileSync } from "node:fs"
const out = new URL("../apps/site/src/assets/icons/", import.meta.url)
mkdirSync(out, { recursive: true })
const f = (n) => +n.toFixed(3)

// Translate Lisse's absolute path coordinates; relative corner commands stay intact.
function sq(x, y, w, h, radius) {
  return generatePath(w, h, { radius, smoothing: 0.8125, preserveSmoothing: true }).replace(/([ML])\s*([-\d.]+)\s+([-\d.]+)/g,
    (_, command, px, py) => `${command} ${f(Number(px) + x)} ${f(Number(py) + y)}`)
}
function pill(x, y, w, h) { return sq(x, y, w, h, Math.min(w, h) / 2) }
const circle = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}Z`
// One-piece plus with round arm ends (a = half arm width, l = arm reach from centre).
function plus(cx, cy, l, a) {
  const e = l - a
  return `M${f(cx - a)} ${f(cy - e)}A${f(a)} ${f(a)} 0 0 1 ${f(cx + a)} ${f(cy - e)}V${f(cy - a)}H${f(cx + e)}A${f(a)} ${f(a)} 0 0 1 ${f(cx + e)} ${f(cy + a)}H${f(cx + a)}V${f(cy + e)}A${f(a)} ${f(a)} 0 0 1 ${f(cx - a)} ${f(cy + e)}V${f(cy + a)}H${f(cx - e)}A${f(a)} ${f(a)} 0 0 1 ${f(cx - e)} ${f(cy - a)}H${f(cx - a)}Z`
}

// Each glyph on a 24-unit grid: back (dark object) + glass (frosted front; may contain
// evenodd holes) + optional progressive flag.
// Each glyph on a 24-unit grid. parts = glass shapes, each { d, top, bottom, holes?, goo? };
// back = optional dark object seen through the glass.
const glyphs = {
  // Open book: glass pages dipping to the spine over a dark cover.
  introduction: {
    back: sq(1, 8, 22, 14, 4.5),
    parts: [{
      d: "M12 5.2L18.6 3.5C20 3.15 21 3.9 21 5.3V15.4C21 16.35 20.4 17.05 19.5 17.3L12.6 19.1C12.2 19.2 11.8 19.2 11.4 19.1L4.5 17.3C3.6 17.05 3 16.35 3 15.4V5.3C3 3.9 4 3.15 5.4 3.5Z",
      top: 3.4, bottom: 19.2,
    }],
  },
  all: {
    parts: [[2, 2], [12.75, 2], [2, 12.75], [12.75, 12.75]].map(([x, y]) => ({ d: sq(x, y, 9.25, 9.25, 4.4), top: y, bottom: y + 9.25 })),
  },
  surface: { parts: [{ d: sq(2, 4, 20, 16, 7), top: 4, bottom: 20 }] },
  buttons: { parts: [{ d: circle(12, 12, 10), top: 2, bottom: 22, holes: plus(12, 12, 4.6, 1.05) }] },
  toolbar: {
    parts: [{ d: pill(0.5, 6.5, 23, 11), top: 6.5, bottom: 17.5, holes: circle(6.4, 12, 2.4) + circle(12, 12, 2.4) + circle(17.6, 12, 2.4) }],
  },
  tabs: {
    back: pill(0.5, 6, 23, 12),
    parts: [
      { d: pill(1.6, 7.1, 10.4, 9.8), top: 7.1, bottom: 16.9, holes: circle(6.8, 12, 1.7) },
      { d: circle(15.2, 12, 1.7), top: 10.3, bottom: 13.7, flat: true },
      { d: circle(19.6, 12, 1.7), top: 10.3, bottom: 13.7, flat: true },
    ],
  },
  menu: {
    parts: [{ d: circle(5, 5, 3.7) + sq(7, 7, 16, 16, 6), top: 1, bottom: 23, goo: true,
      holes: pill(10.5, 11.6, 9, 1.7) + pill(10.5, 14.6, 9, 1.7) + pill(10.5, 17.6, 6, 1.7) }],
  },
  slider: { back: pill(1, 10.2, 22, 3.6), parts: [{ d: pill(9.5, 6.4, 13.4, 10.7), top: 6.4, bottom: 17.1 }] },
  switch: { back: pill(1, 6.67, 22, 9.78), parts: [{ d: pill(9.15, 7.48, 13.04, 8.15), top: 7.48, bottom: 15.63 }] },
  "progressive-blur": {
    back: pill(1, 1.5, 22, 3.4) + pill(1, 7.3, 22, 3.4) + pill(1, 13.1, 22, 3.4) + pill(1, 18.9, 22, 3.4),
    progressive: true,
  },
}

const themes = {
  dark: {
    tile: `<path d="${sq(3, 2, 24, 24, 8.75)}" fill="#3B3B3B" fill-opacity="0.7"/>`,
    back: [["#7C7C7E", 1], ["#4A4A4C", 1]],
    glass: [["#ECECEE", 0.66], ["#C2C2C7", 0.66]],
    rim: 1,
  },
  light: {
    tile: `<path d="${sq(3, 2, 24, 24, 8.75)}" fill="#F5F5F5"/>`,
    back: [["#A3A3A8", 1], ["#636366", 1]],
    glass: [["#F2F2F4", 0.92], ["#ADADB3", 0.92]],
    rim: 1,
    edge: `stroke="#000" stroke-opacity="0.1"`,
    holeFill: "#8E8E93",
  },
}

function build(name, theme) {
  const g = glyphs[name], t = themes[theme], id = `${name}-${theme}`
  const stops = (s) => s.map(([c, o], i) => `<stop offset="${i}" stop-color="${c}" stop-opacity="${o}"/>`).join("")
  let art, defs = `<linearGradient id="bk-${id}" x1="12" y1="1" x2="12" y2="23" gradientUnits="userSpaceOnUse">${stops(t.back)}</linearGradient>`
  if (g.progressive) {
    // Sharp at the top, blurred + frosted toward the bottom: a real progressive blur.
    defs += `
<filter id="bl-${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1"/></filter>
<linearGradient id="fade-${id}" x1="0" y1="4" x2="0" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
<linearGradient id="fadeI-${id}" x1="0" y1="4" x2="0" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
<mask id="ms-${id}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32"><rect x="-4" y="-4" width="32" height="32" fill="url(#fade-${id})"/></mask>
<mask id="mb-${id}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32"><rect x="-4" y="-4" width="32" height="32" fill="url(#fadeI-${id})"/></mask>
<linearGradient id="fr-${id}" x1="0" y1="8" x2="0" y2="23" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${t.glass[1][0]}" stop-opacity="0"/><stop offset="1" stop-color="${t.glass[1][0]}" stop-opacity="${t.glass[1][1] * 0.4}"/></linearGradient>
<clipPath id="cl-${id}"><path d="${sq(1, 1, 22, 22, 7)}"/></clipPath>`
    art = `<g clip-path="url(#cl-${id})">
  <path d="${g.back}" fill="url(#bk-${id})" mask="url(#ms-${id})"/>
  <g mask="url(#mb-${id})"><path d="${g.back}" fill="url(#bk-${id})" filter="url(#bl-${id})"/></g>
  <rect x="0" y="0" width="24" height="24" fill="url(#fr-${id})"/>
</g>`
  } else {
    const all = g.parts.map((p) => p.d).join("")
    const holes = g.parts.map((p) => p.holes ?? "").join("")
    defs += `
<linearGradient id="gl-${id}" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">${stops(t.glass)}</linearGradient>
<filter id="bl-${id}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2"/></filter>
<filter id="ring-${id}" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="erode" radius="0.75" result="in"/><feComposite in="SourceGraphic" in2="in" operator="out"/></filter>
<filter id="goo-${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="b"/><feColorMatrix in="b" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 24 -11"/></filter>
<mask id="hm-${id}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32"><rect x="-4" y="-4" width="32" height="32" fill="#fff"/><path d="${holes}" fill="#000"/></mask>
<mask id="mk-${id}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32"><rect x="-4" y="-4" width="32" height="32" fill="#fff"/><path d="${all}" fill="#000"/></mask>
<clipPath id="cl-${id}"><path d="${all}"/></clipPath>`
    const rims = g.parts.map((p, i) => {
      if (p.flat) return ""
      defs += `<linearGradient id="rim${i}-${id}" x1="0" y1="${p.top}" x2="0" y2="${f(p.top + (p.bottom - p.top) * 0.58)}" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity="${t.rim}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
      if (p.goo) defs += `<mask id="gm${i}-${id}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32"><g filter="url(#goo-${id})"><path d="${p.d}" fill="#fff"/></g></mask><mask id="gr${i}-${id}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32"><g filter="url(#ring-${id})"><g filter="url(#goo-${id})"><path d="${p.d}" fill="#fff"/></g></g></mask>`
      const body = (fill, ring) => p.goo ? `<rect x="-2" y="-2" width="28" height="28" fill="${fill}" mask="url(#${ring ? "gr" : "gm"}${i}-${id})"/>` : `<path d="${p.d}" fill="${fill}"/>`
      return { i, p, body }
    })
    const glass = rims.map((r, i) => {
      const p = g.parts[i]
      const body = r ? r.body : (fill) => `<path d="${p.d}" fill="${fill}"/>`
      return `${body(`url(#gl-${id})`)}${r ? (p.goo ? body(`url(#rim${i}-${id})`, true) : `<g filter="url(#ring-${id})">${body(`url(#rim${i}-${id})`)}</g>`) : ""}${t.edge ? (p.goo ? "" : `<path d="${p.d}" fill="none" ${t.edge} stroke-width="0.5"/>`) : ""}`
    }).join("")
    art = `${g.back ? `<path d="${g.back}" fill="url(#bk-${id})" mask="url(#mk-${id})"/>
<g clip-path="url(#cl-${id})"><path d="${g.back}" fill="url(#bk-${id})" filter="url(#bl-${id})"/></g>` : ""}
<g mask="url(#hm-${id})">${glass}</g>
${t.holeFill && holes ? `<path d="${holes}" fill="${t.holeFill}"/>` : ""}`
  }
  return `<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
${t.tile}
<g transform="translate(7.8 6.8) scale(0.6)">
${art}
</g>
<defs>
${defs}
</defs>
</svg>`
}

const names = Object.keys(glyphs)
for (const n of names) for (const th of ["dark", "light"]) writeFileSync(new URL(`${n}-${th}.svg`, out), build(n, th) + "\n")

