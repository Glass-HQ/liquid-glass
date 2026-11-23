import { useEffect, useId, useMemo } from "react";
import type { RadiusSpec } from "../core/geometry";
import {
  prefersReducedMotion,
  rectIn,
  useGlassEngine,
  useGlassScene,
  useGlassSurfaceContext,
  useSurfaceMotion,
} from "./hooks";

export interface GlassHighlightProps {
  /** The element to highlight (a menu row, a list item), inside the surface; null for none. */
  target: HTMLElement | null;
  /**
   * The pill's corners away from the surface's corners. Default: the target's own border-radius,
   * or a capsule if it has none.
   */
  radius?: RadiusSpec;
  /**
   * Near the surface's corners, follow them: each corner of the pill takes the surface's radius
   * less the pill's distance from it, so the first row of a menu is concentric with the menu.
   * Default: true.
   */
  concentric?: boolean;
  /** CSS color laid over the pill. */
  tint?: string | null;
}

/**
 * A glass pill inside the enclosing surface that follows `target`: it fades in on the first
 * target, slides between targets, follows a target as it scrolls and fades out on null. Renders
 * nothing itself; put it anywhere inside a `GlassSurface`.
 */
export function GlassHighlight({
  target,
  radius,
  concentric = true,
  tint = null,
}: GlassHighlightProps) {
  const scene = useGlassScene();
  const engine = useGlassEngine();
  const surface = useGlassSurfaceContext();
  const machine = useMemo(
    () => engine?.createHighlightMachine({ reducedMotion: prefersReducedMotion }),
    [engine],
  );
  // Resolved where the pill is drawn, so a theme variable (`var(--danger)`) works as a tint.
  const color = useMemo(
    () => (tint && engine && surface ? engine.resolveColor(tint, surface.element) : null),
    [tint, engine, surface],
  );
  const radiusKey = Array.isArray(radius) ? radius.join(",") : radius;
  const corners = useMemo<RadiusSpec>(() => {
    if (radius !== undefined) return radius;
    if (!target || !engine) return "capsule";
    const own = engine.computedRadii(
      getComputedStyle(target),
      target.offsetWidth,
      target.offsetHeight,
    );
    return own.some((r) => r > 0) ? own : "capsule";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKey, target, engine]);

  const layer = `highlight${useId()}`;
  useSurfaceMotion(surface, layer, (_now, dt, s) => {
    if (!machine || !engine) return { shapes: [], moving: false };
    // Re-read every frame the scene draws, so the pill follows rows that scroll or move.
    machine.target(target && target.isConnected ? rectIn(target, s.element) : null, target);
    const frame = machine.advance(dt);
    return {
      shapes: engine.highlightShapes(frame, corners, color, concentric ? s : null),
      moving: frame.moving,
    };
  });

  useEffect(() => {
    scene?.requestFrame();
  }, [scene, target, corners, concentric, color]);

  return null;
}
