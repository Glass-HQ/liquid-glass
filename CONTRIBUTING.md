# Contributing

Bug fixes, documentation improvements, and focused contributions are welcome. For substantial features or API changes, open an issue to discuss the approach first.

## Getting started

Fork the repository, create a branch, and install Bun 1.4.2.

```sh
bun install --frozen-lockfile
bun run dev
```

The development command builds and watches the package alongside the site. Examples use the library's public exports. Read [AGENTS.md](AGENTS.md) for project constraints; keep the root `bun.lock` authoritative.

## Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:package
```

CI runs these checks and the version guard on pull requests. For rendering changes, also run:

```sh
bun run check:gpu
bun run check:shader
bun run test:gpu
```

Use the installed vgpu tools through `bun run vgpu`. Start with `docs cat getting-started.md` and `docs cat shader-workflow.docs.md`; use `docs find` and `examples search` for API details.

Review rendering changes in the site's examples in Chromium, Safari, Firefox, and Electron. Check both appearances and materials. Record browser versions, observed results, and anything you could not check in the PR. An unavailable GPU adapter is not a passing result. The manual GPU workflow needs a macOS runner labelled `gpu`; ordinary CI does not verify browser rendering. For comparison with system materials, use the [native reference app](apps/native-reference/README.md).

## Pull requests

Keep each PR focused on one problem. Explain the change and how you checked it. Include before/after screenshots for visual changes, and a recording when motion matters; attach them to the PR rather than committing them. Maintainers review and merge contributions after CI passes and review conversations are resolved.

Update usage documentation when the API or requirements change. Keep implementation reports, audit logs, and scratch notes out of the repository. Include only source and assets we can distribute.

Report vulnerabilities privately through [GitHub Security](https://github.com/Glass-HQ/liquid-glass/security/advisories/new).

## Releases

Keep the current package version during development. Releases currently use `0.0.x`; bump the patch only when publishing and never reuse a published version.

Run `bun run release:check` and complete browser review before publication. Publish with `npm publish --workspace @glass-sdk/liquid-glass --access public` using owner authentication, or the manual `publish.yml` workflow once npm trusted publishing is configured. Verify the exact version with `npm view @glass-sdk/liquid-glass@<version> version dist.integrity`. Put user-facing release summaries in GitHub releases.

The site consumes the workspace package. Vercel builds `apps/site/dist` using `vercel.json`.
