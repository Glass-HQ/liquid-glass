import { Spring } from "../core/spring.js";
import type { SpringOptions } from "../core/spring.js";
import type { GlassMotion, SurfaceAnimator } from "./interaction.js";

const enabled = (tab: HTMLElement) =>
  !tab.matches(":disabled, [data-disabled], [aria-disabled='true']");

/**
 * The motion of a tab bar's selection, as macOS 27 draws its tabs (measured on
 * `NSSegmentedControl` with the tabs role):
 *
 * - At rest the chosen tab sits on a small glass plate.
 * - A press lifts a lens out of it: the lens grows by a third of the tab's
 *   height at each end and by 0.29 of it above and below, in about 250ms
 *   without overshoot, while the plate fades out beneath it. Pressing another
 *   tab carries the lens there as it grows.
 * - Dragging moves the lens with the pointer, one to one, at the size it was
 *   lifted at. It squashes along its path with speed and wobbles when it
 *   stops. Only at either end of the bar does it take on that end tab's size.
 * - Letting go settles the lens onto the tab under its centre, at that tab's
 *   size, in about 400ms, while the plate fades back in.
 *
 * The plate is the bar's `[role=tablist]` child `plate`; the lens is a
 * separate element given with `setLens`, drawn above the tab labels so it
 * magnifies them, and kept outside the bar so the bar's clip never cuts it.
 * Selection itself stays with the tabs: the lens only clicks the tab it lands
 * on, so keyboard and state handling are unchanged.
 */
export interface SelectionLens extends SurfaceAnimator {
  /** The lens element: absolutely positioned in `container` (the scene root). */
  setLens(lens: HTMLElement | null, container: HTMLElement | null): void;
}

/** How each part moves, from the native measurements above. */
const motion = {
  lift: { duration: 0.25, bounce: 0 },
  settle: { duration: 0.4, bounce: 0 },
  follow: { duration: 0.1, bounce: 0 },
  end: { duration: 0.3, bounce: 0.1 },
  squash: { duration: 0.38, bounce: 0.45 },
} as const satisfies Record<string, SpringOptions>;
/** The lens's growth past its tab, as fractions of the tab's thickness. */
const outset = { along: 1 / 3, across: 0.29 };

interface Box {
  pos: number;
  cross: number;
  length: number;
  thickness: number;
}

export function attachSelectionLens(
  plate: HTMLElement,
  level: () => GlassMotion,
  /** Called when a press needs the lens, and when it has settled away, so
   * the lens is a glass surface only while it shows. */
  onLifted?: (lifted: boolean) => void,
): SelectionLens {
  const list = plate.parentElement;
  if (!list) return { frame: () => false, dispose() {}, setLens() {} };
  const view = plate.ownerDocument.defaultView!;
  const saved = {
    left: plate.style.left,
    top: plate.style.top,
    width: plate.style.width,
    height: plate.style.height,
    opacity: plate.style.opacity,
  };
  const pos = new Spring(0, motion.settle),
    length = new Spring(0, motion.settle),
    cross = new Spring(0, motion.settle),
    thickness = new Spring(0, motion.settle);
  const lift = new Spring(0, motion.lift);
  const squash = new Spring(0, motion.squash);
  let lens: HTMLElement | null = null,
    container: HTMLElement | null = null;
  let ready = false,
    previous = 0,
    suppress = false,
    lifted = false,
    prepared = false;
  let press: {
    id: number;
    start: number;
    client: number;
    grab: number;
    moved: boolean;
    held: HTMLElement;
  } | null = null;
  /** A tab chosen by a release, until the tabs report it selected. */
  let pending: { tab: HTMLElement; at: number } | null = null;

  const vertical = () =>
    list.getAttribute("aria-orientation") === "vertical" || list.dataset.orientation === "vertical";
  const tabs = () =>
    [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
      (tab) => tab.closest('[role="tablist"]') === list,
    );
  const box = (tab: HTMLElement): Box =>
    vertical()
      ? {
          pos: tab.offsetTop,
          cross: tab.offsetLeft,
          length: tab.offsetHeight,
          thickness: tab.offsetWidth,
        }
      : {
          pos: tab.offsetLeft,
          cross: tab.offsetTop,
          length: tab.offsetWidth,
          thickness: tab.offsetHeight,
        };
  const client = (event: PointerEvent) => (vertical() ? event.clientY : event.clientX);
  /** A pointer coordinate in the bar's layout space along the tab axis. */
  const local = (value: number) => {
    const rect = list.getBoundingClientRect();
    return vertical()
      ? ((value - rect.top) * list.offsetHeight) / (rect.height || 1)
      : ((value - rect.left) * list.offsetWidth) / (rect.width || 1);
  };
  /** The enabled tab under a coordinate on the axis, or the nearest one. */
  const under = (at: number) => {
    const candidates = tabs().filter(enabled);
    return (
      candidates.find((tab) => {
        const b = box(tab);
        return at >= b.pos && at < b.pos + b.length;
      }) ??
      candidates
        .map((tab) => ({ tab, distance: Math.abs(box(tab).pos + box(tab).length / 2 - at) }))
        .sort((a, b) => a.distance - b.distance)[0]?.tab
    );
  };
  const selected = () => tabs().find((tab) => tab.getAttribute("aria-selected") === "true");

  function down(event: PointerEvent) {
    if (event.button !== 0 || level() !== "full") return;
    const tab = (event.target as Element | null)?.closest<HTMLElement>('[role="tab"]');
    if (!tab || !list!.contains(tab) || !enabled(tab)) return;
    const at = local(client(event));
    // The chosen tab's lens is grabbed where it was touched; pressing another
    // tab carries the lens there, centred on it.
    const grab = tab === selected() ? at - (pos.value + length.value / 2) : 0;
    press = {
      id: event.pointerId,
      start: client(event),
      client: client(event),
      grab,
      moved: false,
      held: tab,
    };
    pending = null;
    lift.configure(motion.lift).target = 1;
    if (!lifted) {
      lifted = true;
      onLifted?.(true);
    }
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", up);
    view.addEventListener("pointercancel", cancel);
  }
  function move(event: PointerEvent) {
    if (!press || event.pointerId !== press.id) return;
    press.client = client(event);
    press.moved ||= Math.abs(press.client - press.start) > 3;
  }
  function end() {
    press = null;
    lift.configure(motion.settle).target = 0;
    view.removeEventListener("pointermove", move);
    view.removeEventListener("pointerup", up);
    view.removeEventListener("pointercancel", cancel);
  }
  function up(event: PointerEvent) {
    if (!press || event.pointerId !== press.id) return;
    const moved = press.moved;
    const choice = moved ? under(pos.target + length.target / 2) : press.held;
    end();
    if (!choice) return;
    pending = { tab: choice, at: performance.now() };
    if (moved) {
      // The browser's own click would land on whichever tab is under the
      // pointer, or nowhere; the lens decides instead, exactly once.
      suppress = true;
      setTimeout(() => {
        suppress = false;
      }, 0);
      if (choice.getAttribute("aria-selected") !== "true") choice.click();
    }
  }
  function cancel(event: PointerEvent) {
    if (press && event.pointerId === press.id) {
      end();
      pending = null;
    }
  }
  function click(event: MouseEvent) {
    if (!suppress || !event.isTrusted) return;
    suppress = false;
    event.preventDefault();
    event.stopPropagation();
  }
  // The pointer nearing the bar prepares the lens; leaving it lets it go.
  function enter() {
    if (level() !== "full") return;
    prepared = true;
    if (!lifted) {
      lifted = true;
      onLifted?.(true);
    }
  }
  function leave() {
    prepared = false;
  }
  list.addEventListener("pointerenter", enter);
  list.addEventListener("pointerleave", leave);
  list.addEventListener("pointerdown", down);
  list.addEventListener("click", click, true);

  const hideLens = () => {
    if (lens && !lens.hidden) lens.hidden = true;
  };

  return {
    setLens(element, root) {
      if (lens && lens !== element) lens.hidden = true;
      lens = element;
      container = root;
      if (lens) lens.hidden = true;
    },
    frame(now) {
      const dt = previous ? Math.min((now - previous) / 1000, 1 / 20) : 1 / 60;
      previous = now;
      const full = level() === "full";
      if (pending && (selected() === pending.tab || now - pending.at > 600)) pending = null;
      const active = selected();
      if (!active) return false;
      const all = tabs();
      const dragging = Boolean(press?.moved) && full;
      let target = box(pending?.tab ?? press?.held ?? active);
      if (press && dragging) {
        // Follow the pointer at the size the lens was lifted at; only past
        // either end does it take on that end tab's size.
        const first = box(all[0]!),
          last = box(all[all.length - 1]!);
        const held = box(press.held);
        const start = local(press.client) - press.grab - held.length / 2;
        if (start <= first.pos) {
          press.held = all[0]!;
          target = first;
          pos.configure(motion.end);
          length.configure(motion.end);
        } else if (start + held.length >= last.pos + last.length) {
          press.held = all[all.length - 1]!;
          target = last;
          pos.configure(motion.end);
          length.configure(motion.end);
        } else {
          target = { ...held, pos: start };
          pos.configure(motion.follow);
          length.configure(motion.end);
        }
      } else {
        pos.configure(motion.settle);
        length.configure(motion.settle);
      }
      if (!ready || !full) {
        pos.jump(target.pos);
        length.jump(target.length);
        cross.jump(target.cross);
        thickness.jump(target.thickness);
        lift.jump(0);
        squash.jump(0);
        ready = target.length > 0;
      } else {
        pos.target = target.pos;
        length.target = target.length;
        cross.target = target.cross;
        thickness.target = target.thickness;
      }
      // Speed squashes the lens along its path; stopping lets it wobble back.
      squash.target = dragging ? Math.min(0.045, Math.abs(pos.velocity) * 8.5e-5) : 0;
      for (const spring of [pos, length, cross, thickness, lift, squash]) spring.step(dt);

      const v = vertical();
      const place = (element: HTMLElement, p: number, c: number, l: number, t: number) => {
        element.style.left = `${(v ? c : p).toFixed(3)}px`;
        element.style.top = `${(v ? p : c).toFixed(3)}px`;
        element.style.width = `${(v ? t : l).toFixed(3)}px`;
        element.style.height = `${(v ? l : t).toFixed(3)}px`;
      };
      place(plate, pos.value, cross.value, length.value, thickness.value);
      const shown = Math.max(0, Math.min(1, lift.value));
      plate.style.opacity = shown > 0.001 ? (1 - shown).toFixed(3) : saved.opacity;

      if (lens && container && (shown > 0.001 || prepared)) {
        // The lens keeps its lifted thickness in layout and is scaled to grow,
        // so its maps never change while it lifts; only its length follows.
        // While the pointer is only over the bar, the lens waits, hidden, at
        // its lifted size, so a first press finds its glass ready.
        const grow = shown > 0.001 ? shown : 1;
        const thick = thickness.value;
        const liftedThickness = thick * (1 + 2 * outset.across);
        const grownLength = length.value + 2 * thick * outset.along * grow;
        const grownThickness = thick * (1 + 2 * outset.across * grow);
        const scale = grownThickness / liftedThickness;
        const layoutLength = grownLength / scale;
        const listRect = list.getBoundingClientRect(),
          rootRect = container.getBoundingClientRect();
        const offsetX = listRect.left - rootRect.left + container.scrollLeft - container.clientLeft,
          offsetY = listRect.top - rootRect.top + container.scrollTop - container.clientTop;
        const centerPos = pos.value + length.value / 2,
          centerCross = cross.value + thick / 2;
        const along = 1 + squash.value,
          across = 1 - 2.4 * squash.value;
        if (lens.hidden) lens.hidden = false;
        const visibility = shown > 0.001 ? "" : "hidden";
        if (lens.style.visibility !== visibility) lens.style.visibility = visibility;
        place(
          lens,
          centerPos - layoutLength / 2 + (v ? offsetY : offsetX),
          centerCross - liftedThickness / 2 + (v ? offsetX : offsetY),
          layoutLength,
          liftedThickness,
        );
        lens.style.scale = v
          ? `${(scale * across).toFixed(4)} ${(scale * along).toFixed(4)}`
          : `${(scale * along).toFixed(4)} ${(scale * across).toFixed(4)}`;
      } else hideLens();
      if (press) plate.dataset.glassLifted = "";
      else delete plate.dataset.glassLifted;
      if (lifted && !press && !prepared && lift.settled && lift.value === 0) {
        lifted = false;
        onLifted?.(false);
      }
      return (
        !ready ||
        Boolean(press) ||
        Boolean(pending) ||
        [pos, length, cross, thickness, lift, squash].some((spring) => !spring.settled)
      );
    },
    dispose() {
      if (press) end();
      list.removeEventListener("pointerenter", enter);
      list.removeEventListener("pointerleave", leave);
      list.removeEventListener("pointerdown", down);
      list.removeEventListener("click", click, true);
      Object.assign(plate.style, saved);
      delete plate.dataset.glassLifted;
      hideLens();
    },
  };
}
