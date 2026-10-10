import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CSSProperties, ComponentPropsWithRef, Ref } from "react";
import { Menu } from "@base-ui/react/menu";
import { useRender } from "@base-ui/react/use-render";
import { prepareSubmenuHandoff } from "../dom/morph.js";
import type { MaterialOptions } from "../core/materials.js";
import { useMergedRef } from "./merged-ref.js";
import { GlassShape } from "./shape.js";
import { useScene } from "./scene.js";
import { GlassSurface } from "./surface.js";
import type { GlassMotionProps } from "./surface.js";
/** Triggers registered by a menu or submenu. Root menus anchor to a stable
 * wrapper so the trigger's own press motion never moves the popup. */
interface MenuTriggers {
  triggers: Map<HTMLElement, HTMLElement | null>;
  stable: boolean;
}
const MenuTriggersContext = createContext<MenuTriggers | null>(null);
function useMenuTriggers(stable: boolean): MenuTriggers {
  const [registry] = useState(() => ({ triggers: new Map<HTMLElement, HTMLElement | null>(), stable }));
  return registry;
}
function useRegisterTrigger(anchor: (element: HTMLElement) => HTMLElement | null) {
  const registry = useContext(MenuTriggersContext);
  const [resolve] = useState(() => anchor);
  return useCallback((element: HTMLElement | null) => {
    if (!element || !registry) return;
    registry.triggers.set(element, resolve(element));
    return () => { registry.triggers.delete(element); };
  }, [registry, resolve]);
}

export function GlassMenu<Payload>(props: Menu.Root.Props<Payload>) {
  const triggers = useMenuTriggers(true);
  return <MenuTriggersContext.Provider value={triggers}><Menu.Root {...props} /></MenuTriggersContext.Provider>;
}

export function GlassMenuTrigger<Payload>({ ref, ...props }: Menu.Trigger.Props<Payload> & { ref?: Ref<HTMLElement> }) {
  const attach = useRegisterTrigger((element) => element.parentElement);
  const trigger = useRender({ render: <Menu.Trigger {...props} />, ref: [attach, ref ?? null] });
  // The semantic button keeps its shared animation; placement uses its fixed layout box.
  return <span className="lg-menu-anchor">{trigger}</span>;
}

export function GlassMenuSubmenu(props: Menu.SubmenuRoot.Props) {
  // Submenus anchor to their own item, which never moves independently.
  const triggers = useMenuTriggers(false);
  return <MenuTriggersContext.Provider value={triggers}><Menu.SubmenuRoot {...props} /></MenuTriggersContext.Provider>;
}

export function GlassMenuSubmenuTrigger({ ref, delay = 40, onPointerEnter, onPointerLeave, onFocus, onBlur, ...props }: ComponentPropsWithRef<typeof Menu.SubmenuTrigger>) {
  const attach = useRegisterTrigger(() => null);
  const release = useRef<(() => void) | undefined>(undefined);
  const reserve = (element: HTMLElement) => {
    release.current?.();
    release.current = prepareSubmenuHandoff(element);
  };
  const clear = () => { release.current?.(); release.current = undefined; };
  useEffect(() => clear, []);
  // A submenu should be there the moment the pointer rests on its item; Base
  // UI's safe polygon still lets the pointer cross to it diagonally.
  return <GlassShape ref={useMergedRef(attach, ref)} concentric={{ contentPadding: 8 }} render={<Menu.SubmenuTrigger delay={delay} {...props}
    onPointerEnter={(event) => { onPointerEnter?.(event); if (!event.defaultPrevented && !props.disabled) reserve(event.currentTarget); }}
    onPointerLeave={(event) => { onPointerLeave?.(event); clear(); }}
    onFocus={(event) => { onFocus?.(event); if (!event.defaultPrevented && !props.disabled) reserve(event.currentTarget); }}
    onBlur={(event) => { onBlur?.(event); clear(); }}
  />} />;
}
export const GlassMenuGroup = Menu.Group;
export function GlassMenuGroupLabel(props: ComponentPropsWithRef<typeof Menu.GroupLabel>) {
  return <GlassShape concentric={{ contentPadding: 8 }} render={<Menu.GroupLabel {...props} />} />;
}
export const GlassMenuSeparator = Menu.Separator;
export function GlassMenuCheckboxItem(props: ComponentPropsWithRef<typeof Menu.CheckboxItem>) {
  return <GlassShape concentric={{ contentPadding: 8 }} render={<Menu.CheckboxItem {...props} />} />;
}
export const GlassMenuRadioGroup = Menu.RadioGroup;
export function GlassMenuRadioItem(props: ComponentPropsWithRef<typeof Menu.RadioItem>) {
  return <GlassShape concentric={{ contentPadding: 8 }} render={<Menu.RadioItem {...props} />} />;
}
type GlassMenuPositioningProps = Pick<
  ComponentPropsWithRef<typeof Menu.Positioner>,
  "side" | "align" | "sideOffset" | "alignOffset" | "collisionAvoidance"
>;

export interface GlassMenuContentProps
  extends
    GlassMenuPositioningProps,
    Omit<ComponentPropsWithRef<typeof Menu.Popup>, "className" | "style">,
    MaterialOptions,
    Pick<GlassMotionProps, "interactive" | "motion" | "morph" | "neck"> {
  className?: string;
  style?: CSSProperties;
  positionerProps?: Omit<
    ComponentPropsWithRef<typeof Menu.Positioner>,
    "children"
  >;
  portalProps?: Omit<
    ComponentPropsWithRef<typeof Menu.Portal>,
    "children" | "container"
  >;
}
export function GlassMenuContent({
  children,
  className = "",
  style,
  material = "regular",
  appearance,
  radius = 28,
  refraction,
  tint,
  interactive,
  motion,
  morph,
  neck,
  side,
  align,
  sideOffset,
  alignOffset,
  collisionAvoidance,
  positionerProps,
  portalProps,
  ...props
}: GlassMenuContentProps) {
  const { root } = useScene();
  const registry = useContext(MenuTriggersContext);
  // The trigger that opened this popup: its anchor for placement, and the
  // shape the popup's glass grows out of.
  const openTrigger = () => {
    const triggers = [...registry?.triggers.keys() ?? []];
    return triggers.find((trigger) => trigger.hasAttribute("data-popup-open")) ?? triggers[0] ?? null;
  };
  const stableAnchor = () => {
    const trigger = openTrigger();
    return trigger ? registry?.triggers.get(trigger) ?? null : null;
  };
  const anchors = registry?.stable ? registry : null;
  return (
    <Menu.Portal {...portalProps} container={root} style={{ display: "contents", ...portalProps?.style }}>
      <Menu.Positioner
        className="lg-menu-positioner"
        {...positionerProps}
        anchor={positionerProps?.anchor ?? (anchors ? stableAnchor : undefined)}
        side={side ?? positionerProps?.side}
        align={align ?? positionerProps?.align ?? "end"}
        sideOffset={sideOffset ?? positionerProps?.sideOffset ?? 8}
        alignOffset={alignOffset ?? positionerProps?.alignOffset}
        collisionAvoidance={collisionAvoidance ?? positionerProps?.collisionAvoidance}
      >
        <GlassSurface
          material={material}
          appearance={appearance}
          radius={radius}
          refraction={refraction}
          tint={tint}
          interactive={interactive}
          motion={motion}
          // A glass trigger becomes its menu; a trigger inside glass, such
          // as a toolbar button, lets the menu detach from that glass as a drop.
          morphFrom={openTrigger}
          morph={morph}
          neck={neck}
          style={style}
          className={`lg-menu ${className}`}
          render={<Menu.Popup {...props} />}
        >
          <Fragment>
            {children}
          </Fragment>
        </GlassSurface>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
export function GlassMenuItem(props: ComponentPropsWithRef<typeof Menu.Item>) {
  return <GlassShape concentric={{ contentPadding: 8 }} render={<Menu.Item {...props} />} />;
}

/** Submenus fade beside their parent. Moving between siblings morphs the
 * existing panel into the next panel's position and size. */
export function GlassMenuSubmenuContent(props: GlassMenuContentProps) {
  return <GlassMenuContent neck={0} {...props} data-glass-submenu="" side={props.side ?? props.positionerProps?.side ?? "inline-end"} align={props.align ?? props.positionerProps?.align ?? "start"} />;
}
