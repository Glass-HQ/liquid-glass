import { Fragment, createContext, useCallback, useContext, useState } from "react";
import type { CSSProperties, ComponentPropsWithRef, Ref } from "react";
import { Menu } from "@base-ui/react/menu";
import { useRender } from "@base-ui/react/use-render";
import type { MaterialOptions } from "../core/materials.js";
import { useMergedRef } from "./merged-ref.js";
import { GlassRow } from "./shape.js";
import { useScene } from "./scene.js";
import { GlassPopupSurface } from "./surface.js";
import { layoutRect } from "../dom/layout-rect.js";
import type { GlassMotionProps } from "./surface.js";
/** Triggers registered by a menu or submenu. Root menus anchor to a stable
 * wrapper so the trigger's own press motion never moves the popup. */
interface MenuTriggers {
  triggers: Map<HTMLElement, HTMLElement | null>;
  stable: boolean;
}
const MenuTriggersContext = createContext<MenuTriggers | null>(null);
function useMenuTriggers(stable: boolean): MenuTriggers {
  const [registry] = useState(() => ({
    triggers: new Map<HTMLElement, HTMLElement | null>(),
    stable,
  }));
  return registry;
}
function useRegisterTrigger(anchor: (element: HTMLElement) => HTMLElement | null) {
  const registry = useContext(MenuTriggersContext);
  const [resolve] = useState(() => anchor);
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element || !registry) return;
      registry.triggers.set(element, resolve(element));
      return () => {
        registry.triggers.delete(element);
      };
    },
    [registry, resolve],
  );
}

export function GlassMenu<Payload>(props: Menu.Root.Props<Payload>) {
  const triggers = useMenuTriggers(true);
  return (
    <MenuTriggersContext.Provider value={triggers}>
      <Menu.Root {...props} />
    </MenuTriggersContext.Provider>
  );
}

export function GlassMenuTrigger<Payload>({
  ref,
  ...props
}: Menu.Trigger.Props<Payload> & { ref?: Ref<HTMLElement> }) {
  const attach = useRegisterTrigger((element) => element.parentElement);
  const trigger = useRender({ render: <Menu.Trigger {...props} />, ref: [attach, ref ?? null] });
  // The semantic button keeps its shared animation; placement uses its fixed layout box.
  return <span className="lg-menu-anchor">{trigger}</span>;
}

export function GlassMenuSubmenu(props: Menu.SubmenuRoot.Props) {
  // Submenus anchor to their own item, which never moves independently.
  const triggers = useMenuTriggers(false);
  return (
    <MenuTriggersContext.Provider value={triggers}>
      <Menu.SubmenuRoot {...props} />
    </MenuTriggersContext.Provider>
  );
}

export function GlassMenuSubmenuTrigger({
  ref,
  delay = 0,
  ...props
}: ComponentPropsWithRef<typeof Menu.SubmenuTrigger>) {
  const attach = useRegisterTrigger(() => null);
  // A submenu opens the moment the pointer reaches its item, as on macOS, so
  // moving between items swaps submenus without a gap; Base UI's safe polygon
  // still lets the pointer cross to an open submenu diagonally.
  return (
    <GlassRow
      ref={useMergedRef(attach, ref)}
      render={<Menu.SubmenuTrigger delay={delay} {...props} />}
    />
  );
}
export const GlassMenuGroup = Menu.Group;
export function GlassMenuGroupLabel(props: ComponentPropsWithRef<typeof Menu.GroupLabel>) {
  return <GlassRow render={<Menu.GroupLabel {...props} />} />;
}
export const GlassMenuSeparator = Menu.Separator;
export function GlassMenuCheckboxItem(props: ComponentPropsWithRef<typeof Menu.CheckboxItem>) {
  return <GlassRow render={<Menu.CheckboxItem {...props} />} />;
}
export const GlassMenuRadioGroup = Menu.RadioGroup;
export function GlassMenuRadioItem(props: ComponentPropsWithRef<typeof Menu.RadioItem>) {
  return <GlassRow render={<Menu.RadioItem {...props} />} />;
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
    Pick<GlassMotionProps, "interactive" | "motion"> {
  className?: string;
  style?: CSSProperties;
  positionerProps?: Omit<ComponentPropsWithRef<typeof Menu.Positioner>, "children">;
  portalProps?: Omit<ComponentPropsWithRef<typeof Menu.Portal>, "children" | "container">;
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
  specular,
  frost,
  interactive,
  motion,
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
  // The trigger that opened this popup anchors its placement.
  const openTrigger = () => {
    const triggers = [...(registry?.triggers.keys() ?? [])];
    return (
      triggers.find((trigger) => trigger.hasAttribute("data-popup-open")) ?? triggers[0] ?? null
    );
  };
  // The anchor as layout placed it: a press grows the glass around a trigger
  // (a toolbar, a button), and the menu must not move with it.
  const stableAnchor = () => {
    const trigger = openTrigger();
    const anchor = trigger ? (registry?.triggers.get(trigger) ?? null) : null;
    return anchor
      ? { getBoundingClientRect: () => layoutRect(anchor), contextElement: anchor }
      : null;
  };
  const anchors = registry?.stable ? registry : null;
  return (
    <Menu.Portal
      {...portalProps}
      container={root}
      style={{ display: "contents", ...portalProps?.style }}
    >
      <Menu.Positioner
        className="lg-menu-positioner"
        // Placed in viewport coordinates: a popup portaled into the scene is
        // measured before it is attached, and would first land offset by the
        // scene's position, then jump into place.
        positionMethod="fixed"
        {...positionerProps}
        anchor={positionerProps?.anchor ?? (anchors ? stableAnchor : undefined)}
        side={side ?? positionerProps?.side}
        align={align ?? positionerProps?.align ?? "end"}
        sideOffset={sideOffset ?? positionerProps?.sideOffset ?? 8}
        alignOffset={alignOffset ?? positionerProps?.alignOffset}
        collisionAvoidance={collisionAvoidance ?? positionerProps?.collisionAvoidance}
      >
        <GlassPopupSurface
          material={material}
          appearance={appearance}
          radius={radius}
          refraction={refraction}
          tint={tint}
          specular={specular}
          frost={frost}
          interactive={interactive}
          motion={motion}
          style={style}
          className={`lg-menu ${className}`}
          render={<Menu.Popup {...props} />}
        >
          <Fragment>{children}</Fragment>
        </GlassPopupSurface>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
export function GlassMenuItem(props: ComponentPropsWithRef<typeof Menu.Item>) {
  return <GlassRow render={<Menu.Item {...props} />} />;
}

/** Submenus open beside their parent item. */
export function GlassMenuSubmenuContent(props: GlassMenuContentProps) {
  return (
    <GlassMenuContent
      {...props}
      side={props.side ?? props.positionerProps?.side ?? "inline-end"}
      align={props.align ?? props.positionerProps?.align ?? "start"}
    />
  );
}
