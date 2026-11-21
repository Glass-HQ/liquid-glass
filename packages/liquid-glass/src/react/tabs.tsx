import { createContext, useCallback, useContext, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ComponentPropsWithRef, ReactNode, Ref } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { attachSelectionLens } from "../dom/selection.js";
import type { SelectionLens } from "../dom/selection.js";
import { resolveMotion } from "../dom/interaction.js";
import type { GlassMotion } from "../dom/interaction.js";
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
  specular,
  frost,
  // macOS's tab bar holds still under a press; its selection lifts instead.
  interactive = false,
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
        specular={specular}
        frost={frost}
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
  // At rest the chosen tab sits on a plate of glass; a press lifts a Lens out
  // of it that magnifies the labels beneath, as macOS 27's tabs do.
  material = "regular",
  appearance,
  radius = "capsule",
  refraction,
  tint,
  specular,
  frost,
  motion,
  className = "",
  style,
  ref,
  ...props
}: Omit<ComponentPropsWithRef<typeof Tabs.Indicator>, "className" | "style"> &
  MaterialOptions &
  Pick<GlassMotionProps, "motion"> & { className?: string; style?: CSSProperties }) {
  const inherited = useContext(TabsMaterialContext);
  const { controller, root } = useScene();
  const level = useGlassMotion(motion ?? inherited.motion);
  const [selection, setSelection] = useState<SelectionLens | null>(null);
  // The lens is a glass surface only while a press shows it.
  const [lifted, setLifted] = useState(false);
  const plate = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const lens = attachSelectionLens(element, () => resolveMotion(level), setLifted);
      setSelection(lens);
      const remove = controller.addAnimator(lens);
      return () => {
        remove();
        setSelection(null);
      };
    },
    [controller, level],
  );
  const lens = useCallback(
    (element: HTMLElement | null) => {
      selection?.setLens(element, root);
      return () => selection?.setLens(null, null);
    },
    [selection, root],
  );
  const resolvedAppearance = appearance ?? inherited.appearance;
  return (
    <>
      <GlassSurface
        material={material}
        appearance={resolvedAppearance}
        radius={radius}
        refraction={refraction}
        tint={tint}
        specular={specular}
        frost={frost}
        style={style}
        ref={useMergedRef(plate, ref)}
        className={`lg-tab-indicator ${className}`}
        render={<Tabs.Indicator {...props} />}
      />
      {root && selection && lifted
        ? createPortal(
            <GlassSurface
              material="lens"
              // macOS bends a lifted lens by 0.155 of its height at the rim, about 6
              // pixels on a tab: the labels beneath stay legible as it passes.
              refraction={6}
              // Colored fringes where it bends, as on a pressed switch: red and blue part
              // from green at the rim.
              aberration
              appearance={resolvedAppearance}
              radius={radius}
              ref={lens}
              className="lg-tab-lens"
              aria-hidden="true"
              render={<span />}
            />,
            root,
          )
        : null}
    </>
  );
}
export function GlassTabsTrigger({
  children,
  className,
  ...props
}: ComponentPropsWithRef<typeof Tabs.Tab>) {
  return (
    <GlassShape
      radius="capsule"
      concentric
      render={
        <Tabs.Tab
          {...props}
          className={(state) =>
            `lg-tab ${typeof className === "function" ? className(state) : (className ?? "")}`
          }
        />
      }
    >
      <span className="lg-tab-label">{children}</span>
    </GlassShape>
  );
}
export interface GlassTabsProps
  extends
    Omit<ComponentPropsWithRef<typeof Tabs.Root>, "children" | "className" | "style">,
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
  specular,
  frost,
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
        specular={specular}
        frost={frost}
        interactive={interactive}
        motion={motion}
        size={size}
        aria-label={label}
      >
        <GlassTabsIndicator tint={tint} />
        {items.map((item) => (
          <GlassTabsTrigger key={item.value} value={item.value} disabled={item.disabled}>
            {item.label}
          </GlassTabsTrigger>
        ))}
      </GlassTabsList>
    </GlassTabsRoot>
  );
}
