#version 300 es
// Frost, steps 2 and 3: one axis of a separable Gaussian over the cells.
precision highp float;
precision highp int;

uniform sampler2D uSource;
uniform ivec2 uAxis;
uniform float uSigma;
uniform int uTaps;

out vec4 outColor;

void main() {
  ivec2 size = textureSize(uSource, 0);
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec3 sum = texelFetch(uSource, at, 0).rgb;
  float total = 1.0;
  for (int tap = 1; tap <= 16; tap += 1) {
    if (tap > uTaps) break;
    float weight = exp(-0.5 * float(tap * tap) / (uSigma * uSigma));
    ivec2 ahead = clamp(at + uAxis * tap, ivec2(0), size - 1);
    ivec2 behind = clamp(at - uAxis * tap, ivec2(0), size - 1);
    sum += (texelFetch(uSource, ahead, 0).rgb + texelFetch(uSource, behind, 0).rgb) * weight;
    total += 2.0 * weight;
  }
  outColor = vec4(sum / total, 1.0);
}
