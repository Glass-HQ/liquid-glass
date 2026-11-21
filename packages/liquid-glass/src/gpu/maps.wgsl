// Lisse outlines tessellated once on the host, shared with DOM clipping.
// A batch renders several shapes into one atlas: each shape owns a band of
// rows holding its three planes, so every map of an animation path is one
// pass and one readback. The field plane carries displacement in red and
// green and shape coverage in alpha; SVG reads a displacement map
// unpremultiplied, so the two never interfere. The rim plane is the fine
// outline just outside the shape, as black coverage the backdrop darkens by,
// and a faint ring of shade inside it;
// the light plane is the key and fill light on the rim, as white light the
// glass adds to its face.
struct Shape {
  size: vec2f,
  // First atlas row of this shape, and physical rows per plane.
  row: f32,
  rows: f32,
  // Physical columns this shape covers; the atlas is as wide as its widest shape.
  columns: f32,
  dpr: f32,
  dark: f32,
  symmetric: f32,
  // Outline segment range in the shared segment table.
  start: u32,
  count: u32,
  // 0: Regular; 1: Clear and lens, whose light is brighter.
  rim: f32,
  // How deep the rim's bend runs, in CSS pixels: set by the material and size.
  height: f32,
}
struct Batch { count: u32, pad: vec3u, shapes: array<Shape, 32> }
struct Outline { segments: array<vec4f, 4096> }
@group(0) @binding(0) var<uniform> batch: Batch;
@group(0) @binding(1) var<uniform> outline: Outline;
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn shape(s: Shape, point: vec2f) -> vec3f {
  let symmetric = s.symmetric != 0.0;
  let p = select(point, vec2f(abs(point.x), -abs(point.y)), symmetric) + s.size * 0.5;
  var distance2 = 1e20;
  var delta = vec2f(0.0);
  var outward = vec2f(0.0, -1.0);
  for (var i = s.start; i < s.start + s.count; i++) {
    let segment = outline.segments[i];
    let edge = segment.zw - segment.xy;
    let nearest = segment.xy + edge * sat(dot(p-segment.xy, edge) / dot(edge, edge));
    let v = p - nearest;
    let d2 = dot(v, v);
    if (d2 < distance2) {
      distance2 = d2;
      delta = v;
      outward = normalize(vec2f(edge.y, -edge.x));
    }
  }
  let direction = select(-1.0, 1.0, dot(delta, outward) >= 0.0);
  let distance = sqrt(distance2);
  let normal = select(outward, delta * direction / max(distance, 0.00001), distance > 0.00001);
  return vec3f(distance * direction, select(normal, vec2f(normal.x, -normal.y) * sign(point), symmetric));
}
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  var index = 0u;
  for (var k = 1u; k < batch.count; k++) {
    if (position.y >= batch.shapes[k].row) { index = k; }
  }
  let s = batch.shapes[index];
  let band = position.y - s.row;
  let plane = min(u32(band / s.rows), 2u);
  let local = vec2f(position.x / s.columns, (band - f32(plane) * s.rows) / s.rows);
  let point = local * (s.size + 4.0) - (s.size + 4.0) * 0.5;
  let field = shape(s, point);
  let d = field.x; let n = field.yz;
  let aa = max(fwidth(d), 1.0 / s.dpr);
  // Derivatives above stay in uniform control flow; columns past this
  // shape's width belong to a wider shape in the same atlas.
  if (position.x >= s.columns) { return vec4f(0.0); }
  let coverage = sat(0.5 - d / aa);
  let depth = sat(-d / max(s.height, 0.001));
  let edge = 1.0 - sat(sqrt((2.0 - depth) * depth));
  if (plane == 0u) { return vec4f(vec2f(0.5) - n * edge * 0.5, 0.5, coverage); }
  if (plane == 1u) {
    // The outline, as macOS draws it in an active window: the device pixel
    // just outside the shape darkens what is behind it, by
    // a share of it that depends on its brightness (see outlineFor). It is
    // strongest where the edge faces sideways and gone by 45 degrees around a
    // corner; light Regular glass keeps a little of it at the top and bottom. The plane stores 2b as coverage:
    // a black line of that coverage over mid gray darkens it exactly so.
    let line = sat(1.0 - abs(d - 0.5 * aa) / aa);
    let top = select(0.0, 0.08, s.rim < 0.5 && s.dark < 0.5);
    let b = top + (0.24 - top) * pow(abs(n.x), 8.0);
    // Regular glass also shades its face faintly along a ring: its edge moved
    // 8 points down and softened, so about 9 points in at the top, beside the
    // edge on the sides, and gone at the bottom. Drawn over the face.
    let shifted = d - 8.0 * n.y;
    let ring = select(0.022 * exp(-(shifted + 1.5) * (shifted + 1.5) / 23.0) * coverage, 0.0, s.rim > 0.5);
    return vec4f(vec3f(0.0), max(2.0 * b * line, ring));
  }
  // The key light from above and the fill light from below: added to the
  // glass, strongest on the outermost half point, about half as bright a
  // point in, and a faint glow over the next few points.
  let inside = max(0.0, -d);
  var falloff: f32;
  if (inside < 0.25) { falloff = 1.0; }
  else if (inside < 0.75) { falloff = mix(1.0, 0.57, (inside - 0.25) / 0.5); }
  else if (inside < 1.25) { falloff = mix(0.57, 0.22, (inside - 0.75) / 0.5); }
  else if (inside < 2.25) { falloff = mix(0.22, 0.13, inside - 1.25); }
  else if (inside < 4.25) { falloff = mix(0.13, 0.06, (inside - 2.25) / 2.0); }
  else { falloff = max(0.0, 0.06 * (1.0 - (inside - 4.25) / 4.0)); }
  // Around the shape the light is a narrow peak with a soft tail: half as
  // bright 25 degrees from the top, a quarter at 45, gone by 80.
  let angle = degrees(acos(clamp(abs(n.y), 0.0, 1.0)));
  let lobe = 0.45 * exp(-angle * angle / 512.0) + 0.55 * max(0.0, 1.0 - angle / 80.0);
  let amount = select(0.243, 0.4, s.rim > 0.5);
  return vec4f(vec3f(1.0), amount * lobe * falloff * coverage);
}
