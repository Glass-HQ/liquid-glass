import { expect, test } from "bun:test";
import { zoomFilterMarkup } from "./page-zoom.js";

test("page zoom scales primitive lengths and leaves the filter region alone", () => {
  const markup = `<filter id="f" x="-0.1" y="-0.1" width="1.2" height="1.2"><feGaussianBlur in="SourceGraphic" stdDeviation="4 2" x="10" y="20" width="30" height="40" result="b"/><feDisplacementMap in="b" in2="m" scale="8" xChannelSelector="R" yChannelSelector="G"/><feOffset in="b" dx="-2" dy="3"/></filter>`;
  const zoomed = zoomFilterMarkup(markup, 1.5);
  expect(zoomed).toContain('<filter id="f" x="-0.1" y="-0.1" width="1.2" height="1.2">');
  expect(zoomed).toContain('stdDeviation="6 3" x="15" y="30" width="45" height="60"');
  expect(zoomed).toContain('scale="12"');
  expect(zoomed).toContain('dx="-3" dy="4.5"');
  expect(zoomFilterMarkup(markup, 1)).toBe(markup);
});
