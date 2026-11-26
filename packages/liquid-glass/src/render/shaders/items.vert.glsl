#version 300 es
// Display list items as instanced quads (four vertices from gl_VertexID, no vertex buffer).
// Items are captured in viewport CSS px. Each frame they shift by how far their scroller has
// moved, and items owned by a glass surface also follow that surface (anchor -> now).
precision highp float;
precision highp int;

layout(location = 0) in vec4 aRect;
layout(location = 1) in vec4 aRadii;
// box: fill; bitmap: uv rect in its atlas page (all colors premultiplied)
layout(location = 2) in vec4 aPaint;
// box: border widths (top, right, bottom, left); shadow: sigma, spread, x, y; bitmap: 1 / page size
layout(location = 3) in vec4 aExtra;
// box: border color; shadow: color
layout(location = 4) in vec4 aInk;
// kind, clip index (-1 none), scroller index, opacity
layout(location = 5) in vec4 aMeta;
// the owner's screen origin and scale when the item was captured
layout(location = 6) in vec4 aAnchor;
// owner slot (0: the page)
layout(location = 7) in vec4 aOwner;

uniform highp sampler2D uScroll;
uniform highp sampler2D uOwners;
// 0: the target is the viewport; 1: the target is one surface's own canvas space (labels)
uniform int uSpace;
// label space: where local (0, 0) of the surface lands, in CSS px (the bleed)
uniform vec2 uLocalOrigin;
// target device px per CSS px
uniform float uScale;
// target size in device px
uniform vec2 uTarget;
// target region in device px [x0, y0, x1, y1]; quads wholly outside are culled
uniform vec4 uCull;
// 1: draw only items that scroll inside a scroller a progressive blur replaces
uniform int uOnly;

out vec2 vPoint;
flat out vec4 vRect;
flat out vec4 vRadii;
flat out vec4 vPaint;
flat out vec4 vExtra;
flat out vec4 vInk;
flat out int vKind;
flat out int vClip;
flat out float vOpacity;
flat out float vPixel;
flat out vec2 vBase;

// xy: how far the scroller has moved; z: 1 inside a scroller a progressive blur replaces
vec3 scrollerAt(int index) {
  return texelFetch(uScroll, ivec2(index % 1024, index / 1024), 0).xyz;
}

void main() {
  int kind = int(aMeta.x + 0.5);
  int slot = int(aOwner.x + 0.5);
  vec4 now = slot > 0 ? texelFetch(uOwners, ivec2(0, slot), 0) : vec4(0.0, 0.0, 1.0, 1.0);
  vec2 base = slot > 0 ? texelFetch(uOwners, ivec2(1, slot), 0).xy : vec2(0.0);
  // Item space: capture coordinates plus scrolling. An owned item moves with its surface, so
  // the scrolling the surface itself already shows (its base scroller) is taken out.
  vec3 scroller = scrollerAt(int(aMeta.z + 0.5));
  vec2 shift = scroller.xy - base;
  vec4 rect = vec4(aRect.xy + shift, aRect.zw);

  // Item space -> target CSS px is a scale and an offset.
  vec2 scale = vec2(1.0);
  vec2 offset = vec2(0.0);
  if (slot > 0) {
    vec2 anchorScale = max(aAnchor.zw, vec2(1e-4));
    if (uSpace == 1) {
      scale = 1.0 / anchorScale;
      offset = uLocalOrigin - aAnchor.xy * scale;
    } else {
      scale = now.zw / anchorScale;
      offset = now.xy - aAnchor.xy * scale;
    }
  } else if (uSpace == 1) {
    offset = uLocalOrigin;
  }
  float pixel = 1.0 / (uScale * min(scale.x, scale.y));

  float grow = 0.0;
  if (kind == 0) grow = pixel;
  if (kind == 2) grow = aExtra.y + 3.0 * aExtra.x + max(abs(aExtra.z), abs(aExtra.w)) + pixel;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 origin = rect.xy - grow;
  vec2 span = rect.zw + 2.0 * grow;
  vec2 point = origin + corner * span;

  vec2 low = (origin * scale + offset) * uScale;
  vec2 high = ((origin + span) * scale + offset) * uScale;
  bool outside = high.x <= uCull.x || high.y <= uCull.y || low.x >= uCull.z || low.y >= uCull.w || aMeta.w <= 0.0;
  if (uOnly == 1 && (slot > 0 || scroller.z < 0.5)) outside = true;
  vec2 target = (point * scale + offset) * uScale;
  // Targets are stored top row first, so CSS y grows with clip-space y.
  gl_Position = outside ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(target / uTarget * 2.0 - 1.0, 0.0, 1.0);

  vPoint = point;
  vRect = rect;
  vRadii = aRadii;
  vPaint = aPaint;
  vExtra = aExtra;
  vInk = aInk;
  vKind = kind;
  vClip = int(aMeta.y + (aMeta.y < 0.0 ? -0.5 : 0.5));
  vOpacity = aMeta.w;
  vPixel = pixel;
  vBase = base;
}
