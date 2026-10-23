/* ==========================================================================
   Cranimeter · warp renderer (WebGL2)

   Draws the photo through the full geometric pipeline in one pass:

     screen → view space V → (rotate / zoom / flip)⁻¹ → U
            → lens re-projection → P → free-brush displacement field
            → face map (face layer over head / background layer) → source S
   The face map is two smooth thin-plate-spline layers (face over head / background),
   followed by a soft dodge & burn tone layer that moves with the face.

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
// ---- tone: a soft dodge & burn layer over the photo (multiplier on brightness, 1 = unchanged) ----
uniform int   uToneOn;
uniform sampler2D uTone;    // R32F grid in photo space, so it moves with the face
uniform ivec2 uToneN;
uniform float uToneCell;
out vec4 outColor;

float toneAt(vec2 s) {
  vec2 f = s / uToneCell;
  vec2 fl = floor(f), t = f - fl;
  ivec2 i0 = clamp(ivec2(fl), ivec2(0), uToneN - 1), i1 = clamp(ivec2(fl) + 1, ivec2(0), uToneN - 1);
  float a = texelFetch(uTone, ivec2(i0.x, i0.y), 0).r, b = texelFetch(uTone, ivec2(i1.x, i0.y), 0).r;
  float c = texelFetch(uTone, ivec2(i0.x, i1.y), 0).r, d = texelFetch(uTone, ivec2(i1.x, i1.y), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
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
  if (uMapOn == 1) { vec4 s = mapAt(x); sf = s.rg; sb = s.ba; }
  bool layered = uMapOn != 0;

  // derivatives first (must be taken in uniform control flow)
  vec2 uvb = sb / uSize, uvf = sf / uSize;
  vec2 dbx = dFdx(uvb), dby = dFdy(uvb), dfx = dFdx(uvf), dfy = dFdy(uvf);
  vec2 sbx = dFdx(sb), sby = dFdy(sb), sfx = dFdx(sf), sfy = dFdy(sf);
  float lodb = log2(max(max(length(dbx * uTexSize), length(dby * uTexSize)), 1e-6));
  float lodf = log2(max(max(length(dfx * uTexSize), length(dfy * uTexSize)), 1e-6));
  float footb = max(length(sbx), length(sby)), footf = max(length(sfx), length(sfy));

  float m = layered ? texture(uMask, uvf).r : 0.0;     // is the face layer here?

  vec4 colb = mix(bicubic(uvb), textureGrad(uImg, uvb, dbx, dby), smoothstep(0.0, 0.7, lodb));
  vec4 col = colb;
  float edgeB = min(min(sb.x, sb.y), min(uSize.x - sb.x, uSize.y - sb.y));
  float a = clamp(edgeB / max(footb, 1e-4) + 0.5, 0.0, 1.0);   // anti-aliased photo border
  if (uMapOn == 1) {
    vec4 colf = mix(bicubic(uvf), textureGrad(uImg, uvf, dfx, dfy), smoothstep(0.0, 0.7, lodf));
    float edgeF = min(min(sf.x, sf.y), min(uSize.x - sf.x, uSize.y - sf.y));
    float af = clamp(edgeF / max(footf, 1e-4) + 0.5, 0.0, 1.0);
    col = mix(colb, colf, m);
    a = mix(a, af, m);
  }
  // dodge & burn: brightness only, read where each layer's pixel came from (so it moves with the face)
  if (uToneOn == 1) {
    float k = mix(toneAt(sb), toneAt(layered ? sf : sb), m);
    // burn darkens like multiply; dodge lifts more evenly, so highlights don't turn orange
    float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
    col.rgb = k < 1.0 ? col.rgb * k : col.rgb + (k - 1.0) * mix(col.rgb, vec3(lum), 0.55);
    col.rgb = min(col.rgb, vec3(col.a));
  }
  if (layered && uShowLayers > 0.0) {
    vec3 tint = mix(vec3(0.33, 0.42, 0.86), vec3(0.25, 0.82, 0.72), m);
    col.rgb = mix(col.rgb, tint * col.a, 0.32 * uShowLayers);
  }
  outColor = col * (a * uAlpha);
}`;

// Pre-pass: evaluates both face-map layers (thin-plate splines fitted in facemap.js) once per
// grid node, so each frame only interpolates the grid.
const MAP_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uCtrl;    // rows: face layer, back layer — (centre x, y, weight x, y), in units of uS
uniform int   uNF, uNB;
uniform vec3  uAF[2], uAB[2];   // affine parts (x and y rows)
uniform float uS;
uniform float uMapCell;
out vec4 outMap;
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
void main() {
  vec2 v = (gl_FragCoord.xy - 0.5) * uMapCell;
  outMap = vec4(tps(0, uNF, uAF[0], uAF[1], v), tps(1, uNB, uAB[0], uAB[1], v));
}`;

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

  const U = {};
  ['uImg', 'uTexSize', 'uSize', 'uField', 'uFieldN', 'uCell', 'uMorph', 'uView', 'uDpr', 'uCanvasH',
   'uRot', 'uScale', 'uTrans', 'uEll', 'uLensD', 'uZref', 'uAlpha',
   'uMapOn', 'uMap', 'uMapN', 'uMapCell', 'uMask', 'uShowLayers',
   'uToneOn', 'uTone', 'uToneN', 'uToneCell'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
  const MU = {};
  if (mapProg) ['uCtrl', 'uNF', 'uNB', 'uAF', 'uAB', 'uS', 'uMapCell'].forEach(n => { MU[n] = gl.getUniformLocation(mapProg, n); });
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
  const mapTex = gl.createTexture(), ctrlTex = gl.createTexture(), mapFbo = gl.createFramebuffer();
  rgba32(mapTex, 1, 1, new Float32Array(4));
  let mapW = 1, mapH = 1, mapCell = 1;
  // dodge & burn tone grid (one float per node, photo space)
  const toneTex = gl.createTexture();
  const r32 = (tex, w, h, data) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  r32(toneTex, 1, 1, new Float32Array([1]));
  let toneW = 1, toneH = 1, toneCell = 1, toneOn = false;

  let texW = 1, texH = 1, fieldW = 0, fieldH = 0, hasField = false;

  return {
    canvas, maxTex, maxView,
    /** True when the face-map grid can be computed on the GPU (computeMap); otherwise use setMapGrid. */
    gpuMap: !!mapProg,
    /** The dodge & burn tone grid (Float32Array gw*gh, 1 = unchanged), or null to switch it off. */
    setTone(data, gw, gh, cell) {
      if (!data) { toneOn = false; return; }
      r32(toneTex, gw, gh, data);
      toneW = gw; toneH = gh; toneCell = cell; toneOn = true;
    },
    /**
     * Evaluate both face-map layers on a gw × gh grid (cell = source px between nodes).
     * F, B: thin-plate splines from CraniMap.tpsFit (same length unit s).
     */
    computeMap(F, B, gw, gh, cell) {
      const n = Math.max(1, F.n, B.n), ctrl = new Float32Array(n * 2 * 4);
      const put = (T, row) => { for (let i = 0; i < T.n; i++) ctrl.set([T.c[2 * i], T.c[2 * i + 1], T.w[2 * i], T.w[2 * i + 1]], 4 * (row * n + i)); };
      put(F, 0); put(B, 1);
      rgba32(ctrlTex, n, 2, ctrl);
      if (gw !== mapW || gh !== mapH) { rgba32(mapTex, gw, gh, null); mapW = gw; mapH = gh; }
      mapCell = cell;
      gl.bindFramebuffer(gl.FRAMEBUFFER, mapFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mapTex, 0);
      gl.viewport(0, 0, gw, gh);
      gl.useProgram(mapProg);
      gl.bindVertexArray(vao);
      // keep the target textures off every sampler unit while drawing into them
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ctrlTex); gl.uniform1i(MU.uCtrl, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.uniform1i(MU.uNF, F.n); gl.uniform1i(MU.uNB, B.n);
      gl.uniform3fv(MU.uAF, F.a); gl.uniform3fv(MU.uAB, B.a);
      gl.uniform1f(MU.uS, F.s); gl.uniform1f(MU.uMapCell, cell);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    /** Upload a grid computed elsewhere (Float32Array gw*gh*4: face x, y, back x, y). */
    setMapGrid(data, gw, gh, cell) {
      rgba32(mapTex, gw, gh, data);
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
      // face map: p.map = { moved (grid is current), showLayers, tone (draw the tone grid), plain (tone only) } | null
      const M = p.map;
      gl.uniform1i(U.uMapOn, M && !M.plain ? (M.moved ? 1 : 2) : 0);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(U.uMask, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, mapTex); gl.uniform1i(U.uMap, 3);
      gl.uniform2i(U.uMapN, mapW, mapH);
      gl.uniform1f(U.uMapCell, mapCell);
      gl.uniform1f(U.uShowLayers, M && M.showLayers ? 1 : 0);
      const tone = !!(M && M.tone && toneOn);
      gl.uniform1i(U.uToneOn, tone ? 1 : 0);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, toneTex); gl.uniform1i(U.uTone, 4);
      gl.uniform2i(U.uToneN, toneW, toneH);
      gl.uniform1f(U.uToneCell, toneCell);
      gl.uniform1f(U.uAlpha, p.alpha == null ? 1 : p.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    clear() { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
    isLost: () => gl.isContextLost(),
  };
}

window.CraniWarp = { createRenderer, build: '31' };
})();
