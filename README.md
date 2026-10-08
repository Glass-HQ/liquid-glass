# Liquid Glass

Glass surfaces and controls for React, the web, and Electron. Clear and Regular materials support light and dark appearances and refract live content.

[Examples](https://liquid-glass.glassapp.dev/#examples) · [Usage and API](packages/liquid-glass/README.md)

## Install

```sh
npm install @glass-sdk/liquid-glass@~0.0.1
```

```tsx
import { GlassScene, GlassContent, GlassButton } from "@glass-sdk/liquid-glass";
import "@glass-sdk/liquid-glass/styles.css";

<GlassScene style={{ height: 240 }}>
  <GlassContent>
    <img src="/landscape.jpg" alt="Mountain lake"
      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </GlassContent>
  <GlassButton material="regular" style={{ position: "absolute", left: 24, top: 24 }}>
    Get started
  </GlassButton>
</GlassScene>
```

React components require React 19+. Rendering requires HTTPS or localhost and an available WebGPU adapter. Safari has known rendering issues; see [requirements and limitations](packages/liquid-glass/README.md#requirements-and-limitations).

## Development

```sh
bun install --frozen-lockfile
bun run dev
```

The library is in `packages/liquid-glass`; the examples are in `apps/site`. See [Contributing](CONTRIBUTING.md) for checks and pull requests.

## License

[MIT](LICENSE).
