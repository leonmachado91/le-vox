// core/engine.js: Evolved WebGL2 Sprite-Stack & Voxel Renderer.
// Upgrades over upstream sprite-stack-engine:
//  - True per-instance 3D rotation (yaw/rot, pitch, roll) in both Slice & Voxel modes
//  - Integrated single-pass Bayer 4x4 dithering, OKLab palette quantization & 1px outline in FS_POST
//  - 32 distance-culled dynamic point lamps & configurable shadowSteps / aoSamples
//  - Built-in screenToWorld() raycaster and clean destroy() lifecycle
(function (global) {
  'use strict';

  const HMAX = 128;
  const LAMPS = 32;
  const BLOBS = 32;
  const FL = 16;      // floats per slice/voxel instance
  const IL = 15;      // floats per impostor instance
  const NB = 256;
  const ZQ = 2;
  const ANGLES = 32;
  const IMP_PPU = 4;
  const IMP_W = 2048;
  const IMP_H = 1024;

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mul(A, B) {
    const M = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      M[c * 4 + r] = A[r] * B[c * 4] + A[4 + r] * B[c * 4 + 1] + A[8 + r] * B[c * 4 + 2] + A[12 + r] * B[c * 4 + 3];
    }
    return M;
  }
  function invert(M) {
    const o = new Float32Array(16);
    const a = M[0], b = M[1], c = M[2], d = M[3], e = M[4], f = M[5], g = M[6], h = M[7];
    const i = M[8], j = M[9], k = M[10], l = M[11], m = M[12], n = M[13], p = M[14], q = M[15];
    const A = k * q - l * p, B = j * q - l * n, C = j * p - k * n, D = i * q - l * m, E = i * p - k * m, F = i * n - j * m;
    const G = g * q - h * p, H = f * q - h * n, I = f * p - g * n, J = e * q - h * m, K = e * p - g * m, L = e * n - f * m;
    const N = g * l - h * k, O = f * l - h * j, P = f * k - g * j, Q = e * l - h * i, R = e * k - g * i, S = e * j - f * i;
    o[0] = f * A - g * B + h * C; o[4] = -(e * A - g * D + h * E); o[8] = e * B - f * D + h * F; o[12] = -(e * C - f * E + g * F);
    o[1] = -(b * A - c * B + d * C); o[5] = a * A - c * D + d * E; o[9] = -(a * B - b * D + d * F); o[13] = a * C - b * E + c * F;
    o[2] = b * G - c * H + d * I; o[6] = -(a * G - c * J + d * K); o[10] = a * H - b * J + d * L; o[14] = -(a * I - b * K + c * L);
    o[3] = -(b * N - c * O + d * P); o[7] = a * N - c * Q + d * R; o[11] = -(a * O - b * Q + d * S); o[15] = a * P - b * R + c * S;
    const det = a * o[0] + b * o[4] + c * o[8] + d * o[12] || 1;
    for (let u = 0; u < 16; u++) o[u] /= det;
    return o;
  }

  function cameraMatrices(cam, aspect) {
    const ortho = cam.mode === 'ortho';
    const th = Math.tan((cam.fov || 38 * Math.PI / 180) * 0.5);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const back = [cp * cy, cp * sy, sp];
    const eye = [cam.tx + back[0] * cam.dist, cam.ty + back[1] * cam.dist, (cam.tz || 0) + back[2] * cam.dist];
    const f = norm([-back[0], -back[1], -back[2]]), r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
    const V = new Float32Array([
      r[0], u[0], -f[0], 0,
      r[1], u[1], -f[1], 0,
      r[2], u[2], -f[2], 0,
      -dot(r, eye), -dot(u, eye), dot(f, eye), 1
    ]);
    let P;
    if (ortho) {
      const hh = cam.dist * th, hw = hh * aspect, n = 1, fr = 3200;
      P = new Float32Array([1 / hw, 0, 0, 0, 0, 1 / hh, 0, 0, 0, 0, -2 / (fr - n), 0, 0, 0, -(fr + n) / (fr - n), 1]);
    } else {
      const n = Math.max(2, cam.dist * 0.05), fr = cam.dist * 3 + 1400;
      P = new Float32Array([1 / (th * aspect), 0, 0, 0, 0, 1 / th, 0, 0, 0, 0, -(fr + n) / (fr - n), -1, 0, 0, -2 * fr * n / (fr - n), 0]);
    }
    const vp = mul(P, V);
    return { vp, inv: invert(vp), eye, f, r, u, ortho, th, cp, px: P[0], py: P[5], back };
  }

  function unproject(ndcX, ndcY, ndcZ, inv) {
    const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * ndcZ + inv[12];
    const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * ndcZ + inv[13];
    const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * ndcZ + inv[14];
    const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * ndcZ + inv[15] || 1;
    return [x / w, y / w, z / w];
  }

  function screenToWorld(cam, aspect, ndcX, ndcY, planeZ = 0) {
    const M = cameraMatrices(cam, aspect);
    const p0 = unproject(ndcX, ndcY, -1, M.inv);
    const p1 = unproject(ndcX, ndcY, 1, M.inv);
    const dz = p1[2] - p0[2];
    const t = Math.abs(dz) > 1e-5 ? (planeZ - p0[2]) / dz : 0.5;
    return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, planeZ];
  }

  // ---------------------------------------------------------------- Shaders
  const ROT_MAT_GLSL = `
  mat3 rotMat(float yaw, float pitch, float roll) {
    float cy = cos(yaw), sy = sin(yaw);
    float cp = cos(pitch), sp = sin(pitch);
    float cr = cos(roll), sr = sin(roll);
    return mat3(
      cy * cp,              sy * cp,              -sp,
      cy * sp * sr - sy * cr, sy * sp * sr + cy * cr, cp * sr,
      cy * sp * cr + sy * sr, sy * sp * cr - cy * sr, cp * cr
    );
  }`;

  const VS_SLICE = `#version 300 es
  layout(location=0) in vec3 a_pos;      // pivot x, y, z
  layout(location=1) in vec4 a_angles;   // yaw, pitch, roll, localZ
  layout(location=2) in vec4 a_rect;
  layout(location=3) in vec2 a_off;
  layout(location=4) in float a_scale;
  layout(location=5) in vec2 a_corner;
  uniform mat4 u_vp; uniform float u_guard;
  out vec2 v_uv; flat out vec4 v_rect; flat out mat3 v_rotM; out float v_h;
  ${ROT_MAT_GLSL}
  void main() {
    mat3 R = rotMat(a_angles.x, a_angles.y, a_angles.z);
    vec2 l = (a_off + (a_corner - 0.5) * a_rect.zw) * a_scale;
    vec2 m = a_off * a_scale;
    vec3 w = a_pos + R * vec3(l, a_angles.w);
    vec3 wMid = a_pos + R * vec3(m, a_angles.w);
    vec4 p = u_vp * vec4(w, 1.0);
    vec4 q = u_vp * vec4(wMid, 1.0);
    p.y += (p.y / p.w >= q.y / q.w ? 1.0 : -1.0) * u_guard * p.w;
    gl_Position = p;
    v_uv = a_rect.xy + a_corner * a_rect.zw;
    v_rect = a_rect;
    v_rotM = R;
    v_h = w.z;
  }`;

  const FS_G = `#version 300 es
  precision highp float;
  uniform sampler2D u_atlas;
  in vec2 v_uv; flat in vec4 v_rect; flat in mat3 v_rotM; in float v_h;
  layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
  void main() {
    vec4 t = texelFetch(u_atlas, ivec2(clamp(v_uv, v_rect.xy, v_rect.xy + v_rect.zw - 0.001)), 0);
    if (t.r == 0.0) discard;
    vec3 n = normalize(v_rotM * (t.gba * 2.0 - 1.0));
    o0 = vec4(t.r, n * 0.5 + 0.5);
    float h = clamp(v_h / ${HMAX}.0, 0.0, 1.0) * 65535.0, hi = floor(h / 256.0);
    o1 = vec4(hi / 255.0, (h - hi * 256.0) / 255.0, 0.0, 0.0);
  }`;

  const FS_COUNT = `#version 300 es
  precision highp float;
  uniform sampler2D u_atlas; uniform int u_all; uniform float u_unit;
  in vec2 v_uv; flat in vec4 v_rect; flat in mat3 v_rotM; in float v_h;
  out vec4 o;
  void main() {
    if (u_all == 1) { o = vec4(0.0, u_unit, 0.0, 0.0); return; }
    vec4 t = texelFetch(u_atlas, ivec2(clamp(v_uv, v_rect.xy, v_rect.xy + v_rect.zw - 0.001)), 0);
    if (t.r == 0.0) discard;
    o = vec4(u_unit, 0.0, 0.0, 0.0);
  }`;

  // Voxel Mode with full 3D local-frame ray walk
  const VS_VOXEL = `#version 300 es
  layout(location=0) in vec3 a_pos;      // pivot x, y, z
  layout(location=1) in vec4 a_angles;   // yaw, pitch, roll, localZ
  layout(location=2) in vec4 a_rect;
  layout(location=3) in vec2 a_off;
  layout(location=4) in float a_scale;
  layout(location=5) in vec3 a_box;
  layout(location=6) in float a_span;
  uniform mat4 u_vp; uniform vec3 u_eye, u_fwd; uniform float u_ortho;
  out vec3 v_p, v_d;
  flat out vec4 v_rect, v_base;
  flat out mat3 v_rotM;
  flat out vec2 v_off, v_zinfo;          // localZ, a_span / a_scale
  ${ROT_MAT_GLSL}
  void main() {
    mat3 R = rotMat(a_angles.x, a_angles.y, a_angles.z);
    vec2 l = (a_off + (a_box.xy - 0.5) * a_rect.zw) * a_scale;
    vec3 localW = vec3(l, a_angles.w + a_box.z * a_span);
    vec3 w = a_pos + R * localW;
    gl_Position = u_vp * vec4(w, 1.0);
    v_p = vec3(a_box.xy * a_rect.zw, a_box.z * a_span / a_scale);
    vec3 d = u_ortho > 0.5 ? u_fwd : w - u_eye;
    v_d = transpose(R) * d;
    v_rect = a_rect;
    v_base = vec4(a_pos, a_scale);
    v_rotM = R;
    v_off = a_off;
    v_zinfo = vec2(a_angles.w, a_span / a_scale);
  }`;

  const WALK = `
  uniform sampler2D u_atlas; uniform mat4 u_vp;
  in vec3 v_p, v_d;
  flat in vec4 v_rect, v_base;
  flat in mat3 v_rotM;
  flat in vec2 v_off, v_zinfo;
  bool walk(out vec4 t, out vec3 q) {
    vec3 dir = normalize(v_d); vec2 size = v_rect.zw;
    vec3 p = vec3(clamp(v_p.xy, vec2(0.001), size - 0.001), v_p.z);
    ivec2 cell = ivec2(p.xy), lim = ivec2(size + 0.5), stp = ivec2(dir.x < 0.0 ? -1 : 1, dir.y < 0.0 ? -1 : 1);
    vec2 inv = 1.0 / max(abs(dir.xy), vec2(0.00001));
    vec2 next = vec2(dir.x < 0.0 ? p.x - float(cell.x) : float(cell.x) + 1.0 - p.x, dir.y < 0.0 ? p.y - float(cell.y) : float(cell.y) + 1.0 - p.y) * inv;
    float leave = dir.z < -0.00001 ? p.z / -dir.z : dir.z > 0.00001 ? (v_zinfo.y - p.z) / dir.z : 1000000.0, k = 0.0; bool hit = false;
    for (int i = 0; i < 48; i++) {
      t = texelFetch(u_atlas, ivec2(v_rect.xy) + cell, 0);
      if (t.r > 0.0) { hit = true; break; }
      if (next.x < next.y) { k = next.x; next.x += inv.x; cell.x += stp.x; } else { k = next.y; next.y += inv.y; cell.y += stp.y; }
      if (k > leave || cell.x < 0 || cell.y < 0 || cell.x >= lim.x || cell.y >= lim.y) break;
    }
    q = p + dir * k; return hit;
  }
  vec3 worldHit(vec3 q) {
    vec2 l = (v_off + q.xy - v_rect.zw * 0.5) * v_base.w;
    vec3 localPos = vec3(l, v_zinfo.x + clamp(q.z, 0.0, v_zinfo.y) * v_base.w);
    return v_base.xyz + v_rotM * localPos;
  }
  float depthOf(vec3 q, out vec3 wPos) {
    wPos = worldHit(q);
    vec4 c = u_vp * vec4(wPos, 1.0);
    return c.z / c.w * 0.5 + 0.5;
  }`;

  const FS_GVOXEL = `#version 300 es
  precision highp float;
  ${WALK}
  uniform vec3 u_eye, u_fwd;
  layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
  void main() {
    vec4 t; vec3 q; if (!walk(t, q)) discard;
    vec3 n = normalize(v_rotM * (t.gba * 2.0 - 1.0));
    vec3 wPos; gl_FragDepth = depthOf(q, wPos);
    o0 = vec4(t.r, n * 0.5 + 0.5);
    float h = clamp(wPos.z / ${HMAX}.0, 0.0, 1.0) * 65535.0, hi = floor(h / 256.0);
    float far = clamp(dot(wPos - u_eye, u_fwd) / 4096.0, 0.0, 1.0) * 65535.0, fi = floor(far / 256.0);
    o1 = vec4(hi / 255.0, (h - hi * 256.0) / 255.0, fi / 255.0, (far - fi * 256.0) / 255.0);
  }`;

  const FS_COUNTVOXEL = `#version 300 es
  precision highp float;
  ${WALK}
  uniform int u_all; uniform float u_unit;
  out vec4 o;
  void main() {
    if (u_all == 1) { o = vec4(0.0, u_unit, 0.0, 0.0); gl_FragDepth = gl_FragCoord.z; return; }
    vec4 t; vec3 q; if (!walk(t, q)) discard;
    vec3 wPos; gl_FragDepth = depthOf(q, wPos);
    o = vec4(u_unit, 0.0, 0.0, 0.0);
  }`;

  const VS_IMP = `#version 300 es
  layout(location=0) in vec4 a_pos;
  layout(location=1) in vec4 a_cell;
  layout(location=2) in vec4 a_how;
  layout(location=3) in vec3 a_size;
  layout(location=5) in vec2 a_corner;
  uniform mat4 u_vp; uniform vec3 u_right, u_up;
  out vec2 v_uv; out vec3 v_w; flat out vec4 v_cell, v_pos; flat out float v_rot;
  void main() {
    vec3 w = a_pos.xyz + (u_right * ((a_corner.x - 0.5) * a_size.x) + u_up * (a_corner.y * a_size.y - a_size.z)) * a_pos.w
           + vec3(a_how.yz, 0.0) * (a_corner.y * a_how.w * a_pos.w);
    gl_Position = u_vp * vec4(w, 1.0); v_uv = a_corner * a_cell.zw; v_w = w; v_cell = a_cell; v_pos = a_pos; v_rot = a_how.x;
  }`;

  const IMP_FS = `
  uniform sampler2D u_i0, u_i1; uniform mat4 u_vp; uniform vec3 u_fwd;
  in vec2 v_uv; in vec3 v_w; flat in vec4 v_cell, v_pos; flat in float v_rot;
  bool sprite(out vec4 a, out float h) {
    ivec2 tc = ivec2(v_cell.xy) + ivec2(clamp(v_uv, vec2(0.0), v_cell.zw - 0.001));
    a = texelFetch(u_i0, tc, 0); if (a.r == 0.0) return false;
    vec4 b = texelFetch(u_i1, tc, 0);
    h = v_pos.z + (b.r * 65280.0 + b.g * 255.0) / 65535.0 * ${HMAX}.0 * v_pos.w;
    vec4 c = u_vp * vec4(v_w + u_fwd * ((v_w.z - h) / -u_fwd.z), 1.0);
    gl_FragDepth = c.z / c.w * 0.5 + 0.5; return true;
  }`;

  const FS_GIMP = `#version 300 es
  precision highp float;
  ${IMP_FS}
  layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
  void main() {
    vec4 a; float hw; if (!sprite(a, hw)) discard;
    float c = cos(v_rot), s = sin(v_rot); vec3 n = a.gba * 2.0 - 1.0; n.xy = vec2(n.x * c - n.y * s, n.x * s + n.y * c);
    o0 = vec4(a.r, n * 0.5 + 0.5);
    float h = clamp(hw / ${HMAX}.0, 0.0, 1.0) * 65535.0, hi = floor(h / 256.0);
    o1 = vec4(hi / 255.0, (h - hi * 256.0) / 255.0, 0.0, 1.0);
  }`;

  const FS_COUNTIMP = `#version 300 es
  precision highp float;
  ${IMP_FS}
  uniform int u_all; uniform float u_unit;
  out vec4 o;
  void main() {
    if (u_all == 1) { o = vec4(0.0, u_unit, 0.0, 0.0); gl_FragDepth = gl_FragCoord.z; return; }
    vec4 a; float hw; if (!sprite(a, hw)) discard;
    o = vec4(u_unit, 0.0, 0.0, 0.0);
  }`;

  const VS_FULL = `#version 300 es
  layout(location=5) in vec2 a_corner;
  out vec2 v_uv;
  void main() { v_uv = a_corner; gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0); }`;

  const FS_LIGHT = `#version 300 es
  precision highp float;
  uniform sampler2D u_g0, u_g1, u_pal, u_hm;
  uniform mat4 u_inv;
  uniform vec3 u_sun, u_sunCol, u_skyCol, u_bounceCol, u_hazeCol, u_outer, u_eye, u_fwd;
  uniform vec4 u_world, u_fx, u_view, u_tone;
  uniform float u_water;
  uniform int u_shadowSteps, u_aoSamples, u_nlamp, u_nblob;
  uniform vec4 u_lamp[${LAMPS}]; uniform vec3 u_lampCol[${LAMPS}];
  uniform vec4 u_blob[${BLOBS}]; uniform float u_blobLow[${BLOBS}];
  in vec2 v_uv; out vec4 o;

  float land(vec2 p) { return textureLod(u_hm, p / u_world.xy, 0.0).r * 127.5; }
  float height(ivec2 px) { vec4 g = texelFetch(u_g1, clamp(px, ivec2(0), textureSize(u_g1, 0) - 1), 0); return (g.r * 65280.0 + g.g * 255.0) / 65535.0 * ${HMAX}.0; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
  vec3 beyond(vec2 p) {
    vec2 w = (p + 40.0 * vec2(vnoise(p * 0.009), vnoise(p * 0.009 + 7.3))) / 118.0, c = floor(w), f = fract(w);
    float k = hash(c), e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 118.0;
    vec3 col = u_outer * (k < 0.45 ? vec3(1.0) : k < 0.68 ? vec3(1.28, 1.1, 0.8) : k < 0.84 ? vec3(1.06, 0.84, 0.7) : vec3(0.9, 0.97, 0.85));
    return mix(u_outer * 0.7, col, smoothstep(1.0, 3.2, e)) * (0.9 + 0.2 * vnoise(p * 0.11));
  }
  vec3 finish(vec3 c) {
    c = 1.0 - exp(-pow(max(c * u_tone.x, 0.0), vec3(1.25)) * 1.7);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 1.16);
    c += vec3(0.022, 0.006, -0.022) * smoothstep(0.4, 1.0, l) + vec3(-0.014, 0.0, 0.022) * (1.0 - smoothstep(0.0, 0.45, l));
    return clamp(c, 0.0, 1.0);
  }
  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    vec4 g0 = texelFetch(u_g0, px, 0);
    bool outer = g0.r == 0.0;
    float h = outer ? u_world.z : height(px);
    vec2 ndc = v_uv * 2.0 - 1.0; vec4 a = u_inv * vec4(ndc, -1.0, 1.0), b = u_inv * vec4(ndc, 1.0, 1.0); a /= a.w; b /= b.w;
    float fall = b.z - a.z; bool level = fall > -0.0001;
    if (outer && (level || (h - a.z) / fall > 1.0)) { o = vec4(finish(mix(u_hazeCol, u_hazeCol * 0.86 + u_skyCol * 0.3, clamp(normalize(b.xyz - a.xyz).z * 4.0, 0.0, 1.0))), 0.0); return; }
    vec3 w; float far = 0.0;
    if (!outer) { vec4 g1 = texelFetch(u_g1, px, 0); far = (g1.b * 65280.0 + g1.a * 255.0) / 65535.0 * 4096.0; }
    if (far > 0.001) { vec3 dir = normalize(b.xyz - a.xyz); w = u_eye + dir * (far / max(0.001, dot(dir, u_fwd))); }
    else w = a.xyz + (b.xyz - a.xyz) * (level ? 0.0 : (h - a.z) / fall);
    vec3 n = outer ? vec3(0.0, 0.0, 1.0) : normalize(g0.gba * 2.0 - 1.0);
    vec4 mat = outer ? vec4(beyond(w.xy), 0.0) : texelFetch(u_pal, ivec2(int(g0.r * 255.0 + 0.5), 0), 0);
    bool wet = !outer && abs(g0.r * 255.0 - u_water) < 1.5;
    if (wet) {
      float t = u_world.w;
      n = normalize(vec3(sin(w.x * 0.35 + w.y * 0.14 + t * 2.2) * 0.09 + cos(w.x * 0.18 - w.y * 0.31 + t * 1.6) * 0.07,
                         cos(w.y * 0.32 - w.x * 0.13 + t * 2.0) * 0.09, 1.0));
    }

    float sh = 1.0;
    if (u_fx.x > 0.0 && u_shadowSteps > 0) {
      float jit = 0.78 + 0.44 * hash(vec2(px));
      float stepLen = 2.0 * (48.0 / float(u_shadowSteps));
      for (int i = 1; i <= 48; i++) {
        if (i > u_shadowSteps) break;
        float t = (float(i) - 0.5) * stepLen * jit;
        vec3 s = w + u_sun * t;
        if (s.x < 0.0 || s.y < 0.0 || s.x >= u_world.x || s.y >= u_world.y || s.z > 120.0) break;
        sh = min(sh, clamp((s.z - land(s.xy)) / (t * u_fx.x), 0.0, 1.0));
      }
      if (u_fx.w > 0.0) sh *= 1.0 - u_fx.w * smoothstep(0.45, 0.78, vnoise(w.xy * 0.011 + vec2(u_world.w * 0.04, u_world.w * 0.015)));
      if (u_sun.z > 0.02) for (int i = 0; i < ${BLOBS}; i++) {
        if (i >= u_nblob) break;
        vec4 c = u_blob[i];
        if (w.z < c.z - 0.2 && w.z > u_blobLow[i] - 0.5) {
          float d = length(w.xy - c.xy - u_sun.xy / max(0.25, u_sun.z) * max(0.0, c.z - w.z));
          sh = min(sh, smoothstep(c.w * 0.4, c.w * 1.2, d));
        }
      }
      sh = mix(0.25, 1.0, sh);
    }

    float occ = 1.0;
    if (u_fx.y > 0.0 && u_aoSamples > 0) {
      float oc = 0.0, ang = hash(vec2(px)) * 6.283;
      const vec2 dir8[8] = vec2[8](vec2(1.0, 0.0), vec2(0.707, 0.707), vec2(0.0, 1.0), vec2(-0.707, 0.707), vec2(-1.0, 0.0), vec2(-0.707, -0.707), vec2(0.0, -1.0), vec2(0.707, -0.707));
      float ca = cos(ang), sa = sin(ang);
      for (int i = 0; i < 8; i++) {
        vec2 d = vec2(dir8[i].x * ca - dir8[i].y * sa, dir8[i].x * sa + dir8[i].y * ca);
        oc += smoothstep(0.5, 4.0, land(w.xy + d * 2.2) - w.z) * 0.55;
        if (u_aoSamples > 8) oc += smoothstep(1.2, 10.0, land(w.xy + d * 6.0) - w.z) * 0.45;
      }
      occ = 1.0 - min(0.7, oc / 8.0 * u_fx.y);
      if (w.z <= u_world.z + 1.5) for (int i = 0; i < ${BLOBS}; i++) {
        if (i >= u_nblob) break;
        vec4 c = u_blob[i];
        if (w.z < c.z - 0.2 && w.z > u_blobLow[i] - 0.5) occ = min(occ, 0.45 + 0.55 * smoothstep(c.w * 0.2, c.w * 1.1, length(w.xy - c.xy)));
      }
    }

    float ndl = max(dot(n, u_sun), 0.0), sky = n.z * 0.5 + 0.5;
    vec3 lit = mat.rgb * (u_sunCol * ndl * sh + mix(u_bounceCol, u_skyCol, sky) * occ);
    float fres = pow(1.0 - max(dot(n, normalize(u_eye - w)), 0.0), 3.0);
    if (wet) {
      vec3 R = reflect(-normalize(u_eye - w), n);
      float gl = pow(max(dot(R, u_sun), 0.0), 48.0) * sh;
      lit += u_skyCol * (0.35 + 0.9 * fres) + u_sunCol * gl * 1.5;
    } else if (!outer && ndl > 0.15) {
      float rim = max(0.0, dot(n, normalize(u_sun * 0.6 + vec3(0.0, 0.0, 0.4)))) * smoothstep(h + 0.4, h + 1.6, height(px + ivec2(u_view.xy)));
      lit += u_sunCol * (rim * 0.22 * sh + fres * 0.14 * ndl * sh);
    }

    for (int i = 0; i < ${LAMPS}; i++) {
      if (i >= u_nlamp) break;
      vec4 lp = u_lamp[i]; if (lp.w <= 0.0) continue;
      vec3 d = lp.xyz - w; float d2 = dot(d, d);
      if (d2 < lp.w * lp.w) {
        float k = 1.0 - sqrt(d2) / lp.w;
        lit += mat.rgb * u_lampCol[i] * (k * k * (0.45 + 0.55 * max(dot(n, normalize(d)), 0.0)) * 2.2);
      }
    }

    float glow = mat.a > 0.95 ? 1.0 : mat.a * u_fx.z;
    lit += mat.rgb * glow * (mat.a > 0.95 ? 3.2 : 2.6);

    float dist = u_tone.z > 0.5 ? length(w - u_eye) : dot(w - u_eye, u_fwd);
    float fog = 1.0 - exp(-max(0.0, dist - u_view.z) / u_view.w * u_tone.y);
    lit = mix(lit, u_hazeCol * (0.78 + 0.22 * max(0.0, u_sun.z)), clamp(fog, 0.0, 0.85));
    o = vec4(finish(lit), glow * 0.55);
  }`;

  const FS_HEAT = `#version 300 es
  precision highp float;
  uniform sampler2D u_count; uniform int u_channel; uniform float u_unit;
  in vec2 v_uv; out vec4 o;
  void main() {
    vec4 v = texelFetch(u_count, ivec2(v_uv * vec2(textureSize(u_count, 0))), 0);
    float n = (u_channel == 0 ? v.r : v.g) / u_unit;
    if (n < 0.05) { o = vec4(0.05, 0.06, 0.09, 1.0); return; }
    float t = clamp(log2(n) / 7.0, 0.0, 1.0);
    vec3 c = t < 0.25 ? mix(vec3(0.08, 0.16, 0.45), vec3(0.06, 0.62, 0.68), t * 4.0)
           : t < 0.5  ? mix(vec3(0.06, 0.62, 0.68), vec3(0.95, 0.85, 0.2), (t - 0.25) * 4.0)
           : t < 0.75 ? mix(vec3(0.95, 0.85, 0.2), vec3(0.96, 0.35, 0.08), (t - 0.5) * 4.0)
           :            mix(vec3(0.96, 0.35, 0.08), vec3(1.0, 0.96, 0.98), (t - 0.75) * 4.0);
    o = vec4(c, 1.0);
  }`;

  const FS_BRIGHT = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex; uniform vec2 u_px; in vec2 v_uv; out vec4 o;
  void main() {
    vec3 s = vec3(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec4 t = texture(u_tex, v_uv + vec2(float(x), float(y)) * u_px);
      s += t.rgb * (max(0.0, dot(t.rgb, vec3(0.21, 0.72, 0.07)) - 0.82) + t.a * 1.4);
    }
    o = vec4(s / 9.0, 1.0);
  }`;

  const FS_BLUR = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex; uniform vec2 u_step; in vec2 v_uv; out vec4 o;
  void main() {
    o = texture(u_tex, v_uv) * 0.227 + (texture(u_tex, v_uv + u_step * 1.38) + texture(u_tex, v_uv - u_step * 1.38)) * 0.316
      + (texture(u_tex, v_uv + u_step * 3.23) + texture(u_tex, v_uv - u_step * 3.23)) * 0.070;
  }`;

  // Integrated final pass: Bloom + Vignette + Optional 1px Depth/Normal Outline + Bayer 4x4 + OKLab/Posterize
  const FS_POST = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex, u_bloom, u_g0, u_g1;
  uniform vec2 u_size, u_k;
  uniform vec4 u_dither;   // x: strength, y: levels, z: outline, w: palSize
  uniform vec3 u_pal[32];
  in vec2 v_uv; out vec4 o;

  float bayer4x4(vec2 px) {
    int x = int(mod(px.x, 4.0));
    int y = int(mod(px.y, 4.0));
    int i = y * 4 + x;
    float m[16] = float[16](
      0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
     12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
      3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
     15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
    );
    return m[i] - 0.5;
  }

  vec3 rgbToOklab(vec3 c) {
    c = pow(max(c, vec3(0.0)), vec3(2.2));
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    float l_ = pow(max(l, 0.0), 1.0 / 3.0);
    float m_ = pow(max(m, 0.0), 1.0 / 3.0);
    float s_ = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3(
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    );
  }

  float gHeight(ivec2 px) {
    ivec2 cpx = clamp(px, ivec2(0), ivec2(u_size) - 1);
    vec4 g = texelFetch(u_g1, cpx, 0);
    return (g.r * 65280.0 + g.g * 255.0) / 65535.0 * ${HMAX}.0;
  }

  void main() {
    ivec2 px = ivec2(floor(v_uv * u_size));
    vec3 c = texelFetch(u_tex, clamp(px, ivec2(0), ivec2(u_size) - 1), 0).rgb;
    vec3 b = texture(u_bloom, v_uv).rgb * u_k.x;
    c = 1.0 - (1.0 - c) * (1.0 - b);
    vec2 dv = v_uv - 0.5;
    c *= 1.0 - u_k.y * dot(dv, dv) * 1.6;

    // Optional 1px depth/normal silhouette outline at internal pixel resolution
    if (u_dither.z > 0.01) {
      vec4 g0c = texelFetch(u_g0, px, 0);
      if (g0c.r > 0.0) {
        float hc = gHeight(px);
        vec3 nc = normalize(g0c.gba * 2.0 - 1.0);
        float edge = 0.0;
        ivec2 offs[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
        for (int i = 0; i < 4; i++) {
          ivec2 np = clamp(px + offs[i], ivec2(0), ivec2(u_size) - 1);
          vec4 g0n = texelFetch(u_g0, np, 0);
          if (g0n.r == 0.0) edge = max(edge, 0.85);
          else {
            float hn = gHeight(np);
            if (hc - hn > 2.2) edge = max(edge, 0.85);
            vec3 nn = normalize(g0n.gba * 2.0 - 1.0);
            if (dot(nc, nn) < 0.3 && hc >= hn - 0.2) edge = max(edge, 0.45);
          }
        }
        c = mix(c, c * 0.28, edge * u_dither.z);
      }
    }

    // Optional Bayer 4x4 Dither + Quantization
    int palSize = int(u_dither.w + 0.5);
    float bayer = bayer4x4(vec2(px));
    if (palSize > 0) {
      vec3 dCol = clamp(c + vec3(bayer * u_dither.x * 0.14), 0.0, 1.0);
      vec3 lab = rgbToOklab(dCol);
      float bestDist = 1e9;
      vec3 best = dCol;
      for (int i = 0; i < 32; i++) {
        if (i >= palSize) break;
        vec3 diff = lab - rgbToOklab(u_pal[i]);
        float dist = diff.x * diff.x * 1.25 + diff.y * diff.y + diff.z * diff.z;
        if (dist < bestDist) { bestDist = dist; best = u_pal[i]; }
      }
      c = best;
    } else if (u_dither.y > 1.5 && u_dither.x > 0.001) {
      float stepSize = 1.0 / (u_dither.y - 1.0);
      vec3 dCol = clamp(c + vec3(bayer * stepSize * u_dither.x), 0.0, 1.0);
      c = floor(dCol * (u_dither.y - 1.0) + 0.5) / (u_dither.y - 1.0);
    }

    o = vec4(c, 1.0);
  }`;

  const PALETTES = {
    'Níveis (Posterize)': [],
    'Turbo Retro (24)': [
      '#10121c','#1d2030','#2d3145','#444d63','#697187','#9ea6bd',
      '#d6dce8','#f3efe2','#9c1f31','#d9383f','#ff594f','#ffbe47',
      '#ffe599','#7c4c48','#a36b5e','#3b6647','#5b9654','#2e729e',
      '#58b4de','#4ef2ff','#ff598f','#e09f3e','#356b9c','#f56a2c'
    ],
    'Endesga 16': [
      '#141013','#3b1725','#73172d','#b4202a','#df3e23','#fa6a0a',
      '#f9a31b','#ffd541','#fffc40','#d6f264','#9cdb43','#59c135',
      '#14a02e','#1a7a3e','#24523b','#122020'
    ],
    'Pico-8': [
      '#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f',
      '#c2c3c7','#fff1e8','#ff004d','#ffa300','#ffec27','#00e436',
      '#29adff','#83769c','#ff77a8','#ffccaa'
    ],
    'GameBoy Pocket': [
      '#0f1914','#243b2c','#486e4c','#7ca66c','#b8d492','#e8f5c8'
    ]
  };

  function hexToRgb01(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available');
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');

    const programs = [], textures = [], buffers = [], vaos = [], fbos = [], rbos = [];

    function program(vs, fs) {
      const p = gl.createProgram();
      [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach((s) => {
        const sh = gl.createShader(s[0]); gl.shaderSource(sh, s[1]); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
        gl.deleteShader(sh);
      });
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(p, i).name.replace('[0]', '');
        u[name] = gl.getUniformLocation(p, name);
      }
      programs.push(p);
      return { p, u };
    }

    function texture(w, h, internal, format, type, data, filter) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.push(t);
      return t;
    }

    const pG = program(VS_SLICE, FS_G), pCount = program(VS_SLICE, FS_COUNT);
    const pLight = program(VS_FULL, FS_LIGHT), pHeat = program(VS_FULL, FS_HEAT);
    const pGVoxel = program(VS_VOXEL, FS_GVOXEL), pCountVoxel = program(VS_VOXEL, FS_COUNTVOXEL);
    const pGImp = program(VS_IMP, FS_GIMP), pCountImp = program(VS_IMP, FS_COUNTIMP);
    const pBright = program(VS_FULL, FS_BRIGHT), pBlur = program(VS_FULL, FS_BLUR), pPost = program(VS_FULL, FS_POST);

    const corners = gl.createBuffer(); buffers.push(corners);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    let cap = 1 << 16, inst = new Float32Array(cap * FL), tmp = new Float32Array(cap * FL), keys = new Uint16Array(cap);
    const counts = new Uint32Array(NB + 1);

    const vao = gl.createVertexArray(); vaos.push(vao);
    const buf = gl.createBuffer(); buffers.push(buf);
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const perInstance = (list) => list.forEach((a) => {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, FL * 4, a[2] * 4);
      gl.vertexAttribDivisor(a[0], 1);
    });
    perInstance([[0, 3, 0], [1, 4, 3], [2, 4, 7], [3, 2, 11], [4, 1, 13]]);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners); gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);

    const box = gl.createBuffer(); buffers.push(box);
    const vaoVoxel = gl.createVertexArray(); vaos.push(vaoVoxel);
    gl.bindVertexArray(vaoVoxel); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    perInstance([[0, 3, 0], [1, 4, 3], [2, 4, 7], [3, 2, 11], [4, 1, 13], [6, 1, 14]]);
    gl.bindBuffer(gl.ARRAY_BUFFER, box);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1,
      0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1,
      1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1,
      1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1,
      0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1,
      0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 0, 0);

    const impBuf = gl.createBuffer(); buffers.push(impBuf);
    const vaoImp = gl.createVertexArray(); vaos.push(vaoImp);
    gl.bindVertexArray(vaoImp); gl.bindBuffer(gl.ARRAY_BUFFER, impBuf);
    [[0, 4, 0], [1, 4, 4], [2, 4, 8], [3, 3, 12]].forEach((a) => {
      gl.enableVertexAttribArray(a[0]);
      gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, IL * 4, a[2] * 4);
      gl.vertexAttribDivisor(a[0], 1);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, corners); gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);

    const vaoFull = gl.createVertexArray(); vaos.push(vaoFull);
    gl.bindVertexArray(vaoFull); gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);

    let iw = 0, ih = 0, bw = 0, bh = 0, g0, g1, lit, countTex, depth, fboG, fboLit, fboCount, bloom = [], fboBloom = [];
    function releaseTargets() {
      [g0, g1, lit, countTex, bloom[0], bloom[1]].forEach((t) => t && gl.deleteTexture(t));
      [fboG, fboLit, fboCount, fboBloom[0], fboBloom[1]].forEach((f) => f && gl.deleteFramebuffer(f));
      if (depth) gl.deleteRenderbuffer(depth);
    }

    function targets(w, h) {
      if (w === iw && h === ih) return;
      releaseTargets();
      iw = w; ih = h; bw = Math.max(1, w >> 2); bh = Math.max(1, h >> 2);
      g0 = gl.createTexture(); g1 = gl.createTexture(); lit = gl.createTexture(); countTex = gl.createTexture();
      const initTex = (t, tw, th, intFmt, fmt, tp, filt) => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, intFmt, tw, th, 0, fmt, tp, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      };
      initTex(g0, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      initTex(g1, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      initTex(lit, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      initTex(countTex, w, h, floatOK ? gl.RGBA16F : gl.RGBA8, gl.RGBA, floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, gl.NEAREST);
      depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      fboG = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboG);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g0, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, g1, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      fboLit = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboLit);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lit, 0);
      fboCount = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboCount);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, countTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      for (let i = 0; i < 2; i++) {
        bloom[i] = gl.createTexture();
        initTex(bloom[i], bw, bh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
        fboBloom[i] = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboBloom[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloom[i], 0);
      }
    }

    const E = {
      gl,
      palettes: Object.keys(PALETTES),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      stats: { instances: 0, slices: 0, cpuMs: 0, gpuMs: null, written: null, covered: null, iw: 0, ih: 0 }
    };
    let palTex = null, hmTex = null, world = [1, 1], query = null, timing = false;
    const UNIT = floatOK ? 1 : 1 / 255;

    E.makeAtlas = (data, size) => texture(size, size, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, data);
    E.setPalette = (bytes) => {
      if (palTex) gl.deleteTexture(palTex);
      palTex = texture(256, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    };
    E.setHeightMap = (bytes, w, h) => {
      if (hmTex) gl.deleteTexture(hmTex);
      hmTex = texture(w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bytes, gl.LINEAR);
      world = [w, h];
    };
    E.patchHeightMap = (bytes, x, y, w, h) => {
      gl.bindTexture(gl.TEXTURE_2D, hmTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED, gl.UNSIGNED_BYTE, bytes);
    };

    const moved = { dx: 0, dy: 0, dz: 0, rot: 0, pitch: 0, roll: 0, scale: 1 };
    function build(list, M, opt) {
      const ppuOrtho = ih / (2 * opt.cam.dist * M.th), vp = M.vp, voxel = !!opt.voxel;
      let n = 0, slices = 0, tallest = 0;
      const slope = Math.tan(Math.max(0.06, M.ortho ? opt.cam.pitch : opt.cam.pitch - (opt.cam.fov || 0.66) * 0.35));

      for (let q = 0; q < list.length; q++) {
        const it = list[q], st = it.stack, sc = it.scale || 1, one = (it.only ?? -1) >= 0;
        const itPitch = it.pitch || 0, itRoll = it.roll || 0;
        const zc = one ? it.z : it.z + st.n * sc * 0.5;
        const R = (one ? st.radius : Math.hypot(st.radius, st.n * 0.5)) * sc + (it.each ? 60 : 2);
        const cw = vp[3] * it.x + vp[7] * it.y + vp[11] * zc + vp[15];
        const cx = vp[0] * it.x + vp[4] * it.y + vp[8] * zc + vp[12];
        const cy = vp[1] * it.x + vp[5] * it.y + vp[9] * zc + vp[13];
        if (!M.ortho && cw < -R) continue;
        if ((M.ortho || cw > R) && (Math.abs(cx) - R * M.px > cw || Math.abs(cy) - R * M.py > cw)) continue;

        const sides = one || st.slices.length > 1 || st.slices[0].sides;
        let rows = 1;
        if (opt.fill || opt.lod || voxel) {
          if (M.ortho) rows = ppuOrtho * M.cp * sc;
          else {
            const fov = opt.cam.fov || 38 * Math.PI / 180;
            const reach = (M.eye[2] - it.z - st.n * sc) / Math.sin(Math.min(1.5, opt.cam.pitch + fov / 2)) * Math.cos(fov / 2);
            const d = Math.max(4, reach, (it.x - M.eye[0]) * M.f[0] + (it.y - M.eye[1]) * M.f[1] + (it.z - M.eye[2]) * M.f[2] - st.radius * sc);
            rows = ih / (2 * d * M.th) * Math.min(1, M.cp + 0.25) * sc * 1.15;
          }
        }
        if (rows > tallest && sides && Math.abs(cx) < cw && Math.abs(cy) < cw) tallest = rows;

        const skip = opt.lod && !one && !it.each && rows < 1 ? Math.floor(1 / rows) : 1;
        const copies = voxel ? 1 : Math.max(st.shell ? Math.ceil(1 / (st.shell * slope)) : 1, Math.min(48, Math.ceil(opt.fill ? rows : 1)));
        const src = voxel && !one && !it.each ? st.runs : st.slices;
        const a = one ? it.only : 0, b = one ? it.only + 1 : src.length;
        const shx = it.shx || 0, shy = it.shy || 0;

        if (n + (b - a) * copies > cap) {
          while (n + (b - a) * copies > cap) cap *= 2;
          const i2 = new Float32Array(cap * FL), t2 = new Float32Array(cap * FL), k2 = new Uint16Array(cap);
          t2.set(tmp); k2.set(keys); inst = i2; tmp = t2; keys = k2;
        }

        for (let s = a; s < b; s++) {
          if (skip > 1 && (b - 1 - s) % skip) continue;
          const sl = src[s], first = sl.sides ? 0 : copies - 1;
          let px = it.x, py = it.y, pz = it.z;
          let localZ = one ? 0 : sl.z * sc;
          let rot = it.rot || 0, pitch = itPitch, roll = itRoll, k1 = sc;

          if (it.each) {
            moved.dx = 0; moved.dy = 0; moved.dz = 0; moved.rot = 0; moved.pitch = 0; moved.roll = 0; moved.scale = 1;
            const m = it.each(sl.z, st.n, moved);
            if (!m) continue;
            px += m.dx; py += m.dy; localZ += m.dz; rot += m.rot;
            if (m.pitch) pitch += m.pitch;
            if (m.roll) roll += m.roll;
            k1 *= m.scale;
          }
          slices++;

          if (voxel) {
            const j = n * FL, thin = !sl.sides, tall = thin ? 0.03 : s === b - 1 ? sl.n : Math.max(sl.n, skip);
            const lz = localZ + (thin ? (sl.n - 0.03) * k1 : 0);
            tmp[j] = px + shx * localZ; tmp[j + 1] = py + shy * localZ; tmp[j + 2] = pz;
            tmp[j + 3] = rot; tmp[j + 4] = pitch; tmp[j + 5] = roll; tmp[j + 6] = lz;
            tmp[j + 7] = sl.u; tmp[j + 8] = sl.v; tmp[j + 9] = sl.w; tmp[j + 10] = sl.h;
            tmp[j + 11] = sl.ox; tmp[j + 12] = sl.oy; tmp[j + 13] = k1; tmp[j + 14] = tall * k1; tmp[j + 15] = 0;
            keys[n++] = NB - 1 - Math.min(NB - 1, Math.max(0, Math.floor((pz + lz) * ZQ)));
            continue;
          }

          for (let k = first; k < copies; k++) {
            const lz = localZ + k / copies * k1, j = n * FL;
            tmp[j] = px + shx * lz; tmp[j + 1] = py + shy * lz; tmp[j + 2] = pz;
            tmp[j + 3] = rot; tmp[j + 4] = pitch; tmp[j + 5] = roll; tmp[j + 6] = lz;
            tmp[j + 7] = sl.u; tmp[j + 8] = sl.v; tmp[j + 9] = sl.w; tmp[j + 10] = sl.h;
            tmp[j + 11] = sl.ox; tmp[j + 12] = sl.oy; tmp[j + 13] = k1; tmp[j + 14] = 0; tmp[j + 15] = 0;
            let key = Math.min(NB - 1, Math.max(0, Math.floor((pz + lz) * ZQ)));
            if (opt.hsr) key = NB - 1 - key;
            keys[n++] = key;
          }
        }
      }

      counts.fill(0);
      for (let i = 0; i < n; i++) counts[keys[i] + 1]++;
      for (let i = 0; i < NB; i++) counts[i + 1] += counts[i];
      for (let i = 0; i < n; i++) {
        const d = counts[keys[i]]++ * FL, s = i * FL;
        for (let k = 0; k < FL; k++) inst[d + k] = tmp[s + k];
      }
      E.stats.instances = n; E.stats.slices = slices; E.stats.rows = tallest;
      return n;
    }

    function drawSlices(prog, n, M, opt, hsr) {
      gl.useProgram(prog.p); gl.uniformMatrix4fv(prog.u.u_vp, false, M.vp);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, opt.atlas); gl.uniform1i(prog.u.u_atlas, 0);
      if (hsr) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); } else gl.disable(gl.DEPTH_TEST);
      if (opt.voxel) {
        gl.bindVertexArray(vaoVoxel);
        gl.uniform3fv(prog.u.u_eye, M.eye); gl.uniform3fv(prog.u.u_fwd, M.f); gl.uniform1f(prog.u.u_ortho, M.ortho ? 1 : 0);
        gl.enable(gl.CULL_FACE); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, n); gl.disable(gl.CULL_FACE);
      } else {
        gl.bindVertexArray(vao);
        gl.uniform1f(prog.u.u_guard, opt.guard ? 1 / ih : 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      }
      gl.disable(gl.DEPTH_TEST);
    }

    function pass(fbo, w, h, prog, tex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
      gl.useProgram(prog.p); gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.u.u_tex, 0);
    }

    const palBuf = new Float32Array(32 * 3);

    E.render = function (opt) {
      const t0 = performance.now(), W = canvas.width, H = canvas.height, env = opt.light;
      targets(Math.max(1, Math.round(W / (opt.scale || 1))), Math.max(1, Math.round(H / (opt.scale || 1))));
      const M = cameraMatrices(opt.cam, iw / ih), n = build(opt.list, M, opt);
      if (timerExt && !query) { query = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query); timing = true; }
      gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, n * FL), gl.DYNAMIC_DRAW);
      gl.viewport(0, 0, iw, ih); gl.disable(gl.BLEND);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fboG);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const pg = opt.voxel ? pGVoxel : pG, tested = opt.hsr || !!opt.voxel;
      drawSlices(pg, n, M, opt, tested);

      // Light pass
      const u = pLight.u, sun = env.sun;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboLit); gl.useProgram(pLight.p); gl.bindVertexArray(vaoFull);
      [[g0, 'u_g0'], [g1, 'u_g1'], [palTex, 'u_pal'], [hmTex, 'u_hm']].forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t[0]); gl.uniform1i(u[t[1]], i);
      });
      gl.uniformMatrix4fv(u.u_inv, false, M.inv);
      gl.uniform3fv(u.u_sun, sun); gl.uniform3fv(u.u_sunCol, env.sunCol);
      gl.uniform3fv(u.u_skyCol, env.skyCol); gl.uniform3fv(u.u_bounceCol, env.bounceCol);
      gl.uniform3fv(u.u_hazeCol, env.hazeCol); gl.uniform3fv(u.u_outer, env.outer);
      gl.uniform3fv(u.u_eye, M.eye); gl.uniform3fv(u.u_fwd, M.f);
      gl.uniform4f(u.u_world, world[0], world[1], opt.ground || 0, opt.time || 0);
      gl.uniform4f(u.u_fx, opt.shadows ? 0.1 * sun[2] + 0.012 : 0, opt.ao ? 0.9 : 0, env.glow, opt.shadows ? env.cloud || 0 : 0);
      const sx = M.r[0] * sun[0] + M.r[1] * sun[1], sy = M.u[0] * sun[0] + M.u[1] * sun[1] + M.u[2] * sun[2], sl = Math.hypot(sx, sy) || 1;
      gl.uniform4f(u.u_view, sx / sl * 2, sy / sl * 2, M.back - 140, 760);
      gl.uniform4f(u.u_tone, env.exposure, env.hazeK, M.ortho ? 0 : 1, 0);
      gl.uniform1f(u.u_water, opt.water ?? -9);
      gl.uniform1i(u.u_shadowSteps, opt.shadowSteps ?? 32);
      gl.uniform1i(u.u_aoSamples, opt.aoSamples ?? 16);

      // Distance-cull & sort lamps when > LAMPS
      let lampSrc = opt.lamps || [];
      if (lampSrc.length > LAMPS) {
        const cx = opt.cam.tx || 0, cy = opt.cam.ty || 0, cz = opt.cam.tz || 0;
        lampSrc = lampSrc.slice().sort((a, b) =>
          ((a[0] - cx) ** 2 + (a[1] - cy) ** 2 + (a[2] - cz) ** 2) -
          ((b[0] - cx) ** 2 + (b[1] - cy) ** 2 + (b[2] - cz) ** 2)
        ).slice(0, LAMPS);
      }
      const lamps = new Float32Array(LAMPS * 4), lampCol = new Float32Array(LAMPS * 3);
      lampSrc.forEach((l, i) => { lamps.set(l.slice(0, 4), i * 4); lampCol.set(l.slice(4, 7), i * 3); });
      const blobSrc = (opt.blobs || []).slice(0, BLOBS);
      const blobs = new Float32Array(BLOBS * 4), low = new Float32Array(BLOBS);
      blobSrc.forEach((b, i) => { blobs.set(b.slice(0, 4), i * 4); low[i] = b[4]; });
      gl.uniform4fv(u.u_lamp, lamps); gl.uniform3fv(u.u_lampCol, lampCol);
      gl.uniform1i(u.u_nlamp, Math.min(LAMPS, lampSrc.length));
      gl.uniform4fv(u.u_blob, blobs); gl.uniform1fv(u.u_blobLow, low);
      gl.uniform1i(u.u_nblob, blobSrc.length);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (opt.bloom && !opt.heat) {
        pass(fboBloom[0], bw, bh, pBright, lit); gl.uniform2f(pBright.u.u_px, 1 / iw, 1 / ih); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        [[1.2, 0], [0, 1.2], [2.6, 0], [0, 2.6]].forEach((s, i) => {
          pass(fboBloom[1 - (i & 1)], bw, bh, pBlur, bloom[i & 1]);
          gl.uniform2f(pBlur.u.u_step, s[0] / bw, s[1] / bh);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        });
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      if (opt.heat) {
        gl.activeTexture(gl.TEXTURE0); gl.useProgram(pHeat.p); gl.bindTexture(gl.TEXTURE_2D, countTex);
        gl.uniform1i(pHeat.u.u_count, 0); gl.uniform1i(pHeat.u.u_channel, opt.heat - 1); gl.uniform1f(pHeat.u.u_unit, UNIT);
      } else {
        gl.useProgram(pPost.p);
        [[lit, 'u_tex'], [bloom[0], 'u_bloom'], [g0, 'u_g0'], [g1, 'u_g1']].forEach((t, i) => {
          gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t[0]); gl.uniform1i(pPost.u[t[1]], i);
        });
        gl.uniform2f(pPost.u.u_size, iw, ih);
        gl.uniform2f(pPost.u.u_k, opt.bloom ? 0.55 + 0.75 * env.glow : 0, opt.vignette ?? 0.22);

        const dOpt = opt.dither || {};
        const dEnabled = !!dOpt.enabled;
        const dStrength = dEnabled ? (dOpt.strength ?? 0.6) : 0;
        const dLevels = dEnabled ? (dOpt.levels ?? 8) : 0;
        const dOutline = dOpt.outline ?? 0;
        const palInput = dEnabled && dOpt.palette ? (Array.isArray(dOpt.palette) ? dOpt.palette : (PALETTES[dOpt.palette] || [])) : [];
        const palCount = Math.min(32, palInput.length);
        for (let i = 0; i < palCount; i++) {
          const rgb = typeof palInput[i] === 'string' ? hexToRgb01(palInput[i]) : palInput[i];
          palBuf[i * 3] = rgb[0]; palBuf[i * 3 + 1] = rgb[1]; palBuf[i * 3 + 2] = rgb[2];
        }
        gl.uniform4f(pPost.u.u_dither, dStrength, dLevels, dOutline, palCount);
        gl.uniform3fv(pPost.u.u_pal, palBuf);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (timing) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); timing = false; }
      else if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) E.stats.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query); query = null;
      }
      E.stats.cpuMs = performance.now() - t0; E.stats.iw = iw; E.stats.ih = ih;
    };

    E.heights = function () {
      const d = new Uint8Array(iw * ih * 4), h = new Float32Array(iw * ih);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboG); gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(0, 0, iw, ih, gl.RGBA, gl.UNSIGNED_BYTE, d);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      for (let i = 0; i < h.length; i++) h[i] = (d[i * 4] * 256 + d[i * 4 + 1]) / 65535 * HMAX;
      return h;
    };

    E.finish = function () {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    };

    E.destroy = function () {
      releaseTargets();
      if (palTex) gl.deleteTexture(palTex);
      if (hmTex) gl.deleteTexture(hmTex);
      programs.forEach((p) => gl.deleteProgram(p));
      textures.forEach((t) => gl.deleteTexture(t));
      buffers.forEach((b) => gl.deleteBuffer(b));
      vaos.forEach((v) => gl.deleteVertexArray(v));
      fbos.forEach((f) => gl.deleteFramebuffer(f));
      rbos.forEach((r) => gl.deleteRenderbuffer(r));
    };

    return E;
  }

  function figureWriter(list, scale, lift) {
    const put = (st, i, x, y, z, rot) => {
      list.push({ stack: st, x: x * scale, y: y * scale, z: z * scale + (lift || 0), rot, scale, only: i });
    };
    return {
      slice: (st, i, x, y, z, rot) => put(st, i, x, y, z, rot),
      stack: (st, x, y, z, rot) => {
        for (let i = 0; i < st.slices.length; i++) put(st, i, x, y, z + st.slices[i].z, rot);
      },
      limb: (st, a, b, n) => {
        n = Math.max(n, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.8));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          put(st, 0, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 0.5, 0);
        }
      }
    };
  }

  global.Engine = { create, figureWriter, cameraMatrices, screenToWorld, HMAX, PALETTES };
})(typeof window !== 'undefined' ? window : globalThis);
