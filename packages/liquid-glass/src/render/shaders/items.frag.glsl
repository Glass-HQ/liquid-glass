#version 300 es
// Paints one display list item: a rounded, bordered box, its outer box-shadows, or a bitmap,
// clipped by its chain of (rounded) clips. Output is premultiplied, blended ONE, 1 - SRC_ALPHA.
precision highp float;
precision highp int;

in vec2 vPoint;
flat in vec4 vRect;
flat in vec4 vRadii;
flat in vec4 vPaint;
flat in vec4 vExtra;
flat in vec4 vInk;
flat in int vKind;
flat in int vClip;
flat in float vOpacity;
flat in float vPixel;
flat in vec2 vBase;

uniform highp sampler2D uScroll;
uniform highp sampler2D uClips;
uniform sampler2D uPage;

out vec4 outColor;

// Signed distance to a rounded box centred at the origin, radii clockwise from the top left
// (y grows downwards).
float roundedBox(vec2 p, vec2 halfSize, vec4 radii) {
  float radius = p.x < 0.0 ? (p.y < 0.0 ? radii.x : radii.w) : (p.y < 0.0 ? radii.y : radii.z);
  radius = min(radius, min(halfSize.x, halfSize.y));
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float cover(float d) {
  return clamp(0.5 - d / vPixel, 0.0, 1.0);
}

// Abramowitz-Stegun erf: the share of a Gaussian blob past a straight edge.
float gaussianEdge(float x) {
  float a = abs(x) * 0.70710678;
  float t = 1.0 + a * (0.278393 + a * (0.230389 + a * (0.000972 + a * 0.078108)));
  float e = 1.0 - 1.0 / (t * t * t * t);
  return 0.5 * (1.0 + sign(x) * e);
}

vec2 scrollOffset(int index) {
  return texelFetch(uScroll, ivec2(index % 1024, index / 1024), 0).xy;
}

float clipCoverage(vec2 p) {
  float amount = 1.0;
  int index = vClip;
  for (int depth = 0; depth < 8; depth += 1) {
    if (index < 0) break;
    ivec2 at = ivec2((index % 256) * 3, index / 256);
    vec4 rect = texelFetch(uClips, at, 0);
    vec4 radii = texelFetch(uClips, at + ivec2(1, 0), 0);
    vec4 link = texelFetch(uClips, at + ivec2(2, 0), 0);
    vec2 shift = scrollOffset(int(link.x + 0.5)) - vBase;
    amount *= cover(roundedBox(p - rect.xy - shift - rect.zw * 0.5, rect.zw * 0.5, radii));
    if (amount <= 0.0) return 0.0;
    index = int(link.y + (link.y < 0.0 ? -0.5 : 0.5));
  }
  return amount;
}

void main() {
  vec2 halfSize = vRect.zw * 0.5;
  vec2 p = vPoint - vRect.xy - halfSize;
  float outer = cover(roundedBox(p, halfSize, vRadii));
  vec4 color;
  if (vKind == 1) {
    vec2 along = clamp((vPoint - vRect.xy) / max(vRect.zw, vec2(1e-4)), 0.0, 1.0);
    // Stay half a texel inside the source rect so filtering never reads a neighbour.
    vec2 low = min(vPaint.xy, vPaint.zw) + vExtra.xy * 0.5;
    vec2 high = max(vPaint.xy, vPaint.zw) - vExtra.xy * 0.5;
    vec2 uv = clamp(mix(vPaint.xy, vPaint.zw, along), low, high);
    bool rounded = max(max(vRadii.x, vRadii.y), max(vRadii.z, vRadii.w)) > 0.0;
    color = texture(uPage, uv) * (rounded ? outer : 1.0);
  } else if (vKind == 2) {
    float spread = vExtra.y;
    vec4 radii = vec4(
      vRadii.x > 0.0 ? max(vRadii.x + spread, 0.0) : 0.0,
      vRadii.y > 0.0 ? max(vRadii.y + spread, 0.0) : 0.0,
      vRadii.z > 0.0 ? max(vRadii.z + spread, 0.0) : 0.0,
      vRadii.w > 0.0 ? max(vRadii.w + spread, 0.0) : 0.0);
    float d = roundedBox(p - vExtra.zw, max(halfSize + spread, vec2(0.0)), radii);
    float shade = vExtra.x > 0.0 ? 1.0 - gaussianEdge(d / vExtra.x) : cover(d);
    // An outer shadow only shows outside the border box it belongs to.
    color = vInk * shade * (1.0 - outer);
  } else {
    vec4 border = vExtra;
    vec4 fill = vPaint * outer;
    if (max(max(border.x, border.y), max(border.z, border.w)) > 0.0) {
      vec2 innerLow = vec2(border.w, border.x);
      vec2 innerSize = max(vRect.zw - vec2(border.y + border.w, border.x + border.z), vec2(0.0));
      vec4 innerRadii = max(vRadii - vec4(max(border.w, border.x), max(border.x, border.y), max(border.y, border.z), max(border.z, border.w)), vec4(0.0));
      float inner = innerSize.x > 0.0 && innerSize.y > 0.0
        ? cover(roundedBox(vPoint - vRect.xy - innerLow - innerSize * 0.5, innerSize * 0.5, innerRadii))
        : 0.0;
      vec4 ring = vInk * max(outer - inner, 0.0);
      color = ring + fill * (1.0 - ring.a);
    } else {
      color = fill;
    }
  }
  float clipped = vClip >= 0 ? clipCoverage(vPoint) : 1.0;
  outColor = color * (vOpacity * clipped);
}
