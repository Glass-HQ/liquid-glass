import { mkdirSync, copyFileSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const app = resolve(root, "apps/native-reference/build/Liquid Glass Reference.app");
const executable = resolve(app, "Contents/MacOS");
const resources = resolve(app, "Contents/Resources");
mkdirSync(executable, { recursive: true });
mkdirSync(resources, { recursive: true });
const sources = readdirSync(resolve(root, "apps/native-reference/Sources"))
  .filter((p) => p.endsWith(".swift"))
  .map((p) => resolve(root, "apps/native-reference/Sources", p));
const result = spawnSync(
  "swiftc",
  [
    "-parse-as-library",
    "-O",
    "-target",
    "arm64-apple-macos26.0",
    ...sources,
    "-o",
    resolve(executable, "LiquidGlassReference"),
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
for (const name of ["duo-day.jpg", "duo-night.jpg"])
  copyFileSync(resolve(root, "apps/site/public/wallpapers", name), resolve(resources, name));
for (const name of readdirSync(resolve(root, "apps/native-reference/Resources")))
  copyFileSync(resolve(root, "apps/native-reference/Resources", name), resolve(resources, name));
// Reuse the site's permitted content without embedding its renderer.
const music = readFileSync(resolve(root, "apps/site/src/music.ts"), "utf8");
const scenes = readFileSync(resolve(root, "apps/site/src/ProgressiveScenes.tsx"), "utf8");
const quoted = (source, key) =>
  JSON.parse(source.match(new RegExp(`${key}: ("(?:[^"\\\\]|\\\\.)*")`))[1]);
const nowPlaying = Object.fromEntries(
  ["title", "artist", "art"].map((key) => [key, quoted(music, key)]),
);
const albumSource = scenes.match(/const albums = \[([\s\S]*?)\n\]/)[1];
const albums = Array.from(
  albumSource.matchAll(
    /\{\s*title: ("[^"]+"),\s*artist: (nowPlaying.artist|"[^"]+"),\s*art: (nowPlaying.art|cover\("[^"]+"\)),?\s*\}/g,
  ),
  ([, title, artist, art]) => ({
    title: JSON.parse(title),
    artist: artist === "nowPlaying.artist" ? nowPlaying.artist : JSON.parse(artist),
    art:
      art === "nowPlaying.art"
        ? nowPlaying.art
        : `https://is1-ssl.mzstatic.com/image/thumb/${JSON.parse(art.slice(6, -1))}/400x400bb.jpg`,
  }),
);
if (albums.length !== 19)
  throw new Error("Site content changed; update native content extraction.");
writeFileSync(resolve(resources, "site-content.json"), JSON.stringify({ nowPlaying, albums }));
writeFileSync(
  resolve(app, "Contents/Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>LiquidGlassReference</string><key>CFBundleIdentifier</key><string>dev.glassapp.liquid-glass.reference</string><key>CFBundleName</key><string>Liquid Glass Reference</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>26.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`,
);
const sign = spawnSync("codesign", ["--force", "--sign", "-", app], { stdio: "inherit" });
if (sign.status !== 0) process.exit(sign.status ?? 1);
console.log(app);
