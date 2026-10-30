/* ==========================================================================
   Cranimeter · face surface (Face map → step 2)

   Builds a depth map ("topography") of this face on a grid over the photo:
     1. Prior: the template depth carried by the face-map dots (the generic 3D face, pulled onto
        this face by the dots — the "elastic adjustment" of Yin, Weiss & Wei 2004).
     2. Light: order-1 spherical harmonics (ambient + direction) fitted to the photo's brightness
        against the prior's surface normals (Kemelmacher-Shlizerman & Basri, TPAMI 2011).
     3. Albedo: brightness ÷ predicted shading, kept low-frequency (skin colour changes slowly).
     4. Shape from shading: the depth that makes the predicted shading match the photo, held
        close to the prior by a smoothness term and pinned at the face edge. Gauss–Newton
        (normals linearised around the current depth) with preconditioned conjugate gradients.
   The correction runs coarse to fine (a ≈ 5 mm grid first, then as much fine detail as allowed),
   so skin texture can't raise bumps. The Light step (analyze) shows what the photo says first.
   Plus the views: Haralick's topographic labels (peak, pit, ridge, ravine, saddle, hills — "the
   topographic primal sketch", 1983) of the surface or of the photo, contour lines, relief, and
   photo-analysis views (luminance gradient, level sweep, colour principal components).
   And the 3D stage: the photo itself as a relief you can turn around.

   Units: grid nodes; depth in cm toward the camera; h = cm per grid step. y points down.
   Normal of a depth map z(x, y): (−zx, −zy, 1) / √(1 + zx² + zy²).
   ========================================================================== */
(() => {
'use strict';

/* ------------------------------------------------------------ grid helpers -- */

/** Separable box average with radius r (edges normalised by the count). */
function box(a, gw, gh, r) {
  if (r < 1) return Float32Array.from(a);
  const t = new Float32Array(gw * gh), o = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    const row = j * gw;
    let s = 0, c = 0;
    for (let i = 0; i <= Math.min(r, gw - 1); i++) { s += a[row + i]; c++; }
    for (let i = 0; i < gw; i++) {
      t[row + i] = s / c;
      const add = i + r + 1, rem = i - r;
      if (add < gw) { s += a[row + add]; c++; }
      if (rem >= 0) { s -= a[row + rem]; c--; }
    }
  }
  for (let i = 0; i < gw; i++) {
    let s = 0, c = 0;
    for (let j = 0; j <= Math.min(r, gh - 1); j++) { s += t[j * gw + i]; c++; }
    for (let j = 0; j < gh; j++) {
      o[j * gw + i] = s / c;
      const add = j + r + 1, rem = j - r;
      if (add < gh) { s += t[add * gw + i]; c++; }
      if (rem >= 0) { s -= t[rem * gw + i]; c--; }
    }
  }
  return o;
}
/** Smooth (≈ Gaussian, `passes` boxes); with weights w: blur(a·w) / blur(w), which also fills gaps. */
function blur(a, gw, gh, r, w, passes = 2) {
  const n = gw * gh;
  let num = new Float32Array(n), den = w ? new Float32Array(n) : null;
  for (let i = 0; i < n; i++) { num[i] = w ? a[i] * w[i] : a[i]; if (den) den[i] = w[i]; }
  for (let p = 0; p < passes; p++) { num = box(num, gw, gh, r); if (den) den = box(den, gw, gh, r); }
  if (!den) return num;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = den[i] > 1e-4 ? num[i] / den[i] : a[i];
  return out;
}
/** Gradient (per cm) on the face nodes; one-sided at the face edge. */
function gradient(z, gw, gh, h, act) {
  const n = gw * gh, gx = new Float32Array(n), gy = new Float32Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    if (!act[k]) continue;
    const l = i > 0 && act[k - 1], r = i < gw - 1 && act[k + 1], u = j > 0 && act[k - gw], d = j < gh - 1 && act[k + gw];
    gx[k] = l && r ? (z[k + 1] - z[k - 1]) / (2 * h) : r ? (z[k + 1] - z[k]) / h : l ? (z[k] - z[k - 1]) / h : 0;
    gy[k] = u && d ? (z[k + gw] - z[k - gw]) / (2 * h) : d ? (z[k + gw] - z[k]) / h : u ? (z[k] - z[k - gw]) / h : 0;
  }
  return { gx, gy };
}
/** Order-1 spherical-harmonics shading of a normal from a depth gradient (ambient scaled by occlusion a). */
const shade = (L, gx, gy, a = 1) => L[0] * a + (-L[1] * gx - L[2] * gy + L[3]) / Math.sqrt(1 + gx * gx + gy * gy);
/**
 * Ambient occlusion, roughly: a spot below its surroundings (a crease, a socket, under the nose)
 * gets less of the light that comes from everywhere. Real photos are darker there without the skin
 * facing away — read as shape, that darkness pushed folds out and raised humps.
 */
function occlusion(z, gw, gh, h, act) {
  const a = Float32Array.from(act), b = blur(z, gw, gh, Math.max(2, Math.round(1 / h)), a, 2), o = new Float32Array(gw * gh).fill(1);
  for (let k = 0; k < o.length; k++) if (act[k]) o[k] = Math.min(1, Math.max(.4, 1 - .5 * Math.max(0, b[k] - z[k])));
  return o;
}
function solveSmall(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let r = k + 1; r < n; r++) if (Math.abs(M[r][k]) > Math.abs(M[p][k])) p = r;
    [M[k], M[p]] = [M[p], M[k]];
    if (Math.abs(M[k][k]) < 1e-12) continue;
    for (let r = k + 1; r < n; r++) { const f = M[r][k] / M[k][k]; for (let c = k; c <= n; c++) M[r][c] -= f * M[k][c]; }
  }
  const x = new Array(n).fill(0);
  for (let k = n - 1; k >= 0; k--) { let s = M[k][n]; for (let c = k + 1; c < n; c++) s -= M[k][c] * x[c]; x[k] = Math.abs(M[k][k]) < 1e-12 ? 0 : s / M[k][k]; }
  return x;
}
/**
 * Light from the photo: I ≈ a0 + a·n over the skin (n from the prior's normals). Robust
 * (iteratively reweighted), so highlights and cast shadows don't drag it.
 */
function fitLight(I, gx, gy, w, ao) {
  const n = I.length, rw = new Float32Array(n).fill(1);
  let L = [0.5, 0, 0, 0.5];
  for (let it = 0; it < 5; it++) {
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    for (let k = 0; k < n; k++) {
      const wk = w[k] * rw[k];
      if (wk <= 1e-3) continue;
      const N = Math.sqrt(1 + gx[k] * gx[k] + gy[k] * gy[k]), B = [ao ? ao[k] : 1, -gx[k] / N, -gy[k] / N, 1 / N];
      for (let r = 0; r < 4; r++) { b[r] += wk * B[r] * I[k]; for (let c = 0; c < 4; c++) A[r][c] += wk * B[r] * B[c]; }
    }
    for (let r = 0; r < 4; r++) A[r][r] += 1e-6;
    L = solveSmall(A, b);
    // Huber-style weights on the residuals
    let s = 0, c = 0;
    const res = new Float32Array(n);
    for (let k = 0; k < n; k++) if (w[k] > 1e-3) { res[k] = I[k] - shade(L, gx[k], gy[k], ao ? ao[k] : 1); s += res[k] * res[k]; c++; }
    const sig = Math.sqrt(s / Math.max(1, c)) || 1;
    for (let k = 0; k < n; k++) { const e = Math.abs(res[k]) / (1.5 * sig); rw[k] = e <= 1 ? 1 : 1 / e; }
  }
  return L;
}
/** Correlation of the photo's brightness with a predicted shading over the weights. */
function corr(a, b, w) {
  let sw = 0, ma = 0, mb = 0;
  for (let k = 0; k < a.length; k++) if (w[k] > .3) { sw += w[k]; ma += w[k] * a[k]; mb += w[k] * b[k]; }
  if (!sw) return 0;
  ma /= sw; mb /= sw;
  let sab = 0, saa = 0, sbb = 0;
  for (let k = 0; k < a.length; k++) if (w[k] > .3) { const x = a[k] - ma, y = b[k] - mb; sab += w[k] * x * y; saa += w[k] * x * x; sbb += w[k] * y * y; }
  return sab / (Math.sqrt(saa * sbb) || 1);
}

/* ------------------------------------------------------------------- build -- */

/** Weighted percentile (q in 0…1) of the values where the weight is above .5 (sampled). */
function wquant(a, w, q) {
  const v = [];
  const step = Math.max(1, Math.floor(a.length / 6000));
  for (let k = 0; k < a.length; k += step) if (w[k] > .5) v.push(a[k]);
  if (!v.length) return 0;
  v.sort((x, y) => x - y);
  return v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
}
const wmedian = (a, w) => wquant(a, w, .5);
/** Light with a given direction d: only the ambient and the strength are fitted (I ≈ a0 + k·(n·d)). */
function fitLightDir(I, gx, gy, w, d, ao) {
  let s11 = 0, s12 = 0, s22 = 0, b1 = 0, b2 = 0;
  for (let k = 0; k < I.length; k++) {
    if (w[k] <= 1e-3) continue;
    const N = Math.sqrt(1 + gx[k] * gx[k] + gy[k] * gy[k]), nd = (-gx[k] * d[0] - gy[k] * d[1] + d[2]) / N, a = ao ? ao[k] : 1;
    s11 += w[k] * a * a; s12 += w[k] * a * nd; s22 += w[k] * nd * nd; b1 += w[k] * a * I[k]; b2 += w[k] * I[k] * nd;
  }
  const det = s11 * s22 - s12 * s12 || 1e-9, a0 = (b1 * s22 - b2 * s12) / det, kk = Math.max(.05, (s11 * b2 - s12 * b1) / det);
  return [a0, kk * d[0], kk * d[1], kk * d[2]];
}

/**
 * What the photo says about light and shade, before any shape is changed:
 *   skin   data weights (the face minus eyes, brows, lips and nostrils, minus colours unlike the
 *          skin — stubble, lashes, dark circles, make-up — and minus painted "not shape")
 *   Is     brightness, normalised to the skin and lightly smoothed
 *   L      light: ambient + direction (order-1 spherical harmonics) — fitted, or with a given direction
 *   rho    skin colour (albedo), kept smooth
 *   cw     how skin-coloured each node is (0…1)
 */
function prepare(inp) {
  const { gw, gh, h, act, z0, lum } = inp, n = gw * gh, ign = inp.ignore;
  const skin = Float32Array.from(inp.skin), cw = new Float32Array(n).fill(1);
  if (ign) for (let k = 0; k < n; k++) skin[k] *= 1 - ign[k];
  // Where a beard grows, the photo is read through a ≈ 3 mm blur: stubble is speckle much finer than
  // that and only darkens the skin there (its own skin colour takes that up), while the shading of the
  // chin, the lip–chin crease and the jaw is broader and survives — so it still counts as evidence.
  const beard = inp.regions && inp.regions[0], rB = Math.max(1, Math.round(.3 / h));
  const mixB = (a, b) => { if (beard) for (let k = 0; k < n; k++) a[k] += (b[k] - a[k]) * beard[k]; return a; };
  // Light and shade change brightness, not colour (chromaticity): a different colour isn't shape.
  if (inp.rgb) {
    const rgb = inp.rgb, cr = new Float32Array(n), cg = new Float32Array(n);
    for (let k = 0; k < n; k++) { const t = rgb[3 * k] + rgb[3 * k + 1] + rgb[3 * k + 2] || 1e-6; cr[k] = rgb[3 * k] / t; cg[k] = rgb[3 * k + 1] / t; }
    const sr = blur(cr, gw, gh, 1, act, 1), sg = blur(cg, gw, gh, 1, act, 1);
    if (beard) { mixB(sr, blur(cr, gw, gh, rB, act, 2)); mixB(sg, blur(cg, gw, gh, rB, act, 2)); }
    // (the beard area against its own colour: stubble tints all of it, and that isn't shape either)
    const wF = beard ? skin.map((v, k) => v * (1 - beard[k])) : skin, wB = beard ? skin.map((v, k) => v * beard[k]) : null;
    const mr = wmedian(sr, wF), mg = wmedian(sg, wF), d = new Float32Array(n);
    const mrB = wB ? wmedian(sr, wB) : mr, mgB = wB ? wmedian(sg, wB) : mg;
    for (let k = 0; k < n; k++) { const b = beard ? beard[k] : 0; d[k] = Math.hypot(sr[k] - (mr + (mrB - mr) * b), sg[k] - (mg + (mgB - mg) * b)); }
    const sig = Math.max(.004, 1.4826 * wmedian(d, skin));
    for (let k = 0; k < n; k++) { cw[k] = Math.exp(-((d[k] / (2.5 * sig)) ** 2)); skin[k] *= cw[k]; }
  }
  // Speckle finer than a node (stubble) only darkens the skin: trusted much less as shape (less so
  // in the beard area, where the blur has taken the speckle out)
  if (inp.tex) {
    const t0 = Math.max(1e-3, wquant(inp.tex, skin, .3));
    for (let k = 0; k < n; k++) { const e = Math.max(0, inp.tex[k] / t0 - 1.3) / .8 * (beard ? 1 - .95 * beard[k] : 1); skin[k] /= 1 + e * e; }
  }
  let ms = 0, mc = 0;
  for (let k = 0; k < n; k++) if (skin[k] > .3) { ms += lum[k] * skin[k]; mc += skin[k]; }
  const mean = ms / Math.max(1e-6, mc) || 1, I = new Float32Array(n);
  for (let k = 0; k < n; k++) I[k] = lum[k] / mean;
  const Is = blur(I, gw, gh, 1, act, 1);
  if (beard) mixB(Is, blur(I, gw, gh, rB, act, 2));
  const g0 = gradient(z0, gw, gh, h, act), ao = occlusion(z0, gw, gh, h, act);
  const L = inp.lightDir ? fitLightDir(Is, g0.gx, g0.gy, skin, inp.lightDir, ao) : fitLight(Is, g0.gx, g0.gy, skin, ao);
  const rho = new Float32Array(n), wr = new Float32Array(n), hint = inp.hint;
  for (let k = 0; k < n; k++) {
    if (!act[k]) continue;
    const s0 = shade(L, g0.gx[k], g0.gy[k], ao[k]);
    rho[k] = Is[k] / Math.max(.05, s0);
    wr[k] = skin[k] * (s0 > .15 ? 1 : 0) * (hint ? 1 - Math.min(1, Math.abs(hint[k])) : 1);
  }
  // smooth over ~2 cm: broader than that is skin colour; anything smaller is left to be shape
  const rhoLP = blur(rho, gw, gh, Math.max(2, Math.round(2 / h)), wr, 2);
  for (let k = 0; k < n; k++) rhoLP[k] = Math.min(2.5, Math.max(.4, rhoLP[k] || 1));
  const dir = [L[1], L[2], L[3]], ll = Math.hypot(...dir) || 1;
  return { n, skin, cw, Is, g0, ao, L, rho: rhoLP, dir: dir.map(v => v / ll), strength: ll / Math.max(.05, Math.abs(L[0]) + ll) };
}

/**
 * The Light step: the photo's light and shade read against the face map's shape.
 * Returns the light, the shading map (brightness ÷ skin colour), the shading the dots' shape would
 * have in that light, and automatic marks: local highlights (+) and shadows (−), and "not shape"
 * where the colour isn't skin.
 */
function analyze(inp) {
  const { gw, gh, h, act } = inp, P = prepare(inp), n = P.n;
  const shading = new Float32Array(n), expected = new Float32Array(n);
  for (let k = 0; k < n; k++) if (act[k]) { shading[k] = P.Is[k] / P.rho[k]; expected[k] = shade(P.L, P.g0.gx[k], P.g0.gy[k], P.ao[k]); }
  // local highlights and shadows: shading against its own surroundings (≈ 1.5 cm)
  const base = blur(shading, gw, gh, Math.max(2, Math.round(1.5 / h)), act, 2), loc = new Float32Array(n);
  for (let k = 0; k < n; k++) loc[k] = act[k] ? shading[k] / Math.max(.05, base[k]) : 1;
  const w = P.skin, hi1 = wquant(loc, w, .9), hi2 = wquant(loc, w, .985), lo1 = wquant(loc, w, .1), lo2 = wquant(loc, w, .015);
  const hl = new Float32Array(n), ig = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (!act[k] || P.skin[k] < .2) continue;
    const v = loc[k];
    hl[k] = v > hi1 ? Math.min(1, (v - hi1) / Math.max(1e-3, hi2 - hi1)) : v < lo1 ? -Math.min(1, (lo1 - v) / Math.max(1e-3, lo1 - lo2)) : 0;
  }
  for (let k = 0; k < n; k++) if (act[k] && inp.skin[k] > .5) ig[k] = Math.min(1, Math.max(0, (.55 - P.cw[k]) / .45));
  const hls = blur(hl, gw, gh, 1, act, 1);
  return { light: P.L, dir: P.dir, strength: P.strength, shading, expected, rho: P.rho, autoHL: hls, autoIG: ig, skin: P.skin };
}

/* ------------------------------------------------------------ the solver --
   Shape from shading on a grid G = { gw, gh, h, act, z0, rho, T (brightness to match), wd (data
   weights), bk (pull toward the prior per node), L }: the depth change dz minimising
     Σ wd (ρ·shade(z0 + dz) − T)² + α |∇²dz|² + Σ bk dz²
   by Gauss–Newton (normals linearised around the current surface) and preconditioned conjugate
   gradients, with robust re-weighting after the first pass. */
async function solve(G, alpha, outerN, iters, dz, onPass) {
  const { gw, gh, h, act, z0, rho, T, bk, L } = G, n = gw * gh, wd0 = G.wd, wd = Float32Array.from(wd0), ao = G.ao || new Float32Array(n).fill(1);
  // pins: depths the user set by dragging dots in 3D (weight, and weight × the depth change wanted)
  const pw = G.pw || new Float32Array(n), pwt = G.pwt || new Float32Array(n);
  const inner = k => { const i = k % gw, j = (k / gw) | 0; return i > 0 && j > 0 && i < gw - 1 && j < gh - 1 && act[k] && act[k - 1] && act[k + 1] && act[k - gw] && act[k + gw]; };
  const Ul = [], Dl = [], Rl = [];
  for (let k = 0; k < n; k++) {
    if (!act[k]) continue;
    const i = k % gw, j = (k / gw) | 0;
    if (i > 0 && j > 0 && i < gw - 1 && j < gh - 1) Rl.push(k);
    if (inner(k)) { Dl.push(k); if (inner(k - 1) && inner(k + 1) && inner(k - gw) && inner(k + gw)) Ul.push(k); }
  }
  const U = Int32Array.from(Ul), D = Int32Array.from(Dl), R = Int32Array.from(Rl);
  const inv2h = 1 / (2 * h), invh2 = 1 / (h * h), [a0, a1, a2, a3] = L;
  const g0 = gradient(z0, gw, gh, h, act);
  const c = new Float32Array(n), u = new Float32Array(n), Lv = new Float32Array(n);
  const apply = (v, out) => {
    for (let q = 0; q < D.length; q++) { const k = D[q]; u[k] = c[k] * wd[k] * c[k] * (-a1 * (v[k + 1] - v[k - 1]) - a2 * (v[k + gw] - v[k - gw])) * inv2h; }
    for (let q = 0; q < R.length; q++) { const k = R[q]; Lv[k] = (v[k + 1] + v[k - 1] + v[k + gw] + v[k - gw] - 4 * v[k]) * invh2; }
    for (let q = 0; q < U.length; q++) {
      const i = U[q];
      out[i] = (a1 * (u[i + 1] - u[i - 1]) + a2 * (u[i + gw] - u[i - gw])) * inv2h
        + alpha * (Lv[i + 1] + Lv[i - 1] + Lv[i + gw] + Lv[i - gw] - 4 * Lv[i]) * invh2 + (bk[i] + pw[i]) * v[i];
    }
  };
  const b = new Float32Array(n), rhs = new Float32Array(n), Minv = new Float32Array(n);
  const r = new Float32Array(n), zz = new Float32Array(n), p = new Float32Array(n), Ap = new Float32Array(n);
  for (let outer = 0; outer < outerN; outer++) {
    const z = new Float32Array(n);
    for (let k = 0; k < n; k++) z[k] = z0[k] + dz[k];
    const g = gradient(z, gw, gh, h, act);
    for (let k = 0; k < n; k++) {
      if (!act[k]) { c[k] = 0; continue; }
      const N = Math.sqrt(1 + g.gx[k] * g.gx[k] + g.gy[k] * g.gy[k]);
      c[k] = rho[k] / N;
      b[k] = T[k] - rho[k] * (a0 * ao[k] + a3 / N) - c[k] * (-a1 * g0.gx[k] - a2 * g0.gy[k]);
    }
    if (outer > 0) {
      let se = 0, sw = 0;
      const e = new Float32Array(n);
      for (let q = 0; q < D.length; q++) { const k = D[q]; e[k] = T[k] - rho[k] * shade(L, g.gx[k], g.gy[k], ao[k]); se += wd0[k] * e[k] * e[k]; sw += wd0[k]; }
      const sig = Math.sqrt(se / Math.max(1e-6, sw)) || 1;
      for (let q = 0; q < D.length; q++) { const k = D[q], t = Math.abs(e[k]) / (1.5 * sig); wd[k] = wd0[k] * (t <= 1 ? 1 : 1 / (t * t)); }
    }
    u.fill(0);
    for (let q = 0; q < D.length; q++) { const k = D[q]; u[k] = c[k] * wd[k] * b[k]; }
    rhs.fill(0);
    for (let q = 0; q < U.length; q++) { const i = U[q]; rhs[i] = (a1 * (u[i + 1] - u[i - 1]) + a2 * (u[i + gw] - u[i - gw])) * inv2h + pwt[i]; }
    for (let q = 0; q < U.length; q++) {
      const i = U[q];
      let d = bk[i] + pw[i] + alpha * 20 * invh2 * invh2;
      for (const k of [i - 1, i + 1]) d += wd[k] * (c[k] * a1 * inv2h) ** 2;
      for (const k of [i - gw, i + gw]) d += wd[k] * (c[k] * a2 * inv2h) ** 2;
      Minv[i] = 1 / d;
    }
    u.fill(0); Lv.fill(0);
    apply(dz, Ap);
    let rz = 0;
    for (let q = 0; q < U.length; q++) { const i = U[q]; r[i] = rhs[i] - Ap[i]; zz[i] = Minv[i] * r[i]; p[i] = zz[i]; rz += r[i] * zz[i]; }
    let r0 = 0;
    for (let q = 0; q < U.length; q++) r0 += r[U[q]] ** 2;
    r0 = Math.sqrt(r0) || 1;
    for (let it = 0; it < iters; it++) {
      apply(p, Ap);
      let pAp = 0;
      for (let q = 0; q < U.length; q++) { const i = U[q]; pAp += p[i] * Ap[i]; }
      if (!(pAp > 0)) break;
      const al = rz / pAp;
      let rr = 0, rzn = 0;
      for (let q = 0; q < U.length; q++) { const i = U[q]; dz[i] += al * p[i]; r[i] -= al * Ap[i]; rr += r[i] * r[i]; }
      if (Math.sqrt(rr) < 1e-4 * r0) break;
      for (let q = 0; q < U.length; q++) { const i = U[q]; zz[i] = Minv[i] * r[i]; rzn += r[i] * zz[i]; }
      const be = rzn / rz;
      rz = rzn;
      for (let q = 0; q < U.length; q++) { const i = U[q]; p[i] = zz[i] + be * p[i]; }
    }
    if (onPass) onPass(outer + 1);
    await new Promise(res => setTimeout(res, 0));
  }
  return dz;
}
/** A grid at 1/f resolution (block averages; a node is face if most of its block is). */
function coarsen(F, f) {
  const { gw, gh } = F, cw = Math.ceil(gw / f), ch = Math.ceil(gh / f), n2 = cw * ch, out = { gw: cw, gh: ch, h: F.h * f, L: F.L };
  // pins add up in a block (a pin keeps its full pull); everything else is averaged
  for (const key of ['pw', 'pwt']) {
    if (!F[key]) continue;
    const o = new Float32Array(n2);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) o[((j / f) | 0) * cw + ((i / f) | 0)] += F[key][j * gw + i];
    out[key] = o;
  }
  for (const key of ['z0', 'rho', 'T', 'wd', 'bk', 'act', 'ao']) {
    if (!F[key]) continue;
    const a = F[key], o = new Float32Array(n2), cnt = new Float32Array(n2), on = new Float32Array(n2);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i, q = ((j / f) | 0) * cw + ((i / f) | 0);
      cnt[q]++;
      if (F.act[k]) { o[q] += a[k]; on[q]++; }
    }
    for (let q = 0; q < n2; q++) o[q] = key === 'act' ? (on[q] > cnt[q] * .5 ? 1 : 0) : on[q] ? o[q] / on[q] : 0;
    out[key] = key === 'act' ? Uint8Array.from(o) : o;
  }
  return out;
}
/** Back to full resolution (bilinear from the coarse node centres). */
function refine(dzC, C, F, f) {
  const out = new Float32Array(F.gw * F.gh);
  for (let j = 0; j < F.gh; j++) for (let i = 0; i < F.gw; i++) {
    if (!F.act[j * F.gw + i]) continue;
    const fx = Math.min(C.gw - 1.001, Math.max(0, (i + .5) / f - .5)), fy = Math.min(C.gh - 1.001, Math.max(0, (j + .5) / f - .5));
    const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, q = j0 * C.gw + i0;
    out[j * F.gw + i] = (dzC[q] * (1 - tx) + dzC[q + 1] * tx) * (1 - ty) + (dzC[q + C.gw] * (1 - tx) + dzC[q + C.gw + 1] * tx) * ty;
  }
  return out;
}

/**
 * inp: { gw, gh, h (cm per node), act (Uint8, the face), skin (0…1 data weight: face minus eyes,
 *        brows, lips, nostrils, faded at the edge), z0 (prior depth, cm), lum (linear luminance),
 *        rgb (linear colour per node), prior (0…1: where the dots pin the shape down — nose, eyes,
 *        mouth), hint (−1…1: shadow … highlight), ignore (0…1: "not shape"), lightDir (optional:
 *        the light set in the Light step), trust (0 = keep the map's shape … 1 = follow the photo),
 *        detail (0…1: how much fine detail the photo may add) }
 *
 * Coarse to fine (as current face-reconstruction pipelines do): the shading first corrects the
 * shape on a coarse grid (≈ 5 mm), where it can only make broad, smooth changes — skin texture,
 * stubble and lashes can't raise bumps there. Fine detail from the photo is then added on the
 * full grid only as far as `detail` allows.
 */
/** The brightness to match (the photo's, pushed up / down where highlights / shadows are marked) and the data weights. */
function targets(P, inp) {
  const n = P.n, hint = inp.hint, T = new Float32Array(n), wd = new Float32Array(n);
  let Imax = 0;
  for (let k = 0; k < n; k++) if (P.skin[k] > .5) Imax = Math.max(Imax, P.Is[k]);
  for (let k = 0; k < n; k++) {
    T[k] = hint && hint[k] ? P.Is[k] * (1 + .45 * hint[k]) : P.Is[k];
    if (!P.skin[k]) continue;
    const s0 = shade(P.L, P.g0.gx[k], P.g0.gy[k], P.ao[k]), hk = hint ? Math.abs(hint[k]) : 0;
    wd[k] = P.skin[k] * (P.Is[k] > .97 * Imax && !hk ? 0 : 1) * (s0 < .12 ? .25 : 1) * (1 + 1.5 * hk);
    if (hk && !wd[k]) wd[k] = hk;
  }
  return { T, wd };
}

/* ------------------------------------------------------- the anatomy fit --
   How much of each anatomical change this face has — brow ridge, cheekbones, chin, nose … (the app
   gives each as a depth field B_j at full strength) — read from the photo's light and shade:
     Σ w (ρ·shade(z0 + Σ v_j B_j) − T)² / (s²·F)  +  Σ v_j² / σv²  +  Σ_pins (z − z_pin)² / σp²
   (s² the residual variance, F ≈ nodes per correlated patch). Gauss–Newton with Levenberg damping;
   in between, the light (order-1 SH with ambient occlusion) and a smooth skin colour ρ (a quadratic
   over the face, so it can't soak up a cheekbone's shading) are refitted, and robust weights keep
   spots it can't explain — shine, stubble, a cast shadow — from pulling. A dozen numbers instead of
   a free surface: whatever the photo does, the result is a human face. */
function fitAnatomy(inp, P, T, wd) {
  const { gw, gh, h, act, z0 } = inp, n = gw * gh, B = inp.basis.B, nb = B.length, ao = P.ao;
  const Bg = B.map(b => gradient(b, gw, gh, h, act)), D = [];
  for (let k = 0; k < n; k++) if (act[k] && wd[k] > 1e-3) D.push(k);
  const m = D.length;
  if (m < 50 || !nb) return null;
  let ci = 0, cj = 0;
  for (const k of D) { ci += k % gw; cj += (k / gw) | 0; }
  ci /= m; cj /= m;
  // skin colour: a quadratic over the face, plus one level per region the app marks (the beard area)
  const regs = inp.regions || [], R = Math.max(gw, gh) / 2, NP = 6 + regs.length, PB = new Float32Array(m * NP);
  D.forEach((k, q) => { const u = ((k % gw) - ci) / R, v = (((k / gw) | 0) - cj) / R; PB.set([1, u, v, u * u, u * v, v * v, ...regs.map(a => a[k])], q * NP); });
  const v = new Float64Array(nb), z = Float32Array.from(z0), rw = new Float32Array(m).fill(1);
  const rho = new Float32Array(m), S = new Float32Array(m), dSx = new Float32Array(m), dSy = new Float32Array(m), r = new Float32Array(m);
  // held near the template unless the light clearly says otherwise (tested on a rendered face with
  // shine, occlusion, a cast shadow and stubble: freer settings traded one feature for another)
  // (Follow the photo widens or narrows how far the light may move the anatomy: × 4 either way)
  const sigV = .35 * Math.pow(10, ((inp.trust == null ? .5 : inp.trust) - .5) * 1.2), sigP = .15, F = Math.max(1, (1.4 / h) ** 2), vmax = 1;
  const pins = (inp.pins || []).filter(p => act[p.k]);
  // values set by hand (in the Surface panel) are held: the rest of the anatomy fits around them
  const keys = inp.basis.keys, fixed = keys.map(k => inp.fixed && Number.isFinite(inp.fixed[k]) ? inp.fixed[k] : null);
  fixed.forEach((f, j) => { if (f != null) v[j] = f; });
  if (fixed.some(f => f != null)) for (let k = 0; k < n; k++) { if (!act[k]) continue; let s = z0[k]; for (let j = 0; j < nb; j++) s += v[j] * B[j][k]; z[k] = s; }
  let L = P.L.slice(), c = new Array(NP).fill(0);
  c[0] = 1;
  const shadeAll = () => {
    const g = gradient(z, gw, gh, h, act);
    for (let q = 0; q < m; q++) {
      const k = D[q], gx = g.gx[k], gy = g.gy[k], N = Math.sqrt(1 + gx * gx + gy * gy), num = -L[1] * gx - L[2] * gy + L[3];
      S[q] = L[0] * ao[k] + num / N;
      dSx[q] = -L[1] / N - num * gx / (N * N * N); dSy[q] = -L[2] / N - num * gy / (N * N * N);
    }
    return g;
  };
  for (let it = 0; it < 10; it++) {
    let g = shadeAll();
    // skin colour, given the light
    {
      const A = Array.from({ length: NP }, () => new Array(NP).fill(0)), b = new Array(NP).fill(0);
      for (let q = 0; q < m; q++) {
        const w = wd[D[q]] * rw[q], s = S[q];
        for (let a = 0; a < NP; a++) { const pa = PB[q * NP + a] * s; b[a] += w * pa * T[D[q]]; for (let e = 0; e <= a; e++) A[a][e] += w * pa * PB[q * NP + e] * s; }
      }
      for (let a = 0; a < NP; a++) { for (let e = a + 1; e < NP; e++) A[a][e] = A[e][a]; A[a][a] += 1e-6; }
      c = solveSmall(A, b);
      let mr = 0;
      for (let q = 0; q < m; q++) { let p = 0; for (let a = 0; a < NP; a++) p += c[a] * PB[q * NP + a]; rho[q] = Math.max(.3, p); mr += rho[q]; }
      mr /= m;
      for (let q = 0; q < m; q++) rho[q] /= mr;
    }
    // the light, given the skin colour
    {
      const d = inp.lightDir, nr = d ? 2 : 4, A = Array.from({ length: nr }, () => new Array(nr).fill(0)), b = new Array(nr).fill(0);
      for (let q = 0; q < m; q++) {
        const k = D[q], w = wd[k] * rw[q], N = Math.sqrt(1 + g.gx[k] ** 2 + g.gy[k] ** 2);
        const X = d ? [rho[q] * ao[k], rho[q] * (-g.gx[k] * d[0] - g.gy[k] * d[1] + d[2]) / N] : [rho[q] * ao[k], -rho[q] * g.gx[k] / N, -rho[q] * g.gy[k] / N, rho[q] / N];
        for (let a = 0; a < nr; a++) { b[a] += w * X[a] * T[k]; for (let e = 0; e < nr; e++) A[a][e] += w * X[a] * X[e]; }
      }
      for (let a = 0; a < nr; a++) A[a][a] += 1e-6;
      const x = solveSmall(A, b);
      L = d ? [x[0], x[1] * d[0], x[1] * d[1], x[1] * d[2]] : x;
    }
    g = shadeAll();
    // residuals, robust weights (Huber on the median deviation)
    for (let q = 0; q < m; q++) r[q] = T[D[q]] - rho[q] * S[q];
    const ab = Array.from(r, Math.abs).sort((a, b) => a - b), sig = Math.max(1e-4, 1.4826 * ab[m >> 1]);
    let sw = 0, se = 0;
    for (let q = 0; q < m; q++) { const e = Math.abs(r[q]) / (1.5 * sig); rw[q] = e <= 1 ? 1 : 1 / e; const w = wd[D[q]] * rw[q]; sw += w; se += w * r[q] * r[q]; }
    const s2F = Math.max(1e-6, se / sw) * F;
    // Gauss–Newton step on the anatomy
    const A = Array.from({ length: nb }, () => new Array(nb).fill(0)), b = new Array(nb).fill(0), J = new Float64Array(nb);
    for (let q = 0; q < m; q++) {
      const k = D[q], w = wd[k] * rw[q] / s2F;
      for (let j = 0; j < nb; j++) J[j] = rho[q] * (dSx[q] * Bg[j].gx[k] + dSy[q] * Bg[j].gy[k]);   // ∂(ρ·shade)/∂v_j
      for (let j = 0; j < nb; j++) { if (!J[j]) continue; b[j] += w * J[j] * r[q]; for (let l = 0; l <= j; l++) A[j][l] += w * J[j] * J[l]; }
    }
    for (const p of pins) {
      // (soft pins — a side photo's points — a little looser than depths set by hand)
      const e = p.z - z[p.k], s2 = (p.soft ? 1.15 * sigP : sigP) ** 2;
      for (let j = 0; j < nb; j++) { b[j] += B[j][p.k] * e / s2; for (let l = 0; l <= j; l++) A[j][l] += B[j][p.k] * B[l][p.k] / s2; }
    }
    for (let j = 0; j < nb; j++) { for (let l = j + 1; l < nb; l++) A[j][l] = A[l][j]; b[j] -= v[j] / (sigV * sigV); A[j][j] = A[j][j] * 1.05 + 1 / (sigV * sigV); }
    fixed.forEach((f, j) => { if (f == null) return; for (let l = 0; l < nb; l++) A[j][l] = A[l][j] = 0; A[j][j] = 1; b[j] = 0; });
    const dv = solveSmall(A, b);
    for (let j = 0; j < nb; j++) if (fixed[j] == null) v[j] = Math.max(-vmax, Math.min(vmax, v[j] + dv[j]));
    for (let k = 0; k < n; k++) { if (!act[k]) continue; let s = z0[k]; for (let j = 0; j < nb; j++) s += v[j] * B[j][k]; z[k] = s; }
  }
  return { values: Object.fromEntries(inp.basis.keys.map((key, j) => [key, v[j]])), z };
}
/**
 * Depths set by hand (dragging dots in 3D, or a side photo) met exactly: what's left over spreads as a
 * smooth bump about 3 cm across (Wendland C2 radial functions, solved so every pin is met).
 */
function bendThrough(z, inp, pins, R) {
  const { gw, x0, y0, cell, act } = inp, n = pins.length, phi = d => { const t = d / R; return t >= 1 ? 0 : (1 - t) ** 4 * (4 * t + 1); };
  const A = new Float64Array(n * n), w = Float64Array.from(pins, p => p.z - z[p.k]);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] = phi(Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y)) + (i === j ? 1e-3 : 0);
  for (let c = 0; c < n; c++) {
    const pv = A[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / pv;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      w[r] -= f * w[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) { let s = w[c]; for (let k = c + 1; k < n; k++) s -= A[c * n + k] * w[k]; w[c] = s / A[c * n + c]; }
  const out = Float32Array.from(z);
  for (let k = 0; k < out.length; k++) {
    if (!act[k]) continue;
    const x = x0 + (k % gw) * cell, y = y0 + ((k / gw) | 0) * cell;
    let s = 0;
    for (let q = 0; q < n; q++) { const dx = x - pins[q].x, dy = y - pins[q].y; if (dx * dx + dy * dy < R * R) s += w[q] * phi(Math.hypot(dx, dy)); }
    out[k] += s;
  }
  return out;
}

/**
 * A side photo's profile line laid onto the face: along the midline the surface is moved to the line's
 * depth, and the change fades out sideways (each point says how far: ≈ 1.8 cm, less on the nose) and
 * past the line's ends. A smooth correction — bending exactly through many close points rippled.
 * inp.profile: [{ x, y (photo px), z (cm), s (sideways reach, px) }] down the midline, top to bottom.
 */
function profileFix(z, inp) {
  const { gw, gh, x0, y0, cell, act } = inp, P = inp.profile, np = P.length, out = Float32Array.from(z);
  const at = (x, y) => {
    const fx = (x - x0) / cell, fy = (y - y0) / cell, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= gw - 1 || j >= gh - 1) return null;
    const k = j * gw + i;
    if (!act[k] || !act[k + 1] || !act[k + gw] || !act[k + gw + 1]) return null;
    const tx = fx - i, ty = fy - j;
    return (z[k] * (1 - tx) + z[k + 1] * tx) * (1 - ty) + (z[k + gw] * (1 - tx) + z[k + gw + 1] * tx) * ty;
  };
  // what's missing on the midline (where the face is), filled in along the line and smoothed (≈ 2 mm)
  const r = P.map(p => { const v = at(p.x, p.y); return v == null ? null : p.z - v; });
  const first = r.findIndex(v => v != null);
  if (first < 0) return out;
  for (let q = 0; q < np; q++) if (r[q] == null) r[q] = q < first ? r[first] : r[q - 1];
  const dy = np > 1 ? Math.abs(P[np - 1].y - P[0].y) / (np - 1) : 1, sg = Math.max(1, .2 / (inp.h || .1) * cell / Math.max(1e-3, dy)), rs = new Float32Array(np);
  for (let q = 0; q < np; q++) {
    let s = 0, w = 0;
    for (let d = -Math.ceil(3 * sg); d <= Math.ceil(3 * sg); d++) { const u = q + d; if (u < 0 || u >= np) continue; const g = Math.exp(-d * d / (2 * sg * sg)); s += g * r[u]; w += g; }
    rs[q] = s / w;
  }
  // spread sideways from the midline
  for (let j = 0; j < gh; j++) {
    const y = y0 + j * cell;
    let q = 0;
    while (q < np - 2 && P[q + 1].y < y) q++;
    const a = P[q], b = P[q + 1], t = Math.max(0, Math.min(1, (y - a.y) / ((b.y - a.y) || 1)));
    const xm = a.x + (b.x - a.x) * t, sv = a.s + (b.s - a.s) * t, rv = rs[q] + (rs[q + 1] - rs[q]) * t;
    const past = y < P[0].y ? P[0].y - y : y > P[np - 1].y ? y - P[np - 1].y : 0, fade = Math.exp(-past * past / (2 * (.5 * sv) ** 2));
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      if (!act[k]) continue;
      const dx = x0 + i * cell - xm;
      out[k] += rv * fade * Math.exp(-dx * dx / (2 * sv * sv));
    }
  }
  return out;
}
async function build(inp, onProgress) {
  const { gw, gh, h, act } = inp, trust = inp.trust == null ? .5 : inp.trust, detail = inp.detail == null ? 0 : inp.detail;
  const prior = inp.prior, zPrior = inp.z0;
  let z0 = zPrior, fit = null;
  // 1 · the anatomy, fitted to the light and shade (and to depths set by hand)
  if (inp.basis && inp.basis.B && inp.basis.B.length) {
    const P0 = prepare(inp), t0 = targets(P0, inp);
    fit = fitAnatomy(inp, P0, t0.T, t0.wd);
    if (fit) z0 = fit.z;
    if (onProgress) onProgress(.3);
    await new Promise(res => setTimeout(res, 0));
  }
  // 2 · the side photo's profile line laid on, then depths set by hand met exactly
  if (inp.profile && inp.profile.length) z0 = profileFix(z0, inp);
  const hard = (inp.pins || []).filter(p => !p.soft);
  if (hard.length && inp.bendR) z0 = bendThrough(z0, inp, hard, inp.bendR);
  // 3 · then a little free detail from the photo, on top of that shape
  const P = prepare({ ...inp, z0 }), n = P.n, { T, wd } = targets(P, inp);
  const beta = .02, bk = new Float32Array(n);
  for (let k = 0; k < n; k++) bk[k] = beta * (1 + 30 * (prior ? prior[k] : 0));
  // pins: { k (node), z (cm) } — spread over a small neighbourhood so one dot shapes its area
  let pw = null, pwt = null;
  if (hard.length) {
    pw = new Float32Array(n); pwt = new Float32Array(n);
    const rr = Math.max(1, Math.round(.3 / h));
    for (const { k, z } of hard) {
      const pi = k % gw, pj = (k / gw) | 0;
      for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
        const i = pi + di, j = pj + dj, q = j * gw + i;
        if (i < 0 || j < 0 || i >= gw || j >= gh || !act[q]) continue;
        const w = 40 * Math.exp(-(di * di + dj * dj) / (2 * (rr * .6) ** 2));
        pw[q] += w; pwt[q] += w * (z - z0[q]);
      }
    }
  }
  const F = { gw, gh, h, act, z0, rho: P.rho, T, wd, bk, L: P.L, pw, pwt, ao: P.ao };
  // stiff: the shape is the anatomy's; this only adds what it can't express (build 23's much softer
  // surface raised humps and folds on real photos — shine, stubble and dark creases read as shape)
  // Free detail is optional (Fine detail > 0): on real photos — shine, stubble, a side light, a camera's
  // contrast curve — it read brightness as humps, even on the coarse grid. At 0 the surface is the
  // anatomy fit plus the depths set by hand: smooth, and always a human face.
  const alpha = DETAIL_ALPHA * Math.pow(10, (.5 - trust) * 2.4) / Math.max(.1, detail), p0 = fit ? .3 : 0;
  let dz = new Float32Array(n);
  if (detail > 0) {
    // coarse pass (≈ 5 mm grid)
    const f = Math.max(2, Math.round(.5 / h)), C = coarsen(F, f);
    const dzC = await solve(C, alpha, 5, 160, new Float32Array(C.gw * C.gh), k => onProgress && onProgress(p0 + k / 5 * (1 - p0) * .7));
    dz = blur(refine(dzC, C, F, f), gw, gh, Math.max(1, Math.round(f / 2)), act, 1);
    // fine pass: only as much detail as allowed (a stiffer surface for less detail)
    dz = await solve(F, alpha / Math.max(.05, detail * detail) * .5, 2, 100, dz, k => onProgress && onProgress(p0 + (1 - p0) * (.7 + k / 2 * .3)));
    dz = blur(dz, gw, gh, 1, act, 1);
  }
  const z = new Float32Array(n);
  for (let k = 0; k < n; k++) { dz[k] = act[k] ? Math.max(-1.5, Math.min(1.5, dz[k])) : 0; z[k] = z0[k] + dz[k]; }
  const g0 = gradient(zPrior, gw, gh, h, act), g1 = gradient(z, gw, gh, h, act), S0 = new Float32Array(n), S1 = new Float32Array(n);
  for (let k = 0; k < n; k++) if (act[k]) { S0[k] = P.rho[k] * shade(P.L, g0.gx[k], g0.gy[k], P.ao[k]); S1[k] = P.rho[k] * shade(P.L, g1.gx[k], g1.gy[k], P.ao[k]); }
  return {
    gw, gh, h, act, skin: P.skin, z0: zPrior, zfit: z0, z, dz: detail > 0 ? dz : null, light: P.L, dir: P.dir, rho: P.rho, I: P.Is,
    fit: fit ? fit.values : null, fit0: corr(P.Is, S0, wd), fit1: corr(P.Is, S1, wd), strength: P.strength,
  };
}
const DETAIL_ALPHA = .15;
/**
 * The surface for given anatomy values, without fitting again (the Surface panel's sliders): the
 * template depth + Σ v·B, bent through the pins, plus the free detail found by the last build.
 */
function compose(inp, values, dz) {
  const { act, z0 } = inp, B = inp.basis.B, n = z0.length;
  let zf = Float32Array.from(z0);
  inp.basis.keys.forEach((key, j) => { const v = values[key] || 0; if (v) for (let k = 0; k < n; k++) if (act[k]) zf[k] += v * B[j][k]; });
  if (inp.profile && inp.profile.length) zf = profileFix(zf, inp);
  const hard = (inp.pins || []).filter(p => !p.soft);
  if (hard.length && inp.bendR) zf = bendThrough(zf, inp, hard, inp.bendR);
  const z = new Float32Array(n);
  for (let k = 0; k < n; k++) z[k] = zf[k] + (dz && act[k] ? dz[k] : 0);
  return { zfit: zf, z };
}

/* ----------------------------------------------------------- topography -- */

const LABELS = [
  // [name, colour] — index = label code; 0 = slope / flat (not drawn)
  ['Slope', null], ['Peak', '#FFF2A8'], ['Pit', '#3A0D12'], ['Ridge', '#C8C1FF'], ['Ravine', '#2F54D9'],
  ['Saddle', '#F08A3C'], ['Convex hill', '#F2C230'], ['Concave hill', '#8E1F28'], ['Convex saddle', '#E0752B'], ['Concave saddle', '#C2353F'],
];
/**
 * Haralick's topographic labels of a height field (the surface, or the photo's brightness):
 * from the gradient and the Hessian's eigenvalues λ1 ≤ λ2 of a smoothed copy. With detrend > 0,
 * the large-scale shape (a face is round) is taken off first, so the labels show the local relief.
 * Thresholds are physical for the surface (per cm) or adaptive (fraction of the RMS) for the photo.
 */
function topography(f, gw, gh, h, act, opt = {}) {
  const n = gw * gh, w = new Float32Array(n);
  for (let k = 0; k < n; k++) w[k] = act[k] ? 1 : 0;
  let v = blur(f, gw, gh, opt.smooth == null ? 1 : opt.smooth, w, 1);
  if (opt.detrend) {
    const base = blur(v, gw, gh, Math.max(2, Math.round(opt.detrend / h)), w, 3);
    v = v.map((x, k) => x - base[k]);
  }
  const lab = new Uint8Array(n), k1 = new Float32Array(n), k2 = new Float32Array(n), gm = new Float32Array(n);
  const ok = k => { const i = k % gw, j = (k / gw) | 0; return i > 0 && j > 0 && i < gw - 1 && j < gh - 1 && act[k] && act[k - 1] && act[k + 1] && act[k - gw] && act[k + gw] && act[k - gw - 1] && act[k - gw + 1] && act[k + gw - 1] && act[k + gw + 1]; };
  let st = 0, sg = 0, cnt = 0;
  for (let k = 0; k < n; k++) {
    if (!ok(k)) continue;
    const gx = (v[k + 1] - v[k - 1]) / (2 * h), gy = (v[k + gw] - v[k - gw]) / (2 * h);
    const fxx = (v[k + 1] - 2 * v[k] + v[k - 1]) / (h * h), fyy = (v[k + gw] - 2 * v[k] + v[k - gw]) / (h * h);
    const fxy = (v[k + gw + 1] - v[k + gw - 1] - v[k - gw + 1] + v[k - gw - 1]) / (4 * h * h);
    const m = (fxx + fyy) / 2, d = Math.sqrt(((fxx - fyy) / 2) ** 2 + fxy * fxy);
    k1[k] = m - d; k2[k] = m + d; gm[k] = Math.hypot(gx, gy);
    st += k1[k] * k1[k] + k2[k] * k2[k]; sg += gm[k] * gm[k]; cnt++;
  }
  const T = opt.T != null ? opt.T : (opt.k || .55) * Math.sqrt(st / Math.max(1, 2 * cnt));
  const Tg = opt.Tg != null ? opt.Tg : .8 * Math.sqrt(sg / Math.max(1, cnt));
  for (let k = 0; k < n; k++) {
    if (!ok(k)) continue;
    const l1 = k1[k], l2 = k2[k], neg1 = l1 < -T, neg2 = l2 < -T, pos1 = l1 > T, pos2 = l2 > T;
    if (gm[k] < Tg) {
      lab[k] = neg1 && neg2 ? 1 : pos1 && pos2 ? 2 : neg1 && pos2 ? 5 : neg1 ? 3 : pos2 ? 4 : 0;
    } else {
      lab[k] = neg1 && neg2 ? 6 : pos1 && pos2 ? 7 : neg1 && pos2 ? (l1 + l2 < 0 ? 8 : 9) : neg1 ? 6 : pos2 ? 7 : 0;
    }
  }
  return { lab, k1, k2, relief: v };
}
/** Contour lines (marching squares) at every `step` of z: flat [x1, y1, x2, y2, …] in grid units. */
function contours(z, gw, gh, act, step) {
  const segs = [], major = [];
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < z.length; k++) if (act[k]) { lo = Math.min(lo, z[k]); hi = Math.max(hi, z[k]); }
  if (!(hi > lo)) return { segs: new Float32Array(0), major: new Uint8Array(0) };
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const k = j * gw + i;
    if (!act[k] || !act[k + 1] || !act[k + gw] || !act[k + gw + 1]) continue;
    const v = [z[k], z[k + 1], z[k + gw + 1], z[k + gw]], P = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const cl = Math.min(...v), ch = Math.max(...v);
    for (let L = Math.ceil(cl / step) * step; L <= ch; L += step) {
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const a = v[e] - L, b = v[(e + 1) % 4] - L;
        if ((a < 0) !== (b < 0)) { const t = a / (a - b), A = P[e], B = P[(e + 1) % 4]; pts.push(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t); }
      }
      const isMajor = Math.abs(L / step / 4 - Math.round(L / step / 4)) < 1e-3 ? 1 : 0;
      if (pts.length === 4) { segs.push(...pts); major.push(isMajor); }
      else if (pts.length === 8) { segs.push(...pts.slice(0, 4), ...pts.slice(4)); major.push(isMajor, isMajor); }
    }
  }
  return { segs: Float32Array.from(segs), major: Uint8Array.from(major) };
}

/* --------------------------------------------------- photo analysis views --
   The same tools image-forensics sites use to read the light in a photo. */

const lumOf = (d, i) => .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
/** Luminance gradient: red = left↔right change, green = up↔down change, blue constant. */
function lumGradient(src, w, h, gain = 4) {
  const out = new Uint8ClampedArray(w * h * 4), L = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) L[k] = lumOf(src, 4 * k);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
    const gx = (L[y * w + xp] - L[y * w + xm]) * 2 + L[ym * w + xp] - L[ym * w + xm] + L[yp * w + xp] - L[yp * w + xm];
    const gy = (L[yp * w + x] - L[ym * w + x]) * 2 + L[yp * w + xm] - L[ym * w + xm] + L[yp * w + xp] - L[ym * w + xp];
    out[4 * k] = 128 + gx * gain / 8; out[4 * k + 1] = 128 + gy * gain / 8; out[4 * k + 2] = 255; out[4 * k + 3] = 255;
  }
  return out;
}
/** Level sweep: magnifies the contrast around one brightness level (0…1), so equal-light bands show. */
function levelSweep(src, w, h, level, gain = 10) {
  const out = new Uint8ClampedArray(w * h * 4), c = level * 255;
  for (let k = 0; k < w * h; k++) {
    const i = 4 * k;
    for (let ch = 0; ch < 3; ch++) out[i + ch] = 128 + (src[i + ch] - c) * gain;
    out[i + 3] = 255;
  }
  return out;
}
/** Principal components of the colours: projection on component `comp` (0, 1, 2), stretched. */
function pca(src, w, h, comp) {
  const n = w * h, m = [0, 0, 0];
  for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) m[c] += src[4 * k + c];
  for (let c = 0; c < 3; c++) m[c] /= n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < n; k++) {
    const d = [src[4 * k] - m[0], src[4 * k + 1] - m[1], src[4 * k + 2] - m[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b];
  }
  // Jacobi eigen-decomposition of the 3 × 3 covariance
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], A = C.map(r => r.map(x => x / n));
  for (let sweep = 0; sweep < 12; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(A[p][q]) < 1e-9) continue;
    const th = .5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]), cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const ap = A[k][p], aq = A[k][q]; A[k][p] = cs * ap - sn * aq; A[k][q] = sn * ap + cs * aq; }
    for (let k = 0; k < 3; k++) { const ap = A[p][k], aq = A[q][k]; A[p][k] = cs * ap - sn * aq; A[q][k] = sn * ap + cs * aq; }
    for (let k = 0; k < 3; k++) { const vp = V[k][p], vq = V[k][q]; V[k][p] = cs * vp - sn * vq; V[k][q] = sn * vp + cs * vq; }
  }
  const order = [0, 1, 2].sort((a, b) => A[b][b] - A[a][a]), e = order[comp], vec = [V[0][e], V[1][e], V[2][e]];
  const sd = Math.sqrt(Math.max(1e-6, A[e][e])), out = new Uint8ClampedArray(n * 4);
  for (let k = 0; k < n; k++) {
    const pr = (src[4 * k] - m[0]) * vec[0] + (src[4 * k + 1] - m[1]) * vec[1] + (src[4 * k + 2] - m[2]) * vec[2];
    const g = 128 + pr / sd * 42;
    out[4 * k] = out[4 * k + 1] = out[4 * k + 2] = g; out[4 * k + 3] = 255;
  }
  return out;
}

/* ------------------------------------------------------- the 3D stage --
   The photo itself as a 3D relief (Face map → Surface): one mesh over the face's box (the surface,
   falling off smoothly to the photo plane around it) plus the rest of the photo as a flat plane
   behind — and, with the measured head, the head's own mesh around the face (coloured from the side
   photo too: a second texture and a colour per vertex). Model space is the photo's own pixels (x right, y down) with depth z in pixels toward the
   camera, so with no rotation it projects exactly onto the 2D photo. The caller supplies the matrix
   (rotation about the face + the photo → screen transform). */
// (a vertex's colour: the photo, the second photo (the side one) and a colour of its own, mixed by aW —
// and, as the view turns to face the photo's camera, the photo wherever it sees the vertex (aFs), so
// facing you the relief is exactly the photo)
const VSS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv; in vec2 aOv; in vec2 aUv2; in vec3 aW; in vec3 aCol; in float aFs;
uniform mat4 uM; uniform mat3 uR;
out vec3 vN; out vec2 vUv; out vec2 vOv; out vec2 vUv2; out vec3 vW; out vec3 vCol; out float vFs;
void main() { vN = uR * aNrm; vUv = aUv; vOv = aOv; vUv2 = aUv2; vW = aW; vCol = aCol; vFs = aFs; gl_Position = uM * vec4(aPos, 1.0); }`;
const FSS = `#version 300 es
precision highp float;
in vec3 vN; in vec2 vUv; in vec2 vOv; in vec2 vUv2; in vec3 vW; in vec3 vCol; in float vFs;
uniform sampler2D uTex; uniform sampler2D uOv; uniform sampler2D uTex2; uniform vec3 uGain2; uniform float uFront;
uniform int uMode; uniform float uOvA; uniform vec3 uLight; uniform vec4 uColor; uniform float uBack;
out vec4 o;
void main() {
  if (uMode == 3) { o = uColor; return; }
  // (the normals point out of the surface: a fragment whose smoothed normal leans just past edge-on is
  // lit as edge-on, not as its mirror image — that flip drew bright rims along the ears)
  vec3 n = normalize(vN);
  // (a surface seen from behind and facing away — the head's skin from inside, through the mouth's slit — is
  // a cavity: dark. Not at the head's own edge, where a sliver of its far side seen edge-on showed as dark
  // lines along the outline; uBack: which way round the mesh's triangles go, 0 for none)
  // (with the photo on: the photo's own colour there, a little darker — through the closed lips' seam it showed as
  // a black slit, an open mouth, where the photo has the lips' soft line; in the nostrils the photo is dark anyway)
  if (uBack != 0.0 && (gl_FrontFacing ? uBack < 0.0 : uBack > 0.0) && n.z < -0.2) { o = vec4(uMode == 0 ? texture(uTex, vUv).rgb * 0.75 : vec3(0.09, 0.055, 0.045), 1.0); return; }
  float l = max(dot(n, normalize(uLight)), 0.0);
  float wf = vW.x + (1.0 - vW.x) * vFs * uFront, k = (1.0 - wf) / max(1e-4, 1.0 - vW.x);
  vec3 ph = texture(uTex, vUv).rgb * wf + (texture(uTex2, vUv2).rgb * uGain2 * vW.y + vCol * vW.z) * k;
  vec3 c = uMode == 0 ? ph : vec3(0.82, 0.76, 0.72) * (0.24 + 0.86 * l);
  if (uOvA > 0.0 && vOv.x >= 0.0) { vec4 ov = texture(uOv, vOv); c = mix(c, ov.rgb, ov.a * uOvA); }
  o = vec4(c, 1.0);
}`;
function createStage(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(o)); return o; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VSS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FSS)); gl.linkProgram(pr);
  const U = {};
  ['uM', 'uR', 'uTex', 'uOv', 'uTex2', 'uGain2', 'uFront', 'uMode', 'uOvA', 'uLight', 'uColor', 'uBack'].forEach(k => { U[k] = gl.getUniformLocation(pr, k); });
  const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer(), lbo = gl.createBuffer();
  const tex = gl.createTexture(), ovTex = gl.createTexture(), tex2 = gl.createTexture();
  const texInit = (t, src) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  texInit(ovTex, new ImageData(1, 1));
  texInit(tex2, new ImageData(1, 1));
  let nTri = 0, nLine = 0, hasOv = false, meshBack = 0;
  const loc = n => gl.getAttribLocation(pr, n);
  return {
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    /** The photo (an image or canvas; its pixels map onto the photo's full width and height). */
    setPhoto(src) { texInit(tex, src); },
    /** The second photo (the side one), or null. */
    setPhoto2(src) { texInit(tex2, src || new ImageData(1, 1)); },
    /**
     * The mesh: { pos (x, y, z per vertex, photo px), nrm (3 per vertex), uv (photo 0…1),
     * ov (overlay 0…1, or −1 for none), tri (Uint32Array), lines (Uint32Array, for Wire) } and, optionally,
     * uv2 (the second photo, 0…1), w (3 per vertex: how much of the photo, the second photo and col),
     * col (3 per vertex, 0…1) and fs (1 where the photo sees the vertex) — without them, the photo alone.
     */
    setMesh(M) {
      const nv = M.pos.length / 3, F = 19, data = new Float32Array(nv * F);
      for (let v = 0; v < nv; v++) {
        const o = F * v;
        data.set([M.pos[3 * v], M.pos[3 * v + 1], M.pos[3 * v + 2], M.nrm[3 * v], M.nrm[3 * v + 1], M.nrm[3 * v + 2], M.uv[2 * v], M.uv[2 * v + 1], M.ov[2 * v], M.ov[2 * v + 1]], o);
        if (M.w) data.set([M.uv2[2 * v], M.uv2[2 * v + 1], M.w[3 * v], M.w[3 * v + 1], M.w[3 * v + 2], M.col[3 * v], M.col[3 * v + 1], M.col[3 * v + 2], M.fs[v]], o + 10);
        else data[o + 12] = 1;
      }
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const at = (n, k, off) => { const l = loc(n); if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, 4 * F, 4 * off); };
      at('aPos', 3, 0); at('aNrm', 3, 3); at('aUv', 2, 6); at('aOv', 2, 8); at('aUv2', 2, 10); at('aW', 3, 12); at('aCol', 3, 15); at('aFs', 1, 18);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, M.tri, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, M.lines, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      nTri = M.tri.length; nLine = M.lines.length; meshBack = M.back || 0;
    },
    /** A view drawn over the face (contours, relief…), covering the surface grid; null for none. */
    setOverlay(src) { hasOv = !!src; if (src) texInit(ovTex, src); },
    /** p: { m (column-major 4×4), r (3×3 rotation, column-major), light [x, y, z], mode ('photo' | 'clay' | 'wire'), ovA, w, h (device px), gain2 ([r, g, b] for the second photo) } */
    render(p) {
      if (canvas.width !== p.w) canvas.width = p.w;
      if (canvas.height !== p.h) canvas.height = p.h;
      gl.viewport(0, 0, p.w, p.h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!nTri) return;
      gl.useProgram(pr); gl.bindVertexArray(vao);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.uniformMatrix4fv(U.uM, false, p.m); gl.uniformMatrix3fv(U.uR, false, p.r);
      const L = p.light || [0, -.3, .95], r = p.r;
      gl.uniform3fv(U.uLight, [r[0] * L[0] + r[3] * L[1] + r[6] * L[2], r[1] * L[0] + r[4] * L[1] + r[7] * L[2], r[2] * L[0] + r[5] * L[1] + r[8] * L[2]]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ovTex); gl.uniform1i(U.uOv, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex2); gl.uniform1i(U.uTex2, 2);
      gl.uniform3fv(U.uGain2, p.gain2 || [1, 1, 1]);
      // (how squarely the view faces the photo's camera: from ≈ 35° off on, the photo takes over everything it sees)
      const fz = p.r[8], f = Math.min(1, Math.max(0, (fz - .82) / (.985 - .82)));
      gl.uniform1f(U.uFront, f * f * (3 - 2 * f));
      gl.uniform1f(U.uOvA, hasOv ? p.ovA : 0);
      gl.uniform1i(U.uMode, p.mode === 'photo' ? 0 : 1);
      gl.uniform1f(U.uBack, meshBack);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.drawElements(gl.TRIANGLES, nTri, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      if (p.mode === 'wire' && nLine) {
        gl.uniform1i(U.uMode, 3); gl.uniform4f(U.uColor, .35, .55, 1, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lbo);
        gl.drawElements(gl.LINES, nLine, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null);
    },
    clear() { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
  };
}

window.CraniSurface = { buildSurface: build, compose, analyze, topography, contours, gradient, blur, shade, lumGradient, levelSweep, pca, createStage, LABELS, build: '55' };
})();
