import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ComponentPropsWithRef,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Appearance, MaterialKind, Rect } from "../protocol";
import { GlassButton } from "./button";
import type { GlassButtonProps } from "./button";
import { GlassHighlight } from "./highlight";
import { mergeProps } from "./surface";
import {
  GroupContext,
  SceneContext,
  SurfaceContext,
  chain,
  prefersReducedMotion,
  useControllable,
  pressGrowth,
  rectIn,
  useGlassSurface,
  useMergedRef,
} from "./hooks";

/**
 * The menu opens and closes on springs: it grows out of its button, overshooting a touch, and its
 * rows fade in once it is most of the way open.
 */
const OPEN = { dampingRatio: 0.75, response: 0.35 };
const CLOSE = { dampingRatio: 0.8, response: 0.49 };
/** Where a submenu starts growing from: this share of its size. */
const SEED = 0.4;

type FocusOnOpen = "first" | "last" | "panel" | "none";
type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

interface MenuContext {
  readonly open: boolean;
  readonly setOpen: (open: boolean, focus?: FocusOnOpen | "trigger") => void;
  /** Close this menu and every menu it opened from, focusing the first trigger. */
  readonly closeAll: () => void;
  /** A submenu: it opens beside its row, on hover, and Left arrow closes it. */
  readonly sub: boolean;
  /** Open and close without animating: one submenu taking over from another. */
  readonly instant: boolean;
  readonly triggerId: string;
  readonly popupId: string;
  /** The button (or submenu row) the menu opens from; for a context menu, the region. */
  readonly trigger: React.RefObject<HTMLElement | null>;
  /** Where a context menu was asked for, in viewport px; null for a menu opened from a button. */
  readonly point: React.RefObject<{ x: number; y: number } | null>;
  readonly focusOnOpen: React.RefObject<FocusOnOpen | null>;
}

const Context = createContext<MenuContext | null>(null);

/** Inside a popup: which of its submenus is open (only one at a time). */
const SubHost = createContext<{
  readonly openSub: string | null;
  /** The last change swapped one open submenu for another. */
  readonly swapped: boolean;
  /** The menu they open from is closing: they go at once, without animating. */
  readonly closing: boolean;
  readonly setOpenSub: (id: string | null) => void;
} | null>(null);
const useMenu = (part: string) => {
  const context = useContext(Context);
  if (!context) throw new Error(`${part} must be inside a GlassMenu or a GlassContextMenu.`);
  return context;
};

export interface GlassMenuProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

/**
 * A menu: a `GlassMenuTrigger` and a `GlassMenuPopup` of items. It renders no element of its own,
 * so the trigger sits in the layout as if the menu weren't there; the popup renders over the
 * whole page (see `GlassMenuPopup`).
 */
export function GlassMenu({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
}: GlassMenuProps) {
  const [open, setOpenState] = useControllable(openProp, defaultOpen, onOpenChange);
  const trigger = useRef<HTMLElement | null>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const focusOnOpen = useRef<FocusOnOpen | null>(null);
  const id = useId();
  const setOpen = useCallback(
    (next: boolean, focus?: FocusOnOpen | "trigger") => {
      if (next) focusOnOpen.current = focus === "trigger" ? null : (focus ?? "panel");
      else if (focus === "trigger") trigger.current?.focus();
      setOpenState(next);
    },
    [setOpenState],
  );
  const context = useMemo<MenuContext>(
    () => ({
      open,
      setOpen,
      closeAll: () => setOpen(false, "trigger"),
      sub: false,
      instant: false,
      triggerId: `${id}-trigger`,
      popupId: `${id}-popup`,
      trigger,
      point,
      focusOnOpen,
    }),
    [open, setOpen, id],
  );
  return <Context value={context}>{children}</Context>;
}

/**
 * A context menu: a `GlassContextMenuTrigger` (the region it belongs to) and a `GlassMenuPopup`.
 * It opens where the region is right-clicked or long-pressed, or with the keyboard's menu key or
 * Shift+F10, and grows out of that point.
 */
export const GlassContextMenu = GlassMenu;
export type GlassContextMenuProps = GlassMenuProps;

export interface GlassMenuTriggerProps extends GlassButtonProps {
  /**
   * Render this element as the trigger instead of a `GlassButton` (a `GlassToolbarButton` in a
   * toolbar, or any button of your own), with the trigger's props merged into it. A glass
   * trigger morphs into the panel; any other grows the panel out of itself.
   */
  render?: ReactElement;
}

/** The button that opens the menu: a `GlassButton`, or the element given as `render`. */
export function GlassMenuTrigger({
  ref,
  onClick,
  onKeyDown,
  render,
  ...props
}: GlassMenuTriggerProps) {
  const menu = useMenu("GlassMenuTrigger");
  const mergedRef = useMergedRef<HTMLButtonElement>(
    menu.trigger as React.RefObject<HTMLButtonElement | null>,
    ref,
  );
  const own = {
    id: menu.triggerId,
    "aria-haspopup": "menu" as const,
    "aria-expanded": menu.open,
    "aria-controls": menu.open ? menu.popupId : undefined,
    "data-lg-menu-open": menu.open ? "" : undefined,
    onClick: chain((event: MouseEvent<HTMLButtonElement>) => {
      if (event.defaultPrevented) return;
      menu.point.current = null;
      menu.setOpen(!menu.open, event.detail === 0 ? "first" : "panel");
    }, onClick),
    onKeyDown: chain((event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        menu.point.current = null;
        menu.setOpen(true, event.key === "ArrowDown" ? "first" : "last");
      }
    }, onKeyDown),
  };
  if (render && isValidElement(render)) {
    const { children, ...rest } = props;
    return cloneElement(
      asAny(render),
      { ...mergeProps(propsOf(render), { ...rest, ...own }), ref: mergedRef },
      children ?? (propsOf(render).children as ReactNode),
    );
  }
  return <GlassButton {...props} {...own} ref={mergedRef} />;
}

export interface GlassContextMenuTriggerProps extends ComponentPropsWithRef<"div"> {
  /** Render this element as the region instead of a `div`, with the trigger's props merged in. */
  render?: ReactElement;
  /** Leave the browser's own context menu in place. */
  disabled?: boolean;
  /**
   * Leave right-clicks on matching descendants to them (a selector, such as "a, button, input"):
   * the menu opens only for the region's empty space and whatever doesn't match.
   */
  ignore?: string;
}

/** How long a touch rests before it opens a context menu, ms, and how far it may wander, px. */
const LONG_PRESS = 500;
const LONG_PRESS_SLOP = 10;

/** The region a context menu belongs to. */
export function GlassContextMenuTrigger({
  render,
  disabled = false,
  ignore,
  ref,
  children,
  onContextMenu,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...props
}: GlassContextMenuTriggerProps) {
  const menu = useMenu("GlassContextMenuTrigger");
  const mergedRef = useMergedRef<HTMLDivElement>(
    menu.trigger as React.RefObject<HTMLDivElement | null>,
    ref,
  );
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer);
    },
    [],
  );
  const openAt = (x: number, y: number, focus: FocusOnOpen) => {
    menu.point.current = { x, y };
    menu.setOpen(true, focus);
  };
  const own = {
    "data-lg-context-trigger": "",
    "data-lg-menu-open": menu.open ? "" : undefined,
    onContextMenu: chain((event: MouseEvent<HTMLDivElement>) => {
      if (disabled || event.defaultPrevented) return;
      // Only right-clicks inside the region itself: not ones from a menu or dialog rendered
      // elsewhere that reach it through the component tree, nor on what it leaves alone.
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !event.currentTarget.contains(target)) return;
      if (
        ignore &&
        target.closest(ignore)?.closest("[data-lg-context-trigger]") === event.currentTarget
      )
        return;
      event.preventDefault();
      cancelPress();
      openAt(event.clientX, event.clientY, "panel");
    }, onContextMenu),
    onKeyDown: chain((event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        const box = (event.target as HTMLElement).getBoundingClientRect();
        openAt(
          box.left + Math.min(16, box.width / 2),
          box.top + Math.min(16, box.height / 2),
          "first",
        );
      }
    }, onKeyDown),
    onPointerDown: chain((event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || event.pointerType !== "touch") return;
      cancelPress();
      const { clientX: x, clientY: y } = event;
      press.current = { x, y, timer: window.setTimeout(() => openAt(x, y, "panel"), LONG_PRESS) };
    }, onPointerDown),
    onPointerMove: chain((event: ReactPointerEvent<HTMLDivElement>) => {
      const held = press.current;
      if (held && Math.hypot(event.clientX - held.x, event.clientY - held.y) > LONG_PRESS_SLOP)
        cancelPress();
    }, onPointerMove),
    onPointerUp: chain(cancelPress, onPointerUp),
    onPointerCancel: chain(cancelPress, onPointerCancel),
  };
  if (render && isValidElement(render)) {
    return cloneElement(
      asAny(render),
      { ...mergeProps(propsOf(render), { ...props, ...own }), ref: mergedRef },
      children ?? (propsOf(render).children as ReactNode),
    );
  }
  return (
    <div {...props} {...own} ref={mergedRef}>
      {children}
    </div>
  );
}

export interface GlassMenuPopupProps extends Omit<ComponentPropsWithRef<"div">, "role"> {
  /**
   * Which side of the trigger it opens towards. Default: "bottom". It moves to the other side
   * when there is more room there, and shifts along to stay in the window.
   */
  side?: Side;
  /** How it lines up with the trigger. Default: "start". */
  align?: Align;
  /**
   * How far the panel sits past where it starts, px. Default: 0: like iOS, the panel opens over
   * its button (its top edge on the button's top edge when it opens down), and the button morphs
   * into it. A context menu opens at the pointer.
   */
  offset?: number;
  /** Shifts the panel along its trigger, px (towards the end for "start", the start for "end"). */
  alignOffset?: number;
  /**
   * Where the panel renders. Default: the scene's root element, over the whole page, so nothing
   * the trigger sits in (a sidebar, a scrolling list) clips it.
   */
  container?: HTMLElement | null;
  material?: MaterialKind;
  tint?: string | null;
  appearance?: Appearance;
  /** The panel's corners. Default: 28. */
  radius?: number;
  /** Highlights that follow the pointer (or device tilt). Default: the scene's. */
  specular?: boolean;
}

/** A `render` element's props, whatever its component. */
const propsOf = (element: ReactElement) => element.props as Record<string, unknown>;
const asAny = (element: ReactElement) => element as ReactElement<Record<string, unknown>>;

const itemSelector = "[data-lg-menu-item]:not([aria-disabled=true])";

/** How long a row crossed on the way to an open submenu waits before taking over, ms. */
const SWITCH_DELAY = 150;
/** How long typed letters keep adding up to one search, ms. */
const TYPEAHEAD_MS = 600;
/** The room a panel keeps from the window's edges, px. */
const VIEWPORT_MARGIN = 8;

/**
 * Whether a pointer moving from `from` to `to` is heading into `box` (a submenu beside the
 * menu): it moved towards the box's side and stays inside the triangle from `from` to that
 * side's two corners, with a few px of slack.
 */
function headingInto(
  from: { x: number; y: number },
  to: { x: number; y: number },
  box: DOMRect,
): boolean {
  const left = box.left >= from.x - 4 ? box.left : box.right <= from.x + 4 ? box.right : null;
  if (left === null) return false;
  const towards = left > from.x ? to.x - from.x : from.x - to.x;
  if (towards <= 0) return false;
  const a = { x: left, y: box.top - 8 };
  const b = { x: left, y: box.bottom + 8 };
  const side = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(from, a, to);
  const d2 = side(a, b, to);
  const d3 = side(b, from, to);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/** The panel's inset around its rows, a row's height and its line of text, px (styles.ts). */
const PANEL_INSET = 4;
const ROW = 28;
const LINE = 16;
/** Room kept between a row's content and the panel's curve. */
const CONTENT_PADDING = 8;

/**
 * Every row of a menu keeps its content as far from the sides as the panel's corners need: the
 * first row's corners follow the panel's curve, which cuts into its line of text by this much,
 * and the other rows line up with it.
 */
function contentInset(radius: number): number {
  const curve = Math.max(0, radius - PANEL_INSET);
  const into = (ROW - LINE) / 2;
  const cut = curve > into ? curve - Math.sqrt(curve * curve - (curve - into) ** 2) : 0;
  return Math.ceil(CONTENT_PADDING + cut);
}

interface Placement {
  readonly left: number;
  readonly top: number;
  readonly side: Side;
  readonly maxHeight: number;
}

/**
 * Where a panel of `size` goes for an `anchor` (viewport px): on `side`, lined up by `align`, kept
 * inside the window. "over" starts the panel at the anchor's near edge, covering it (a menu over
 * its button, a context menu at the pointer); "beside" starts it past the far edge (a submenu
 * beside its row). It moves to the other side when that has more room than it needs and this one
 * hasn't, and is as tall as the room it has.
 */
function placePanel(
  anchor: Rect,
  size: { width: number; height: number },
  side: Side,
  align: Align,
  offset: number,
  alignOffset: number,
  mode: "over" | "beside",
): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = VIEWPORT_MARGIN;
  const vertical = side === "top" || side === "bottom";
  const start = vertical ? anchor.y : anchor.x;
  const length = vertical ? anchor.height : anchor.width;
  const extent = vertical ? vh : vw;
  const want = vertical ? size.height : size.width;
  // Where the panel's near edge goes on each side, and the room it has from there.
  const forward = mode === "over" ? start + offset : start + length + offset;
  const backward = mode === "over" ? start + length - offset : start - offset;
  const roomForward = extent - m - forward;
  const roomBackward = backward - m;
  const towardsEnd = side === "bottom" || side === "right";
  let forwardChosen = towardsEnd;
  if (towardsEnd && want > roomForward && roomBackward > roomForward) forwardChosen = false;
  if (!towardsEnd && want > roomBackward && roomForward > roomBackward) forwardChosen = true;
  const room = Math.max(0, forwardChosen ? roomForward : roomBackward);
  const used = Math.min(want, Math.max(room, Math.min(want, extent - 2 * m)));
  let main = forwardChosen ? forward : backward - used;
  main = Math.min(Math.max(main, m), extent - m - used);
  // Across: lined up with the anchor, then kept in the window.
  const crossStart = vertical ? anchor.x : anchor.y;
  const crossLength = vertical ? anchor.width : anchor.height;
  const crossExtent = vertical ? vw : vh;
  const crossSize = vertical ? size.width : Math.min(size.height, crossExtent - 2 * m);
  let cross =
    align === "start"
      ? crossStart + alignOffset
      : align === "end"
        ? crossStart + crossLength - crossSize - alignOffset
        : crossStart + (crossLength - crossSize) / 2;
  cross = Math.min(Math.max(cross, m), crossExtent - m - crossSize);
  const chosen: Side = vertical
    ? forwardChosen
      ? "bottom"
      : "top"
    : forwardChosen
      ? "right"
      : "left";
  return vertical
    ? { left: cross, top: main, side: chosen, maxHeight: used }
    : { left: main, top: cross, side: chosen, maxHeight: crossSize };
}

/**
 * The menu's panel: floating glass that grows out of its trigger (or the pointer, for a context
 * menu), with a glass pill under the row the pointer or keyboard is on. It renders over the whole
 * page, stays inside the window, and scrolls when taller than the room it has. Closes on Escape,
 * a click outside, Tab or a chosen item. Typing a row's first letters moves to it.
 */
export function GlassMenuPopup(props: GlassMenuPopupProps) {
  const menu = useMenu("GlassMenuPopup");
  const scene = useContext(SceneContext);
  if (menu.sub) return <MenuPanel {...props} />;
  const { container, ...rest } = props;
  const target =
    container ?? scene?.root ?? (typeof document === "undefined" ? null : document.body);
  if (!target) return null;
  // Out of any group the trigger sits in: the panel is glass of its own, over the page.
  return createPortal(
    <GroupContext value={null}>
      <MenuPanel {...rest} />
    </GroupContext>,
    target,
  );
}

function MenuPanel({
  side = "bottom",
  align = "start",
  offset = 0,
  alignOffset = 0,
  material,
  tint,
  appearance,
  radius = 28,
  specular,
  style,
  children,
  onKeyDown,
  onPointerMove,
  onPointerLeave,
  ref,
  ...props
}: Omit<GlassMenuPopupProps, "container">) {
  const menu = useMenu("GlassMenuPopup");
  const panel = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(menu.open);
  const [active, setActive] = useState<HTMLElement | null>(null);
  /** Whether the menu is open now, for timers that outlive a render. */
  const openRef = useRef(menu.open);
  openRef.current = menu.open;
  /** The row a waiting switch is for, and the pointer's last position. */
  const pending = useRef<HTMLElement | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  /** A row switch waiting out the safe path to an open submenu. */
  const switching = useRef<number | undefined>(undefined);
  /** Letters typed so far, and when the search started over. */
  const typed = useRef({ text: "", at: 0 });
  useEffect(() => () => clearTimeout(switching.current), []);
  const [sub, setSub] = useState<{ open: string | null; swapped: boolean }>({
    open: null,
    swapped: false,
  });
  const openSub = sub.open;
  /** Whether one of this panel's submenus is open, for the morph's frame loop. */
  const subShown = useRef(false);
  subShown.current = openSub !== null;
  // A submenu opening before the panel has settled is never cut off, not even for a frame.
  useLayoutEffect(() => {
    if (openSub !== null && menu.open && panel.current) panel.current.style.clipPath = "";
  }, [openSub, menu.open]);
  const setOpenSub = useCallback(
    (id: string | null) =>
      setSub((current) =>
        current.open === id
          ? current
          : // Moving from one submenu's row to another's swaps them in place, without the
            // first shrinking away and the next growing in.
            { open: id, swapped: current.open !== null && id !== null },
      ),
    [],
  );
  const subHost = useMemo(
    () => ({
      // A closing menu's submenus close with it, in the same frame.
      openSub: menu.open ? openSub : null,
      swapped: sub.swapped,
      closing: !menu.open,
      setOpenSub,
    }),
    [openSub, sub.swapped, setOpenSub, menu.open],
  );
  // Rows carry the room their content keeps from the panel's curve (see below).
  const rowPadding = useMemo(() => contentInset(radius), [radius]);
  /** This panel's own rows, not its submenus'. */
  const ownItems = (node: HTMLElement) =>
    [...node.querySelectorAll<HTMLElement>(itemSelector)].filter(
      (item) => item.closest("[data-lg-menu-popup]") === node,
    );
  const progress = useRef({ value: menu.open ? 1 : 0, velocity: 0 });

  if (menu.open && !shown) setShown(true);

  const content = useRef<HTMLDivElement | null>(null);
  const morph = useRef<Morph | null>(null);

  // The panel's glass. A root menu draws it as its morph (the panel and the button melting
  // together), so it has no resting body; a submenu is a plain floating panel.
  const { ref: surfaceRef, surface } = useGlassSurface({
    body: menu.sub,
    floating: true,
    liftable: !menu.sub,
    material,
    tint,
    appearance,
    specular,
    radius,
    smoothing: undefined,
    labelsInGlass: false,
    bleed: undefined,
    overhang: undefined,
    lensHeight: undefined,
  });
  const mergedRef = useMergedRef<HTMLDivElement>(panel, surfaceRef, ref);

  /** Where the panel is, written to its style; also read by the morph. */
  const placed = useRef<Placement | null>(null);
  const place = useCallback(() => {
    const node = panel.current;
    const inner = content.current;
    if (!node || !inner) return;
    const anchorElement = menu.trigger.current;
    const point = menu.sub ? null : menu.point.current;
    let anchor: Rect | null = null;
    if (point) anchor = { x: point.x, y: point.y, width: 0, height: 0 };
    else if (anchorElement) {
      const box = anchorElement.getBoundingClientRect();
      anchor = { x: box.left, y: box.top, width: box.width, height: box.height };
    }
    if (!anchor) return;
    // Its natural size, whatever room it was given last time.
    const chrome = node.offsetHeight - inner.clientHeight;
    const size = { width: node.offsetWidth, height: chrome + inner.scrollHeight };
    const next = placePanel(
      anchor,
      size,
      side,
      point ? "start" : align,
      menu.sub ? offset : point ? 0 : offset,
      menu.sub ? alignOffset - PANEL_INSET : alignOffset,
      menu.sub ? "beside" : "over",
    );
    placed.current = next;
    node.style.left = `${Math.round(next.left)}px`;
    node.style.top = `${Math.round(next.top)}px`;
    node.style.maxHeight = `${Math.floor(next.maxHeight)}px`;
    node.dataset.side = next.side;
    node.style.setProperty("--lg-anchor-width", `${anchor.width}px`);
  }, [menu.sub, menu.trigger, menu.point, side, align, offset, alignOffset]);

  // Placed before it paints, and again whenever the page under it moves or it changes size.
  useLayoutEffect(() => {
    if (!shown) return;
    place();
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, { capture: true, passive: true });
    const observer = new ResizeObserver(again);
    if (content.current) observer.observe(content.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, { capture: true });
      observer.disconnect();
    };
  }, [shown, place]);

  // The root menu: the button morphs into the panel.
  useLayoutEffect(() => {
    if (menu.sub || !shown) return;
    const node = panel.current;
    const trigger = menu.trigger.current;
    const own = surface;
    if (!node || !trigger) return;
    const state = (morph.current ??= createMorph());
    const opening = menu.open;
    const instant = prefersReducedMotion();
    retarget(state, opening, instant);
    const point = menu.point.current;
    const glassTrigger = point === null && trigger.hasAttribute("data-lg-button");
    // The trigger's own glass gives way to the morph's button only once the morph draws: a
    // frame between them would show neither (the flash on opening).
    let frame = 0;
    let last = performance.now();
    let reach = -1;
    const apply = () => {
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const box = node.getBoundingClientRect();
      // What it grows out of, in the panel's px: the button, or the point a context menu is for.
      const button = point
        ? { x: point.x - box.left, y: point.y - box.top, width: 0, height: 0 }
        : rectIn(trigger, node);
      const view = morphFrame(state, {
        panel: { x: 0, y: 0, width, height },
        button,
        growth: glassTrigger ? (pressGrowth.get(trigger) ?? 1) : 1,
        seedless: !glassTrigger,
        side: placed.current?.side ?? side,
        radius,
      });
      // The glass reaches as far as the button lies outside the panel, and the melt past it.
      const needed = Math.ceil(
        Math.max(
          0,
          -button.x,
          -button.y,
          button.x + button.width - width,
          button.y + button.height - height,
        ) +
          view.merge +
          8,
      );
      if (own && needed > reach) {
        reach = needed;
        own.update({ overhang: reach });
      }
      const body = (r: { x: number; y: number; width: number; height: number }, corner: number) => {
        const c = Math.min(corner, r.width / 2, r.height / 2);
        return {
          role: "body" as const,
          rect: r,
          radii: [c, c, c, c] as const,
          lift: 0,
          magnify: 1,
          alpha: 1,
          merge: view.merge,
          tint: null,
          light: 0,
        };
      };
      // Out of a glass button the panel grows from a seed hidden inside it; out of a plain one
      // (a toolbar's) or a point there is nothing to hide it, so it grows from, and shrinks to,
      // nothing.
      const panelShape = body(view.panel, radius);
      if (!glassTrigger) panelShape.alpha = Math.min(1, Math.max(0, view.grown / 0.12));
      const shapes = [panelShape];
      if (glassTrigger) shapes.push(body(view.button, Infinity));
      if (own) {
        own.setShapes(shapes, "morph");
        own.update({ shadowLift: view.lift });
        if (glassTrigger && !trigger.hasAttribute("data-lg-hidden"))
          trigger.setAttribute("data-lg-hidden", "");
      }
      // The panel's DOM is clipped to its glass; its content scales from the edge nearest the
      // button, deblurs and fades in.
      const p = view.panel;
      const corner = Math.min(radius, p.width / 2, p.height / 2);
      // Open, the panel isn't clipped (a submenu beside it would be cut off); nor while a submenu
      // shows during the last of the opening.
      const settled =
        opening && ((view.grown >= 0.97 && view.contentAlpha >= 1) || subShown.current);
      node.style.clipPath = settled
        ? ""
        : `inset(${p.y}px ${width - p.x - p.width}px ${height - p.y - p.height}px ${p.x}px round ${corner}px)`;
      const inner = content.current;
      if (inner) {
        const still =
          Math.abs(view.contentScale - 1) < 1e-3 &&
          Math.abs(view.shift.x) < 0.05 &&
          Math.abs(view.shift.y) < 0.05;
        // At rest the content has no transform: a submenu inside it is placed against the window.
        inner.style.transformOrigin = still ? "" : view.anchorRest;
        inner.style.transform = still
          ? ""
          : `translate(${view.shift.x}px, ${view.shift.y}px) scale(${view.contentScale})`;
        inner.style.opacity = view.contentAlpha >= 1 ? "" : String(view.contentAlpha);
        inner.style.filter = view.blur > 0.05 ? `blur(${(0.58 * view.blur).toFixed(2)}px)` : "";
      }
      if (point) return;
      // The trigger's icon fades as the panel covers it; a glass button's shrinks with it too.
      trigger.style.setProperty("--lg-menu-icon", String(view.iconAlpha));
      if (glassTrigger) {
        const rest = rectIn(trigger, node);
        trigger.style.setProperty("--lg-menu-icon-scale", String(view.buttonScale));
        trigger.style.setProperty(
          "--lg-menu-icon-x",
          `${view.button.x + view.button.width / 2 - (rest.x + rest.width / 2)}px`,
        );
        trigger.style.setProperty(
          "--lg-menu-icon-y",
          `${view.button.y + view.button.height / 2 - (rest.y + rest.height / 2)}px`,
        );
      }
    };
    const finish = () => {
      if (opening) return;
      trigger.removeAttribute("data-lg-hidden");
      for (const name of [
        "--lg-menu-icon",
        "--lg-menu-icon-scale",
        "--lg-menu-icon-x",
        "--lg-menu-icon-y",
      ])
        trigger.style.removeProperty(name);
      own?.update({ shadowLift: 0 });
      setShown(false);
    };
    const tick = (now: number) => {
      const dt = Math.min(0.025, Math.max(0, (now - last) / 1000));
      last = now;
      const moving = stepMorph(state, dt);
      apply();
      // A seedless panel is gone once the close reaches zero: its spring's last ripple would
      // only redraw nothing.
      const gone = !opening && !glassTrigger && state.open.value <= 0;
      if (!moving || gone) {
        finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    apply();
    if (instant) finish();
    else frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open, shown, side, radius, surface]);

  // The trigger shows as it was if the panel goes away mid-morph (unmounted while open).
  useEffect(() => {
    if (menu.sub) return;
    const trigger = menu.trigger.current;
    return () => {
      if (!trigger) return;
      trigger.removeAttribute("data-lg-hidden");
      for (const name of [
        "--lg-menu-icon",
        "--lg-menu-icon-scale",
        "--lg-menu-icon-x",
        "--lg-menu-icon-y",
      ])
        trigger.style.removeProperty(name);
    };
  }, [menu.sub, menu.trigger]);

  // A submenu springs its panel open or closed, writing straight to its style each frame.
  useLayoutEffect(() => {
    if (!menu.sub || !shown) return;
    const node = panel.current;
    if (!node) return;
    const target = menu.open ? 1 : 0;
    const params = menu.open ? OPEN : CLOSE;
    const state = progress.current;
    let frame = 0;
    let last = performance.now();
    const apply = () => {
      const p = state.value;
      const scale = SEED + (1 - SEED) * p;
      // At rest it has no scale: a submenu inside it is placed against the window.
      node.style.scale = Math.abs(scale - 1) < 1e-3 ? "" : `${scale}`;
      node.style.opacity = p >= 1 ? "" : `${Math.min(1, Math.max(0, p * 2.2))}`;
      node.style.setProperty("--lg-menu-content", `${Math.min(1, Math.max(0, (p - 0.45) / 0.45))}`);
    };
    if (prefersReducedMotion() || menu.instant) {
      state.value = target;
      state.velocity = 0;
      apply();
      if (!menu.open) setShown(false);
      return;
    }
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const omega = (2 * Math.PI) / params.response;
      // Small fixed steps keep the spring stable at any frame rate.
      for (let t = 0; t < dt; t += 1 / 480) {
        const h = Math.min(1 / 480, dt - t);
        const accel =
          omega * omega * (target - state.value) - 2 * params.dampingRatio * omega * state.velocity;
        state.velocity += accel * h;
        state.value += state.velocity * h;
      }
      apply();
      const settled = Math.abs(target - state.value) < 0.001 && Math.abs(state.velocity) < 0.01;
      if (settled) {
        state.value = target;
        state.velocity = 0;
        apply();
        if (!menu.open) setShown(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    apply();
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [menu.open, menu.instant, shown]);

  // Focus on open, and close on a press outside.
  useEffect(() => {
    if (!menu.open) return;
    const node = panel.current;
    if (!node) return;
    const items = () => ownItems(node);
    const focus = menu.focusOnOpen.current;
    menu.focusOnOpen.current = null;
    if (focus === "first") {
      const first = items()[0];
      first?.focus({ preventScroll: true });
      if (first) setActive(first);
    } else if (focus === "last") items().at(-1)?.focus({ preventScroll: true });
    else if (focus !== "none") node.focus({ preventScroll: true });
    if (menu.sub) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (node.contains(target)) return;
      // A press on a menu's button toggles it there; on a context menu's region it opens anew.
      if (menu.point.current === null && menu.trigger.current?.contains(target)) return;
      menu.setOpen(false);
    };
    const away = () => {
      if (!document.hasFocus()) menu.setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", away);
    };
  }, [menu]);

  useEffect(() => {
    if (menu.open) return;
    clearTimeout(switching.current);
    switching.current = undefined;
    setActive(null);
    setOpenSub(null);
  }, [menu.open, setOpenSub]);

  if (!shown) return null;

  const moveTo = (target: HTMLElement | undefined) => {
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
    setActive(target);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const node = panel.current;
    if (event.defaultPrevented || !node) return;
    // Keys in a submenu are the submenu's.
    if ((event.target as Element).closest?.("[data-lg-menu-popup]") !== node) return;
    const items = ownItems(node);
    const current = items.findIndex((item) => item === document.activeElement);
    let next: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        next = current < 0 ? 0 : current + 1;
        break;
      case "ArrowUp":
        next = current < 0 ? items.length - 1 : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        menu.setOpen(false, "trigger");
        return;
      case "ArrowLeft":
        if (!menu.sub) return;
        event.preventDefault();
        menu.setOpen(false, "trigger");
        return;
      case "Tab":
        menu.closeAll();
        return;
      default: {
        // Typing a row's first letters moves to it.
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
        const now = performance.now();
        const search = typed.current;
        search.text = (now - search.at > TYPEAHEAD_MS ? "" : search.text) + event.key.toLowerCase();
        search.at = now;
        if (search.text === " ") return;
        const label = (item: HTMLElement) =>
          (item.dataset.lgLabel ?? item.textContent ?? "").trim().toLowerCase();
        const from = Math.max(0, current);
        const order = [...items.slice(from + (search.text.length === 1 ? 1 : 0)), ...items];
        const found = order.find((item) => label(item).startsWith(search.text));
        if (found) {
          event.preventDefault();
          moveTo(found);
        }
        return;
      }
    }
    event.preventDefault();
    moveTo(items[(next + items.length) % items.length]);
  };

  // A submenu grows out of the corner nearest its row; a root menu's morph draws its own growth.
  const origin = (placed.current?.side ?? side) === "left" ? "100% 0%" : "0% 0%";

  return (
    <div
      {...props}
      ref={mergedRef}
      id={menu.popupId}
      role="menu"
      aria-labelledby={menu.triggerId}
      tabIndex={-1}
      data-lg-menu-popup=""
      data-side={side}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 50,
        // While it closes, the panel lets the pointer through to what is beneath.
        pointerEvents: menu.open ? undefined : "none",
        transformOrigin: origin,
        ["--lg-menu-row-padding" as string]: `${rowPadding}px`,
        ...style,
      }}
      onKeyDown={chain(keyDown, onKeyDown)}
      onPointerMove={chain((event: ReactPointerEvent<HTMLDivElement>) => {
        // A closing menu's rows don't answer the pointer: crossing them must not open anything.
        if (!menu.open) return;
        const point = { x: event.clientX, y: event.clientY };
        const previous = lastPoint.current;
        lastPoint.current = point;
        const target = event.target instanceof Element ? event.target : null;
        // Reaching the open submenu keeps it: the pointer was on its way there.
        if (target && target.closest("[data-lg-menu-popup]") !== panel.current) {
          clearTimeout(switching.current);
          switching.current = undefined;
          pending.current = null;
          return;
        }
        const item = target?.closest<HTMLElement>(itemSelector) ?? null;
        if (!item || item === active) {
          // Back on the active row: a switch that was waiting is dropped.
          if (item === active) {
            clearTimeout(switching.current);
            switching.current = undefined;
            pending.current = null;
          }
          return;
        }
        // Already waiting to switch to this row: let the wait run, don't restart it.
        if (pending.current === item) return;
        const go = () => {
          switching.current = undefined;
          pending.current = null;
          if (!openRef.current) return;
          setActive(item);
          item.focus({ preventScroll: true });
          // Moving onto another row closes an open submenu; its own row opens it again.
          if (item.dataset.lgSubmenu !== openSub) setOpenSub(item.dataset.lgSubmenu ?? null);
        };
        clearTimeout(switching.current);
        switching.current = undefined;
        pending.current = null;
        // A safe path: with a submenu open, a row is only held back while the pointer is
        // heading into the submenu (inside the triangle from where it was to the submenu's near
        // edge); moving any other way switches at once.
        const submenu =
          openSub !== null && item.dataset.lgSubmenu !== openSub
            ? panel.current?.querySelector<HTMLElement>(
                `[data-lg-menu-submenu]:has(> [data-lg-submenu="${openSub}"]) > [data-lg-menu-popup]`,
              )
            : null;
        if (submenu && previous && headingInto(previous, point, submenu.getBoundingClientRect())) {
          pending.current = item;
          switching.current = window.setTimeout(go, SWITCH_DELAY);
        } else go();
      }, onPointerMove)}
      onPointerLeave={chain(() => {
        clearTimeout(switching.current);
        switching.current = undefined;
        pending.current = null;
        // The row of an open submenu stays lit while the pointer is in the submenu.
        if (openSub !== null) return;
        setActive(null);
        panel.current?.focus({ preventScroll: true });
      }, onPointerLeave)}
    >
      <SurfaceContext value={surface}>
        <GlassHighlight target={active} tint={active?.dataset.lgTint ?? null} />
        <CurrentRows panel={panel} active={active} />
        <SubHost value={subHost}>
          <div ref={content} data-lg-menu-content="">
            {children}
          </div>
        </SubHost>
      </SurfaceContext>
    </div>
  );
}

/** Rows marked `current` (the page that's open) rest on a pill of their own. */
function CurrentRows({
  panel,
  active,
}: {
  panel: React.RefObject<HTMLDivElement | null>;
  active: HTMLElement | null;
}) {
  const [rows, setRows] = useState<readonly HTMLElement[]>([]);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const read = () => {
      const next = [...node.querySelectorAll<HTMLElement>("[data-lg-menu-current]")].filter(
        (row) => row.closest("[data-lg-menu-popup]") === node,
      );
      setRows((previous) =>
        previous.length === next.length && previous.every((row, i) => row === next[i])
          ? previous
          : next,
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(node, {
      subtree: true,
      childList: true,
      attributeFilter: ["data-lg-menu-current"],
    });
    return () => observer.disconnect();
  }, [panel]);
  return (
    <>
      {rows
        .filter((row) => row !== active)
        .map((row, index) => (
          <GlassHighlight key={index} target={row} tint={row.dataset.lgTint ?? null} />
        ))}
    </>
  );
}

export interface GlassMenuItemProps extends Omit<
  ComponentPropsWithRef<"div">,
  "role" | "onSelect"
> {
  /**
   * Called when the item is chosen; the menu closes after unless it calls `preventDefault` (or
   * `closeOnSelect` is false).
   */
  onSelect?: (event: Event) => void;
  /** Close the menu once the item is chosen. Default: true. */
  closeOnSelect?: boolean;
  disabled?: boolean;
  /** A symbol before the label. */
  icon?: ReactNode;
  /** Text at the end of the row, such as a shortcut. */
  detail?: ReactNode;
  /** A choice among several (`menuitemradio`), an on/off choice (`menuitemcheckbox`), or neither. */
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  /** For a radio or checkbox item: chosen. It shows a tick at the end of the row. */
  checked?: boolean;
  /** The row for what's open now (the current page): it rests on a pill of its own. */
  current?: boolean;
  /** The color of the pill under the row when it is lit, such as a faint red for a destructive row. */
  tint?: string | null;
  /** The text typing a row's first letters matches. Default: the row's text. */
  label?: string;
  /** Render this element as the row (a link), with the item's props merged into it. */
  render?: ReactElement;
}

/** One row of the menu. */
export function GlassMenuItem({
  onSelect,
  closeOnSelect = true,
  disabled = false,
  icon,
  detail,
  role = "menuitem",
  checked,
  current,
  tint,
  label,
  render,
  children,
  onClick,
  onKeyDown,
  ref,
  ...props
}: GlassMenuItemProps) {
  const menu = useMenu("GlassMenuItem");
  const row = useRef<HTMLElement | null>(null);
  const mergedRef = useMergedRef<HTMLElement>(row, ref);
  const choose = () => {
    if (disabled) return;
    const event = new Event("select", { cancelable: true });
    onSelect?.(event);
    if (closeOnSelect && !event.defaultPrevented) menu.closeAll();
  };
  const own = {
    role,
    tabIndex: -1,
    "aria-checked": role === "menuitem" ? undefined : (checked ?? false),
    "aria-disabled": disabled || undefined,
    "aria-current": current ? ("page" as const) : undefined,
    "data-lg-menu-item": "",
    "data-lg-menu-current": current ? "" : undefined,
    "data-lg-tint": tint ?? undefined,
    "data-lg-label": label,
    onClick: chain((event: MouseEvent<HTMLElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      choose();
    }, onClick),
    onKeyDown: chain((event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        // A link row follows its link as a click would.
        if (render) row.current?.click();
        else choose();
      }
    }, onKeyDown),
  };
  const inner = (
    <>
      {icon !== undefined && (
        <span data-lg-menu-icon="" aria-hidden="true">
          {icon}
        </span>
      )}
      <span data-lg-menu-label="">{children}</span>
      {detail !== undefined && <span data-lg-menu-detail="">{detail}</span>}
      {role !== "menuitem" && (
        <svg data-lg-menu-check="" viewBox="0 0 24 24" aria-hidden="true">
          {checked && <path d="M5 14L8.5 17.5L19 6.5" />}
        </svg>
      )}
    </>
  );
  if (render && isValidElement(render))
    return cloneElement(
      asAny(render),
      { ...mergeProps(propsOf(render), { ...props, ...own }), ref: mergedRef },
      inner,
    );
  return (
    <div {...props} {...own} ref={mergedRef}>
      {inner}
    </div>
  );
}

/** A small title over a group of items. */
export function GlassMenuHeading(props: ComponentPropsWithRef<"div">) {
  return <div role="presentation" data-lg-menu-heading="" {...props} />;
}

/** A rule between groups of items. */
export function GlassMenuSeparator(props: ComponentPropsWithRef<"div">) {
  return <div role="separator" data-lg-menu-separator="" {...props} />;
}

export interface GlassMenuSubmenuProps extends ComponentPropsWithRef<"div"> {
  /** Called when the submenu opens or closes. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * A row that opens a menu beside it: a `GlassMenuSubmenuTrigger` and a `GlassMenuSubmenuPopup`,
 * inside this wrapper. It opens when the pointer rests on the row, on a click, or with Right
 * arrow or Enter; Left arrow or Escape closes it. Choosing one of its items closes every menu.
 */
export function GlassMenuSubmenu({ onOpenChange, children, ...props }: GlassMenuSubmenuProps) {
  const parent = useMenu("GlassMenuSubmenu");
  const host = useContext(SubHost);
  const id = useId();
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const trigger = useRef<HTMLElement | null>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const focusOnOpen = useRef<FocusOnOpen | null>(null);
  const open = host?.openSub === id;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    changed.current?.(open);
  }, [open]);
  const setOpen = useCallback(
    (next: boolean, focus?: FocusOnOpen | "trigger") => {
      if (next) focusOnOpen.current = focus === "trigger" ? null : (focus ?? "none");
      else if (focus === "trigger") trigger.current?.focus();
      host?.setOpenSub(next ? id : null);
    },
    [host, id],
  );
  const context = useMemo<MenuContext>(
    () => ({
      open,
      setOpen,
      closeAll: parent.closeAll,
      sub: true,
      instant: (host?.swapped ?? false) || (host?.closing ?? false),
      triggerId: `${id}-trigger`,
      popupId: `${id}-popup`,
      trigger,
      point,
      focusOnOpen,
    }),
    [open, setOpen, parent.closeAll, host?.swapped, host?.closing, id],
  );
  return (
    <div data-lg-menu-submenu="" {...props}>
      <Context value={context}>{children}</Context>
    </div>
  );
}

export interface GlassMenuSubmenuTriggerProps extends Omit<
  GlassMenuItemProps,
  "onSelect" | "role" | "closeOnSelect" | "checked" | "render"
> {}

/** The row that opens a submenu: its label, the value it holds (`detail`) and a chevron. */
export function GlassMenuSubmenuTrigger({
  icon,
  detail,
  disabled = false,
  tint,
  label,
  current,
  children,
  ref,
  onClick,
  onKeyDown,
  ...props
}: GlassMenuSubmenuTriggerProps) {
  const menu = useMenu("GlassMenuSubmenuTrigger");
  const mergedRef = useMergedRef<HTMLDivElement>(
    menu.trigger as React.RefObject<HTMLDivElement | null>,
    ref,
  );
  const sub = menu.popupId.slice(0, -"-popup".length);
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-haspopup="menu"
      aria-expanded={menu.open}
      aria-controls={menu.open ? menu.popupId : undefined}
      aria-disabled={disabled || undefined}
      id={menu.triggerId}
      data-lg-menu-item=""
      data-lg-menu-subtrigger=""
      data-lg-submenu={sub}
      data-lg-menu-open={menu.open ? "" : undefined}
      data-lg-menu-current={current ? "" : undefined}
      data-lg-tint={tint ?? undefined}
      data-lg-label={label}
      {...props}
      ref={mergedRef}
      onClick={chain(() => {
        if (!disabled) menu.setOpen(!menu.open, "none");
      }, onClick)}
      onKeyDown={chain((event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          menu.setOpen(true, "first");
        }
      }, onKeyDown)}
    >
      {icon !== undefined && (
        <span data-lg-menu-icon="" aria-hidden="true">
          {icon}
        </span>
      )}
      <span data-lg-menu-label="">{children}</span>
      {detail !== undefined && <span data-lg-menu-detail="">{detail}</span>}
      <svg data-lg-menu-chevron="" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6L15 12L9 18" />
      </svg>
    </div>
  );
}

export interface GlassMenuSubmenuPopupProps extends Omit<
  GlassMenuPopupProps,
  "align" | "container"
> {
  /** Which side of its row it opens on; it moves to the other when there's no room. Default: "right". */
  side?: "left" | "right";
}

/** The submenu's panel, beside its row, its first row level with it. */
export function GlassMenuSubmenuPopup({
  side = "right",
  offset = 10,
  ...props
}: GlassMenuSubmenuPopupProps) {
  return <GlassMenuPopup side={side} align="start" offset={offset} {...props} />;
}

// ---------------------------------------------------------------------------------------------
// The morph: every value from springs
// solved in closed form, so it is exact at any frame rate and can be interrupted anywhere.
// ---------------------------------------------------------------------------------------------

interface Spring {
  value: number;
  velocity: number;
  target: number;
  dampingRatio: number;
  response: number;
}

const spring = (value: number): Spring => ({
  value,
  velocity: 0,
  target: value,
  dampingRatio: 1,
  response: 0.3,
});

/** Retarget, keeping the value and (unless given) the velocity. */
function aim(
  s: Spring,
  target: number,
  params: { dampingRatio: number; response: number },
  velocity?: number,
) {
  s.target = target;
  s.dampingRatio = params.dampingRatio;
  s.response = params.response;
  if (velocity !== undefined) s.velocity = velocity;
}

/** Advance by `dt` seconds with the exact solution; returns whether it is still moving. */
function advance(s: Spring, dt: number): boolean {
  const x0 = s.value - s.target;
  const v0 = s.velocity;
  if (Math.abs(x0) < 1e-4 && Math.abs(v0) < 1e-3) {
    s.value = s.target;
    s.velocity = 0;
    return false;
  }
  const w = (2 * Math.PI) / s.response;
  const z = s.dampingRatio;
  let x: number;
  let v: number;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w * dt);
    const c = x0;
    const k = (v0 + z * w * c) / wd;
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    x = e * (c * cos + k * sin);
    v = e * (-z * w * (c * cos + k * sin) + (-c * wd * sin + k * wd * cos));
  } else {
    const e = Math.exp(-w * dt);
    const b = v0 + w * x0;
    x = (x0 + b * dt) * e;
    v = (b - w * (x0 + b * dt)) * e;
  }
  s.value = s.target + x;
  s.velocity = v;
  return true;
}

const OPEN_SPRING = { dampingRatio: 0.75, response: 0.35 };
const CLOSE_SPRING = { dampingRatio: 0.8, response: 0.49 };
const TRAVEL_OPEN = { dampingRatio: 1, response: 0.2 };
const KICK_OPEN = { dampingRatio: 0.64, response: 0.38 };
const KICK_CLOSE = { dampingRatio: 0.81, response: 0.335 };
const CONTENT_SCALE = { dampingRatio: 0.75, response: 0.61 };
/** The panel's push away from the button as it opens, per unit of their distance per second. */
const KICK_VELOCITY = 7;
/** The button shrinks to this, travelling this share of the way to the panel's centre. */
const BUTTON_END = 0.25;
const TRAVEL_SHARE = 0.25;
/** The panel starts as a circle this share of the button's size (18 on a 56 pt button). */
const SEED_SHARE = 18 / 56;
const CONTENT_FROM = 1.305;
const CONTENT_BLUR = 4;
/** Closing, the content is gone once the progress has dropped by this much. */
const CLOSE_GONE = 0.2;

interface Morph {
  readonly open: Spring;
  readonly travel: Spring;
  readonly kick: Spring;
  readonly scale: Spring;
  heading: { toward: "open" | "closed"; p0: number; a0: number };
  alpha: number;
}

function createMorph(): Morph {
  return {
    open: spring(0),
    travel: spring(0),
    kick: spring(0),
    scale: spring(CONTENT_FROM),
    heading: { toward: "open", p0: 0, a0: 0 },
    alpha: 0,
  };
}

function retarget(m: Morph, opening: boolean, instant: boolean) {
  m.heading = {
    toward: opening ? "open" : "closed",
    p0: Math.min(1, Math.max(0, m.open.value)),
    a0: m.alpha,
  };
  if (instant) {
    for (const s of [m.open, m.travel]) {
      s.value = s.target = opening ? 1 : 0;
      s.velocity = 0;
    }
    m.kick.value = m.kick.target = m.kick.velocity = 0;
    m.scale.value = m.scale.target = 1;
    m.scale.velocity = 0;
    return;
  }
  if (opening) {
    aim(m.open, 1, OPEN_SPRING);
    aim(m.travel, 1, TRAVEL_OPEN);
    aim(m.kick, 0, KICK_OPEN, KICK_VELOCITY);
    m.scale.value = m.alpha > 0 ? Math.min(CONTENT_FROM, m.scale.value) : CONTENT_FROM;
    aim(m.scale, 1, CONTENT_SCALE);
  } else {
    aim(m.open, 0, CLOSE_SPRING);
    aim(m.travel, 0, CLOSE_SPRING);
    aim(m.kick, 0, KICK_CLOSE);
  }
}

function stepMorph(m: Morph, dt: number): boolean {
  let moving = false;
  for (const s of [m.open, m.travel, m.kick, m.scale]) moving = advance(s, dt) || moving;
  return moving;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** One frame: the panel and button rects (the menu's px), and the content's transform. */
function morphFrame(
  m: Morph,
  at: {
    panel: Rect;
    button: Rect;
    /** The button's press growth now (it keeps falling, with its bounce, as the menu opens). */
    growth: number;
    /** No glass button to hide a seed in: the panel grows from a point. */
    seedless: boolean;
    side: "top" | "bottom" | "left" | "right";
    radius: number;
  },
) {
  const P = at.panel;
  const B = at.button;
  const pc = { x: P.x + P.width / 2, y: P.y + P.height / 2 };
  const bc = { x: B.x + B.width / 2, y: B.y + B.height / 2 };
  const a = { x: Math.sign(pc.x - bc.x) || 1, y: Math.sign(pc.y - bc.y) || 1 };
  const near = { x: pc.x - (a.x * P.width) / 2, y: pc.y - (a.y * P.height) / 2 };
  const h = Math.max(0, m.open.value);
  const g = Math.min(1, h);
  const d = clamp01(m.open.value);
  // A glass button travels a quarter of the way into the panel as it shrinks; a plain trigger
  // stays put, and the panel grows from (and shrinks back into) its centre.
  const travel = at.seedless ? 0 : TRAVEL_SHARE * m.travel.value;
  const v = { x: (pc.x - bc.x) * travel, y: (pc.y - bc.y) * travel };
  const seed = at.seedless ? 0 : SEED_SHARE * Math.min(B.width, B.height);
  const width = lerp(seed, P.width, h);
  const height = (width / Math.max(P.width, 1)) * lerp(P.width, P.height, h);
  const nx = lerp(bc.x + v.x - (a.x * seed) / 2, near.x, h);
  const ny = lerp(bc.y + v.y - (a.y * seed) / 2, near.y, h);
  const vertical = at.side === "top" || at.side === "bottom";
  const kick = {
    x: vertical ? 0 : m.kick.value * (pc.x - bc.x),
    y: vertical ? m.kick.value * (pc.y - bc.y) : 0,
  };
  const cx = nx + (a.x * width) / 2 + kick.x;
  const cy = ny + (a.y * height) / 2 + kick.y;
  const scale = at.growth * lerp(1, BUTTON_END, g);
  // The melt between button and panel: 24 px for a 56 px button, in proportion to this one, and only once the panel has started to grow. At rest the seed sits inside the button,
  // and a full-size melt would inflate a small button (it then shrank back when the morph ended).
  const merge = 24 * (Math.min(B.width, B.height) / 56) * clamp01(h / 0.15);
  const bw = B.width * scale;
  const bh = B.height * scale;

  const heading = m.heading;
  const alpha =
    heading.toward === "open"
      ? heading.p0 >= 1
        ? 1
        : lerp(heading.a0, 1, clamp01((d - heading.p0) / (1 - heading.p0)))
      : heading.a0 * (1 - clamp01((heading.p0 - d) / CLOSE_GONE));
  m.alpha = alpha;

  const anchorNow = { x: cx, y: cy - (a.y * height) / 2 };
  const anchorRest = { x: P.x + P.width / 2, y: a.y > 0 ? P.y : P.y + P.height };
  return {
    panel: { x: cx - width / 2, y: cy - height / 2, width, height },
    button: { x: bc.x + v.x - bw / 2, y: bc.y + v.y - bh / 2, width: bw, height: bh },
    buttonScale: scale,
    merge,
    grown: h,
    iconAlpha: 1 - g,
    lift: g,
    contentAlpha: alpha,
    contentScale: m.scale.value,
    blur: CONTENT_BLUR * (1 - d),
    shift: { x: anchorNow.x - anchorRest.x, y: anchorNow.y - anchorRest.y },
    anchorRest: `50% ${a.y > 0 ? "0%" : "100%"}`,
  };
}
