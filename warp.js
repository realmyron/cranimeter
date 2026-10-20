/* ==========================================================================
   Cranimeter · warp renderer (WebGL2)

   Draws the photo through the full geometric pipeline in one pass:

     screen → view space V → (rotate / zoom / flip)⁻¹ → U
            → lens re-projection → P → morph displacement field → source S

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
uniform float uZoom;
uniform float uFlip;
uniform vec4  uEll;         // face ellipse cx, cy, ax, ay (U space)
uniform float uLensK;       // face depth ÷ camera distance (0 = off)
uniform float uAlpha;
out vec4 outColor;

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

// Head modelled as a smooth dome: depth 1 at the face centre, 0 at the
// face outline, gently further back beyond it. Re-projecting from a near
// camera to a far one scales offsets by 1 / (1 - k·depth).
float lensG(vec2 u) {
  if (uLensK <= 0.0) return 1.0;
  vec2 r = (u - uEll.xy) / uEll.zw;
  float r2 = dot(r, r);
  float h = r2 < 1.0 ? 1.0 - r2 : -0.5 * (1.0 - exp(-(r2 - 1.0) / 0.5));
  return 1.0 / (1.0 - uLensK * h);
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
  vec2 dv = v - c0;
  vec2 u = c0 + vec2(uRot.x * dv.x + uRot.y * dv.y, -uRot.y * dv.x + uRot.x * dv.y) / uZoom;
  u.x = c0.x + (u.x - c0.x) * uFlip;

  vec2 p = uEll.xy + (u - uEll.xy) * lensG(u);
  vec2 s = p;
  if (uMorph == 1) s += fieldAt(p);

  vec2 uv = s / uSize;
  // derivatives first (must be taken in uniform control flow)
  vec2 dsx = dFdx(s), dsy = dFdy(s);
  vec2 duvx = dFdx(uv), duvy = dFdy(uv);
  float foot = max(length(dsx), length(dsy));                      // source px per screen px
  float rho = max(length(duvx * uTexSize), length(duvy * uTexSize));
  float lod = log2(max(rho, 1e-6));

  float edge = min(min(s.x, s.y), min(uSize.x - s.x, uSize.y - s.y));
  float a = clamp(edge / max(foot, 1e-4) + 0.5, 0.0, 1.0);          // anti-aliased photo border

  vec4 cubic = bicubic(uv);
  vec4 tri = textureGrad(uImg, uv, duvx, duvy);
  vec4 col = mix(cubic, tri, smoothstep(0.0, 0.7, lod));
  outColor = col * (a * uAlpha);
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
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return null; }

  const U = {};
  ['uImg', 'uTexSize', 'uSize', 'uField', 'uFieldN', 'uCell', 'uMorph', 'uView', 'uDpr', 'uCanvasH',
   'uRot', 'uZoom', 'uFlip', 'uEll', 'uLensK', 'uAlpha'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
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

  let texW = 1, texH = 1, fieldW = 0, fieldH = 0, hasField = false;

  return {
    canvas, maxTex, maxView,
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
     * p: { cw, ch (device px), view {x,y,k}, dpr, size [iw,ih], rot (rad), zoom, flip,
     *      ell [cx,cy,ax,ay] | null, lensK, morph (bool), cell, alpha }
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
      gl.uniform1f(U.uZoom, p.zoom);
      gl.uniform1f(U.uFlip, p.flip);
      const e = p.ell || [0, 0, 1, 1];
      gl.uniform4f(U.uEll, e[0], e[1], Math.max(1, e[2]), Math.max(1, e[3]));
      gl.uniform1f(U.uLensK, p.ell ? p.lensK : 0);
      gl.uniform1f(U.uAlpha, p.alpha == null ? 1 : p.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    clear() { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
    isLost: () => gl.isContextLost(),
  };
}

window.CraniWarp = { createRenderer, build: '8' };
})();
