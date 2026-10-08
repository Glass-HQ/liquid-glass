import { shapeContainerAttributes } from "../dom/shape-layout.js";
import { GlassShape } from "./shape.js";
export { GlassShape, GlassShapeContainer, GlassCorner } from "./shape.js";
export type { GlassShapeProps, GlassCornerProps } from "./shape.js";
import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMergedRef } from "./merged-ref.js";
import type {
  CSSProperties,
  ComponentPropsWithRef,
  HTMLAttributes,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import { Button } from "@base-ui/react/button";
import { Tabs } from "@base-ui/react/tabs";
import { Menu } from "@base-ui/react/menu";
import { Toolbar } from "@base-ui/react/toolbar";
import { useRender } from "@base-ui/react/use-render";
import { attachSelectionLens, createGlassScene, resolveMotion } from "../dom/index.js";
import type { GlassSceneController, GlassSceneOptions, GlassMotion, GlassMorph } from "../dom/index.js";
import type { MaterialOptions } from "../core/materials.js";
export type { GlassMotion, GlassMorph } from "../dom/index.js";
interface SceneContextValue {
  controller: GlassSceneController;
  root: HTMLElement | null;
  maxSurfaces: number;
  material: MaterialOptions["material"];
  appearance: MaterialOptions["appearance"];
  motion: GlassMotion;
}
import type { GlassBlurEdge, ProgressiveBlurOptions } from "../core/progressive.js";
import { validateProgressive } from "../core/progressive.js";
export type { GlassBlurEdge, ProgressiveBlurOptions } from "../core/progressive.js";
const inertController: GlassSceneController = {
  setContent() {},
  addForeground() { return () => {}; },
  addAnimator() { return () => {}; },
  addProgressiveBlur() { return () => {}; },
  addScrollEdges() { return () => {}; },
  addSurface() {
    return () => {};
  },
  dispose() {},
};
const SceneContext = createContext<SceneContextValue | null>(null);
/** The motion level a glass component inherits from its scene. */
export function useGlassMotion(motion?: GlassMotion): GlassMotion {
  const scene = useContext(SceneContext);
  return motion ?? scene?.motion ?? "full";
}
function useScene() {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error("Glass components must be inside <GlassScene>.");
  return scene;
}
/** Ref for live foreground DOM; registration adds no material or GPU maps. */
export function useGlassForeground() {
  const { controller } = useScene();
  return useCallback((element: HTMLElement | null) => {
    if (element) return controller.addForeground(element);
  }, [controller]);
}
export interface GlassForegroundProps extends HTMLAttributes<HTMLElement> {
  render?: Parameters<typeof useRender>[0]["render"];
  ref?: Ref<HTMLElement>;
}
/** Content above the backdrop that refracts through higher glass surfaces. */
export function GlassForeground({ render, ref, ...props }: GlassForegroundProps) {
  const attach = useGlassForeground();
  return useRender({ render, ref: [attach, ref ?? null], props });
}
export interface GlassSceneProps
  extends
    ComponentPropsWithRef<"div">,
    GlassSceneOptions,
    Pick<MaterialOptions, "material" | "appearance"> {
  /** Motion for every glass component in the scene. `full` still follows the
   * system reduced-motion setting, which removes elasticity and travel. */
  motion?: GlassMotion;
}
export function GlassScene({
  children,
  className = "",
  onDiagnostic,
  maxSurfaces = 16,
  ref,
  material = "clear",
  appearance = "light",
  motion = "full",
  ...props
}: GlassSceneProps) {
  const capacity = Math.max(1, Math.min(64, Math.floor(maxSurfaces)));
  if (!Number.isFinite(capacity))
    throw new RangeError("maxSurfaces must be finite.");
  const [scene, setScene] = useState<SceneContextValue>({
    controller: inertController,
    root: null,
    maxSurfaces: capacity,
    material,
    appearance,
    motion,
  });
  const diagnostic = useRef(onDiagnostic);
  useLayoutEffect(() => {
    diagnostic.current = onDiagnostic;
  }, [onDiagnostic]);
  const attach = useCallback(
    (root: HTMLDivElement | null) => {
      if (!root) return;
      const controller = createGlassScene(root, {
        maxSurfaces: capacity,
        onDiagnostic: (d) => diagnostic.current?.(d),
      });
      setScene((previous) => ({
        ...previous,
        controller,
        root,
        maxSurfaces: capacity,
      }));
      return () => controller.dispose();
    },
    [capacity],
  );
  return useRender({
    ref: [attach, ref ?? null],
    props: {
      ...props,
      className: `lg-scene ${className}`,
      children: (
        <SceneContext.Provider value={{ ...scene, material, appearance, motion }}>
          {children}
        </SceneContext.Provider>
      ),
    },
  });
}
export interface GlassContentProps extends ComponentPropsWithRef<"div"> {
  /** Flow content determines scene height; overlay is the default for backdrops. */
  layout?: "overlay" | "flow";
}
export function GlassContent({
  layout = "overlay",
  className = "",
  ref,
  ...props
}: GlassContentProps) {
  const { controller } = useScene();
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      controller.setContent(element);
      return () => {
        controller.setContent(null);
      };
    },
    [controller],
  );
  return useRender({
    ref: [attach, ref ?? null],
    props: { ...props, "data-layout": layout, className: `lg-content ${className}` },
  });
}
/** How a glass surface moves. Every option is available to any surface. */
export interface GlassMotionProps {
  /** Respond to touch and pointer input: grow under a press, stretch toward a
   * drag, settle with overshoot on release, and light up beneath the pointer. */
  interactive?: boolean;
  /** Grow out of this element when mounted, and shrink back into it when a
   * Base UI popup closes. */
  morphFrom?: RefObject<Element | null> | (() => Element | null | undefined);
  /** How the surface relates to the glass it grows from. `become`: the
   * source's glass is this surface; its content withdraws while the surface
   * is present. `detach`: the surface leaves the source's glass as a drop,
   * joined by a liquid neck until they part. Default: a glass source is
   * become; a source inside glass, such as a toolbar button, is detached from. */
  morph?: GlassMorph;
  /** How far a detaching surface stays joined to its glass by a liquid neck,
   * in pixels. `0` grows a plain shape with no union. Default: 18. */
  neck?: number;
  /** Grow out of `morphFrom` when mounted. `false` keeps only the exit, for
   * an element that is already in place. Default: true. */
  morphEnter?: boolean;
  /** Spring the glass outline when the surface's layout box changes. */
  fluid?: boolean;
  /** Override the scene's motion level for this surface. */
  motion?: GlassMotion;
}
export interface GlassSurfaceProps
  extends HTMLAttributes<HTMLElement>, MaterialOptions, GlassMotionProps {
  render?: useRender.RenderProp;
  ref?: Ref<HTMLElement>;
}
/** Pass a shadcn component with render={<Button/>}; geometry follows its real DOM. */
export function GlassSurface({
  material,
  appearance,
  radius,
  concentric,
  refraction,
  tint,
  interactive = false,
  morphFrom,
  morph,
  neck,
  morphEnter,
  fluid = false,
  motion,
  render,
  ref,
  children,
  className = "",
  style,
  ...props
}: GlassSurfaceProps) {
  const scene = useScene();
  const { controller } = scene;
  material ??= scene.material;
  appearance ??= scene.appearance;
  motion ??= scene.motion;
  const relative = Boolean(concentric);
  const inset = typeof concentric === "object" ? concentric.inset : undefined;
  // The source is read when the surface mounts or leaves; a new function or
  // ref identity must not register the surface again.
  const source = useRef(morphFrom);
  useLayoutEffect(() => { source.current = morphFrom; });
  const morphs = Boolean(morphFrom);
  const options = useMemo(
    () => ({
      material, appearance, radius, concentric: relative ? { inset } : undefined, refraction, tint,
      interactive, fluid, motion, morph, neck, morphEnter,
      morphFrom: morphs ? () => {
        const from = source.current;
        return typeof from === "function" ? from() : from?.current;
      } : undefined,
    }),
    [material, appearance, radius, relative, inset, refraction, tint, interactive, fluid, motion, morph, neck, morphEnter, morphs],
  );
  const attach = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const remove = controller.addSurface(element, options);
      return () => {
        remove();
      };
    },
    [controller, options],
  );
  return useRender({
    render,
    ref: [attach, ref ?? null],
    props: {
      ...props,
      ...shapeContainerAttributes(radius ?? 8),
      "data-glass-material": material,
      "data-glass-appearance": appearance,
      "data-glass-interactive": interactive ? "" : undefined,
      className: `lg-surface ${className}`,
      style: {
        ...style,
      } as CSSProperties,
      ...(children === undefined ? {} : { children }),
    },
  });
}
export type GlassButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
export interface GlassButtonProps
  extends
    Omit<ComponentPropsWithRef<typeof Button>, "className" | "style">,
    MaterialOptions,
    Pick<GlassMotionProps, "interactive" | "motion"> {
  className?: string;
  style?: CSSProperties;
  size?: GlassButtonSize;
}
export function GlassButton({
  material,
  appearance,
  radius = "capsule",
  refraction,
  tint,
  interactive = true,
  motion,
  size = "default",
  className = "",
  style,
  children,
  ...props
}: GlassButtonProps) {
  return (
    <GlassSurface
      material={material}
      appearance={appearance}
      radius={size.startsWith("icon") ? "circle" : radius}
      refraction={refraction}
      tint={tint}
      interactive={interactive}
      motion={motion}
      className={`lg-button ${className}`}
      style={style}
      data-size={size}
      render={<Button {...props} />}
    >
      {children}
    </GlassSurface>
  );
}
export interface GlassToolbarProps
  extends
    Omit<ComponentPropsWithRef<typeof Toolbar.Root>, "className" | "style">,
    MaterialOptions,
    Pick<GlassMotionProps, "interactive" | "motion"> {
  className?: string;
  style?: CSSProperties;
}
export function GlassToolbar({
  material,
  appearance,
  radius = "capsule",
  refraction,
  tint,
  interactive = true,
  motion,
  className = "",
  style,
  children,
  ...props
}: GlassToolbarProps) {
  // Clusters that appear after the toolbar has mounted split off a neighbor;
  // clusters whose spacer is removed stay mounted, in place, until their glass
  // has merged back into the one before them.
  const settled = useRef(false);
  useEffect(() => { settled.current = true; }, []);
  const elements = useRef(new Map<string, HTMLElement>());
  const previous = useRef(new Map<string, ReactNode[]>());
  const [ghosts, setGhosts] = useState(new Map<string, Ghost>());
  // Fragments and arrays are transparent; spacers delimit optical surfaces.
  const items: ReactNode[] = [];
  const collect = (nodes: ReactNode, prefix = "") => {
    Children.forEach(Children.toArray(nodes), (child) => {
      if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment)
        collect(child.props.children, `${prefix}${child.key}/`);
      else items.push(isValidElement(child)
        ? cloneElement(child, { key: `${prefix}${child.key}` })
        : child);
    });
  };
  collect(children);
  const clusters: ReactNode[] = [];
  const live = new Map<string, ReactNode[]>();
  let controls: ReactNode[] = [];
  const cluster = (key: string, index: number, children: ReactNode[], ghost?: { left: number; top: number; width: number; height: number }) => (
    <ToolbarCluster
      key={key}
      index={index}
      settled={settled}
      material={material}
      appearance={appearance}
      radius={radius}
      refraction={refraction}
      tint={tint}
      interactive={interactive}
      motion={motion}
      orientation={props.orientation ?? "horizontal"}
      ghost={ghost}
      register={(element) => { if (element) elements.current.set(key, element); else elements.current.delete(key); }}
      onExited={() => setGhosts((current) => { if (!current.has(key)) return current; const next = new Map(current); next.delete(key); return next; })}
    >
      {children}
    </ToolbarCluster>
  );
  const flush = () => {
    if (!controls.length) return;
    const key = `cluster-${live.size}`;
    live.set(key, controls);
    clusters.push(cluster(key, live.size - 1, controls));
    controls = [];
  };
  for (const item of items) {
    if (isValidElement(item) && item.type === GlassToolbarSpacer) {
      flush();
      clusters.push(item);
    } else controls.push(item);
  }
  flush();
  // A cluster that just lost its spacer keeps its last controls and box while
  // it merges. Its element is only measurable now, before this render commits.
  // oxlint-disable-next-line react/refs
  const leaving = leavingClusters(live, ghosts, previous, elements, props.orientation !== "vertical");
  if (leaving.size !== ghosts.size || [...leaving.keys()].some((key) => !ghosts.has(key))) queueMicrotask(() => setGhosts(leaving));
  for (const [key, ghost] of leaving) clusters.push(cluster(key, live.size, ghost.children, ghost.box));
  return (
    <Toolbar.Root
      aria-label="Toolbar"
      {...props}
      style={style}
      className={`lg-toolbar ${className}`}
      data-segmented={clusters.length > 1 ? "" : undefined}
    >
      {clusters}
    </Toolbar.Root>
  );
}
type GhostBox = { left: number; top: number; width: number; height: number };
type Ghost = { children: ReactNode[]; box: GhostBox };
/** Clusters rendered last time but not this time, measured before React
 * removes them: they are drawn in place while their glass merges back. */
function leavingClusters(live: Map<string, ReactNode[]>, ghosts: Map<string, Ghost>, previous: RefObject<Map<string, ReactNode[]>>, elements: RefObject<Map<string, HTMLElement>>, enabled: boolean): Map<string, Ghost> {
  const leaving = new Map(ghosts);
  for (const key of leaving.keys()) if (live.has(key)) leaving.delete(key);
  if (enabled) for (const [key, children] of previous.current) {
    const element = elements.current.get(key);
    if (live.has(key) || leaving.has(key) || !element) continue;
    const parent = element.offsetParent as HTMLElement | null;
    leaving.set(key, { children, box: { left: element.offsetLeft - (parent?.clientLeft ?? 0), top: element.offsetTop - (parent?.clientTop ?? 0), width: element.offsetWidth, height: element.offsetHeight } });
  }
  previous.current = live;
  return leaving;
}
function ToolbarCluster({ index, settled, orientation, children, ghost, register, onExited, ...options }: MaterialOptions & Pick<GlassMotionProps, "interactive" | "motion"> & {
  index: number;
  settled: RefObject<boolean>;
  orientation: string;
  children: ReactNode;
  /** The box this cluster keeps, inert, while its glass merges back into its neighbor. */
  ghost?: GhostBox;
  register: (element: HTMLElement | null) => void;
  onExited: () => void;
}) {
  // Decided once: a cluster created by a new spacer grows out of the one before it.
  const [split] = useState(() => settled.current && index > 0);
  const neighbor = useCallback((): Element | null => {
    let node = self.current?.previousElementSibling ?? null;
    while (node && !(node.classList.contains("lg-toolbar-cluster") && !node.hasAttribute("data-ending-style"))) node = node.previousElementSibling;
    return node;
  }, []);
  const self = useRef<HTMLElement>(null);
  // The toolbar's callbacks change identity every render; the ref must not.
  const latest = useRef({ register, onExited });
  useLayoutEffect(() => { latest.current = { register, onExited }; });
  const attach = useCallback((element: HTMLElement | null) => {
    latest.current.register(element);
    if (!element) return;
    const exited = () => latest.current.onExited();
    element.addEventListener("glass:exited", exited);
    return () => { element.removeEventListener("glass:exited", exited); latest.current.register(null); };
  }, []);
  return (
    <GlassSurface
      {...options}
      ref={useMergedRef(self, attach)}
      fluid
      morphFrom={index > 0 ? neighbor : undefined}
      morphEnter={split}
      morph="detach"
      // Merging back is a plain drop: a union traced against the neighbor's
      // final box would show its full size before its own glass got there.
      neck={ghost ? 0 : undefined}
      className="lg-toolbar-cluster"
      data-orientation={orientation}
      data-ending-style={ghost ? "" : undefined}
      aria-hidden={ghost ? true : undefined}
      inert={ghost ? true : undefined}
      style={ghost ? { position: "absolute", left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height, pointerEvents: "none" } : undefined}
    >
      {children}
    </GlassSurface>
  );
}
export interface GlassToolbarButtonProps
  extends ComponentPropsWithRef<typeof Toolbar.Button> {
  /** Icon controls remain square; default controls fit their text. */
  size?: "icon" | "default";
}
export function GlassToolbarButton({
  className,
  size = "icon",
  ...props
}: GlassToolbarButtonProps) {
  return (
    <GlassShape radius={size === "icon" ? "circle" : "capsule"} render={<Toolbar.Button
      {...props}
      data-size={size}
      className={(state) =>
        `lg-toolbar-button ${typeof className === "function" ? className(state) : (className ?? "")}`
      }
    />} />
  );
}
export const GlassToolbarLink = Toolbar.Link;
export const GlassToolbarGroup = Toolbar.Group;

export interface GlassToolbarSpacerProps
  extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Flexible spacers fill available space; fixed spacers keep a standard gap. */
  sizing?: "fixed" | "flexible";
}
export function GlassToolbarSpacer({
  sizing = "flexible",
  className = "",
  ...props
}: GlassToolbarSpacerProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={`lg-toolbar-spacer ${className}`}
      data-sizing={sizing}
    />
  );
}

export const GlassTabsRoot = Tabs.Root;
export const GlassTabsContent = Tabs.Panel;
export interface GlassTabsListProps
  extends
    Omit<ComponentPropsWithRef<typeof Tabs.List>, "className" | "style">,
    MaterialOptions,
    Pick<GlassMotionProps, "interactive" | "motion"> {
  className?: string;
  style?: CSSProperties;
  size?: "default" | "sm" | "lg";
}
const TabsMaterialContext = createContext<MaterialOptions & { motion?: GlassMotion }>({});
export function GlassTabsList({
  material,
  appearance,
  radius = "capsule",
  refraction,
  tint,
  interactive = true,
  motion,
  size = "default",
  className = "",
  style,
  children,
  ...props
}: GlassTabsListProps) {
  const scene = useScene();
  const resolved = {
    material: material ?? scene.material,
    appearance: appearance ?? scene.appearance,
    motion,
  };
  return (
    <TabsMaterialContext.Provider value={resolved}>
      <GlassSurface
        material={resolved.material}
        appearance={resolved.appearance}
        radius={radius}
        refraction={refraction}
        tint={tint}
        interactive={interactive}
        motion={motion}
        style={style}
        className={`lg-tabs-list ${className}`}
        data-size={size}
        render={<Tabs.List activateOnFocus {...props} />}
      >
        {children}
      </GlassSurface>
    </TabsMaterialContext.Provider>
  );
}
export function GlassTabsIndicator({
  material = "clear",
  appearance,
  radius = "capsule",
  refraction,
  tint,
  motion,
  className = "",
  style,
  ref,
  ...props
}: Omit<ComponentPropsWithRef<typeof Tabs.Indicator>, "className" | "style"> &
  MaterialOptions & Pick<GlassMotionProps, "motion"> & { className?: string; style?: CSSProperties }) {
  const inherited = useContext(TabsMaterialContext);
  const { controller } = useScene();
  const level = useGlassMotion(motion ?? inherited.motion);
  // The indicator is the tab bar's selection lens: it springs between tabs,
  // lifts under a press, and can be dragged to choose a tab.
  const lens = useCallback((element: HTMLElement | null) => {
    if (element) return controller.addAnimator(attachSelectionLens(element, () => resolveMotion(level)));
  }, [controller, level]);
  return (
    <GlassSurface
      material={material}
      appearance={appearance ?? inherited.appearance}
      radius={radius}
      refraction={refraction}
      tint={tint}
      style={style}
      ref={useMergedRef(lens, ref as Ref<HTMLElement> | undefined)}
      className={`lg-tab-indicator ${className}`}
      render={<Tabs.Indicator {...props} />}
    />
  );
}
export function GlassTabsTrigger({
  children,
  className,
  ...props
}: ComponentPropsWithRef<typeof Tabs.Tab>) {
  return (
    <GlassShape radius="capsule" concentric render={<Tabs.Tab
      {...props}
      className={(state) =>
        `lg-tab ${typeof className === "function" ? className(state) : (className ?? "")}`
      }
    />}>
      <span className="lg-tab-label">{children}</span>
    </GlassShape>
  );
}
export interface GlassTabsProps
  extends
    Omit<
      ComponentPropsWithRef<typeof Tabs.Root>,
      "children" | "className" | "style"
    >,
    MaterialOptions,
    Pick<GlassMotionProps, "interactive" | "motion"> {
  items: readonly { value: string; label: ReactNode; disabled?: boolean }[];
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
  size?: "default" | "sm" | "lg";
}
export function GlassTabs({
  items,
  defaultValue,
  material,
  appearance,
  radius,
  refraction,
  tint,
  interactive,
  motion,
  size,
  className = "",
  "aria-label": label = "Sections",
  ...props
}: GlassTabsProps) {
  return (
    <GlassTabsRoot
      {...props}
      defaultValue={defaultValue ?? items.find((item) => !item.disabled)?.value}
      className={`lg-tabs ${className}`}
    >
      <GlassTabsList
        material={material}
        appearance={appearance}
        radius={radius}
        refraction={refraction}
        tint={tint}
        interactive={interactive}
        motion={motion}
        size={size}
        aria-label={label}
      >
        <GlassTabsIndicator tint={tint} />
        {items.map((item) => (
          <GlassTabsTrigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
          >
            {item.label}
          </GlassTabsTrigger>
        ))}
      </GlassTabsList>
    </GlassTabsRoot>
  );
}
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

export function GlassMenuSubmenuTrigger({ ref, delay = 40, ...props }: ComponentPropsWithRef<typeof Menu.SubmenuTrigger>) {
  const attach = useRegisterTrigger(() => null);
  // A submenu should be there the moment the pointer rests on its item; Base
  // UI's safe polygon still lets the pointer cross to it diagonally.
  return <GlassShape ref={useMergedRef(attach, ref)} concentric={{ contentPadding: 8 }} render={<Menu.SubmenuTrigger delay={delay} {...props} />} />;
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

/** A submenu uses the same glass surface and positioning as a root menu. It
 * grows out of its item as a plain shape: a neck to the parent menu would
 * cost a traced union per frame of the path, for a shape that is meant to
 * appear the moment the pointer rests on its item. */
export function GlassMenuSubmenuContent(props: GlassMenuContentProps) {
  return <GlassMenuContent neck={0} {...props} side={props.side ?? props.positionerProps?.side ?? "inline-end"} align={props.align ?? props.positionerProps?.align ?? "start"} />;
}

export interface GlassProgressiveBlurProps extends ProgressiveBlurOptions,
  Omit<ComponentPropsWithRef<"div">, "children"> { children?: never }
/** A decorative region affecting the scene's explicit GlassContent only. */
export function GlassProgressiveBlur({ edge = "bottom", size = 80, blur = 20,
  refraction = 0, disabled = false, className = "", style, ref, ...props
}: GlassProgressiveBlurProps) {
  const { controller } = useScene();
  validateProgressive({ edge, size, blur, refraction });
  const attach = useCallback((element: HTMLDivElement | null) => {
    if (element) return controller.addProgressiveBlur(element, { edge, size, blur, refraction, disabled });
  }, [controller, edge, size, blur, refraction, disabled]);
  return useRender({ ref: [attach, ref ?? null], props: {
    ...props, "aria-hidden": true, "data-edge": edge,
    className: `lg-progressive-blur ${className}`,
    style: { "--lg-blur-size": `${size}px`, ...style, pointerEvents: "none" } as CSSProperties,
  } });
}
export interface GlassScrollEdgesProps extends Omit<ProgressiveBlurOptions, "edge"> {
  /** The existing scroll container. Does not create or replace scrolling. */
  target: RefObject<HTMLElement | null>;
  edges?: readonly GlassBlurEdge[];
}
const defaultBlurEdges: readonly GlassBlurEdge[] = ["top", "bottom"];
/** Filters only the target scrollport. Place floating controls outside that
 * element to keep them sharp; no extra viewport wrapper is required. */
export function GlassScrollEdges({ target, edges = defaultBlurEdges, size = 80,
  blur = 20, refraction = 0, disabled = false }: GlassScrollEdgesProps) {
  const { controller } = useScene();
  validateProgressive({ size, blur, refraction });
  edges.forEach((edge) => validateProgressive({ edge }));
  const edgeKey = [...new Set(edges)].join(",");
  useLayoutEffect(() => controller.addScrollEdges({
    target: () => target.current,
    edges: edgeKey ? edgeKey.split(",") as GlassBlurEdge[] : [], size, blur, refraction, disabled,
  }), [controller, target, edgeKey, size, blur, refraction, disabled]);
  return null;
}

export { GlassSlider, GlassSwitch } from "./value-controls.js";
export type { GlassSliderProps, GlassSwitchProps } from "./value-controls.js";
