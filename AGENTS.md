# Project instructions

- Use Bun workspaces and TypeScript. Keep the root `bun.lock` authoritative.
- Use vgpu and WGSL for production GPU rendering. At setup or upgrade time, use the latest released vgpu and read its bundled documentation. For shader development, use the official vgpu skill and project-local tools: docs, examples, doctor, required WGSL validation, and real GPU readbacks.
- Use normal SVG filters on explicit DOM content layers for refraction. Do not introduce WebGL/GLSL, HTML-in-Canvas, DOM screenshots, CSS material approximations, or SVG backdrop filters as fallback renderers.
- Chromium, Safari, Firefox, and Electron are release acceptance targets. Verify visuals with the Codex browser or computer use; do not add Playwright or another browser automation suite. A result in one browser does not prove parity.
- Use shadcn/ui Mira components installed through its CLI for site controls, and Hugeicons for icons.
- Keep the public site to one library, a short introduction, interactive examples, and usage. Do not add pricing, accounts, status chips, decorative feature grids, or a separate showcase renderer. Examples must use the library's public exports.
- Native and React Native ports are outside the initial scope. Keep the macOS app as a local comparison reference.
- Publish only our source, measurements we own, and permitted assets. Never commit extracted framework binaries or disassembly.
- When interacting with Cloudflare, use `cf` unless the project has a Wrangler configuration.

## Documentation

Write for someone using or contributing to the library. Lead with installation and a working example; explain props, requirements, and surprising limitations. Keep architecture secondary and avoid repeating what types or code already explain.

Rewrite outdated sections instead of appending implementation histories. Keep conversational references, plans, audit logs, publication receipts, and PR summaries out of repository documentation. Put verification evidence in the PR and release summaries in GitHub releases. Add a document only when it has a distinct, durable purpose.
