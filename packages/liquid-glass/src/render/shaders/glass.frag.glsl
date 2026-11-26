#version 300 es
// Every shape of one glass surface, in one pass.
//
// Coordinates: "local" is the surface's own untransformed CSS px (0, 0 at the border box's top
// left, y down), where shapes live. The backdrop is a viewport-sized texture in screen CSS px;
// local maps to screen by the surface's current transform (a scale and an offset).
//
// Shapes come in three groups, in this order in the arrays:
//   body   [0, uBodyEnd)          glass melted together with smooth-min: bodies and buttons
//   lenses [uBodyEnd, uLensEnd)   glass above the bodies that refracts them (tab lens, thumbs)
//   pills  [uLensEnd, uPillEnd)   flat ink laid on the body under its labels (selection pill)
//
// Output is premultiplied. Inside glass it is opaque; outside, shadows and the outline are
// black with the alpha that darkens whatever is behind by the right amount, so the canvas can
// sit over the live page.
precision highp float;
precision highp int;

out vec4 outColor;

uniform vec4 uFragToLocal;
uniform vec4 uLocalToScreen;
uniform vec2 uViewport;
// local CSS px per output pixel, the width of the anti-aliasing ramp
uniform float uPixel;

uniform sampler2D uBackdrop;
uniform sampler2D uFrost;
uniform int uFrosted;
uniform vec2 uFrostScale;
uniform float uFrostGamma;

uniform sampler2D uLabels;
uniform int uLabeled;
uniform vec4 uLabelMap;

const int MAX_SHAPES = 8;
uniform int uBodyEnd;
uniform int uLensEnd;
uniform int uPillEnd;
// center, half size
uniform vec4 uBox[MAX_SHAPES];
// clockwise from the top left
uniform vec4 uRadii[MAX_SHAPES];
// lift, magnify, alpha, merge radius with the shapes before it in its group
uniform vec4 uShape[MAX_SHAPES];
// straight RGBA, alpha 0 for none
uniform vec4 uShapeTint[MAX_SHAPES];
uniform float uShapeLight[MAX_SHAPES];
// 0 for circular corners, 1 for continuous ones
uniform float uSmoothing[MAX_SHAPES];

uniform float uDark;
// The rim's bend: depth it runs (CSS px), inward pull at the edge as a share of the corner
// radius, the falloff's power, and the red/blue split.
uniform float uBezel;
uniform float uPull;
uniform float uFalloff;
uniform float uDispersion;
// The face's tone on luma: lift, gain, curve, saturation
uniform vec4 uFace;
// Lighting: specular rims, sheen, hairline on the flanks, hairline kept at top and bottom
uniform vec4 uLighting;
// A progressive blur instead of glass: 0 for glass, 1 laid over the page, 2 replacing the page's
// own content; the direction (x, y) from its strongest side in; and how far along it covers the
// page fully. uFrost is its strongest frost, these its two lighter ones (uv scales: A.xy, B.zw).
uniform vec4 uEdge;
uniform sampler2D uEdgeFrostA;
uniform sampler2D uEdgeFrostB;
uniform vec4 uEdgeScale;
// Frosted glass's sharp share: in the middle, and added towards the rim
uniform vec2 uSharp;
// The light: its axis on screen (y down) and the strength of specular glass's highlight (0: none)
uniform vec2 uLight;
uniform vec4 uTint;
// The dimming layer between the backdrop and the glass, 0..1 (clear glass over bright content)
uniform float uDim;
// x, y, sigma, spread
uniform vec4 uShadow;
uniform float uShadowAlpha;
uniform float uOpacity;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

struct Field {
  float d;
  vec2 n;
  vec2 c;
  vec2 h;
  // the corner radius where the point is
  float r;
  float alpha;
  float lift;
  float magnify;
  float light;
  vec4 tint;
};

// Continuous corners: a squircle at smoothing 0.8125. A corner of radius r keeps a circular arc around its middle
// and eases into each edge over a transition that reaches (1 + s) r from the corner along that
// edge. A side that is too short for its full reach gives up smoothing on that side only, so a
// capsule's ends stay a half circle while its long sides still ease in (its shoulders).
//
// The curve is drawn in polar form around the arc's centre C (r in from both edges): rho = r on
// the arc, and over a transition a cubic Hermite from the arc to the edge's tangent line, plus
// two terms fitted to the Bezier transition (within 0.03% of r for any smoothing up to 0.8125).
const float SQUIRCLE = 0.8125;
const float HALF_PI = 1.5707963;

// A transition of smoothing s, at polar angle psi from the edge's own axis: rho / r and its
// derivative with psi. psi runs from the arc's end (pi/2 - pi/4 s) to the edge (pi/2 + atan s).
vec2 transition(float s, float psi) {
  float pa = HALF_PI - 0.7853982 * s;
  float span = HALF_PI + atan(s) - pa;
  if (s < 1e-3 || psi <= pa) return vec2(1.0, 0.0);
  float u = clamp((psi - pa) / span, 0.0, 1.0);
  float root = sqrt(1.0 + s * s);
  float m1 = s * root * span;
  float s2 = s * s;
  float k1 = s2 * (-0.76417 + s * (0.00658 + s * (1.63745 - 0.77474 * s)));
  float k2 = s2 * (0.29963 + s * (-0.15395 + s * (0.60184 + 0.57503 * s)));
  float u2 = u * u;
  float v = 1.0 - u;
  float hermite = (2.0 * u2 * u - 3.0 * u2 + 1.0) + (3.0 * u2 - 2.0 * u2 * u) * root + (u2 * u - u2) * m1;
  float dHermite = (6.0 * u2 - 6.0 * u) + (6.0 * u - 6.0 * u2) * root + (3.0 * u2 - 2.0 * u) * m1;
  float bump = u2 * v * v;
  float dBump = 2.0 * u * v * v - 2.0 * u2 * v;
  float value = hermite + k1 * bump + k2 * bump * u;
  float slope = dHermite + k1 * dBump + k2 * (dBump * u + bump);
  return vec2(value, slope / span);
}

// Signed distance to shape i and the outward normal of its nearest edge. Exact along the straight
// edges; in a corner, the distance to the curve along its normal, to first order, and never
// deeper than the nearest edge's line.
float shapeDistance(int i, vec2 p, out vec2 normal) {
  vec4 box = uBox[i];
  vec2 rel = p - box.xy;
  vec2 h = box.zw;
  vec4 radii = uRadii[i];
  // Each corner owns the part of the shape nearest it. A side is split between its two corners
  // in proportion to their radii, so a large corner beside a small one (a menu's first row,
  // concentric with the menu above a small corner below) keeps its whole curve, and the two
  // curves meet on the straight part of the side between them.
  float splitLeft = h.y * (2.0 * radii.x / max(radii.x + radii.w, 1e-3) - 1.0);
  float splitRight = h.y * (2.0 * radii.y / max(radii.y + radii.z, 1e-3) - 1.0);
  bool top = rel.y < (rel.x < 0.0 ? splitLeft : splitRight);
  float splitTop = h.x * (2.0 * radii.x / max(radii.x + radii.y, 1e-3) - 1.0);
  float splitBottom = h.x * (2.0 * radii.w / max(radii.w + radii.z, 1e-3) - 1.0);
  bool left = rel.x < (top ? splitTop : splitBottom);
  float r = left ? (top ? radii.x : radii.w) : (top ? radii.y : radii.z);
  // No corner reaches past its share of either side.
  float shareY = left ? (top ? splitLeft + h.y : h.y - splitLeft) : (top ? splitRight + h.y : h.y - splitRight);
  float shareX = top ? (left ? splitTop + h.x : h.x - splitTop) : (left ? splitBottom + h.x : h.x - splitBottom);
  r = min(r, min(shareX, shareY));
  float most = SQUIRCLE * clamp(uSmoothing[i], 0.0, 1.0);
  // Smoothing along the horizontal edge (it eases into the top or bottom) and the vertical one.
  float sTop = r > 1e-3 ? clamp(shareX / r - 1.0, 0.0, most) : 0.0;
  float sSide = r > 1e-3 ? clamp(shareY / r - 1.0, 0.0, most) : 0.0;
  // Measured from the owning corner, not mirrored about the middle: a corner's region can
  // reach past the middle when it is the larger of the two on its side.
  vec2 side = vec2(left ? -1.0 : 1.0, top ? -1.0 : 1.0);
  vec2 q = rel * side - (h - r);
  float edge = max(q.x, q.y) - r;
  float span = length(q);
  float phi = atan(q.y, q.x);
  if (r > 1e-3 && span > 1e-4 && phi >= -atan(sSide) && phi <= HALF_PI + atan(sTop)) {
    vec2 u = q / span;
    // The top's transition is measured from the x axis, the side's (mirrored) from the y axis.
    vec2 shape = phi > 0.7853982 ? transition(sTop, phi) : transition(sSide, HALF_PI - phi) * vec2(1.0, -1.0);
    float rho = r * shape.x;
    float slope = shape.y / shape.x;
    float stretch = sqrt(1.0 + slope * slope);
    normal = (u - slope * vec2(-u.y, u.x)) / stretch * side;
    return max((span - rho) / stretch, edge);
  }
  if (max(q.x, q.y) > 0.0) {
    // Beside one straight edge.
    normal = (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) * side;
  } else {
    // Along the straight edges, lean towards every edge that is nearly as close, so the bend
    // turns smoothly around tight corners instead of folding along the diagonal.
    vec2 w = exp((q - max(q.x, q.y)) / max(uBezel * 0.35, 1.0));
    normal = normalize(w * side);
  }
  return edge;
}

float shapeDistanceOnly(int i, vec2 p) {
  vec2 normal;
  return shapeDistance(i, p, normal);
}

Field shapeField(int i, vec2 p) {
  Field f;
  f.d = shapeDistance(i, p, f.n);
  f.c = uBox[i].xy;
  f.h = uBox[i].zw;
  vec2 rel = p - f.c;
  vec4 radii = uRadii[i];
  f.r = min(rel.x < 0.0 ? (rel.y < 0.0 ? radii.x : radii.w) : (rel.y < 0.0 ? radii.y : radii.z), min(f.h.x, f.h.y));
  f.lift = uShape[i].x;
  f.magnify = uShape[i].y;
  f.alpha = uShape[i].z;
  f.light = uShapeLight[i];
  f.tint = uShapeTint[i];
  return f;
}

// Polynomial smooth-min. Every attribute blends with the same share, so the refraction of
// the melted shape stays continuous where two shapes meet.
float shareOf(float a, float b, float k) {
  return k > 1e-3 ? clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0) : (a <= b ? 1.0 : 0.0);
}

Field groupField(int from, int to, vec2 p) {
  Field a = shapeField(from, p);
  for (int i = from + 1; i < to; i += 1) {
    Field b = shapeField(i, p);
    float k = uShape[i].w;
    float s = shareOf(a.d, b.d, k);
    a.d = mix(b.d, a.d, s) - k * s * (1.0 - s);
    a.n = mix(b.n, a.n, s);
    a.c = mix(b.c, a.c, s);
    a.h = mix(b.h, a.h, s);
    a.r = mix(b.r, a.r, s);
    a.alpha = mix(b.alpha, a.alpha, s);
    a.lift = mix(b.lift, a.lift, s);
    a.magnify = mix(b.magnify, a.magnify, s);
    a.light = mix(b.light, a.light, s);
    a.tint = mix(b.tint, a.tint, s);
  }
  float length2 = dot(a.n, a.n);
  a.n = length2 > 1e-8 ? a.n * inversesqrt(length2) : vec2(0.0, -1.0);
  return a;
}

float groupDistance(int from, int to, vec2 p) {
  float a = shapeDistanceOnly(from, p);
  for (int i = from + 1; i < to; i += 1) {
    float b = shapeDistanceOnly(i, p);
    float k = uShape[i].w;
    float s = shareOf(a, b, k);
    a = mix(b, a, s) - k * s * (1.0 - s);
  }
  return a;
}

float gaussianEdge(float x) {
  float a = abs(x) * 0.70710678;
  float t = 1.0 + a * (0.278393 + a * (0.230389 + a * (0.000972 + a * 0.078108)));
  float e = 1.0 - 1.0 / (t * t * t * t);
  return 0.5 * (1.0 + sign(x) * e);
}

float coverage(float d) {
  return clamp(0.5 - d / uPixel, 0.0, 1.0);
}

vec2 toScreen(vec2 local) {
  return local * uLocalToScreen.xy + uLocalToScreen.zw;
}

vec3 sharpAt(vec2 local) {
  return texture(uBackdrop, toScreen(local) / uViewport).rgb;
}

vec3 behindAt(vec2 local) {
  if (uFrosted == 1) return pow(texture(uFrost, toScreen(local) * uFrostScale).rgb, vec3(1.0 / uFrostGamma));
  return sharpAt(local);
}

// The face's tone: a milky lift of the darks and a gain on luma, then saturation around the
// toned luma. Clear glass is the identity.
vec3 face(vec3 seen) {
  float l = dot(seen, LUMA);
  vec3 toned = seen + uFace.x + l * (uFace.y - uFace.z * l) - l;
  float tl = dot(toned, LUMA);
  return clamp(vec3(tl) + (toned - vec3(tl)) * uFace.w, 0.0, 1.0);
}

// Colored glass keeps some of the light and dark of what is behind it.
vec3 tinted(vec3 seen, vec4 tint) {
  float l = dot(seen, LUMA);
  return mix(seen, clamp(tint.rgb * (0.75 + 0.5 * l), 0.0, 1.0), tint.a);
}

// The light comes from straight above (y is down); specular glass turns the same highlights to
// `uLight`, so they slide around the rim toward the pointer and stay exactly as subtle.
const vec2 LIGHT_AXIS = vec2(0.0, -1.0);
const float BEVEL = 1.2;
const float SHINE_POWER = 3.0;
const float SHEEN_DEPTH = 6.0;
const float SHADE = 0.019;
const float HAIRLINE_WIDTH = 0.85;

float bevelGleam(vec2 n, float tilt, vec3 light) {
  vec3 surface = vec3(n * sin(tilt), cos(tilt));
  return pow(max(dot(surface, light), 0.0), SHINE_POWER);
}

// The lighting on the face: a faint shade inside the lit edge and along the flanks, a sheen
// screen-blended just inside the top and bottom, and two thin specular rims on the bevel.
vec3 finish(vec3 seen, vec2 n, float within, float amount) {
  vec2 axis = uLight.xy;
  float facing = dot(n, axis);
  float entry = pow(max(facing, 0.0), SHINE_POWER);
  float exit = pow(max(-facing, 0.0), SHINE_POWER);
  float flank = 1.0 - abs(facing);
  float bump = smoothstep(0.0, 7.0, within) * (1.0 - smoothstep(7.0, 18.0, within));
  float flankBand = 1.0 - smoothstep(5.0, 17.0, within);
  seen *= 1.0 - clamp(amount * (SHADE * max(facing, 0.0) * bump + SHADE * flank * flankBand), 0.0, 1.0);
  float tilt = (1.0 - clamp(within / BEVEL, 0.0, 1.0)) * 1.5707963;
  vec3 light = vec3(axis, 0.0);
  float gleam = uLighting.x * (bevelGleam(n, tilt, light) + bevelGleam(n, tilt, vec3(-light.xy, light.z)));
  float carried = 1.0 - clamp(within / SHEEN_DEPTH, 0.0, 1.0);
  float sheen = uLighting.y * (entry + exit) * carried;
  seen += (1.0 - seen) * clamp(sheen * amount, 0.0, 1.0);
  return min(seen + gleam * amount, vec3(1.0));
}

// The hairline just outside the edge, subtracted from what is behind: strongest on the flanks.
float hairline(vec2 n, float d) {
  float flank = 1.0 - abs(dot(n, LIGHT_AXIS));
  float band = clamp(d / uPixel + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.0, HAIRLINE_WIDTH, d));
  return clamp(uLighting.z * mix(uLighting.w, 1.0, flank) * band, 0.0, 1.0);
}

// How far the rim pulls a point inward, at `within` px inside an edge of corner radius `radius`.
float rimPull(float within, float radius) {
  float band = clamp(uBezel, 1.0, radius);
  return radius * uPull * pow(1.0 - clamp(within / band, 0.0, 1.0), uFalloff);
}

vec3 bodyColor(vec2 p, Field f) {
  float within = max(-f.d, 0.0);
  float radius = max(min(f.r, min(f.h.x, f.h.y)), 1.0);
  float pull = rimPull(within, radius);
  float spread = uDispersion * pull / max(radius * uPull, 1e-3);
  vec2 shift = -f.n * pull;
  vec2 at = f.c + (p - f.c) / max(f.magnify, 1e-3);
  vec3 seen;
  if (spread > 1e-3) {
    seen = vec3(
      behindAt(at + shift * (1.0 - spread)).r,
      behindAt(at + shift).g,
      behindAt(at + shift * (1.0 + spread)).b
    );
  } else {
    seen = behindAt(at + shift);
  }
  if (uFrosted == 1) {
    // Part of the sharp backdrop shows through the frost, most at the rim, so the bend reads.
    float rim = pull / max(radius * uPull, 1e-3);
    float share = clamp(uSharp.x + uSharp.y * rim, 0.0, 1.0);
    if (share > 1e-3) {
      vec3 sharp = spread > 1e-3
        ? vec3(sharpAt(at + shift * (1.0 - spread)).r, sharpAt(at + shift).g, sharpAt(at + shift * (1.0 + spread)).b)
        : sharpAt(at + shift);
      seen = mix(seen, sharp, share);
    }
  }
  seen = face(seen * (1.0 - uDim));
  if (uTint.a > 0.0) seen = tinted(seen, uTint);
  if (f.tint.a > 0.0) seen = tinted(seen, f.tint);
  seen += (1.0 - seen) * f.light * (uDark > 0.5 ? 0.18 : 0.3);
  return finish(seen, f.n, within, 1.0);
}

vec4 pillsAt(vec2 p) {
  vec4 sum = vec4(0.0);
  for (int i = uLensEnd; i < uPillEnd; i += 1) {
    float c = coverage(shapeDistanceOnly(i, p)) * uShape[i].z;
    if (c <= 0.0) continue;
    vec4 tint = uShapeTint[i].a > 0.0 ? uShapeTint[i] : (uDark > 0.5 ? vec4(1.0, 1.0, 1.0, 0.12) : vec4(0.0, 0.0, 0.0, 0.075));
    // On light glass the pill is a touch lighter at the top, like a lit groove.
    float lift = uDark > 0.5 ? 1.0 : 1.0 + 0.17 * clamp(-(p.y - uBox[i].y) / max(uBox[i].w, 1.0), -1.0, 1.0);
    vec4 ink = vec4(clamp(tint.rgb * lift, 0.0, 1.0) * tint.a, tint.a) * c;
    sum = ink + sum * (1.0 - ink.a);
  }
  return sum;
}

// The bodies with everything on them, premultiplied: glass, pills and labels inside, the shadow
// and outline outside.
// A progressive blur. Along it, from the faint side to the strong one, what is behind passes
// through three frosts, each about three times the last, blended so the blur deepens without a
// step. It covers the page fully early on, while it still looks like the page, and fades out to
// nothing at the faint side, where the page shows exactly as it is.
//
// Laid over an opaque page, it reads the page and is opaque where it covers. Replacing the
// content of a see-through page, it reads a backdrop holding only that content, and is as
// see-through as the content is.
vec4 edgeAt(vec2 p) {
  vec4 box = uBox[0];
  vec2 rel = (p - box.xy) / max(box.zw, vec2(1e-3));
  // 1 at the strong side, 0 at the other.
  float t = clamp(0.5 - 0.5 * dot(rel, uEdge.yz), 0.0, 1.0);
  vec2 screen = toScreen(p);
  vec4 sharp = texture(uBackdrop, screen / uViewport);
  vec4 light = texture(uEdgeFrostA, screen * uEdgeScale.xy);
  vec4 middle = texture(uEdgeFrostB, screen * uEdgeScale.zw);
  vec4 strong = texture(uFrost, screen * uFrostScale);
  // Slow to start, so the blur is still light halfway and deepens fast near the strong side.
  float level = 3.0 * t * t;
  vec4 seen = level < 1.0
    ? mix(sharp, light, level)
    : level < 2.0 ? mix(light, middle, level - 1.0) : mix(middle, strong, level - 2.0);
  if (uEdge.x < 1.5) seen.a = 1.0;
  if (uTint.a > 0.0) {
    float tinted = uTint.a * t * t * (3.0 - 2.0 * t);
    seen = vec4(uTint.rgb * tinted, tinted) + seen * (1.0 - tinted);
  }
  float c = clamp(t / max(uEdge.w, 1e-3), 0.0, 1.0);
  return seen * (c * c * (3.0 - 2.0 * c));
}

vec4 groundAt(vec2 p) {
  if (uBodyEnd <= 0) return vec4(0.0);
  if (uEdge.x > 0.5) return edgeAt(p);
  Field f = groupField(0, uBodyEnd, p);
  float cover = coverage(f.d) * f.alpha;
  float dark = 0.0;
  if (f.d > -uPixel) {
    // Subtracting the hairline from what is behind is darkening it by hairline / channel.
    vec3 under = sharpAt(p);
    float h = hairline(f.n, f.d);
    dark = clamp(h / max(min(under.r, min(under.g, under.b)), 0.004), 0.0, 1.0) * f.alpha;
  }
  if (uShadowAlpha > 0.0 && cover < 1.0) {
    float castDistance = groupDistance(0, uBodyEnd, p - uShadow.xy) - uShadow.w;
    float shade = uShadow.z > 0.0 ? 1.0 - gaussianEdge(castDistance / uShadow.z) : coverage(castDistance);
    dark = 1.0 - (1.0 - dark) * (1.0 - uShadowAlpha * shade * f.alpha);
  }
  vec4 outside = vec4(0.0, 0.0, 0.0, dark);
  if (cover <= 0.0) return outside;
  vec3 body = bodyColor(p, f);
  vec4 pill = pillsAt(p);
  body = pill.rgb + body * (1.0 - pill.a);
  if (uLabeled == 1) {
    vec4 label = texture(uLabels, p * uLabelMap.xy + uLabelMap.zw);
    body = label.rgb + body * (1.0 - label.a);
  }
  return vec4(body * cover, cover) + outside * (1.0 - cover);
}

// What a lens sees at a point: the bodies composited over the sharp backdrop.
vec3 groundOpaque(vec2 p) {
  vec4 ground = groundAt(p);
  return ground.rgb + sharpAt(p) * (1.0 - ground.a);
}

vec4 lensAt(vec2 p, vec4 under) {
  Field f = groupField(uBodyEnd, uLensEnd, p);
  float cover = coverage(f.d) * f.alpha;
  float halfMin = max(min(f.h.x, f.h.y), 1.0);
  // Lens numbers are tuned for a lens about 84 px tall and scale with it.
  float fit = clamp(halfMin / 42.0, 0.25, 1.5);
  float lift = clamp(f.lift, 0.0, 1.0);

  // A lifted lens casts a soft ring of shadow just past its edge.
  float sigma = 9.0 * fit;
  float drop = groupDistance(uBodyEnd, uLensEnd, p - vec2(0.0, 6.0 * fit));
  float ring = gaussianEdge((drop + min(36.0 * fit, halfMin * 0.9)) / sigma) - gaussianEdge(drop / sigma);
  float shade = clamp(0.06 * lift * f.alpha * ring * (1.0 - cover), 0.0, 1.0);
  vec4 result = vec4(under.rgb * (1.0 - shade), under.a + shade * (1.0 - under.a));
  if (cover <= 0.0) return result;

  float within = max(-f.d, 0.0);
  // At rest a thumb bends like the body; lifted it bends like a lens, hard and only at the
  // very rim, with color fringes there.
  float bodyPull = rimPull(within, max(min(f.r, halfMin), 1.0));
  vec2 bodyShift = -f.n * bodyPull;
  // The lens: its middle shows what is
  // under it unbent; only its outer tenth bends, by 0.155 of its height at the very rim, along a
  // quarter circle, with red and blue parting from green by up to 0.053 of its height there.
  float size = 2.0 * halfMin;
  float lensBand = max(0.1 * size, 1.0);
  float t = clamp(within / lensBand, 0.0, 1.0);
  float lensCurve = 1.0 - sqrt(max(t * (2.0 - t), 0.0));
  vec2 lensShift = -f.n * 0.155 * size * lensCurve;
  vec2 shift = mix(bodyShift, lensShift, lift);
  // Fringes only right at the rim, where the bend is steepest.
  float split = mix(uDispersion * bodyPull, 0.03 * size * lensCurve * lensCurve, lift);
  vec2 at = f.c + (p - f.c) / max(f.magnify, 1e-3) + shift;
  vec3 seen;
  if (split > 0.01) {
    seen = vec3(groundOpaque(at - f.n * split).r, groundOpaque(at).g, groundOpaque(at + f.n * split).b);
  } else {
    seen = groundOpaque(at);
  }
  // A thumb's tint is its paint (a white knob at rest), so it covers rather than colors.
  if (f.tint.a > 0.0) seen = mix(seen, f.tint.rgb, f.tint.a);
  seen += (1.0 - seen) * f.light * (uDark > 0.5 ? 0.18 : 0.3);
  seen = finish(seen, f.n, within, 1.0);
  float line = (1.0 - smoothstep(0.0, uPixel * 0.9, within)) * 0.45 * (uDark > 0.5 ? 0.4 : 1.6) * smoothstep(0.0, 0.35, lift);
  vec3 edge = uDark > 0.5 ? vec3(0.75, 0.75, 0.78) : vec3(0.7, 0.7, 0.72);
  seen = mix(seen, edge, clamp(line, 0.0, 1.0));
  return vec4(seen * cover, cover) + result * (1.0 - cover);
}

void main() {
  vec2 p = gl_FragCoord.xy * uFragToLocal.xy + uFragToLocal.zw;
  vec4 color = groundAt(p);
  if (uLensEnd > uBodyEnd) color = lensAt(p, color);
  outColor = color * uOpacity;
}
