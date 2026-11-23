import type { ReactNode } from "react";
import { GlassSegmented, GlassSegmentedItem } from "./segmented";
import type { GlassSegmentedItemProps, GlassSegmentedProps } from "./segmented";

export interface GlassTabBarProps extends Omit<GlassSegmentedProps, "kind" | "floating"> {}

/**
 * The floating tab bar of iOS, sized and moving like it: a 66 px capsule of tabs, the selected
 * one on a pill that lifts into a magnifying lens under a finger, follows a drag and stretches
 * the bar at its ends. A `GlassSegmented` with `floating`, laid out as tabs of an icon over a
 * label.
 */
export function GlassTabBar({ labelsInGlass = true, ...props }: GlassTabBarProps) {
  return (
    <GlassSegmented
      {...props}
      kind="tabs"
      floating
      labelsInGlass={labelsInGlass}
      data-lg-tabbar=""
    />
  );
}

export interface GlassTabProps extends Omit<GlassSegmentedItemProps, "children"> {
  /** The tab's symbol, about 25 px. */
  icon: ReactNode;
  /** The tab's name, shown under the symbol. */
  label: ReactNode;
}

/** One tab: an icon over its label. */
export function GlassTab({ icon, label, ...props }: GlassTabProps) {
  return (
    <GlassSegmentedItem {...props} data-lg-tab="">
      <span data-lg-tab-icon="" aria-hidden="true">
        {icon}
      </span>
      <span data-lg-tab-label="">{label}</span>
    </GlassSegmentedItem>
  );
}
