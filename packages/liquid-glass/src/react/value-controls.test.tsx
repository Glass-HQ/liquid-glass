import { switchDragState } from "./value-control-motion.js";
import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlassScene, GlassSlider, GlassSwitch } from "./index.js";

const render = (child: ReactNode) => renderToStaticMarkup(<GlassScene>{child}</GlassScene>);

test("slider forwards accessible input, numeric range and form name during SSR", () => {
  const html = render(<GlassSlider value={0.5} min={0} max={1} step={0.01}
    name="gain" aria-label="Gain" thumbProps={{ "aria-valuetext": "Half", className: () => "custom-thumb" }} />);
  expect(html).toContain('type="range"');
  expect(html).toContain('aria-label="Gain"');
  expect(html).toContain('aria-valuetext="Half"');
  expect(html).toContain('name="gain"');
  expect(html).toContain('value="0.5"');
  expect(html).toContain('step="0.01"');
  expect(html).toContain("custom-thumb");
});

test("invalid ranges and unbounded tick generation fail before rendering", () => {
  for (const props of [{ min: 1, max: 1 }, { min: NaN }, { max: Infinity }, { step: 0 }, { step: -1 }, { min: -1e308, max: 1e308 }])
    expect(() => render(<GlassSlider {...props} />)).toThrow(RangeError);
  expect(() => render(<GlassSlider ticks step={1e12} />)).toThrow(RangeError);
  expect(() => render(<GlassSlider ticks step={0.01} />)).toThrow(RangeError);
  expect(() => render(<GlassSlider ticks min={0} max={1} step={0.3} />)).toThrow(RangeError);
  const html = render(<GlassSlider ticks step={25} defaultValue={50} />);
  expect(html).toContain('step="25"');
  expect(html).toContain('aria-hidden="true"');
});

test("switch preserves controlled checked state and form fields", () => {
  const on = render(<GlassSwitch checked name="notifications" value="yes" aria-label="Notifications" />);
  expect(on).toContain('role="switch"');
  expect(on).toContain('aria-checked="true"');
  expect(on).toContain('name="notifications"');
  expect(on).toContain('value="yes"');
  const off = render(<GlassSwitch checked={false} aria-label="Notifications" />);
  expect(off).toContain('aria-checked="false"');
});

 test("resting value controls have solid faces without registered glass surfaces", () => {
  const html = render(<><GlassSlider defaultValue={50} /><GlassSwitch defaultChecked /></>);
  expect(html).toContain('lg-control-face');
  expect(html).toContain('data-press-phase="idle"');
  expect(html).not.toContain('lg-control-lens');
  expect(html).not.toContain('lg-surface');
 });

 test("switch drag uses the native midpoint and opposite-half resistance in both directions", () => {
  const normal = { start: 0, x: 16, left: 0, width: 54, rtl: false, oppositeHalf: false };
  expect(switchDragState(normal, 26)).toBe(false);
  expect(switchDragState(normal, 27)).toBe(true);
  const opposite = { ...normal, x: 40, oppositeHalf: true };
  expect(switchDragState(opposite, 61)).toBe(false);
  expect(switchDragState(opposite, 62)).toBe(true);
  expect(switchDragState({ ...opposite, start: 1, x: 10 }, -12)).toBe(false);
  expect(switchDragState({ ...normal, rtl: true }, 26)).toBe(true);
  expect(switchDragState({ ...opposite, rtl: true }, 18)).toBe(true);
 });
