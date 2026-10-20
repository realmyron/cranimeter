/* ==========================================================================
   Cranimeter · face map (structure-aware morph)

   A 75-point face map in a normalised face frame:
     X = ±1 at the zygions (cheekbones), Y = −1 at nasion, +1 at menton.
   "left" / "right" are as seen in the image (same as the measurement presets).

   Two deformation layers, each a thin-plate spline (Bookstein, "Principal
   Warps", IEEE PAMI 1989) through the dots plus dense samples along every
   contour:
     · face  — everything inside the face outline (which includes the hairline)
     · back  — hair, ears, neck and background
   The face layer is composited over the back layer, so a widened cheek
   covers the hair behind it instead of stretching it, and a narrowed cheek
   reveals hair that the back layer warps in to fill the gap.
   Rigid moving least squares (Schaefer, McPhail & Warren 2006) is used to
   fit the template and to carry the interior skin dots along.
   ========================================================================== */
(() => {
'use strict';

// group: brush layer ('surface' | 'brows' | 'eyes' | 'nose' | 'lips' | 'head')
// field: which deformation layer(s) the point drives ('both' | 'face' | 'back')
const pt = (id, name, x, y, group, field, landmark) => ({ id, name, x, y, group, field, landmark: landmark || null });

const outlineLeft = [
  pt('hlL1', 'Hairline', -.45, -1.95, 'surface', 'both'),
  pt('hlL2', 'Hairline', -.82, -1.75, 'surface', 'both'),
  pt('temL', 'Temple', -.98, -1.35, 'surface', 'both'),
  pt('zyL', 'Cheekbone (zygion)', -1.0, -.65, 'surface', 'both', 'Zygion · left'),
  pt('chkL', 'Cheek edge', -.97, -.2, 'surface', 'both'),
  pt('jawL1', 'Jawline', -.9, .2, 'surface', 'both'),
  pt('goL', 'Jaw angle (gonion)', -.8, .55, 'surface', 'both', 'Gonion · left'),
  pt('jawL2', 'Jawline', -.6, .85, 'surface', 'both'),
  pt('chinL', 'Chin', -.3, 1.0, 'surface', 'both'),
];
const browLeft = [
  pt('bLi', 'Brow · inner', -.18, -1.12, 'brows', 'face'),
  pt('bLm', 'Brow · arch', -.45, -1.24, 'brows', 'face'),
  pt('bLo', 'Brow · tail', -.76, -1.12, 'brows', 'face'),
];
const eyeLeft = [
  pt('enL', 'Inner eye corner', -.27, -.92, 'eyes', 'face', 'Endocanthion · left'),
  pt('eLu1', 'Upper lid', -.40, -1.0, 'eyes', 'face'),
  pt('eLu2', 'Upper lid', -.56, -1.0, 'eyes', 'face'),
  pt('exL', 'Outer eye corner', -.69, -.92, 'eyes', 'face', 'Exocanthion · left'),
  pt('eLl2', 'Lower lid', -.56, -.86, 'eyes', 'face'),
  pt('eLl1', 'Lower lid', -.40, -.85, 'eyes', 'face'),
  pt('puL', 'Pupil', -.48, -.93, 'eyes', 'face', 'Pupil · left'),
];
const interiorLeft = [
  pt('fhL', 'Forehead', -.55, -1.55, 'surface', 'face'),
  pt('ckL', 'Cheek', -.62, -.40, 'surface', 'face'),
  pt('mcL', 'Lower cheek', -.60, .35, 'surface', 'face'),
];
const headLeft = [
  pt('neckL', 'Neck', -.75, 1.45, 'head', 'back'),
  pt('earLb', 'Ear · lobe', -1.17, -.15, 'head', 'back'),
  pt('earLt', 'Ear · top', -1.22, -.95, 'head', 'back'),
  pt('hdL2', 'Head side', -1.28, -1.9, 'head', 'back'),
  pt('hdL1', 'Head top', -.9, -2.65, 'head', 'back'),
];
const sideR = list => list.map(p => ({
  ...p,
  id: p.id.replace('L', 'R'),
  x: -p.x,
  landmark: p.landmark ? p.landmark.replace('· left', '· right') : null,
}));

const POINTS = [
  pt('tri', 'Hairline · centre (trichion)', 0, -2.0, 'surface', 'both', 'Trichion'),
  ...outlineLeft, ...sideR(outlineLeft),
  pt('me', 'Chin bottom (menton)', 0, 1.05, 'surface', 'both', 'Menton'),
  ...browLeft, ...sideR(browLeft),
  ...eyeLeft, ...sideR(eyeLeft),
  pt('n', 'Nasion', 0, -.95, 'nose', 'face', 'Nasion'),
  pt('dor', 'Nose bridge', 0, -.6, 'nose', 'face'),
  pt('prn', 'Nose tip', 0, -.28, 'nose', 'face', 'Pronasale'),
  pt('sn', 'Nose base (subnasale)', 0, -.10, 'nose', 'face', 'Subnasale'),
  pt('alL', 'Nostril wing (alare)', -.25, -.16, 'nose', 'face', 'Alare · left'),
  pt('alR', 'Nostril wing (alare)', .25, -.16, 'nose', 'face', 'Alare · right'),
  pt('chL', 'Mouth corner (cheilion)', -.38, .32, 'lips', 'face', 'Cheilion · left'),
  pt('ulL', 'Upper lip', -.18, .22, 'lips', 'face'),
  pt('ls', 'Upper lip · centre', 0, .24, 'lips', 'face', 'Labrale superius'),
  pt('ulR', 'Upper lip', .18, .22, 'lips', 'face'),
  pt('chR', 'Mouth corner (cheilion)', .38, .32, 'lips', 'face', 'Cheilion · right'),
  pt('llR', 'Lower lip', .18, .43, 'lips', 'face'),
  pt('li', 'Lower lip · centre', 0, .46, 'lips', 'face', 'Labrale inferius'),
  pt('llL', 'Lower lip', -.18, .43, 'lips', 'face'),
  pt('sto', 'Lip line (stomion)', 0, .33, 'lips', 'face', 'Stomion'),
  pt('fhC', 'Forehead · centre', 0, -1.6, 'surface', 'face'),
  pt('gl', 'Glabella', 0, -1.15, 'brows', 'face', 'Glabella'),
  pt('chinC', 'Chin · centre', 0, .82, 'surface', 'face'),
  ...interiorLeft, ...sideR(interiorLeft),
  pt('crown', 'Top of the head', 0, -2.95, 'head', 'back'),
  ...headLeft, ...sideR(headLeft),
];

const R = id => id.replace('L', 'R');
const CONTOURS = [
  { id: 'outline', closed: true, ids: ['tri', 'hlR1', 'hlR2', 'temR', 'zyR', 'chkR', 'jawR1', 'goR', 'jawR2', 'chinR', 'me', 'chinL', 'jawL2', 'goL', 'jawL1', 'chkL', 'zyL', 'temL', 'hlL2', 'hlL1'] },
  { id: 'browL', closed: false, ids: ['bLi', 'bLm', 'bLo'] },
  { id: 'browR', closed: false, ids: ['bRi', 'bRm', 'bRo'] },
  { id: 'eyeL', closed: true, ids: ['enL', 'eLu1', 'eLu2', 'exL', 'eLl2', 'eLl1'] },
  { id: 'eyeR', closed: true, ids: ['enR', 'eRu1', 'eRu2', 'exR', 'eRl2', 'eRl1'] },
  { id: 'ridge', closed: false, ids: ['n', 'dor', 'prn', 'sn'] },
  { id: 'nostrils', closed: false, ids: ['alL', 'sn', 'alR'] },
  { id: 'lips', closed: true, ids: ['chL', 'ulL', 'ls', 'ulR', 'chR', 'llR', 'li', 'llL'] },
  { id: 'mouthline', closed: false, ids: ['chL', 'sto', 'chR'] },
  { id: 'head', closed: false, ids: ['neckL', 'earLb', 'earLt', 'hdL2', 'hdL1', 'crown', R('hdL1'), R('hdL2'), R('earLt'), R('earLb'), R('neckL')] },
];

const INDEX = Object.fromEntries(POINTS.map((p, i) => [p.id, i]));

/**
 * Rigid MLS.  ctrl is a flat array of [qx, qy, px, py] per control point: q = where the point is
 * now (output), p = where it came from (source). Returns the source position for output (x, y).
 * With inverse = true the roles swap (source → output), used to place measurement points.
 */
function mls(ctrl, n, x, y, eps, inverse) {
  const a = inverse ? 2 : 0, b = inverse ? 0 : 2;
  let sw = 0, qx = 0, qy = 0, px = 0, py = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4, dx = ctrl[k + a] - x, dy = ctrl[k + a + 1] - y, w = 1 / (dx * dx + dy * dy + eps);
    sw += w; qx += w * ctrl[k + a]; qy += w * ctrl[k + a + 1]; px += w * ctrl[k + b]; py += w * ctrl[k + b + 1];
  }
  qx /= sw; qy /= sw; px /= sw; py /= sw;
  let mr = 0, mi = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4, dx = ctrl[k + a] - x, dy = ctrl[k + a + 1] - y, w = 1 / (dx * dx + dy * dy + eps);
    const hx = ctrl[k + a] - qx, hy = ctrl[k + a + 1] - qy, gx = ctrl[k + b] - px, gy = ctrl[k + b + 1] - py;
    mr += w * (hx * gx + hy * gy); mi += w * (hx * gy - hy * gx);
  }
  const L = Math.hypot(mr, mi) || 1, cr = mr / L, ci = mi / L, vx = x - qx, vy = y - qy;
  return [px + cr * vx - ci * vy, py + cr * vy + ci * vx];
}

/**
 * Thin-plate spline (Bookstein 1989) through the controls: the smoothest map (least bending)
 * that takes every "where now" point exactly to its "where from" point. No flat spots or folds
 * between controls, which is what keeps reshaped skin looking natural.
 *   ctrl: flat [qx, qy, px, py] per control · s: length unit (e.g. the photo size) for conditioning
 * Returns { n, c (centres, in units of s), w (weights), a (affine), s } for tpsEval / the GPU.
 */
function tpsFit(ctrl, n, s, lambda = 1e-6) {
  // rows carry the two right-hand sides in their last two columns
  const m = n + 3, W = m + 2, rows = [];
  for (let i = 0; i < m; i++) rows.push(new Float64Array(W));
  const c = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { c[2 * i] = ctrl[4 * i] / s; c[2 * i + 1] = ctrl[4 * i + 1] / s; }
  for (let i = 0; i < n; i++) {
    const xi = c[2 * i], yi = c[2 * i + 1], Ri = rows[i];
    for (let j = i + 1; j < n; j++) {
      const dx = xi - c[2 * j], dy = yi - c[2 * j + 1], r2 = dx * dx + dy * dy;
      const u = r2 > 1e-14 ? .5 * r2 * Math.log(r2) : 0;
      Ri[j] = u; rows[j][i] = u;
    }
    Ri[i] = lambda;
    Ri[n] = 1; Ri[n + 1] = xi; Ri[n + 2] = yi;
    rows[n][i] = 1; rows[n + 1][i] = xi; rows[n + 2][i] = yi;
    Ri[m] = (ctrl[4 * i + 2] - ctrl[4 * i]) / s; Ri[m + 1] = (ctrl[4 * i + 3] - ctrl[4 * i + 1]) / s;
  }
  // Gaussian elimination with partial pivoting
  for (let k = 0; k < m; k++) {
    let piv = k, best = Math.abs(rows[k][k]);
    for (let r = k + 1; r < m; r++) { const v = Math.abs(rows[r][k]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-14) continue;
    if (piv !== k) { const t = rows[k]; rows[k] = rows[piv]; rows[piv] = t; }
    const Rk = rows[k], inv = 1 / Rk[k];
    for (let r = k + 1; r < m; r++) {
      const Rr = rows[r], f = Rr[k] * inv;
      if (f === 0) continue;
      for (let col = k; col < W; col++) Rr[col] -= f * Rk[col];
    }
  }
  const sx = new Float64Array(m), sy = new Float64Array(m);
  for (let k = m - 1; k >= 0; k--) {
    const Rk = rows[k];
    let tx = Rk[m], ty = Rk[m + 1];
    for (let col = k + 1; col < m; col++) { tx -= Rk[col] * sx[col]; ty -= Rk[col] * sy[col]; }
    const d = Rk[k];
    sx[k] = Math.abs(d) < 1e-14 ? 0 : tx / d; sy[k] = Math.abs(d) < 1e-14 ? 0 : ty / d;
  }
  const w = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { w[2 * i] = sx[i]; w[2 * i + 1] = sy[i]; }
  return { n, c, w, a: [sx[n], sx[n + 1], sx[n + 2], sy[n], sy[n + 1], sy[n + 2]], s };
}
/** Evaluate a fitted thin-plate spline: where (x, y) now comes from. */
function tpsEval(T, x, y) {
  const s = T.s, X = x / s, Y = y / s, c = T.c, w = T.w, a = T.a;
  let dx = a[0] + a[1] * X + a[2] * Y, dy = a[3] + a[4] * X + a[5] * Y;
  for (let i = 0; i < T.n; i++) {
    const ex = X - c[2 * i], ey = Y - c[2 * i + 1], r2 = ex * ex + ey * ey;
    if (r2 > 1e-14) { const u = .5 * r2 * Math.log(r2); dx += w[2 * i] * u; dy += w[2 * i + 1] * u; }
  }
  return [x + dx * s, y + dy * s];
}

/**
 * Centripetal Catmull-Rom spline through points (contours, the face mask, dense map controls) —
 * unlike the uniform kind it never overshoots or forms cusps when neighbouring dots move unevenly.
 * steps = samples per segment (a number, or a function of the segment index); each segment's
 * first sample is its starting point.
 */
function spline(pts, closed, steps = 8) {
  const n = pts.length, out = [];
  if (n < 2) return pts.slice();
  const get = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const knot = (a, b) => Math.max(1e-3, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const lerp = (a, b, ta, tb, t) => { const u = (t - ta) / (tb - ta); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; };
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const ns = typeof steps === 'function' ? steps(i) : steps;
    for (let s = 0; s < ns; s++) {
      const t = t1 + (t2 - t1) * s / ns;
      const A1 = lerp(p0, p1, t0, t1, t), A2 = lerp(p1, p2, t1, t2, t), A3 = lerp(p2, p3, t2, t3, t);
      const B1 = lerp(A1, A2, t0, t2, t), B2 = lerp(A2, A3, t1, t3, t);
      out.push(lerp(B1, B2, t1, t2, t));
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

window.CraniMap = { POINTS, CONTOURS, INDEX, mls, tpsFit, tpsEval, spline, build: '11' };
})();
