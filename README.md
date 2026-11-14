# Liquid Glass

Glass surfaces and controls for React, the web, and Electron. Clear and Regular materials support light and dark appearances and refract live content.

[Examples](https://liquid-glass.glassapp.dev/#examples) · [Usage and API](packages/liquid-glass/README.md) · [Changelog](changelog)

https://github.com/user-attachments/assets/42b3ebff-2fef-4380-a173-2320d5d0651f

## Install

```sh
npm install @glass-sdk/liquid-glass @base-ui/react
```

## Usage

```tsx
import { GlassScene, GlassContent, GlassButton } from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

<GlassScene style={{ height: 240 }}>
  <GlassContent>
    <img
      src="/landscape.jpg"
      alt="Mountain lake"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </GlassContent>
  <GlassButton material="regular" style={{ position: "absolute", left: 24, top: 24 }}>
    Get started
  </GlassButton>
</GlassScene>;
```

The React components need React 19 or later and Base UI (`@base-ui/react`). Rendering needs HTTPS or localhost and a WebGPU adapter. Safari has known rendering issues; see [requirements and limitations](packages/liquid-glass/README.md#requirements-and-limitations).

## Development

Install [Bun](https://bun.com) 1.4.4 and [Vite+](https://viteplus.dev) (`vp`), which provides Node.js 26.

```sh
bun install --frozen-lockfile
vp run dev
```

The library is in `packages/liquid-glass`, the examples site in `apps/site`, the cross-browser benchmark in `apps/bench`, and a macOS comparison app in `apps/native-reference`. `vp check` formats, lints and type-checks; `vp run build` and `vp run test` build and test every package. See [Contributing](CONTRIBUTING.md) for the checks that run before a push.

## Releases

Each release has notes in `changelog/<version>.md`. `node scripts/release.ts <version>` sets the version, commits and tags `liquid-glass@<version>`; pushing the tag publishes to npm and creates the GitHub release. See [Contributing](CONTRIBUTING.md#releases).

## License

[MIT](LICENSE).
