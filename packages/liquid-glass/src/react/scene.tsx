import { useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithRef } from "react";
import type { TintAmount } from "../core/material";
import type { Appearance, MaterialKind } from "../protocol";
import type { GlassScene as Scene } from "../scene/scene";
import { injectStyles } from "../scene/styles";
import { SceneContext, useMergedRef } from "./hooks";
import type { Engine, SceneContextValue } from "./hooks";

export interface GlassSceneProps extends ComponentPropsWithRef<"div"> {
  /** Default material for surfaces. Default: "regular". */
  material?: MaterialKind;
  /** Default: follows `prefers-color-scheme`. */
  appearance?: Appearance | "auto";
  /**
   * How tinted regular glass is: "clear", "tinted",
   * or 0 (clear) to 1 (tinted). Default: "default" (0.5). The clear material doesn't take it.
   */
  tintAmount?: TintAmount;
  /** CSS color drawn where the page is transparent. Default: the first opaque background up the tree. */
  backdrop?: string;
  /** Count frames and timings for `useGlassTelemetry`. Default: false. */
  telemetry?: boolean;
  /**
   * Adapt glass to what is behind it (small regular glass flips light/dark, clear glass dims
   * bright content, labels follow `data-lg-tone`). Default: true.
   */
  adaptive?: boolean;
  /** Highlights that follow the pointer (or device tilt) on every surface. Default: false. */
  specular?: boolean;
}

// One request per page, shared by every scene; a failed load is retried by the next scene.
let engineRequest: Promise<Engine> | null = null;
const loadEngine = (): Promise<Engine> =>
  (engineRequest ??= import("./engine").catch((error: unknown) => {
    engineRequest = null;
    throw error;
  }));

/**
 * The root of an app with glass. Its children are the content glass refracts; glass surfaces
 * anywhere inside it are drawn by one renderer. The engine (scene, capture, renderer, motion)
 * loads when the first scene mounts; until then components render as plain DOM and
 * `useGlassScene()` returns null.
 */
export function GlassScene({
  material = "regular",
  appearance = "auto",
  tintAmount = "default",
  backdrop,
  telemetry = false,
  adaptive = true,
  specular = false,
  children,
  ref,
  ...props
}: GlassSceneProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState<{ scene: Scene; engine: Engine } | null>(null);
  const [failed, setFailed] = useState(false);
  const mergedRef = useMergedRef<HTMLDivElement>(setRoot, ref);
  const options = { material, appearance, tintAmount, backdrop, telemetry, adaptive, specular };
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  // The components' CSS goes in before anything is laid out, so they have their size and look
  // on the first paint, long before the engine arrives.
  useInsertionEffect(() => injectStyles(), []);

  useLayoutEffect(() => {
    if (!root) return;
    let created: Scene | null = null;
    let live = true;
    loadEngine().then(
      (engine) => {
        if (!live) return;
        // Created with the options of the latest render; later changes go through `configure`.
        created = engine.createGlassScene({ root, ...latest.current });
        setLoaded({ scene: created, engine });
      },
      (error: unknown) => {
        if (!live) return;
        console.error("liquid-glass: the engine failed to load", error);
        setFailed(true);
      },
    );
    return () => {
      live = false;
      created?.destroy();
      setLoaded(null);
      setFailed(false);
    };
  }, [root]);

  const scene = loaded?.scene ?? null;
  useLayoutEffect(() => {
    scene?.configure({
      material,
      appearance,
      tintAmount,
      backdrop,
      telemetry,
      adaptive,
      specular,
    });
  }, [scene, material, appearance, tintAmount, backdrop, telemetry, adaptive, specular]);

  const failedAppearance: Appearance | null = !failed
    ? null
    : appearance === "auto"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : appearance;
  const context = useMemo<SceneContextValue>(
    () => ({ scene, engine: loaded?.engine ?? null, failed: failedAppearance }),
    [scene, loaded, failedAppearance],
  );

  return (
    <div {...props} ref={mergedRef} data-lg-scene="">
      <SceneContext value={context}>{children}</SceneContext>
    </div>
  );
}
