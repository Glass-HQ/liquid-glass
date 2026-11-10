# Project instructions

- Use Bun workspaces and TypeScript. Keep the root `bun.lock` authoritative.
- Use vgpu and WGSL for production GPU rendering. At setup or upgrade time, use the latest released vgpu and read its bundled documentation. For shader development, use the official vgpu skill and project-local tools: docs, examples, doctor, required WGSL validation, and real GPU readbacks.
- Everything must work by default for every user of the target browsers: no browser flags, origin trials, or opt-in APIs such as HTML-in-Canvas. Glass must look the same in each engine. Engine-specific render paths are welcome when they keep that look and are measured and verified in each engine. Refract live DOM with SVG filters; do not use DOM screenshots, WebGL/GLSL, or CSS approximations of the material.
- Chromium, Safari, Firefox, and Electron are release acceptance targets. Verify visuals with the Codex browser or computer use; do not add Playwright or another browser automation suite. A result in one browser does not prove parity.
- Use shadcn/ui Mira components installed through its CLI for site controls, and Hugeicons for icons.
- Keep the public site to one library, a short introduction, interactive examples, and usage. Do not add pricing, accounts, status chips, decorative feature grids, or a separate showcase renderer. Examples must use the library's public exports.
- Native and React Native ports are outside the initial scope. Keep the macOS app as a local comparison reference.
- Publish only our source, measurements we own, and permitted assets. Never commit extracted framework binaries or disassembly.
- When interacting with Cloudflare, use `cf` unless the project has a Wrangler configuration.

## Commits

- Write commit messages as Conventional Commits: `type(scope): summary`, lowercase and imperative, for example `fix(webkit): keep filters alive on repaints far from every lens`. Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`. Scopes name the area: `webkit`, `gecko`, `chromium`, `progressive`, `gpu`, `react`, `package`, `site`, `native-reference`.

## Checks

A `pre-push` hook runs every check and blocks a push that fails. There's no CI on everyday work, on purpose: [Contributing](CONTRIBUTING.md#checks) explains why. Don't add it back.

## Performance

Measure with `bun run bench` ([guide](apps/bench/README.md)); keep measuring tools and scenes in `apps/bench`, not in scratch folders outside the repository. Claim a gain only where the session marks one, and say which browsers and which machine it ran on. Timings in Safari and Firefox are noisy because both saturate the CPU: read `filter work` and `filter redraws/s` there first.

## Documentation

Write for someone using or contributing to the library. Lead with installation and a working example; explain props, requirements, and surprising limitations. Keep architecture secondary and avoid repeating what types or code already explain.

Rewrite outdated sections instead of appending implementation histories. Keep conversational references, plans, audit logs, and publication receipts out of repository documentation. Put verification evidence in commit messages and release summaries in GitHub releases. Add a document only when it has a distinct, durable purpose.

## Scope and copy

Before adding complexity for a speculative or vanishingly unlikely race or security edge case, explain the concrete failure mode, likelihood, and complexity cost to the user and get their buy-in. Do not silently expand scope for theoretical robustness.

Avoid em dashes in written copy. Use a comma, colon, parentheses, or a new sentence.
