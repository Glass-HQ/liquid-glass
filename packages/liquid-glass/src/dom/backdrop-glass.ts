import { aberrationFor, glassRecipe, outlineFor, shadowFor } from "../core/materials.js";
import type { MaterialOptions } from "../core/materials.js";
import { nineMapImage } from "./map-image.js";
import type { MaterialMaps } from "./maps.js";
import {
  backdropMarkup,
  fillMarkup,
  lightMarkup,
  outlineMarkup,
  overlayTintMarkup,
  refractMarkup,
  tintChannels,
  tintMarkup,
  toneMarkup,
} from "./material-graph.js";

/**
 * Glass drawn as a backdrop filter of the surface itself, as Chromium can.
 *
 * The filter reads what is painted behind the surface, in the surface's own
 * box and coordinates, and only its own glass: a menu redraws a menu's worth
 * of pixels, not the page's, and glass beneath other glass sees it as it is.
 * What the filter returns is drawn over the backdrop, so it returns only the
 * glass: the face inside the shape, its light and ring, and the outline. The
 * backdrop beyond the box is out of reach, so the shape sits one device pixel
 * inside the box and the outline takes that pixel; the shadow, which reaches
 * far past it, is the surface's box shadow.
 */
export interface BackdropGlass {
  id: string;
  maps: MaterialMaps;
  options: MaterialOptions;
  /** The surface's layout box, in CSS pixels. */
  width: number;
  height: number;
  /** The shorter side the glass takes its look from (see `glassSize`). */
  size: number;
  /** How far the rim bends, in CSS pixels. */
  refraction: number;
  /** Whether the scene has a backdrop color to show under transparent content. */
  backed: boolean;
  /** CSS pixels per device pixel. */
  pixel: number;
}

export function backdropGlassFilter(glass: BackdropGlass): string {
  const { maps, options: o, width, height, size, pixel } = glass;
  const p = "g";
  const parts: string[] = [];
  // The map covers the shape and two pixels around it; drawn a device pixel
  // smaller, its outline lands on the box's outermost device pixel.
  const box = [-2 + pixel, -2 + pixel, width + 4 - 2 * pixel, height + 4 - 2 * pixel] as const;
  // Chromium copies a filter's images into every frame, and runs a pass once
  // for every pass that reads it, as if each read its own copy. So the color
  // passes, which read their inputs more than once, run first, on the
  // backdrop: they work pixel by pixel and the refraction only moves pixels,
  // so they give the same face. The refraction and the maps come last, each
  // map read once or twice.
  for (const plane of ["field", "rim", "light"] as const)
    parts.push(nineMapImage(maps, plane, `${p}${plane}`, ...box, pixel));
  // The frost is Chromium's own blur, run before this filter (see
  // `backdropGlassFrost`): it reads the backdrop the same way, and costs a
  // fraction of an SVG blur, which every frame the glass redraws runs again.
  // So the filter's source is already frosted. The backdrop color goes
  // beneath it, so the frost does not fade where the content is transparent.
  let frosted = "SourceGraphic";
  if (glass.backed) {
    parts.push(
      backdropMarkup(`${p}backdrop`, { x: 0, y: 0, width, height }),
      `<feMerge result="${p}frosted"><feMergeNode in="${p}backdrop"/><feMergeNode in="SourceGraphic"/></feMerge>`,
    );
    frosted = `${p}frosted`;
  }
  // The softer copy blends with the frost. As soft as the frost, it is the
  // frost, and the blend changes nothing; softer, it blurs the frost by what
  // the frost leaves out (Gaussians add in quadrature).
  const recipe = glassRecipe(o, size);
  const blur = backdropGlassFrost(o, size);
  const filled =
    recipe.fill <= blur + 0.01
      ? { markup: "", result: frosted }
      : fillMarkup(
          p,
          frosted,
          frosted,
          o,
          size,
          Math.sqrt(recipe.fill ** 2 - blur ** 2) / recipe.fill,
        );
  parts.push(filled.markup, toneMarkup(p, o, size, filled.result));
  let color = `${p}color`;
  let light = `${p}light`;
  const tint = tintChannels(o);
  if (tint) {
    const tinted = tintMarkup(p, o, tint);
    parts.push(tinted.markup);
    color = tinted.color;
    light = `${p}tintLight`;
  }
  parts.push(
    refractMarkup(p, color, glass.refraction, aberrationFor(o, size)),
    ...(tint ? [overlayTintMarkup(`${p}light`, light, tint)] : []),
    lightMarkup(p, `${p}refracted`, light, `${p}field`, o.material),
    outlineMarkup(p, frosted, `${p}rim`, 1, outlineFor(o, size)),
    `<feComposite in="${p}rim" in2="${p}field" operator="in" result="${p}ring"/>`,
    `<feMerge><feMergeNode in="${p}outline"/><feMergeNode in="${p}litInside"/><feMergeNode in="${p}ring"/></feMerge>`,
  );
  // Every pass works on the box alone.
  const markup = parts
    .join("")
    .replace(
      /<(fe(?:Flood|Composite|DisplacementMap|ColorMatrix|ComponentTransfer|GaussianBlur|Blend|Merge|Offset))\b([^>]*?)(\/?)>/g,
      (tag, name: string, attributes: string, close: string) =>
        /\sx="/.test(attributes)
          ? tag
          : `<${name}${attributes} x="0" y="0" width="${width}" height="${height}"${close}>`,
    );
  return `<filter id="${glass.id}" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${markup}</filter>`;
}

/** The frost Chromium's own `blur()` draws before the glass filter, in CSS
 * pixels: the material's, rounded to a hundredth; 0 for none. */
export function backdropGlassFrost(o: MaterialOptions, size: number): number {
  const blur = Math.round(glassRecipe(o, size).blur * 100) / 100;
  return blur >= 0.05 ? blur : 0;
}

/** The shadow glass casts, as a CSS box shadow: a Gaussian of `blur` CSS
 * pixels is a box shadow's blur radius of twice that. Glass inside other
 * glass casts none. */
export function backdropGlassShadow(o: MaterialOptions, size: number, nested: boolean): string {
  const shadow = nested ? undefined : shadowFor(o, size);
  if (!shadow || shadow.opacity < 0.004) return "";
  return `0 ${shadow.dy}px ${2 * shadow.blur}px rgba(0, 0, 0, ${Math.round(shadow.opacity * 1000) / 1000})`;
}
