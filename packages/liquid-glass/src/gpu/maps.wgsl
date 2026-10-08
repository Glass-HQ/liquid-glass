// Lisse outlines tessellated once on the host, shared with DOM clipping.
// A batch renders several shapes into one atlas: each shape owns a band of
// rows holding its four planes, so every map of an animation path is one
// pass and one readback.
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
  pad: vec2u,
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
  let plane = min(u32(band / s.rows), 3u);
  let local = vec2f(position.x / s.columns, (band - f32(plane) * s.rows) / s.rows);
  let point = local * (s.size + 4.0) - (s.size + 4.0) * 0.5;
  let field = shape(s, point);
  let d = field.x; let n = field.yz;
  let aa = max(fwidth(d), 1.0 / s.dpr);
  // Derivatives above stay in uniform control flow; columns past this
  // shape's width belong to a wider shape in the same atlas.
  if (position.x >= s.columns) { return vec4f(0.0); }
  let coverage = sat(0.5 - d / aa);
  let depth = sat(-d * 0.05);
  let edge = 1.0 - sat(sqrt((2.0 - depth) * depth));
  if (plane == 0u) { return vec4f(vec2f(0.5) - n * edge * 0.5, 0.5, 1.0); }
  if (plane == 1u) { return vec4f(1, 1, 1, coverage); }
  // Keep the top/bottom light away from the side outline, including capsules.
  let spread = 1.08;
  let directional = pow(sat((abs(n.y) - cos(spread)) / (1.0 - cos(spread))), 1.25);
  let diffuseDir = pow(sat((abs(n.y) - cos(spread * 0.65)) / (1.0 - cos(spread * 0.65))), 1.25);
  let stroke = sat((d + 0.9) / aa + 0.5) * sat(0.5 - d / aa);
  var specular = directional * stroke;
  specular = specular / (1.0 + 0.5 * (1.0 - specular));
  let diffuse = diffuseDir * 0.18 * pow(1.0 - sat(-d / 4.5), 2.0) * coverage;
  let highlight = sat(specular * mix(1.0, 0.82, s.dark) + diffuse * mix(1.0, 0.40, s.dark));
  if (plane == 2u) { return vec4f(vec3f(mix(1.0, 0.82, s.dark)), highlight); }
  let adjusted = d - 0.5;
  let falloff = 1.0 - sat(-adjusted / 0.5);
  let ramp = mix(select(0.0, 1.0, falloff > 0.0), falloff, 0.75);
  let outline = ramp * sat((adjusted + 0.5) / aa + 0.5) * sat(-adjusted / aa + 0.5);
  let sideSpread = 0.98;
  let weights = clamp((vec2f(n.x, -n.x) - cos(sideSpread)) / (1.0 - cos(sideSpread)), vec2f(0), vec2f(1)) * outline;
  let shade = dot(weights / (vec2f(1) + 0.4 * (vec2f(1) - weights)), vec2f(1));
  return vec4f(0, 0, 0, shade * mix(0.48, 0.60, s.dark));
}
