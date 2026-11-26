#version 300 es
// Frost, step 1: average the backdrop over one cell (a few CSS px) per texel. Colors are
// averaged as color^gamma: above 1 the average leans to the lighter detail (light glass), below
// 1 to the darker (dark glass), which keeps the frost from looking muddy.
precision highp float;
precision highp int;

uniform sampler2D uSource;
uniform vec2 uSourceSize;
// source texels per cell
uniform float uCell;
// samples per axis
uniform int uTaps;
uniform float uGamma;

out vec4 outColor;

void main() {
  vec2 origin = (gl_FragCoord.xy - 0.5) * uCell;
  vec3 sum = vec3(0.0);
  // How much of the cell the page's own content covers, averaged as it is.
  float cover = 0.0;
  for (int y = 0; y < 8; y += 1) {
    if (y >= uTaps) break;
    for (int x = 0; x < 8; x += 1) {
      if (x >= uTaps) break;
      vec2 at = origin + (vec2(float(x), float(y)) + 0.5) / float(uTaps) * uCell;
      vec4 texel = texture(uSource, at / uSourceSize);
      sum += pow(max(texel.rgb, vec3(0.0)), vec3(uGamma));
      cover += texel.a;
    }
  }
  outColor = vec4(sum, cover) / float(uTaps * uTaps);
}
