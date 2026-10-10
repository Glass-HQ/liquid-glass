import { Children, Fragment, cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ComponentPropsWithRef, ReactNode, RefObject } from "react";
import { Toolbar } from "@base-ui/react/toolbar";
import type { MaterialOptions } from "../core/materials.js";
import { useMergedRef } from "./merged-ref.js";
import { GlassShape } from "./shape.js";
import { GlassSurface } from "./surface.js";
import type { GlassMotionProps } from "./surface.js";
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
