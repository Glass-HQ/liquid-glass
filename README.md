# Liquid Glass

Liquid Glass for the web: refraction, frost, rim light and springy motion, drawn by one WebGL2
renderer in a worker. The same pixels in Chrome, Safari, Firefox and Electron, at the display's
rate, up to 120 Hz on iPhone.

```sh
npm install @glass-sdk/liquid-glass
```

```tsx
import { GlassButton, GlassScene, GlassSurface } from "@glass-sdk/liquid-glass/react";

export function App() {
  return (
    <GlassScene appearance="auto">
      <main>…your page…</main>
      <GlassSurface className="toolbar" radius="capsule" floating>
        <GlassButton onClick={save}>Save</GlassButton>
      </GlassSurface>
    </GlassScene>
  );
}
```

The package's [README](packages/liquid-glass/README.md) covers every component and option.

## Repository

- `packages/liquid-glass`: the library.
- `apps/lab`: a playground with every component over hard content (`bun run dev`).

```sh
bun install
bun run dev      # the lab, against the library's source
bun run build    # the library and the lab
bun run check    # format, lint and types
```

Releases: set the version in `packages/liquid-glass/package.json`, add its section to
[CHANGELOG.md](CHANGELOG.md), commit, and push the tag `liquid-glass@<version>`. A prerelease
(`0.0.3-beta.2`) is published under `next` with the notes of the version it leads to.

## License

[MIT](LICENSE)
