import type { GlassRadius } from "./shape.js";
export type GlassMaterial = "clear" | "regular";
export type GlassAppearance = "light" | "dark";
export interface MaterialOptions {
  material?: GlassMaterial;
  appearance?: GlassAppearance;
  radius?: GlassRadius;
  /** Follow the nearest shape container; radius controls independent corners. */
  concentric?: boolean | { inset?: number };
  refraction?: number;
  /** Optional six-digit hex color, e.g. "#007aff". Omit for untinted glass. */
  tint?: string;
}
export const materials = {
  clear: {
    blur: 0,
    refraction: 60,
    // Selective shadow lift / highlight rolloff; preserve the middle tones.
    light: { shadowLift: 0.18, highlightRolloff: 0 },
    dark: { shadowLift: 0.15, highlightRolloff: 0.20 },
  },
  regular: {
    blur: 7.33,
    refraction: 60,
    light: {
      fillSigma: 23,
      fillOpacity: 0.34,
      tone: [0.36, 0.67, -0.1113, 1.1031],
    },
    dark: {
      fillSigma: 21.8,
      fillOpacity: 0.65,
      tone: [0.105, 0.83, -0.2091, 1.0648],
    },
  },
} as const;
