import { Spring, springs } from "../core/spring.js";
import type { GlassMotion, SurfaceAnimator } from "./interaction.js";

const enabled = (tab: HTMLElement) => !tab.matches(":disabled, [data-disabled], [aria-disabled='true']");

/** A selection lens for a tab list: it springs between tabs, follows a drag
 * across the list with velocity stretch, and selects the tab beneath it on release. Selection itself stays with the tabs: the lens
 * only clicks the tab it lands on, so keyboard and state handling are unchanged. */
export function attachSelectionLens(indicator: HTMLElement, motion: () => GlassMotion): SurfaceAnimator {
  const list = indicator.parentElement;
  if (!list) return { frame() {}, dispose() {} };
  const view = indicator.ownerDocument.defaultView!;
  const saved = { left: indicator.style.left, top: indicator.style.top, width: indicator.style.width, height: indicator.style.height, scale: indicator.style.scale };
  const pos = new Spring(0, springs.layout), cross = new Spring(0, springs.layout);
  const length = new Spring(0, springs.layout), thickness = new Spring(0, springs.layout);
  let ready = false, previous = 0, moved = false, suppress = false;
  let drag: { id: number; start: number; grab: number; client: number } | null = null;
  const vertical = () => list.getAttribute("aria-orientation") === "vertical" || list.dataset.orientation === "vertical";
  const tabs = () => [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter((tab) => tab.parentElement === list || tab.closest('[role="tablist"]') === list);
  const box = (tab: HTMLElement) => vertical()
    ? { pos: tab.offsetTop, cross: tab.offsetLeft, length: tab.offsetHeight, thickness: tab.offsetWidth }
    : { pos: tab.offsetLeft, cross: tab.offsetTop, length: tab.offsetWidth, thickness: tab.offsetHeight };
  const client = (event: PointerEvent) => vertical() ? event.clientY : event.clientX;
  /** Pointer coordinate in the list's layout space along the tab axis. */
  const local = (value: number) => {
    const rect = list.getBoundingClientRect();
    return vertical() ? (value - rect.top) * list.offsetHeight / (rect.height || 1)
      : (value - rect.left) * list.offsetWidth / (rect.width || 1);
  };
  /** The enabled tab whose center is nearest a coordinate on the axis. */
  const nearest = (center: number) => tabs().filter(enabled)
    .map((tab) => ({ tab, distance: Math.abs(box(tab).pos + box(tab).length / 2 - center) }))
    .sort((a, b) => a.distance - b.distance)[0]?.tab;

  function down(event: PointerEvent) {
    if (event.button !== 0 || motion() === "none") return;
    const tab = (event.target as Element | null)?.closest<HTMLElement>('[role="tab"]');
    if (!tab || !list!.contains(tab) || !enabled(tab)) return;
    const at = local(client(event));
    const active = tab.getAttribute("aria-selected") === "true";
    // Grab the lens where it was touched; pressing another tab pulls it there.
    drag = { id: event.pointerId, start: client(event), client: client(event), grab: active ? at - (pos.value + length.value / 2) : 0 };
    moved = false;
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", up);
    view.addEventListener("pointercancel", cancel);
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    drag.client = client(event);
    moved ||= Math.abs(drag.client - drag.start) > 4;
  }
  function end() {
    drag = null;
    view.removeEventListener("pointermove", move);
    view.removeEventListener("pointerup", up);
    view.removeEventListener("pointercancel", cancel);
  }
  function up(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const choice = nearest(pos.value + length.value / 2);
    end();
    if (moved && choice) {
      // The browser's own click would land on whichever tab is under the
      // pointer, or nowhere; the lens decides instead, exactly once.
      suppress = true;
      setTimeout(() => { suppress = false; }, 0);
      if (choice.getAttribute("aria-selected") !== "true") choice.click();
    }
  }
  function cancel(event: PointerEvent) {
    if (drag && event.pointerId === drag.id) end();
  }
  function click(event: MouseEvent) {
    if (!suppress || !event.isTrusted) return;
    suppress = false;
    event.preventDefault();
    event.stopPropagation();
  }
  list.addEventListener("pointerdown", down);
  list.addEventListener("click", click, true);

  return {
    frame(now) {
      const dt = previous ? Math.min((now - previous) / 1000, 1 / 20) : 1 / 60;
      previous = now;
      const level = motion();
      const active = tabs().find((tab) => tab.getAttribute("aria-selected") === "true");
      if (!active) return false;
      const target = box(active);
      if (!ready || level !== "full") {
        pos.jump(target.pos); cross.jump(target.cross); length.jump(target.length); thickness.jump(target.thickness);
        ready = target.length > 0;
      } else if (drag && moved && level === "full") {
        // Follow the finger; take on the width of the tab passing beneath.
        const tabsBox = tabs().map(box);
        const min = Math.min(...tabsBox.map((b) => b.pos)), max = Math.max(...tabsBox.map((b) => b.pos + b.length));
        const under = nearest(local(drag.client) - drag.grab);
        const size = under ? box(under).length : target.length;
        const center = Math.max(min + size / 2, Math.min(max - size / 2, local(drag.client) - drag.grab));
        pos.configure(springs.track).target = center - size / 2;
        length.configure(springs.track).target = size;
        cross.target = target.cross; thickness.target = target.thickness;
      } else {
        for (const spring of [pos, cross, length, thickness]) spring.configure(springs.layout);
        pos.target = target.pos; cross.target = target.cross; length.target = target.length; thickness.target = target.thickness;
      }
      for (const spring of [pos, cross, length, thickness]) spring.step(dt);
      // The bar grows around the lens under a press, keeping its even inset;
      // the lens itself only stretches along its path while it moves.
      const stretch = Math.min(0.2, Math.abs(pos.velocity) * 0.00035) * (drag ? 1 : 0.6);
      const along = 1 + stretch, across = 1 / Math.sqrt(1 + stretch);
      const v = vertical();
      indicator.style.left = `${(v ? cross.value : pos.value).toFixed(3)}px`;
      indicator.style.top = `${(v ? pos.value : cross.value).toFixed(3)}px`;
      indicator.style.width = `${(v ? thickness.value : length.value).toFixed(3)}px`;
      indicator.style.height = `${(v ? length.value : thickness.value).toFixed(3)}px`;
      const scale = v ? `${across.toFixed(4)} ${along.toFixed(4)}` : `${along.toFixed(4)} ${across.toFixed(4)}`;
      indicator.style.scale = Math.abs(along - 1) + Math.abs(across - 1) > 1e-4 ? scale : saved.scale;
      if (drag) indicator.dataset.glassLifted = ""; else delete indicator.dataset.glassLifted;
      return !ready || Boolean(drag) || [pos, cross, length, thickness].some((spring) => !spring.settled);
    },
    dispose() {
      end();
      list.removeEventListener("pointerdown", down);
      list.removeEventListener("click", click, true);
      Object.assign(indicator.style, saved);
      delete indicator.dataset.glassLifted;
    },
  };
}
