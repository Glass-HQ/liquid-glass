// Seven partition-of-unity weights, followed by a directional displacement map.
// Baked once per physical edge; no GPU readback is needed while scrolling.
struct Direction { axis: f32, reverse: f32 }
@group(0) @binding(0) var<uniform> direction: Direction;
@fragment fn progressive(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let x = clamp((position.x - 0.5) / 255.0, 0.0, 1.0);
  let t = mix(x, 1.0 - x, direction.reverse);
  let depth = t * t * (3.0 - 2.0 * t);
  let row = floor(position.y);
  if (row < 7.0) {
    let weight = max(0.0, 1.0 - abs(depth * 6.0 - row));
    return vec4f(1.0, 1.0, 1.0, weight);
  }
  // Exact neutral encoded in rgba8 is 128/255, calibrated by the SVG consumer.
  let shift = depth * (1.0 - depth) * 4.0 * mix(1.0, -1.0, direction.reverse);
  let neutral = 128.0 / 255.0;
  return vec4f(neutral + shift * 0.49 * (1.0 - direction.axis),
    neutral + shift * 0.49 * direction.axis, 0.0, 1.0);
}
