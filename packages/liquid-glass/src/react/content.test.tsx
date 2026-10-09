import { expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlassContent, GlassScene, GlassSurface } from "./index.js";

const marker = '<aside data-content-end=""';
function renderContent(capacity: number | undefined, surfaces: number, layout: "overlay" | "flow" | "scroll") {
  const html = renderToStaticMarkup(
    <GlassScene maxSurfaces={capacity}>
      <GlassContent id="source" ref={createRef<HTMLDivElement>()} layout={layout}
        className="author-content" aria-label="Backdrop"
        style={{ width: 240, minHeight: 160, filter: "grayscale(1)" }}>
        <input name="draft" defaultValue="Keep this value" />
        <span>Live content</span>
      </GlassContent>
      <aside data-content-end="" />
      {Array.from({ length: surfaces }, (_, index) => <GlassSurface key={index}>Surface {index}</GlassSurface>)}
    </GlassScene>,
  );
  return html.slice(0, html.indexOf(marker));
}

test("content keeps one fixed element while scene surfaces enter and leave", () => {
  // Identical ancestry is required for React to preserve the content DOM,
  // including live form values and caller refs, as surfaces come and go.
  for (const capacity of [1, undefined, 64]) for (const layout of ["overlay", "flow", "scroll"] as const) {
    const count = capacity ?? 16;
    const empty = renderContent(capacity, 0, layout);
    expect(empty).not.toContain("data-glass-filter-host");
    expect(empty.match(/id="source"/g)?.length).toBe(1);
    expect(empty.match(/name="draft"/g)?.length).toBe(1);
    expect(empty).toContain('class="lg-content author-content"');
    expect(empty).toContain('aria-label="Backdrop"');
    expect(empty).toContain('style="width:240px;min-height:160px;filter:grayscale(1)"');
    expect(empty).toContain('value="Keep this value"');
    expect(empty.match(new RegExp(`data-layout="${layout}"`, "g"))?.length).toBe(1);
    for (const surfaces of [1, count]) expect(renderContent(capacity, surfaces, layout)).toBe(empty);
  }
});

test("server and browser user agents render identical content ancestry", () => {
  // Engine detection is initialized at module load. Isolate imports so the
  // server result cannot accidentally hide a Firefox-only render branch.
  const script = `
    const agent = JSON.parse(process.argv[1]);
    if (agent) Object.defineProperty(globalThis, "navigator", { value: agent });
    else Reflect.deleteProperty(globalThis, "navigator");
    const { createElement: h } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { GlassScene, GlassContent } = await import(${JSON.stringify(new URL("./index.tsx", import.meta.url).href)});
    console.log(renderToStaticMarkup(h(GlassScene, { maxSurfaces: 4 },
      h(GlassContent, { layout: "scroll", id: "source" }, h("input", { defaultValue: "Keep this value" }))
    )));
  `;
  const agents = [
    null,
    { vendor: "", userAgent: "Mozilla/5.0 Gecko/20100101 Firefox/144.0" },
    { vendor: "Apple Computer, Inc.", userAgent: "Mozilla/5.0 AppleWebKit/605.1.15 Version/27.0 Safari/605.1.15" },
    { vendor: "Google Inc.", userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36" },
  ];
  const html = agents.map((agent) => {
    const result = Bun.spawnSync([process.execPath, "--eval", script, JSON.stringify(agent)], {
      cwd: new URL("../../", import.meta.url).pathname,
    });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  });
  expect(html[0]).toContain('id="source"');
  for (const browser of html.slice(1)) expect(browser).toBe(html[0]!);
});
