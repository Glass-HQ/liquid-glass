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
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import type { Appearance, MaterialKind, Rect } from "../protocol";
import type { GlassSurfaceHandle } from "../scene/scene";
import { GlassButton } from "./button";
import type { GlassButtonProps } from "./button";
import { GlassGroup } from "./group";
import { GlassHighlight } from "./highlight";
import { GlassSurface, mergeProps } from "./surface";
import {
  chain,
  prefersReducedMotion,
  useControllable,
  pressGrowth,
  rectIn,
  useGlassSurfaceContext,
  useMergedRef,
} from "./hooks";

/**
 * The menu opens and closes on springs: it grows out of its button, overshooting a touch, and its rows fade in once it
 * is most of the way open.
 */
const OPEN = { dampingRatio: 0.75, response: 0.35 };
const CLOSE = { dampingRatio: 0.8, response: 0.49 };
/** Where the panel starts growing from: this share of its size. */
const SEED = 0.4;

type FocusOnOpen = "first" | "last" | "panel" | "none";

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
  readonly trigger: React.RefObject<HTMLElement | null>;
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
  if (!context) throw new Error(`${part} must be inside a GlassMenu.`);
  return context;
};

export interface GlassMenuProps extends ComponentPropsWithRef<"div"> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** A menu: a `GlassMenuTrigger` and a `GlassMenuPopup` of items, inside this wrapper. */
export function GlassMenu({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  style,
  children,
  ...props
}: GlassMenuProps) {
  const [open, setOpenState] = useControllable(openProp, defaultOpen, onOpenChange);
  const trigger = useRef<HTMLElement | null>(null);
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
      focusOnOpen,
    }),
    [open, setOpen, id],
  );
  // The button and its panel are one piece of glass while it opens: they melt together.
  return (
    <GlassGroup
      liftable
      // Its icon and rows animate in the DOM (fade, scale, blur) every frame; drawn into the
      // glass they would follow only when the page is next captured, seconds late.
      labelsInGlass={false}
      data-lg-menu=""
      {...props}
      style={{ position: "relative", display: "inline-block", ...style }}
    >
      <Context value={context}>{children}</Context>
    </GlassGroup>
  );
}

export interface GlassMenuTriggerProps extends GlassButtonProps {
  /**
   * Render this element as the trigger instead of a `GlassButton` (a `GlassToolbarButton` in a
   * toolbar), with the trigger's props merged into it.
   */
  render?: ReactElement<Record<string, unknown>>;
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
    onClick: chain((event: MouseEvent<HTMLButtonElement>) => {
      if (event.defaultPrevented) return;
      menu.setOpen(!menu.open, event.detail === 0 ? "first" : "panel");
    }, onClick),
    onKeyDown: chain((event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        menu.setOpen(true, event.key === "ArrowDown" ? "first" : "last");
      }
    }, onKeyDown),
  };
  if (render && isValidElement(render)) {
    const { children, ...rest } = props;
    return cloneElement(
      render,
      { ...mergeProps(render.props, { ...rest, ...own }), ref: mergedRef },
      children ?? (render.props.children as ReactNode),
    );
  }
  return <GlassButton {...props} {...own} ref={mergedRef} />;
}

export interface GlassMenuPopupProps extends Omit<ComponentPropsWithRef<"div">, "role"> {
  /** Which side of the trigger it opens on. Default: "bottom". */
  side?: "top" | "bottom" | "left" | "right";
  /** How it lines up with the trigger. Default: "start". */
  align?: "start" | "center" | "end";
  /**
   * How far the panel sits past its trigger, px. Default: 0: like iOS, the panel opens over its
   * button (its top edge on the button's top edge when it opens down), and the button morphs
   * into it.
   */
  offset?: number;
  material?: MaterialKind;
  tint?: string | null;
  appearance?: Appearance;
  /** The panel's corners. Default: 28. */
  radius?: number;
  /** Highlights that follow the pointer (or device tilt). Default: the scene's. */
  specular?: boolean;
}

const itemSelector = "[data-lg-menu-item]:not([aria-disabled=true])";

/** How long a row crossed on the way to an open submenu waits before taking over, ms. */
const SWITCH_DELAY = 150;

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

/**
 * The menu's panel: floating glass that grows out of the trigger, with a glass pill under the
 * row the pointer or keyboard is on. Closes on Escape, a click outside, Tab or a chosen item.
 */
export function GlassMenuPopup({
  side = "bottom",
  align = "start",
  offset = 0,
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
}: GlassMenuPopupProps) {
  const menu = useMenu("GlassMenuPopup");
  const panel = useRef<HTMLDivElement | null>(null);
  const mergedRef = useMergedRef<HTMLDivElement>(panel, ref);
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

  const group = useGlassSurfaceContext();
  const content = useRef<HTMLDivElement | null>(null);
  const morph = useRef<Morph | null>(null);
  /** The panel's own glass handle (in the menu's group), reported by `SurfaceGrab` below. */
  const popupSurface = useRef<GlassSurfaceHandle | null>(null);

  // The root menu: the button morphs into the panel.
  useLayoutEffect(() => {
    if (menu.sub || !shown) return;
    const node = panel.current;
    const trigger = menu.trigger.current;
    const host = group?.element;
    if (!node || !trigger || !host) return;
    const state = (morph.current ??= createMorph());
    const opening = menu.open;
    const instant = prefersReducedMotion();
    retarget(state, opening, instant);
    const glassTrigger = trigger.hasAttribute("data-lg-button");
    // The trigger's own glass gives way to the morph's button only once the morph draws: a
    // frame between them would show neither (the flash on opening).
    let frame = 0;
    let last = performance.now();
    const apply = () => {
      // Where the panel really is (a centred one is moved by its own translate), in the menu's px.
      const at = rectIn(node, host);
      const view = morphFrame(state, {
        panel: { x: at.x, y: at.y, width: node.offsetWidth, height: node.offsetHeight },
        button: rectIn(trigger, host),
        growth: glassTrigger ? (pressGrowth.get(trigger) ?? 1) : 1,
        seedless: !glassTrigger,
        side,
        radius,
      });
      // The glass: the panel and the shrinking button, two shapes that melt together.
      const local = (r: { x: number; y: number; width: number; height: number }) => ({
        ...r,
        x: r.x - at.x,
        y: r.y - at.y,
      });
      const body = (r: { x: number; y: number; width: number; height: number }, corner: number) => {
        const c = Math.min(corner, r.width / 2, r.height / 2);
        return {
          role: "body" as const,
          rect: local(r),
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
      // (a toolbar's) there is nothing to hide it, so it grows from, and shrinks to, nothing.
      const panelShape = body(view.panel, radius);
      if (!glassTrigger) panelShape.alpha = Math.min(1, Math.max(0, view.grown / 0.12));
      const shapes = [panelShape];
      if (glassTrigger) shapes.push(body(view.button, Infinity));
      const own = popupSurface.current;
      if (own) {
        own.setShapes(shapes, "morph");
        if (glassTrigger && !trigger.hasAttribute("data-lg-group-hidden"))
          trigger.setAttribute("data-lg-group-hidden", "");
      }
      group?.update({ shadowLift: view.lift });
      // The panel's DOM is clipped to its glass; its content scales from the edge nearest the
      // button, deblurs and fades in.
      const p = local(view.panel);
      const corner = Math.min(radius, p.width / 2, p.height / 2);
      // Open, the panel isn't clipped (a submenu beside it would be cut off); nor while a submenu
      // shows during the last of the opening.
      const settled =
        opening && ((view.grown >= 0.97 && view.contentAlpha >= 1) || subShown.current);
      node.style.clipPath = settled
        ? ""
        : `inset(${p.y}px ${node.offsetWidth - p.x - p.width}px ${node.offsetHeight - p.y - p.height}px ${p.x}px round ${corner}px)`;
      const inner = content.current;
      if (inner) {
        inner.style.transformOrigin = view.anchorRest;
        inner.style.transform = `translate(${view.shift.x}px, ${view.shift.y}px) scale(${view.contentScale})`;
        inner.style.opacity = String(view.contentAlpha);
        inner.style.filter = view.blur > 0.05 ? `blur(${(0.58 * view.blur).toFixed(2)}px)` : "";
      }
      // The trigger's icon fades as the panel covers it; a glass button's shrinks with it too.
      trigger.style.setProperty("--lg-menu-icon", String(view.iconAlpha));
      if (glassTrigger) {
        const rest = rectIn(trigger, host);
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
      trigger.removeAttribute("data-lg-group-hidden");
      for (const name of [
        "--lg-menu-icon",
        "--lg-menu-icon-scale",
        "--lg-menu-icon-x",
        "--lg-menu-icon-y",
      ])
        trigger.style.removeProperty(name);
      group?.update({ shadowLift: 0 });
      setShown(false);
    };
    const tick = (now: number) => {
      const dt = Math.min(0.025, Math.max(0, (now - last) / 1000));
      last = now;
      const moving = stepMorph(state, dt);
      apply();
      // A plain trigger's panel is gone once the close reaches zero: its spring's last ripple
      // would only redraw nothing.
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
  }, [menu.open, shown, side, radius, group]);

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
      node.style.scale = `${scale}`;
      node.style.opacity = `${Math.min(1, Math.max(0, p * 2.2))}`;
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
      first?.focus();
      if (first) setActive(first);
    } else if (focus === "last") items().at(-1)?.focus();
    else if (focus !== "none") node.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (node.contains(target) || menu.trigger.current?.contains(target)) return;
      menu.setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [menu]);

  useEffect(() => {
    if (menu.open) return;
    clearTimeout(switching.current);
    switching.current = undefined;
    setActive(null);
    setOpenSub(null);
  }, [menu.open, setOpenSub]);

  if (!shown) return null;

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const node = panel.current;
    if (event.defaultPrevented || !node) return;
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
        menu.setOpen(false, "trigger");
        return;
      case "ArrowLeft":
        if (!menu.sub) return;
        event.preventDefault();
        menu.setOpen(false, "trigger");
        return;
      case "Tab":
        menu.setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    const target = items[(next + items.length) % items.length];
    if (target) {
      target.focus();
      setActive(target);
    }
  };

  const vertical = side === "top" || side === "bottom";
  // Along the side the panel opens on: where it lines up with the trigger.
  const along: CSSProperties = vertical
    ? align === "start"
      ? { insetInlineStart: 0 }
      : align === "end"
        ? { insetInlineEnd: 0 }
        : { left: "50%", translate: "-50% 0" }
    : align === "start"
      ? { top: 0 }
      : align === "end"
        ? { bottom: 0 }
        : { top: "50%", translate: "0 -50%" };
  // A submenu opens beside its row; the root menu over its button, which morphs into it.
  const gap = menu.sub ? `calc(100% + ${offset}px)` : `${offset}px`;
  const away: CSSProperties =
    side === "bottom"
      ? { top: gap }
      : side === "top"
        ? { bottom: gap }
        : side === "left"
          ? { right: gap }
          : { left: gap };
  // It grows out of the corner (or edge middle) nearest the trigger.
  const alignShare = align === "start" ? "0%" : align === "end" ? "100%" : "50%";
  const origin = vertical
    ? `${alignShare} ${side === "bottom" ? "0%" : "100%"}`
    : `${side === "right" ? "0%" : "100%"} ${alignShare}`;

  return (
    <GlassSurface
      floating
      material={material}
      tint={tint}
      appearance={appearance}
      radius={radius}
      specular={specular}
      {...props}
      ref={mergedRef}
      id={menu.popupId}
      role="menu"
      aria-labelledby={menu.triggerId}
      tabIndex={-1}
      data-lg-menu-popup=""
      // The root panel's glass is drawn by its morph, not as a resting box.
      data-lg-group-shaped={menu.sub ? undefined : ""}
      data-side={side}
      style={{
        position: "absolute",
        zIndex: 50,
        // While it closes, the panel lets the pointer through to what is beneath.
        pointerEvents: menu.open ? undefined : "none",
        transformOrigin: origin,
        ["--lg-menu-row-padding" as string]: `${rowPadding}px`,
        ...along,
        ...away,
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
                `[data-lg-submenu="${openSub}"] + [data-lg-menu-popup], [data-lg-menu-submenu]:has(> [data-lg-submenu="${openSub}"]) > [data-lg-menu-popup]`,
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
      <GlassHighlight target={active} />
      {!menu.sub && <SurfaceGrab into={popupSurface} />}
      <SubHost value={subHost}>
        {menu.sub ? (
          children
        ) : (
          <div ref={content} data-lg-menu-content="">
            {children}
          </div>
        )}
      </SubHost>
    </GlassSurface>
  );
}

export interface GlassMenuItemProps extends Omit<
  ComponentPropsWithRef<"div">,
  "role" | "onSelect"
> {
  /** Called when the item is chosen; the menu closes after unless it calls `preventDefault`. */
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  /** A symbol before the label. */
  icon?: ReactNode;
  /** Text at the end of the row, such as a shortcut. */
  detail?: ReactNode;
  /** A choice among several (`menuitemradio`, with `aria-checked`) or a plain item. */
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  /** For a radio or checkbox item: chosen. It shows a tick at the end of the row. */
  checked?: boolean;
}

/** One row of the menu. */
export function GlassMenuItem({
  onSelect,
  disabled = false,
  icon,
  detail,
  role = "menuitem",
  checked,
  children,
  onClick,
  onKeyDown,
  ...props
}: GlassMenuItemProps) {
  const menu = useMenu("GlassMenuItem");
  const choose = () => {
    if (disabled) return;
    const event = new Event("select", { cancelable: true });
    onSelect?.(event);
    if (!event.defaultPrevented) menu.closeAll();
  };
  return (
    <div
      role={role}
      tabIndex={-1}
      aria-checked={role === "menuitem" ? undefined : (checked ?? false)}
      aria-disabled={disabled || undefined}
      data-lg-menu-item=""
      {...props}
      onClick={chain(() => choose(), onClick)}
      onKeyDown={chain((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
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
      {role !== "menuitem" && (
        <svg data-lg-menu-check="" viewBox="0 0 24 24" aria-hidden="true">
          {checked && <path d="M5 14L8.5 17.5L19 6.5" />}
        </svg>
      )}
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

export interface GlassMenuSubmenuProps extends ComponentPropsWithRef<"div"> {}

/**
 * A row that opens a menu beside it: a `GlassMenuSubmenuTrigger` and a `GlassMenuSubmenuPopup`,
 * inside this wrapper. It opens when the pointer rests on the row, on a click, or with Right
 * arrow or Enter; Left arrow or Escape closes it. Choosing one of its items closes every menu.
 */
export function GlassMenuSubmenu({ style, children, ...props }: GlassMenuSubmenuProps) {
  const parent = useMenu("GlassMenuSubmenu");
  const host = useContext(SubHost);
  const id = useId();
  const trigger = useRef<HTMLElement | null>(null);
  const focusOnOpen = useRef<FocusOnOpen | null>(null);
  const open = host?.openSub === id;
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
      focusOnOpen,
    }),
    [open, setOpen, parent.closeAll, host?.swapped, host?.closing, id],
  );
  return (
    <div data-lg-menu-submenu="" {...props} style={{ position: "relative", ...style }}>
      <Context value={context}>{children}</Context>
    </div>
  );
}

export interface GlassMenuSubmenuTriggerProps extends Omit<
  GlassMenuItemProps,
  "onSelect" | "role"
> {}

/** The row that opens a submenu: its label, the value it holds (`detail`) and a chevron. */
export function GlassMenuSubmenuTrigger({
  icon,
  detail,
  disabled = false,
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

export interface GlassMenuSubmenuPopupProps extends Omit<GlassMenuPopupProps, "align"> {
  /** Which side of its row it opens on. Default: "right". */
  side?: "left" | "right";
}

/** The submenu's panel, beside its row, its first row level with it. */
export function GlassMenuSubmenuPopup({
  side = "right",
  offset = 10,
  style,
  ...props
}: GlassMenuSubmenuPopupProps) {
  // Level with the row: the panel's own inset above its first row.
  return (
    <GlassMenuPopup
      side={side}
      align="start"
      offset={offset}
      style={{ top: -4, ...style }}
      {...props}
    />
  );
}

/** Reports the surface it renders in (the panel's) into a ref. */
function SurfaceGrab({ into }: { into: React.RefObject<GlassSurfaceHandle | null> }) {
  const surface = useGlassSurfaceContext();
  useLayoutEffect(() => {
    into.current = surface;
    return () => {
      into.current = null;
    };
  }, [surface, into]);
  return null;
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
