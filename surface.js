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
   And a small WebGL viewer to turn the surface around in 3D.

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
/** Order-1 spherical-harmonics shading of a normal from a depth gradient. */
const shade = (L, gx, gy) => L[0] + (-L[1] * gx - L[2] * gy + L[3]) / Math.sqrt(1 + gx * gx + gy * gy);
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
function fitLight(I, gx, gy, w) {
  const n = I.length, rw = new Float32Array(n).fill(1);
  let L = [0.5, 0, 0, 0.5];
  for (let it = 0; it < 5; it++) {
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    for (let k = 0; k < n; k++) {
      const wk = w[k] * rw[k];
      if (wk <= 1e-3) continue;
      const N = Math.sqrt(1 + gx[k] * gx[k] + gy[k] * gy[k]), B = [1, -gx[k] / N, -gy[k] / N, 1 / N];
      for (let r = 0; r < 4; r++) { b[r] += wk * B[r] * I[k]; for (let c = 0; c < 4; c++) A[r][c] += wk * B[r] * B[c]; }
    }
    for (let r = 0; r < 4; r++) A[r][r] += 1e-6;
    L = solveSmall(A, b);
    // Huber-style weights on the residuals
    let s = 0, c = 0;
    const res = new Float32Array(n);
    for (let k = 0; k < n; k++) if (w[k] > 1e-3) { res[k] = I[k] - shade(L, gx[k], gy[k]); s += res[k] * res[k]; c++; }
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
function fitLightDir(I, gx, gy, w, d) {
  let s11 = 0, s12 = 0, s22 = 0, b1 = 0, b2 = 0;
  for (let k = 0; k < I.length; k++) {
    if (w[k] <= 1e-3) continue;
    const N = Math.sqrt(1 + gx[k] * gx[k] + gy[k] * gy[k]), nd = (-gx[k] * d[0] - gy[k] * d[1] + d[2]) / N;
    s11 += w[k]; s12 += w[k] * nd; s22 += w[k] * nd * nd; b1 += w[k] * I[k]; b2 += w[k] * I[k] * nd;
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
  // Light and shade change brightness, not colour (chromaticity): a different colour isn't shape.
  if (inp.rgb) {
    const rgb = inp.rgb, cr = new Float32Array(n), cg = new Float32Array(n);
    for (let k = 0; k < n; k++) { const t = rgb[3 * k] + rgb[3 * k + 1] + rgb[3 * k + 2] || 1e-6; cr[k] = rgb[3 * k] / t; cg[k] = rgb[3 * k + 1] / t; }
    const sr = blur(cr, gw, gh, 1, act, 1), sg = blur(cg, gw, gh, 1, act, 1);
    const mr = wmedian(sr, skin), mg = wmedian(sg, skin), d = new Float32Array(n);
    for (let k = 0; k < n; k++) d[k] = Math.hypot(sr[k] - mr, sg[k] - mg);
    const sig = Math.max(.004, 1.4826 * wmedian(d, skin));
    for (let k = 0; k < n; k++) { cw[k] = Math.exp(-((d[k] / (2.5 * sig)) ** 2)); skin[k] *= cw[k]; }
  }
  let ms = 0, mc = 0;
  for (let k = 0; k < n; k++) if (skin[k] > .3) { ms += lum[k] * skin[k]; mc += skin[k]; }
  const mean = ms / Math.max(1e-6, mc) || 1, I = new Float32Array(n);
  for (let k = 0; k < n; k++) I[k] = lum[k] / mean;
  const Is = blur(I, gw, gh, 1, act, 1);
  const g0 = gradient(z0, gw, gh, h, act);
  const L = inp.lightDir ? fitLightDir(Is, g0.gx, g0.gy, skin, inp.lightDir) : fitLight(Is, g0.gx, g0.gy, skin);
  const rho = new Float32Array(n), wr = new Float32Array(n), hint = inp.hint;
  for (let k = 0; k < n; k++) {
    if (!act[k]) continue;
    const s0 = shade(L, g0.gx[k], g0.gy[k]);
    rho[k] = Is[k] / Math.max(.05, s0);
    wr[k] = skin[k] * (s0 > .15 ? 1 : 0) * (hint ? 1 - Math.min(1, Math.abs(hint[k])) : 1);
  }
  const rhoLP = blur(rho, gw, gh, Math.max(2, Math.round(.9 / h)), wr, 2);
  for (let k = 0; k < n; k++) rhoLP[k] = Math.min(2.5, Math.max(.4, rhoLP[k] || 1));
  const dir = [L[1], L[2], L[3]], ll = Math.hypot(...dir) || 1;
  return { n, skin, cw, Is, g0, L, rho: rhoLP, dir: dir.map(v => v / ll), strength: ll / Math.max(.05, Math.abs(L[0]) + ll) };
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
  for (let k = 0; k < n; k++) if (act[k]) { shading[k] = P.Is[k] / P.rho[k]; expected[k] = shade(P.L, P.g0.gx[k], P.g0.gy[k]); }
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
  const { gw, gh, h, act, z0, rho, T, bk, L } = G, n = gw * gh, wd0 = G.wd, wd = Float32Array.from(wd0);
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
        + alpha * (Lv[i + 1] + Lv[i - 1] + Lv[i + gw] + Lv[i - gw] - 4 * Lv[i]) * invh2 + bk[i] * v[i];
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
      b[k] = T[k] - rho[k] * (a0 + a3 / N) - c[k] * (-a1 * g0.gx[k] - a2 * g0.gy[k]);
    }
    if (outer > 0) {
      let se = 0, sw = 0;
      const e = new Float32Array(n);
      for (let q = 0; q < D.length; q++) { const k = D[q]; e[k] = T[k] - rho[k] * shade(L, g.gx[k], g.gy[k]); se += wd0[k] * e[k] * e[k]; sw += wd0[k]; }
      const sig = Math.sqrt(se / Math.max(1e-6, sw)) || 1;
      for (let q = 0; q < D.length; q++) { const k = D[q], t = Math.abs(e[k]) / (1.5 * sig); wd[k] = wd0[k] * (t <= 1 ? 1 : 1 / (t * t)); }
    }
    u.fill(0);
    for (let q = 0; q < D.length; q++) { const k = D[q]; u[k] = c[k] * wd[k] * b[k]; }
    rhs.fill(0);
    for (let q = 0; q < U.length; q++) { const i = U[q]; rhs[i] = (a1 * (u[i + 1] - u[i - 1]) + a2 * (u[i + gw] - u[i - gw])) * inv2h; }
    for (let q = 0; q < U.length; q++) {
      const i = U[q];
      let d = bk[i] + alpha * 20 * invh2 * invh2;
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
  for (const key of ['z0', 'rho', 'T', 'wd', 'bk', 'act']) {
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
async function build(inp, onProgress) {
  const { gw, gh, h, act, z0 } = inp, trust = inp.trust == null ? .5 : inp.trust, detail = inp.detail == null ? .15 : inp.detail;
  const P = prepare(inp), n = P.n, hint = inp.hint, prior = inp.prior;
  // the brightness to match: the photo's, pushed up / down where highlights / shadows are marked
  const T = new Float32Array(n), wd = new Float32Array(n);
  let Imax = 0;
  for (let k = 0; k < n; k++) if (P.skin[k] > .5) Imax = Math.max(Imax, P.Is[k]);
  for (let k = 0; k < n; k++) {
    T[k] = hint && hint[k] ? P.Is[k] * (1 + .45 * hint[k]) : P.Is[k];
    if (!P.skin[k]) continue;
    const s0 = shade(P.L, P.g0.gx[k], P.g0.gy[k]), hk = hint ? Math.abs(hint[k]) : 0;
    wd[k] = P.skin[k] * (P.Is[k] > .97 * Imax && !hk ? 0 : 1) * (s0 < .12 ? .25 : 1) * (1 + 1.5 * hk);
    if (hk && !wd[k]) wd[k] = hk;
  }
  const beta = .02, bk = new Float32Array(n);
  for (let k = 0; k < n; k++) bk[k] = beta * (1 + 30 * (prior ? prior[k] : 0));
  const F = { gw, gh, h, act, z0, rho: P.rho, T, wd, bk, L: P.L };
  const alpha = .08 * Math.pow(10, (.5 - trust) * 2.4);
  // coarse pass (≈ 5 mm grid)
  const f = Math.max(2, Math.round(.5 / h)), C = coarsen(F, f);
  const dzC = await solve(C, alpha, 5, 160, new Float32Array(C.gw * C.gh), k => onProgress && onProgress(k / 5 * (detail > 0 ? .7 : 1)));
  let dz = blur(refine(dzC, C, F, f), gw, gh, Math.max(1, Math.round(f / 2)), act, 1);
  // fine pass: only as much detail as allowed (a stiffer surface for less detail)
  if (detail > 0) {
    dz = await solve(F, alpha / Math.max(.05, detail * detail) * .5, 2, 100, dz, k => onProgress && onProgress(.7 + k / 2 * .3));
    dz = blur(dz, gw, gh, 1, act, 1);
  }
  const z = new Float32Array(n);
  for (let k = 0; k < n; k++) z[k] = z0[k] + (act[k] ? Math.max(-1, Math.min(1, dz[k])) : 0);
  const g1 = gradient(z, gw, gh, h, act), S0 = new Float32Array(n), S1 = new Float32Array(n);
  for (let k = 0; k < n; k++) if (act[k]) { S0[k] = P.rho[k] * shade(P.L, P.g0.gx[k], P.g0.gy[k]); S1[k] = P.rho[k] * shade(P.L, g1.gx[k], g1.gy[k]); }
  return {
    gw, gh, h, act, skin: P.skin, z0, z, light: P.L, dir: P.dir, rho: P.rho, I: P.Is,
    fit0: corr(P.Is, S0, wd), fit1: corr(P.Is, S1, wd), strength: P.strength,
  };
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

/* ------------------------------------------------------------ 3D viewer -- */

const VS3 = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv;
uniform mat4 uMvp; uniform mat3 uRot;
out vec3 vN; out vec2 vUv;
void main() { vN = uRot * aNrm; vUv = aUv; gl_Position = uMvp * vec4(aPos, 1.0); }`;
const FS3 = `#version 300 es
precision highp float;
in vec3 vN; in vec2 vUv;
uniform sampler2D uTex; uniform int uMode; uniform vec3 uLight; uniform vec4 uColor;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float l = max(dot(n, normalize(uLight)), 0.0);
  if (uMode == 0) o = vec4(texture(uTex, vUv).rgb, 1.0);
  else if (uMode == 1) { vec3 base = vec3(0.82, 0.76, 0.72); float rim = pow(1.0 - max(n.z, 0.0), 3.0) * 0.18; o = vec4(base * (0.24 + 0.86 * l) + rim, 1.0); }
  else o = uColor;
}`;
const mat = {
  mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
  persp(fov, asp, nr, fr) { const f = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = f / asp; o[5] = f; o[10] = (fr + nr) / (nr - fr); o[11] = -1; o[14] = 2 * fr * nr / (nr - fr); return o; },
  rot(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Rx(pitch) · Ry(yaw), column-major
    return new Float32Array([cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, 0, 0, 1]);
  },
};
/** A small orbit viewer for the surface: drag to turn it, wheel to zoom, double-click to reset. */
function createViewer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(o)); return o; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS3)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS3)); gl.linkProgram(pr);
  const U = {};
  ['uMvp', 'uRot', 'uTex', 'uMode', 'uLight', 'uColor'].forEach(k => { U[k] = gl.getUniformLocation(pr, k); });
  const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer(), lbo = gl.createBuffer(), tex = gl.createTexture();
  let nTri = 0, nLine = 0, radius = 10, light = [0, .4, 1];
  const st = { yaw: 0, pitch: 0, zoom: 1, mode: 'photo' };
  function setSurface(s, texSrc) {
    const { gw, gh, h, act, z } = s, idx = new Int32Array(gw * gh).fill(-1), vert = [];
    let cx = 0, cy = 0, cz = 0, cnt = 0;
    for (let k = 0; k < gw * gh; k++) if (act[k]) { cx += k % gw; cy += (k / gw) | 0; cz += z[k]; cnt++; }
    cx /= cnt || 1; cy /= cnt || 1; cz /= cnt || 1;
    const g = gradient(z, gw, gh, h, act);
    let r = 0;
    for (let k = 0; k < gw * gh; k++) {
      if (!act[k]) continue;
      const i = k % gw, j = (k / gw) | 0, X = (i - cx) * h, Y = -(j - cy) * h, Z = z[k] - cz;
      const N = Math.sqrt(1 + g.gx[k] ** 2 + g.gy[k] ** 2);
      idx[k] = vert.length / 8;
      vert.push(X, Y, Z, -g.gx[k] / N, g.gy[k] / N, 1 / N, (i + .5) / gw, (j + .5) / gh);
      r = Math.max(r, Math.hypot(X, Y));
    }
    radius = r || 10;
    const tri = [], lines = [], every = Math.max(2, Math.round(.45 / h));
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = idx[j * gw + i], b = idx[j * gw + i + 1], c = idx[(j + 1) * gw + i], d = idx[(j + 1) * gw + i + 1];
      // whole quads, and half quads along the edge (a smoother outline)
      if (a >= 0 && b >= 0 && c >= 0) tri.push(a, c, b);
      if (b >= 0 && c >= 0 && d >= 0) tri.push(b, c, d);
      else if (a >= 0 && b >= 0 && d >= 0 && c < 0) tri.push(a, d, b);
      if (a >= 0 && c >= 0 && d >= 0 && b < 0) tri.push(a, c, d);
      if (j % every === 0 && a >= 0 && b >= 0) lines.push(a, b);
      if (i % every === 0 && a >= 0 && c >= 0) lines.push(a, c);
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vert), gl.STATIC_DRAW);
    const loc = n => gl.getAttribLocation(pr, n);
    gl.enableVertexAttribArray(loc('aPos')); gl.vertexAttribPointer(loc('aPos'), 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(loc('aNrm')); gl.vertexAttribPointer(loc('aNrm'), 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(loc('aUv')); gl.vertexAttribPointer(loc('aUv'), 2, gl.FLOAT, false, 32, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(tri), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(lines), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    nTri = tri.length; nLine = lines.length;
    if (texSrc) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texSrc);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    if (s.dir) light = [s.dir[0], -s.dir[1], s.dir[2]];
    render();
  }
  function render() {
    const dpr = Math.min(2, devicePixelRatio || 1), W = Math.max(1, Math.round(canvas.clientWidth * dpr)), H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    gl.viewport(0, 0, W, H);
    gl.clearColor(.07, .08, .1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!nTri) return;
    const R = mat.rot(st.yaw, st.pitch), dist = radius / Math.tan(.28) * 1.08 / st.zoom;
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1]);
    const mvp = mat.mul(mat.persp(.56, W / H, dist * .2, dist * 3), mat.mul(view, R));
    const r3 = new Float32Array([R[0], R[1], R[2], R[4], R[5], R[6], R[8], R[9], R[10]]);
    gl.useProgram(pr); gl.bindVertexArray(vao);
    gl.enable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(U.uMvp, false, mvp); gl.uniformMatrix3fv(U.uRot, false, r3);
    // the light turns with the face (it's the photo's light on this face)
    const lr = [r3[0] * light[0] + r3[3] * light[1] + r3[6] * light[2], r3[1] * light[0] + r3[4] * light[1] + r3[7] * light[2], r3[2] * light[0] + r3[5] * light[1] + r3[8] * light[2]];
    gl.uniform3fv(U.uLight, lr);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uTex, 0);
    gl.uniform1i(U.uMode, st.mode === 'photo' ? 0 : 1);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.drawElements(gl.TRIANGLES, nTri, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (st.mode === 'wire' && nLine) {
      gl.uniform1i(U.uMode, 2); gl.uniform4f(U.uColor, .35, .55, 1, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lbo);
      gl.drawElements(gl.LINES, nLine, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }
  // orbit
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not a real pointer */ } });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    st.yaw = drag.yaw + (e.clientX - drag.x) * .01;
    st.pitch = Math.max(-1.3, Math.min(1.3, drag.pitch + (e.clientY - drag.y) * .01));
    render();
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.preventDefault(); st.zoom = Math.max(.5, Math.min(4, st.zoom * Math.exp(-e.deltaY * .0015))); render(); }, { passive: false });
  canvas.addEventListener('dblclick', () => { st.yaw = 0; st.pitch = 0; st.zoom = 1; render(); });
  return {
    setSurface, render,
    setMode(m) { st.mode = m; render(); },
    setView(yaw, pitch) { st.yaw = yaw; st.pitch = pitch; render(); },
    get state() { return { ...st }; },
  };
}

window.CraniSurface = { buildSurface: build, analyze, topography, contours, gradient, blur, shade, lumGradient, levelSweep, pca, createViewer, LABELS, build: '20' };
})();
