import { createContext, useCallback, useContext } from "react";
import type { CSSProperties, ComponentPropsWithRef, ReactNode, Ref } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { attachSelectionLens, resolveMotion } from "../dom/index.js";
import type { GlassMotion } from "../dom/index.js";
import type { MaterialOptions } from "../core/materials.js";
import { useMergedRef } from "./merged-ref.js";
import { GlassShape } from "./shape.js";
import { useGlassMotion, useScene } from "./scene.js";
import { GlassSurface } from "./surface.js";
import type { GlassMotionProps } from "./surface.js";
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
