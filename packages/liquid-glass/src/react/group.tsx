import { useCallback, useContext, useMemo, useRef } from "react";
import type { ComponentPropsWithRef } from "react";
import type { Appearance, MaterialKind, Radii, Shape } from "../protocol";
import type { GlassSurfaceHandle, SurfaceOptions } from "../scene/scene";
import type { GroupJoin } from "./hooks";
import {
  GroupContext,
  SceneContext,
  SurfaceContext,
  rectIn,
  useGlassSurface,
  useMergedRef,
  useSurfaceMotion,
} from "./hooks";

export interface GlassGroupProps extends ComponentPropsWithRef<"div"> {
  material?: MaterialKind;
  tint?: string | null;
  appearance?: Appearance;
  /** The glass floats above content (a tab bar over a scrolling page). */
  floating?: boolean;
  /**
   * How far apart pieces start to melt together, px: at this gap they begin to bridge, and they
   * are fully joined by the time they touch. Default: 7.33.
   */
  spacing?: number;
  /** Draw the members' labels in the glass, so lenses magnify them. Default: true. */
  labelsInGlass?: boolean;
  /** The group's shadow will lift to a floating one (a menu): keep room for it from the start. */
  liftable?: boolean;
}

/** The merge radius for a spacing: 24 px at the default 7.33. */
const MERGE_PER_SPACING = 24 / 7.33;

interface Member {
  readonly id: number;
  readonly element: HTMLElement;
  options: SurfaceOptions;
  readonly layers: Map<string, readonly Shape[]>;
}

let nextMember = 0;

/**
 * A group of glass that melts together. Put glass components inside it (a `GlassTabBar` and a
 * round `GlassButton` beside it, a row of buttons): they are drawn as one piece of glass whose
 * parts bridge when they come within `spacing` of each other, as when a pressed button grows
 * towards its neighbour. Lay the members out with CSS; the group is a plain `div`.
 */
export function GlassGroup({
  material,
  tint,
  appearance,
  floating,
  spacing = 7.33,
  labelsInGlass = true,
  liftable,
  ref,
  children,
  ...props
}: GlassGroupProps) {
  const engine = useContext(SceneContext)?.engine ?? null;
  const members = useRef(new Map<number, Member>());
  const group = useRef<{ surface: GlassSurfaceHandle | null; element: HTMLElement | null }>({
    surface: null,
    element: null,
  });
  /** How far shapes reached past the group's box last time, rounded up: the canvas's room. */
  const extent = useRef(0);
  const reach = () => {
    let overhang = 0;
    let lensHeight = 0;
    for (const member of members.current.values()) {
      overhang = Math.max(overhang, member.options.overhang ?? 0);
      lensHeight = Math.max(lensHeight, member.options.lensHeight ?? 0);
    }
    return { overhang: Math.max(overhang + 2, extent.current), lensHeight };
  };
  /**
   * The look: the group's own, else the first member's that sets one, so a group made by a
   * component (a menu) takes the look its parts were given.
   */
  const look = () => {
    const first = <K extends "material" | "tint" | "appearance" | "specular">(key: K) => {
      for (const member of members.current.values())
        if (member.options[key] !== undefined && member.options[key] !== null)
          return member.options[key];
      return undefined;
    };
    return {
      material: material ?? first("material"),
      tint: tint ?? first("tint") ?? null,
      appearance: appearance ?? first("appearance"),
      specular: first("specular"),
    };
  };
  const {
    ref: surfaceRef,
    surface,
    element,
  } = useGlassSurface({
    body: false,
    ...look(),
    floating,
    liftable,
    labelsInGlass,
    ...reach(),
    radius: undefined,
    smoothing: undefined,
    bleed: undefined,
  });
  group.current = { surface, element };
  const mergedRef = useMergedRef<HTMLDivElement>(surfaceRef, ref);

  const radiiOf = useCallback(
    (member: Member): Radii => {
      const size = { width: member.element.offsetWidth, height: member.element.offsetHeight };
      if (!engine) return [0, 0, 0, 0];
      return member.options.radius !== undefined && member.options.radius !== null
        ? engine.resolveRadii(member.options.radius, size)
        : engine.computedRadii(getComputedStyle(member.element), size.width, size.height);
    },
    [engine],
  );

  /** Every member's shapes, in the group's px; bodies carry the merge radius. */
  const compose = useCallback((): Shape[] => {
    const host = group.current.element;
    if (!host) return [];
    const merge = Math.max(0, spacing) * MERGE_PER_SPACING;
    const shapes: Shape[] = [];
    for (const member of members.current.values()) {
      // A member another part draws for a while (a menu's button while it morphs) is skipped.
      if (!member.element.isConnected || member.element.hasAttribute("data-lg-group-hidden"))
        continue;
      const at = rectIn(member.element, host);
      const own = [...member.layers.values()].flat();
      if (
        (member.options.body ?? true) &&
        !member.element.hasAttribute("data-lg-group-shaped") &&
        !own.some((s) => s.role === "body")
      )
        own.unshift({
          role: "body",
          rect: { x: 0, y: 0, width: at.width, height: at.height },
          radii: radiiOf(member),
          lift: 0,
          magnify: 1,
          alpha: 1,
          merge: 0,
          tint: null,
          light: 0,
        });
      for (const s of own)
        shapes.push({
          ...s,
          rect: { ...s.rect, x: s.rect.x + at.x, y: s.rect.y + at.y },
          // A member that shapes itself (a menu's morph) sets its own melt.
          merge:
            s.role === "body" && !member.element.hasAttribute("data-lg-group-shaped")
              ? merge
              : s.merge,
        });
    }
    // Keep room on the canvas for everything drawn, in steps so it rarely resizes. A member that
    // draws its own shapes (a menu panel) gets room for its whole box, a third more for its
    // overshoot, from its first frame, so the canvas is sized once rather than as it grows.
    let past = 0;
    const w = host.offsetWidth;
    const h = host.offsetHeight;
    for (const member of members.current.values()) {
      if (!member.element.hasAttribute("data-lg-group-shaped")) continue;
      const r = rectIn(member.element, host);
      const grow = Math.max(r.width, r.height) / 3;
      past = Math.max(
        past,
        -r.x + grow,
        -r.y + grow,
        r.x + r.width - w + grow,
        r.y + r.height - h + grow,
      );
    }
    for (const s of shapes)
      past = Math.max(
        past,
        -s.rect.x,
        -s.rect.y,
        s.rect.x + s.rect.width - w,
        s.rect.y + s.rect.height - h,
      );
    const needed = Math.ceil((past + 4) / 32) * 32;
    if (needed > extent.current) {
      extent.current = needed;
      group.current.surface?.update(reach());
    }
    return shapes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiiOf, spacing]);

  const push = useCallback(() => {
    group.current.surface?.setShapes(compose(), "members");
  }, [compose]);

  // Every frame the scene draws, members are measured again: they move with the layout.
  useSurfaceMotion(surface, "members", () => ({ shapes: compose(), moving: false }));

  const join = useMemo<GroupJoin>(
    () => ({
      join(memberElement, options) {
        const member: Member = {
          id: (nextMember += 1),
          element: memberElement,
          options,
          layers: new Map(),
        };
        members.current.set(member.id, member);
        const handle: GlassSurfaceHandle = {
          id: -member.id,
          element: memberElement,
          get size() {
            return { width: memberElement.offsetWidth, height: memberElement.offsetHeight };
          },
          get radii() {
            return radiiOf(member);
          },
          get smoothing() {
            return group.current.surface?.smoothing ?? 1;
          },
          get tone() {
            return group.current.surface?.tone ?? options.appearance ?? "light";
          },
          onTone(listener) {
            return group.current.surface?.onTone(listener) ?? (() => {});
          },
          setShapes(shapes, layer = "default") {
            member.layers.set(layer, shapes);
            push();
          },
          update(next) {
            member.options = { ...member.options, ...next };
            group.current.surface?.update({ ...reach(), ...look() });
            push();
          },
          remove() {
            members.current.delete(member.id);
            push();
          },
        };
        return handle;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [push, radiiOf],
  );

  return (
    <div data-lg-group="" {...props} ref={mergedRef}>
      <SurfaceContext value={surface}>
        <GroupContext value={join}>{children}</GroupContext>
      </SurfaceContext>
    </div>
  );
}
