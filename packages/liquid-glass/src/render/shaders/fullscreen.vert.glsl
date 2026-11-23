#version 300 es
// One triangle covering the viewport; passes restrict themselves with the scissor.
void main() {
  vec2 corner = vec2(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID >> 1) * 4 - 1));
  gl_Position = vec4(corner, 0.0, 1.0);
}
