/* ==========================================================================
   Cranimeter · warp renderer (WebGL2)

   Draws the photo through the full geometric pipeline in one pass:

     screen → view space V → (rotate / zoom / flip)⁻¹ → U
            → lens re-projection → P → free-brush displacement field
            → face map (face layer over head / background layer) → source S
   The face layer comes from a 3D mesh rendered with a depth buffer into a face buffer
   (photo position + shading per pixel), so folds and occlusion work; without float
   render targets it falls back to a 2D spline warp.

   Every frame samples the ORIGINAL photo, so edits never stack resampling
   blur. Magnified areas use a sharp Catmull-Rom bicubic filter; minified
   areas use anisotropic trilinear mipmaps. Nothing here knows about the UI.
   ========================================================================== */
(() => {
'use strict';

const VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uImg;
uniform vec2  uTexSize;     // texture resolution (may be smaller than the photo)
uniform vec2  uSize;        // photo size in source px
uniform sampler2D uField;   // RG32F displacement per grid node (source px)
uniform ivec2 uFieldN;
uniform float uCell;
uniform int   uMorph;
uniform vec3  uView;        // x, y, k  (css px)
uniform float uDpr;
uniform float uCanvasH;     // device px
uniform vec2  uRot;         // cos θ, sin θ
uniform vec2  uScale;       // x scale (sign = flip), y scale
uniform vec2  uTrans;       // translation (view px)
uniform vec4  uEll;         // face frame: origin x, y, half bizygomatic, half nasion–menton (P space)
uniform float uLensD;       // camera distance in cm (0 = off)
uniform float uAlpha;
// ---- face map: two deformation layers, face composited over head/background ----
uniform int   uMapOn;       // 0 off · 1 on · 2 layers shown but not moved (tint only)
uniform sampler2D uMap;     // RGBA32F grid: source position for the face layer (rg) and the back layer (ba)
uniform ivec2 uMapN;
uniform float uMapCell;
uniform sampler2D uMask;    // face-layer mask in source space
uniform float uShowLayers;
uniform sampler2D uDepth;   // RGBA32F grid: face depth at each node of the photo (r), its change at each node of the result (g) — source px
uniform float uShade;       // 0…1 relighting strength
uniform vec3  uLight;       // light direction (image x right, y down, z toward the camera)
// ---- 3D face mesh, rendered with a depth buffer into a face buffer (mode 3) ----
uniform sampler2D uMesh;    // RGBA32F over the result: photo position (rg), shading (b), coverage (a)
uniform ivec2 uMeshN;
uniform float uMeshSc;      // face-buffer px per result px
uniform float uMeshJump;    // photo px: neighbours further apart than this sit on different folds
out vec4 outColor;

/* The face buffer at x. Photo positions are interpolated between texels, except across a fold
   (one surface in front of another), where blending positions would invent pixels. */
vec4 meshAt(vec2 x) {
  vec2 f = x * uMeshSc - 0.5;
  vec2 fl = floor(f), t = f - fl;
  ivec2 i0 = clamp(ivec2(fl), ivec2(0), uMeshN - 1), i1 = clamp(ivec2(fl) + 1, ivec2(0), uMeshN - 1);
  vec4 a = texelFetch(uMesh, ivec2(i0.x, i0.y), 0), b = texelFetch(uMesh, ivec2(i1.x, i0.y), 0);
  vec4 c = texelFetch(uMesh, ivec2(i0.x, i1.y), 0), d = texelFetch(uMesh, ivec2(i1.x, i1.y), 0);
  float wa = (1.0 - t.x) * (1.0 - t.y) * a.a, wb = t.x * (1.0 - t.y) * b.a, wc = (1.0 - t.x) * t.y * c.a, wd = t.x * t.y * d.a;
  float sw = wa + wb + wc + wd;
  if (sw < 1e-5) return vec4(0.0);
  vec3 v = (wa * a.rgb + wb * b.rgb + wc * c.rgb + wd * d.rgb) / sw;
  float spread = 0.0;
  if (a.a > 0.0 && b.a > 0.0) spread = max(spread, distance(a.rg, b.rg));
  if (a.a > 0.0 && c.a > 0.0) spread = max(spread, distance(a.rg, c.rg));
  if (d.a > 0.0 && b.a > 0.0) spread = max(spread, distance(d.rg, b.rg));
  if (d.a > 0.0 && c.a > 0.0) spread = max(spread, distance(d.rg, c.rg));
  if (spread > uMeshJump) {
    // on a fold: take the strongest texel instead of blending across it
    vec4 m = a; float wm = wa;
    if (wb > wm) { m = b; wm = wb; }
    if (wc > wm) { m = c; wm = wc; }
    if (wd > wm) { m = d; }
    v = m.rgb;
  }
  return vec4(v, sw);
}

vec4 gridAt(sampler2D g, vec2 x) {
  vec2 f = x / uMapCell;
  vec2 fl = floor(f);
  vec2 t = f - fl;
  ivec2 i0 = clamp(ivec2(fl), ivec2(0), uMapN - 1);
  ivec2 i1 = clamp(ivec2(fl) + 1, ivec2(0), uMapN - 1);
  vec4 a = texelFetch(g, ivec2(i0.x, i0.y), 0);
  vec4 b = texelFetch(g, ivec2(i1.x, i0.y), 0);
  vec4 c = texelFetch(g, ivec2(i0.x, i1.y), 0);
  vec4 d = texelFetch(g, ivec2(i1.x, i1.y), 0);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
vec4 mapAt(vec2 x) {
  // outside the grid, carry on with the edge's offset
  vec2 xe = clamp(x, vec2(0.0), vec2(uMapN - 1) * uMapCell);
  return gridAt(uMap, x) + vec4(x - xe, x - xe);
}

vec2 fieldAt(vec2 p) {
  vec2 f = p / uCell;
  vec2 fl = floor(f);
  vec2 t = f - fl;
  ivec2 i0 = clamp(ivec2(fl), ivec2(0), uFieldN - 1);
  ivec2 i1 = clamp(ivec2(fl) + 1, ivec2(0), uFieldN - 1);
  vec2 a = texelFetch(uField, ivec2(i0.x, i0.y), 0).rg;
  vec2 b = texelFetch(uField, ivec2(i1.x, i0.y), 0).rg;
  vec2 c = texelFetch(uField, ivec2(i0.x, i1.y), 0).rg;
  vec2 d = texelFetch(uField, ivec2(i1.x, i1.y), 0).rg;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

// ---- close-range perspective model (keep in sync with depthAt() in app.js) ----
// Depth in cm in front of the ear plane, in face-normalised coordinates
// (X = ±1 at the zygions, Y = −1 at nasion, +1 at menton).
float hump(float t) { t = clamp(t, 0.0, 1.0); return 1.0 - t * t * (3.0 - 2.0 * t); }
float gauss(vec2 q, vec2 c, vec2 s) { vec2 d = (q - c) / s; return exp(-0.5 * dot(d, d)); }
float depthAt(vec2 q) {
  float hx = hump((q.x * q.x) / (1.3 * 1.3));                              // face curves back toward the ears
  float hy = q.y < -1.0 ? hump((-1.0 - q.y) / 1.9)                         // forehead → crown
           : q.y > 0.9 ? mix(1.0, 0.25, 1.0 - hump((q.y - 0.9) / 0.6))      // under the chin → neck
           : 1.0;
  float z = 8.5 * hx * hy;
  z += 2.8 * gauss(q, vec2(0.0, -0.3), vec2(0.19, 0.40));                  // nose
  z += 0.8 * gauss(q, vec2(0.0, 0.25), vec2(0.30, 0.16));                  // lips
  z += 0.5 * gauss(q, vec2(0.0, 0.85), vec2(0.30, 0.20));                  // chin
  z -= 1.2 * (gauss(q, vec2(0.47, -0.9), vec2(0.2, 0.14)) + gauss(q, vec2(-0.47, -0.9), vec2(0.2, 0.14)));  // eye sockets
  return max(z, 0.0);
}
uniform float uZref;   // depth at the zygion (computed in app.js) — cheekbone width is held fixed
#define ZREF uZref
// Source/output scale for a point at face position p: x_near = x_far · (D − zref) / (D − z).
float lensG(vec2 p) {
  vec2 q = (p - uEll.xy) / uEll.zw;
  float e = (q.x * q.x) / (1.3 * 1.3) + ((q.y + 0.95) * (q.y + 0.95)) / 4.0;
  float w = 1.0 - smoothstep(1.0, 3.5, e);                                 // far background stays put
  return (uLensD - ZREF * w) / (uLensD - depthAt(q));
}
vec2 lensUP(vec2 u) {
  if (uLensD <= 0.0) return u;
  vec2 p = u;
  for (int i = 0; i < 6; i++) p = uEll.xy + (u - uEll.xy) * lensG(p);
  return p;
}

// Catmull-Rom bicubic in 9 bilinear taps — sharp, no gaussian softening.
vec4 bicubic(vec2 uv) {
  vec2 sp = uv * uTexSize;
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (t1 - 1.0) / uTexSize;
  vec2 t3 = (t1 + 2.0) / uTexSize;
  vec2 t12 = (t1 + w2 / w12) / uTexSize;
  vec4 r = vec4(0.0);
  r += textureLod(uImg, vec2(t0.x,  t0.y),  0.0) * w0.x  * w0.y;
  r += textureLod(uImg, vec2(t12.x, t0.y),  0.0) * w12.x * w0.y;
  r += textureLod(uImg, vec2(t3.x,  t0.y),  0.0) * w3.x  * w0.y;
  r += textureLod(uImg, vec2(t0.x,  t12.y), 0.0) * w0.x  * w12.y;
  r += textureLod(uImg, vec2(t12.x, t12.y), 0.0) * w12.x * w12.y;
  r += textureLod(uImg, vec2(t3.x,  t12.y), 0.0) * w3.x  * w12.y;
  r += textureLod(uImg, vec2(t0.x,  t3.y),  0.0) * w0.x  * w3.y;
  r += textureLod(uImg, vec2(t12.x, t3.y),  0.0) * w12.x * w3.y;
  r += textureLod(uImg, vec2(t3.x,  t3.y),  0.0) * w3.x  * w3.y;
  r = clamp(r, 0.0, 1.0);
  r.rgb = min(r.rgb, vec3(r.a));   // stay valid premultiplied colour
  return r;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y) / uDpr;
  vec2 v = (frag - uView.xy) / uView.z;

  vec2 c0 = uSize * 0.5;
  vec2 dv = v - c0 - uTrans;
  vec2 u = c0 + vec2(uRot.x * dv.x + uRot.y * dv.y, -uRot.y * dv.x + uRot.x * dv.y) / uScale;

  vec2 p = lensUP(u);
  vec2 x = p;
  if (uMorph == 1) x += fieldAt(p);           // free-brush field

  // face map layers (identity when off)
  vec2 sb = x, sf = x;
  if (uMapOn == 1 || uMapOn == 3) { vec4 s = mapAt(x); sf = s.rg; sb = s.ba; }
  // mode 3: the face comes from the rendered 3D mesh (with occlusion and its own shading)
  float meshShade = 1.0, meshCov = 1.0;
  if (uMapOn == 3) { vec4 fm = meshAt(x); meshCov = fm.a; sf = fm.a > 0.0 ? fm.rg : x; meshShade = fm.b; }
  bool layered = uMapOn != 0;

  // derivatives first (must be taken in uniform control flow)
  vec2 uvb = sb / uSize, uvf = sf / uSize;
  vec2 dbx = dFdx(uvb), dby = dFdy(uvb), dfx = dFdx(uvf), dfy = dFdy(uvf);
  vec2 sbx = dFdx(sb), sby = dFdy(sb), sfx = dFdx(sf), sfy = dFdy(sf);
  float lodb = log2(max(max(length(dbx * uTexSize), length(dby * uTexSize)), 1e-6));
  float lodf = log2(max(max(length(dfx * uTexSize), length(dfy * uTexSize)), 1e-6));
  float footb = max(length(sbx), length(sby)), footf = max(length(sfx), length(sfy));

  float m = layered ? texture(uMask, uvf).r : 0.0;     // is the face layer here?
  if (uMapOn == 3) m *= smoothstep(0.0, 1.0, meshCov);   // …and has the mesh reached this spot?

  // Relighting: the face's depth before (z0, carried from the photo) and after (z1) the change.
  // Their slopes give the surface normals; the ratio of the two Lambert terms is the shading change.
  bool shade = uMapOn == 1 && uShade > 0.0;
  float z0 = shade ? gridAt(uDepth, sf).r : 0.0;
  float z1 = z0 + (shade ? gridAt(uDepth, x).g : 0.0);
  float spx = uView.z * uDpr;   // device px per source px
  vec2 g0 = vec2(dFdx(z0), -dFdy(z0)) * spx, g1 = vec2(dFdx(z1), -dFdy(z1)) * spx;

  vec4 colb = mix(bicubic(uvb), textureGrad(uImg, uvb, dbx, dby), smoothstep(0.0, 0.7, lodb));
  vec4 col = colb;
  float edgeB = min(min(sb.x, sb.y), min(uSize.x - sb.x, uSize.y - sb.y));
  float a = clamp(edgeB / max(footb, 1e-4) + 0.5, 0.0, 1.0);   // anti-aliased photo border
  if (uMapOn == 1 || uMapOn == 3) {
    vec4 colf = mix(bicubic(uvf), textureGrad(uImg, uvf, dfx, dfy), smoothstep(0.0, 0.7, lodf));
    if (uMapOn == 3) { colf.rgb *= meshShade; colf.rgb = min(colf.rgb, vec3(colf.a)); }
    if (shade) {
      vec3 L = normalize(uLight);
      vec3 n0 = normalize(vec3(-g0, 1.0)), n1 = normalize(vec3(-g1, 1.0));
      // skin scatters light, so geometric highlights stay softer than shadows
      float k = (max(dot(n1, L), 0.0) + 0.3) / (max(dot(n0, L), 0.0) + 0.3);
      k = k > 1.0 ? 1.0 + (min(k, 1.6) - 1.0) * 0.45 : max(k, 0.55);
      colf.rgb *= mix(1.0, k, uShade);
      colf.rgb = min(colf.rgb, vec3(colf.a));
    }
    float edgeF = min(min(sf.x, sf.y), min(uSize.x - sf.x, uSize.y - sf.y));
    float af = clamp(edgeF / max(footf, 1e-4) + 0.5, 0.0, 1.0);
    col = mix(colb, colf, m);
    a = mix(a, af, m);
  }
  if (layered && uShowLayers > 0.0) {
    vec3 tint = mix(vec3(0.33, 0.42, 0.86), vec3(0.25, 0.82, 0.72), m);
    col.rgb = mix(col.rgb, tint * col.a, 0.32 * uShowLayers);
  }
  outColor = col * (a * uAlpha);
}`;

// Pre-pass: evaluates both face-map layers and the two depth fields (thin-plate splines fitted in
// facemap.js) once per grid node, so each frame only interpolates the grids.
const MAP_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uCtrl;    // rows: face layer, back layer, base depth, depth change — (centre x, y, weight x, y), in units of uS
uniform int   uNF, uNB, uND, uNC;
uniform vec3  uAF[2], uAB[2];   // affine parts (x and y rows)
uniform vec3  uAD, uAC;
uniform float uS;
uniform float uMapCell;
layout(location = 0) out vec4 outMap;
layout(location = 1) out vec4 outDepth;
vec2 tps(int row, int n, vec3 ax, vec3 ay, vec2 v) {
  vec2 X = v / uS;
  vec2 d = vec2(ax.x + ax.y * X.x + ax.z * X.y, ay.x + ay.y * X.x + ay.z * X.y);
  for (int i = 0; i < 2048; i++) {
    if (i >= n) break;
    vec4 c = texelFetch(uCtrl, ivec2(i, row), 0);
    vec2 e = X - c.xy; float r2 = dot(e, e);
    if (r2 > 1e-12) d += c.zw * (0.5 * r2 * log(r2));
  }
  return v + d * uS;
}
float tps1(int row, int n, vec3 a, vec2 v) {
  vec2 X = v / uS;
  float d = a.x + a.y * X.x + a.z * X.y;
  for (int i = 0; i < 2048; i++) {
    if (i >= n) break;
    vec4 c = texelFetch(uCtrl, ivec2(i, row), 0);
    vec2 e = X - c.xy; float r2 = dot(e, e);
    if (r2 > 1e-12) d += c.z * (0.5 * r2 * log(r2));
  }
  return d * uS;
}
void main() {
  vec2 v = (gl_FragCoord.xy - 0.5) * uMapCell;
  outMap = vec4(tps(0, uNF, uAF[0], uAF[1], v), tps(1, uNB, uAB[0], uAB[1], v));
  outDepth = vec4(uND > 0 ? tps1(2, uND, uAD, v) : 0.0, uNC > 0 ? tps1(3, uNC, uAC, v) : 0.0, 0.0, 1.0);
}`;

// The deformed 3D face mesh: each vertex knows where it is now (result px), how close it is to the
// camera (for the depth test), where its pixels come from on the photo, and its new shading.
const MESH_VS = `#version 300 es
in vec2 aPos;      // result position (px)
in float aZ;       // depth toward the camera (px)
in vec2 aSrc;      // photo position (px)
in float aShade;
uniform vec2 uSize;
uniform float uZScale;
out vec2 vSrc;
out float vShade;
void main() {
  vSrc = aSrc; vShade = aShade;
  vec2 n = aPos / uSize * 2.0 - 1.0;
  gl_Position = vec4(n, clamp(-aZ * uZScale, -1.0, 1.0), 1.0);   // nearer = smaller depth
}`;
const MESH_FS = `#version 300 es
precision highp float;
in vec2 vSrc;
in float vShade;
out vec4 outFace;
void main() { outFace = vec4(vSrc, vShade, 1.0); }`;

function createRenderer(canvas) {
  let gl;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
  } catch (e) { gl = null; }
  if (!gl) return null;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const link = (vs, fs) => {
    if (!vs || !fs) return null;
    const pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(pr)); return null; }
    return pr;
  };
  const vs = sh(gl.VERTEX_SHADER, VS);
  const prog = link(vs, sh(gl.FRAGMENT_SHADER, FS));
  if (!prog) return null;
  // rendering the map grid needs float render targets; without them app.js fills the grid on the CPU
  const floatRT = !!gl.getExtension('EXT_color_buffer_float');
  const mapProg = floatRT ? link(vs, sh(gl.FRAGMENT_SHADER, MAP_FS)) : null;
  const meshProg = floatRT ? link(sh(gl.VERTEX_SHADER, MESH_VS), sh(gl.FRAGMENT_SHADER, MESH_FS)) : null;

  const U = {};
  ['uImg', 'uTexSize', 'uSize', 'uField', 'uFieldN', 'uCell', 'uMorph', 'uView', 'uDpr', 'uCanvasH',
   'uRot', 'uScale', 'uTrans', 'uEll', 'uLensD', 'uZref', 'uAlpha',
   'uMapOn', 'uMap', 'uMapN', 'uMapCell', 'uMask', 'uShowLayers', 'uDepth', 'uShade', 'uLight',
   'uMesh', 'uMeshN', 'uMeshSc', 'uMeshJump'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
  const XU = {};
  if (meshProg) ['uSize', 'uZScale'].forEach(n => { XU[n] = gl.getUniformLocation(meshProg, n); });
  const MU = {};
  if (mapProg) ['uCtrl', 'uNF', 'uNB', 'uND', 'uNC', 'uAF', 'uAB', 'uAD', 'uAC', 'uS', 'uMapCell'].forEach(n => { MU[n] = gl.getUniformLocation(mapProg, n); });
  const vao = gl.createVertexArray();
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxView = gl.getParameter(gl.MAX_VIEWPORT_DIMS);

  const imgTex = gl.createTexture();
  const fieldTex = gl.createTexture();
  const zeroTex = gl.createTexture();
  const floatTex = (tex, w, h, data) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, w, h, 0, gl.RG, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  floatTex(zeroTex, 1, 1, new Float32Array(2));
  const maskTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const rgba32 = (tex, w, h, data) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const mapTex = gl.createTexture(), depthTex = gl.createTexture(), ctrlTex = gl.createTexture(), mapFbo = gl.createFramebuffer();
  rgba32(mapTex, 1, 1, new Float32Array(4));
  rgba32(depthTex, 1, 1, new Float32Array(4));
  let mapW = 1, mapH = 1, mapCell = 1;
  // 3D face mesh → face buffer
  const meshTex = gl.createTexture(), meshDepth = gl.createRenderbuffer(), meshFbo = gl.createFramebuffer();
  const meshVao = gl.createVertexArray(), meshVbo = gl.createBuffer(), meshIbo = gl.createBuffer();
  rgba32(meshTex, 1, 1, new Float32Array(4));
  let meshW = 1, meshH = 1, meshSc = 1, meshCount = 0;
  if (meshProg) {
    gl.bindVertexArray(meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
    const loc = n => gl.getAttribLocation(meshProg, n), F = 4, stride = 6 * F;
    [['aPos', 2, 0], ['aZ', 1, 2], ['aSrc', 2, 3], ['aShade', 1, 5]].forEach(([n, k, o]) => {
      const l = loc(n); if (l < 0) return;
      gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, stride, o * F);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIbo);
    gl.bindVertexArray(null);
  }

  let texW = 1, texH = 1, fieldW = 0, fieldH = 0, hasField = false;

  return {
    canvas, maxTex, maxView,
    /** True when the face-map grid can be computed on the GPU (computeMap); otherwise use setMapGrid. */
    gpuMap: !!mapProg,
    /** True when the 3D face mesh can be rendered (needs float render targets). */
    gpuMesh: !!meshProg,
    /** Triangles of the face mesh (indices into the vertex list); changes when the scan is re-aligned. */
    setMeshIndices(idx) {
      gl.bindVertexArray(meshVao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      meshCount = idx.length;
    },
    /**
     * Render the face mesh into the face buffer. verts: Float32Array of 6 per vertex
     * (result x, y, depth, photo x, y, shading); size [iw, ih] of the result in px; sc: buffer px per result px.
     */
    renderMesh(verts, size, sc, zScale) {
      const w = Math.max(1, Math.round(size[0] * sc)), h = Math.max(1, Math.round(size[1] * sc));
      if (w !== meshW || h !== meshH) {
        rgba32(meshTex, w, h, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, meshDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        meshW = w; meshH = h;
      }
      meshSc = w / size[0];
      gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.bindFramebuffer(gl.FRAMEBUFFER, meshFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, meshTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, meshDepth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      gl.useProgram(meshProg);
      gl.uniform2f(XU.uSize, size[0], size[1]);
      gl.uniform1f(XU.uZScale, zScale);
      gl.bindVertexArray(meshVao);
      gl.drawElements(gl.TRIANGLES, meshCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    /**
     * Evaluate both face-map layers and the two depth fields on a gw × gh grid (cell = source px
     * between nodes). F, B: thin-plate splines from CraniMap.tpsFit (same length unit s);
     * D, C: scalar splines for the face depth (on the photo) and its change (on the result), or null.
     */
    computeMap(F, B, D, C, gw, gh, cell) {
      const n = Math.max(1, F.n, B.n, D ? D.n : 0, C ? C.n : 0), ctrl = new Float32Array(n * 4 * 4);
      const put = (T, row) => { if (T) for (let i = 0; i < T.n; i++) ctrl.set([T.c[2 * i], T.c[2 * i + 1], T.w[2 * i], T.w[2 * i + 1]], 4 * (row * n + i)); };
      put(F, 0); put(B, 1); put(D, 2); put(C, 3);
      rgba32(ctrlTex, n, 4, ctrl);
      if (gw !== mapW || gh !== mapH) { rgba32(mapTex, gw, gh, null); rgba32(depthTex, gw, gh, null); mapW = gw; mapH = gh; }
      mapCell = cell;
      gl.bindFramebuffer(gl.FRAMEBUFFER, mapFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mapTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, depthTex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, gw, gh);
      gl.useProgram(mapProg);
      gl.bindVertexArray(vao);
      // keep the target textures off every sampler unit while drawing into them
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ctrlTex); gl.uniform1i(MU.uCtrl, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.uniform1i(MU.uNF, F.n); gl.uniform1i(MU.uNB, B.n);
      gl.uniform1i(MU.uND, D ? D.n : 0); gl.uniform1i(MU.uNC, C ? C.n : 0);
      gl.uniform3fv(MU.uAF, F.a); gl.uniform3fv(MU.uAB, B.a);
      gl.uniform3fv(MU.uAD, D ? D.a.slice(0, 3) : [0, 0, 0]); gl.uniform3fv(MU.uAC, C ? C.a.slice(0, 3) : [0, 0, 0]);
      gl.uniform1f(MU.uS, F.s); gl.uniform1f(MU.uMapCell, cell);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    /** Upload grids computed elsewhere (Float32Array gw*gh*4: face x, y, back x, y · depth, depth change, 0, 0). */
    setMapGrid(data, depth, gw, gh, cell) {
      rgba32(mapTex, gw, gh, data);
      rgba32(depthTex, gw, gh, depth);
      mapW = gw; mapH = gh; mapCell = cell;
    },
    /** Upload the photo (an image or canvas already scaled to fit maxTex). */
    setImage(src, w, h) {
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      texW = w; texH = h;
    },
    /** Upload the face-layer mask (a canvas covering the photo, white = face). */
    setMask(src) {
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    },
    /** Upload the morph field (Float32Array of gw*gh*2) — or null for none. */
    setField(data, gw, gh) {
      if (!data) { hasField = false; return; }
      if (gw !== fieldW || gh !== fieldH) { floatTex(fieldTex, gw, gh, data); fieldW = gw; fieldH = gh; }
      else {
        gl.bindTexture(gl.TEXTURE_2D, fieldTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.RG, gl.FLOAT, data);
      }
      hasField = true;
    },
    /**
     * p: { cw, ch (device px), view {x,y,k}, dpr, size [iw,ih], rot (rad), scale [sx,sy], trans [tx,ty],
     *      ell [cx,cy,ax,ay] | null, lensD (cm, 0 = off), morph (bool), cell, alpha }
     */
    render(p) {
      if (canvas.width !== p.cw) canvas.width = p.cw;
      if (canvas.height !== p.ch) canvas.height = p.ch;
      gl.viewport(0, 0, p.cw, p.ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, imgTex); gl.uniform1i(U.uImg, 0);
      const useField = p.morph && hasField;
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, useField ? fieldTex : zeroTex); gl.uniform1i(U.uField, 1);
      gl.uniform2f(U.uTexSize, texW, texH);
      gl.uniform2f(U.uSize, p.size[0], p.size[1]);
      gl.uniform2i(U.uFieldN, useField ? fieldW : 1, useField ? fieldH : 1);
      gl.uniform1f(U.uCell, p.cell || 1);
      gl.uniform1i(U.uMorph, useField ? 1 : 0);
      gl.uniform3f(U.uView, p.view.x, p.view.y, p.view.k);
      gl.uniform1f(U.uDpr, p.dpr);
      gl.uniform1f(U.uCanvasH, p.ch);
      gl.uniform2f(U.uRot, Math.cos(p.rot), Math.sin(p.rot));
      gl.uniform2f(U.uScale, p.scale[0], p.scale[1]);
      gl.uniform2f(U.uTrans, p.trans[0], p.trans[1]);
      const e = p.ell || [0, 0, 1, 1];
      gl.uniform4f(U.uEll, e[0], e[1], Math.max(1, e[2]), Math.max(1, e[3]));
      gl.uniform1f(U.uLensD, p.ell ? p.lensD : 0);
      gl.uniform1f(U.uZref, p.zref || 0);
      // face map: p.map = { moved (grids are current), showLayers, shade (0…1), light [x, y, z] } | null
      const M = p.map;
      gl.uniform1i(U.uMapOn, M ? (M.moved ? (M.mesh ? 3 : 1) : 2) : 0);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, meshTex); gl.uniform1i(U.uMesh, 5);
      gl.uniform2i(U.uMeshN, meshW, meshH);
      gl.uniform1f(U.uMeshSc, meshSc);
      gl.uniform1f(U.uMeshJump, M && M.jump ? M.jump : 8);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(U.uMask, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, mapTex); gl.uniform1i(U.uMap, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, depthTex); gl.uniform1i(U.uDepth, 4);
      gl.uniform2i(U.uMapN, mapW, mapH);
      gl.uniform1f(U.uMapCell, mapCell);
      gl.uniform1f(U.uShowLayers, M && M.showLayers ? 1 : 0);
      gl.uniform1f(U.uShade, M && M.moved ? (M.shade || 0) : 0);
      const L = (M && M.light) || [0, -.35, 1];
      gl.uniform3f(U.uLight, L[0], L[1], L[2]);
      gl.uniform1f(U.uAlpha, p.alpha == null ? 1 : p.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    clear() { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
    isLost: () => gl.isContextLost(),
  };
}

window.CraniWarp = { createRenderer, build: '13' };
})();
