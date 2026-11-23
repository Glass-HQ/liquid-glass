#version 300 es
// What is behind one glass surface, in one texel: the mean luma of its backdrop, how much the
// luma varies (contrast), the share that is bright, and how much fine detail there is (luma
// steps between points 1.5 px apart: high over text, low over photos and flat color). The body
// box is sampled on a 16 x 16 grid, jittered per cell, which is plenty for statistics and
// costs one small draw per redrawn surface.
precision highp float;
precision highp int;

uniform sampler2D uBackdrop;
uniform vec2 uViewport;
// the body's box in screen CSS px: left, top, right, bottom
uniform vec4 uBox;

out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const int GRID = 16;

void main() {
  vec2 size = uBox.zw - uBox.xy;
  float sum = 0.0;
  float squares = 0.0;
  float bright = 0.0;
  float detail = 0.0;
  vec2 offset = vec2(1.5) / uViewport;
  for (int y = 0; y < GRID; y += 1) {
    for (int x = 0; x < GRID; x += 1) {
      // A fixed jitter per cell (a cheap hash) keeps a regular grid from locking onto text lines.
      vec2 cell = vec2(float(x), float(y));
      vec2 jitter = fract(sin(vec2(dot(cell, vec2(12.9898, 78.233)), dot(cell, vec2(39.3468, 11.135)))) * 43758.5453);
      vec2 at = uBox.xy + (cell + jitter) / float(GRID) * size;
      vec2 uv = at / uViewport;
      float l = dot(texture(uBackdrop, uv).rgb, LUMA);
      float across = dot(texture(uBackdrop, uv + vec2(offset.x, 0.0)).rgb, LUMA);
      float down = dot(texture(uBackdrop, uv + vec2(0.0, offset.y)).rgb, LUMA);
      detail += abs(across - l) + abs(down - l);
      sum += l;
      squares += l * l;
      bright += step(0.6, l);
    }
  }
  float n = float(GRID * GRID);
  float mean = sum / n;
  float deviation = sqrt(max(squares / n - mean * mean, 0.0));
  outColor = vec4(mean, min(deviation * 2.0, 1.0), bright / n, min(detail / n * 2.0, 1.0));
}
