/* ==========================================================================
   Cranimeter · head model (ICT-FaceKit)

   A measured 3D head: the ICT-FaceKit light model (MIT License, Copyright (c) 2020 USC Institute for
   Creative Technologies; see ICT-FaceKit-LICENSE.txt) — a neutral head plus identity modes from
   light-stage scans of real people: the skin of the face, head and neck, and the eyeballs, converted
   to ict-head.bin by tools/ict_convert.ps1 (the first 60 of its 100 modes; the rest move the skin by
   less than 0.15 mm).

   It is fitted to the face map's dots: on the front photo, and on the side photo when it's mapped —
   the pose of each photo (scaled orthographic) and how much of each identity mode this face has, with
   the modes' own statistics as the prior (their weights are standard normal in the scans). The fitted
   head is a real head's shape where the template's depth had to be guessed, and with a side photo the
   head's true profile.

   Frames: the model's own (cm; x = the photo's right in a front view, y up, z forward); photos in
   pixels (y down). Depths handed back are the app's: cm forward from the ear plane (tragion = 0).
   ========================================================================== */
(() => {
'use strict';
const FM = window.CraniMap;
if (!FM) return;

let model = null, loading = null;
/** Load ict-head.bin (once). Resolves to the model: { N, nSkin, nTri, K, neu, tri, D (Float32 modes) }. */
function load(url = 'ict-head.bin') {
  if (model) return Promise.resolve(model);
  if (!loading) loading = fetch(url).then(r => { if (!r.ok) throw new Error(`ict-head.bin: ${r.status}`); return r.arrayBuffer(); }).then(buf => {
    const dv = new DataView(buf);
    if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'ICT1') throw new Error('ict-head.bin: not a head model');
    const hl = dv.getUint32(4, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    let o = 8 + hl;
    const N = H.nVert, nt = H.nTri, K = H.K;
    const neu = new Float32Array(buf.slice(o, o + N * 12)); o += N * 12;
    const tri = new Uint16Array(buf.slice(o, o + nt * 6)); o += nt * 6 + ((nt * 6) % 4 ? 2 : 0);
    const D = new Float32Array(K * N * 3);
    for (let k = 0; k < K; k++) { const q = new Int8Array(buf, o, N * 3), sc = H.scales[k]; for (let i = 0; i < N * 3; i++) D[k * N * 3 + i] = q[i] * sc; o += N * 3; }
    model = { N, nSkin: H.nSkin, nTri: nt, K, neu, tri, D };
    return model;
  }).catch(e => { loading = null; throw e; });
  return loading;
}

/* ---- where each face-map dot is on the model ----
   The model's 68 Multi-PIE landmark vertices (ICT-FaceKit README) that are dots of ours line the two
   up: a similarity (scale, rotation, shift), then a smooth 3D bend through the landmarks' leftover
   offsets; each dot then takes the model's nearest skin vertex (midline dots: the nearest midline
   vertex; the pupil and iris: the eyeball's front). */
const LM68 = [1225, 1888, 1052, 367, 1719, 1722, 2199, 1447, 966, 3661, 4390, 3927, 3924, 2608, 3272, 4088, 3443, 268, 493, 1914, 2044, 1401, 3615, 4240, 4114, 2734, 2509, 978, 4527, 4942, 4857, 1140, 2075, 1147, 4269, 3360, 1507, 1542, 1537, 1528, 1518, 1511, 3742, 3751, 3756, 3721, 3725, 3732, 5708, 5695, 2081, 0, 4275, 6200, 6213, 6346, 6461, 5518, 5957, 5841, 5702, 5711, 5533, 6216, 6207, 6470, 5517, 5966];
const LM_DOTS = { 8: 'me', 27: 'n', 30: 'prn', 33: 'sn', 31: 'acL', 35: 'acR', 36: 'exL', 37: 'eu3L', 38: 'eu1L', 39: 'enL', 40: 'el1L', 41: 'el3L', 42: 'enR', 43: 'eu1R', 44: 'eu3R', 45: 'exR', 46: 'el3R', 47: 'el1R',
  48: 'chL', 49: 'ulL', 50: 'cphL', 51: 'ls', 52: 'cphR', 53: 'ulR', 54: 'chR', 55: 'llR', 57: 'li', 59: 'llL' };
// the face's outline in a front photo is the head's silhouette from the cheekbones down: its dots slide
// to wherever the fitted head's edge is (at their height), not one fixed vertex (above, at the temples,
// the outline is the hairline's edge — the head's own edge is further out, under the hair)
const SIL = /^(zy|chk|jaw1|go|jaw2|chin|me)[LR]?$/;
// … and in a side photo the jaw's lower border and the ramus's back edge (see `turn` below)
const SIDE_EDGE = /^(jaw2|go|ramus)[LR]$/;
let corr = null;
/** Per template dot: { v (vertex), cand (silhouette candidates), nrm ([x, y] outward in a front view) } (cached). */
function correspond() {
  if (corr) return corr;
  const m = model, P = FM.POINTS, nS = m.nSkin, V = i => [m.neu[3 * i], m.neu[3 * i + 1], m.neu[3 * i + 2]];
  // model → template frame (y down): similarity on the landmark pairs (Umeyama)
  const A = [], B = [];
  for (const [k, id] of Object.entries(LM_DOTS)) { const i = FM.INDEX[id]; if (i == null) continue; const v = V(LM68[k]); A.push([v[0], -v[1], v[2]]); B.push([P[i].x, P[i].y, P[i].z]); }
  const sim = umeyama(A, B), toT = v => { const a = [v[0], -v[1], v[2]], r = sim.R; return [0, 1, 2].map(j => sim.s * (r[j][0] * a[0] + r[j][1] * a[1] + r[j][2] * a[2]) + sim.t[j]); };
  // then a smooth bend (Gaussian, σ ≈ 2.5 cm) through what's left at the landmarks
  const Ab = A.map((a, q) => toT([a[0], -a[1], a[2]])), res = Ab.map((a, q) => [B[q][0] - a[0], B[q][1] - a[1], B[q][2] - a[2]]);
  const g = (a, b) => Math.exp(-((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / (2 * 2.5 * 2.5)), n = Ab.length;
  const G = Ab.map(a => Ab.map(b => g(a, b))); G.forEach((row, q) => { row[q] += .05; });
  const W = [0, 1, 2].map(j => solve(G.map(r => r.slice()), res.map(r => r[j])));
  const bend = p => { const o = [0, 0, 0]; for (let q = 0; q < n; q++) { const w = g(p, Ab[q]); for (let j = 0; j < 3; j++) o[j] += W[j][q] * w; } return [p[0] + o[0], p[1] + o[1], p[2] + o[2]]; };
  const T = new Float32Array(m.N * 3);
  for (let i = 0; i < m.N; i++) { const p = bend(toT(V(i))); T[3 * i] = p[0]; T[3 * i + 1] = p[1]; T[3 * i + 2] = p[2]; }
  const near = (p, lo, hi, ok) => { let best = -1, bd = Infinity; for (let i = lo; i < hi; i++) { if (ok && !ok(i)) continue; const d = (T[3 * i] - p[0]) ** 2 + (T[3 * i + 1] - p[1]) ** 2 + (T[3 * i + 2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
  // Below the jaw's lower border (the neck, under the chin): the model's neck is fixed to its head in one
  // posture, while a photo's neck sits however the head is tilted on it — so it isn't used for the 3D,
  // and the jaw's outline dots never take a neck vertex (below the chin the neck reaches lower in a front
  // view, and was taken for the chin's edge)
  const jaw = ['me', 'chinR', 'jaw2R', 'goR'].map(id => P[FM.INDEX[id]]).map(p => [Math.abs(p.x), p.y]);
  const yJaw = ax => { if (ax >= jaw[3][0]) return jaw[3][1]; for (let q = 1; q < 4; q++) if (ax <= jaw[q][0]) { const t = (ax - jaw[q - 1][0]) / ((jaw[q][0] - jaw[q - 1][0]) || 1); return jaw[q - 1][1] + t * (jaw[q][1] - jaw[q - 1][1]); } return jaw[3][1]; };
  const neck = new Uint8Array(m.N);
  for (let i = 0; i < nS; i++) if (T[3 * i + 1] > yJaw(Math.abs(T[3 * i])) + .45) neck[i] = 1;
  // … nor an ear's (at the jaw angle the ear lobe reaches further out). The auricle: within 1 cm of its dots —
  // but only 3.5 mm round where it joins the head (otobasion above and below): that's the head's own skin, and
  // the ramus's back edge runs up to just below the lower one (at 1.2 cm round every ear dot, the whole
  // ramus counted as ear, and a side photo's ramus was never fitted as the jaw's edge)
  const earPts = P.filter(p => p.group === 'ears' && p.x > 0).map(p => [p.x, p.y, p.z, /^ob[is]R$/.test(p.id) ? .35 : 1]), ear = new Uint8Array(m.N);
  for (let i = 0; i < nS; i++) { const x = Math.abs(T[3 * i]), y = T[3 * i + 1], z = T[3 * i + 2]; if (earPts.some(([px, py, pz, r]) => (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2 < r * r)) ear[i] = 1; }
  // … nor the jaw's underside: the jaw outline's dot is the jawline — the border where the skin turns
  // under — and below it the underside, facing down, reaches out as far in a front view
  const down = new Uint8Array(m.N), nrm = new Float32Array(nS * 3);
  for (let t = 0; t < m.nTri; t++) {
    const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2];
    if (a >= nS || b >= nS || c >= nS) continue;
    const ux = T[3 * b] - T[3 * a], uy = T[3 * b + 1] - T[3 * a + 1], uz = T[3 * b + 2] - T[3 * a + 2], vx = T[3 * c] - T[3 * a], vy = T[3 * c + 1] - T[3 * a + 1], vz = T[3 * c + 2] - T[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[3 * v] += nx; nrm[3 * v + 1] += ny; nrm[3 * v + 2] += nz; }
  }
  const ip = LM68[30], sgn = nrm[3 * ip + 2] < 0 ? -1 : 1;   // (the nose tip's normal points forward)
  for (let i = 0; i < nS; i++) { const L = Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]) || 1; if (sgn * nrm[3 * i + 1] / L > .55) down[i] = 1; }
  // In a side photo the jaw line is where the skin turns from the jaw's side to its underside — and, behind,
  // round the ramus's back edge to the neck: the vertices half way round that turn (facing out and down, or
  // out and back about equally) are where the side map's jaw dots go
  const turn = new Uint8Array(nS);
  for (let i = 0; i < nS; i++) {
    const x = T[3 * i];
    if (neck[i] || ear[i] || Math.abs(x) < 2) continue;
    const L = sgn / (Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]) || 1), a = Math.sign(x) * nrm[3 * i] * L, b = nrm[3 * i + 1] * L, c = -nrm[3 * i + 2] * L;
    if (a > .35 && ((b > .35 && Math.abs(a - b) < .3) || (c > .35 && Math.abs(a - c) < .3))) turn[i] = 1;
  }
  // the front outline's normals, from the template's own outline
  const outline = FM.contours(0).find(c => c.boundary).idx, on = new Map();
  outline.forEach((i, q) => { const a = P[outline[(q + outline.length - 1) % outline.length]], b = P[outline[(q + 1) % outline.length]]; let nx = b.y - a.y, ny = -(b.x - a.x); const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L; if (nx * P[i].x + ny * (P[i].y + 1) < 0) { nx = -nx; ny = -ny; } on.set(i, [nx, ny]); });
  corr = P.map((pt, i) => {
    const p = [pt.x, pt.y, pt.z], base = pt.id.replace(/[LR]$/, '');
    if (/^(pu|irI|irO)$/.test(base)) return { v: near(p, nS, m.N, j => T[3 * j + 2] > pt.z - 1) };
    const v = Math.abs(pt.x) < 1e-6 ? near(p, 0, nS, j => Math.abs(T[3 * j]) < .12) : near(p, 0, nS);
    const out = { v };
    if (SIL.test(pt.id) || (pt.mid && on.has(i) && pt.y > -4.5)) {
      // silhouette candidates: skin within ±0.6 cm of the dot's height on its side, in front of the ears
      const cand = [];
      for (let j = 0; j < nS; j++) { if (neck[j] || ear[j] || (pt.y > 0 && down[j])) continue; const tx = T[3 * j], ty = T[3 * j + 1], tz = T[3 * j + 2]; if (Math.abs(ty - pt.y) < .6 && tz > -1 && (pt.x === 0 ? Math.abs(tx) < 2.5 : tx * pt.x > 0 && Math.abs(tx - pt.x) < 3)) cand.push(j); }
      if (cand.length) { out.cand = Int32Array.from(cand); out.nrm = on.get(i) || [Math.sign(pt.x), pt.x ? 0 : 1]; }
    }
    if (SIDE_EDGE.test(pt.id)) {
      const sc = [];
      for (let j = 0; j < nS; j++) if (turn[j] && T[3 * j] * pt.x > 0 && (T[3 * j] - pt.x) ** 2 + (T[3 * j + 1] - pt.y) ** 2 + (T[3 * j + 2] - pt.z) ** 2 < 4) sc.push(j);
      if (sc.length) out.scand = Int32Array.from(sc);
    }
    return out;
  });
  corr.T = T;
  corr.neck = neck;
  corr.ear = ear;
  corr.turn = turn;
  return corr;
}

/* ---- small linear algebra ---- */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / d; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let c = n - 1; c >= 0; c--) { let s = M[c][n]; for (let k = c + 1; k < n; k++) s -= M[c][k] * x[k]; x[c] = s / (M[c][c] || 1e-12); }
  return x;
}
/** Rotation (3×3) closest to M, by polar decomposition (Newton iterations). */
function orthonormal(M) {
  let R = M.map(r => r.slice());
  for (let it = 0; it < 30; it++) {
    const inv = inv3(R), Rt = [0, 1, 2].map(i => [0, 1, 2].map(j => inv[j][i]));
    R = R.map((r, i) => r.map((v, j) => (v + Rt[i][j]) / 2));
  }
  return R;
}
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, k] = m[2], A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1e-12;
  return [[A / det, -(b * k - c * h) / det, (b * f - c * e) / det], [B / det, (a * k - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}
/** Similarity B ≈ s R A + t (least squares). */
function umeyama(A, B) {
  const n = A.length, ma = [0, 0, 0], mb = [0, 0, 0];
  for (let q = 0; q < n; q++) for (let j = 0; j < 3; j++) { ma[j] += A[q][j] / n; mb[j] += B[q][j] / n; }
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let va = 0;
  for (let q = 0; q < n; q++) for (let i = 0; i < 3; i++) { va += (A[q][i] - ma[i]) ** 2 / n; for (let j = 0; j < 3; j++) C[i][j] += (B[q][i] - mb[i]) * (A[q][j] - ma[j]) / n; }
  const R = orthonormal(C);
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += R[i][j] * C[i][j];
  const s = tr / va, t = [0, 1, 2].map(i => mb[i] - s * (R[i][0] * ma[0] + R[i][1] * ma[1] + R[i][2] * ma[2]));
  return { s, R, t };
}
const rotSmall = (w) => { const [x, y, z] = w, th = Math.hypot(x, y, z); if (th < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; const k = [x / th, y / th, z / th], c = Math.cos(th), s = Math.sin(th), v = 1 - c; return [[c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s], [k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s], [k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v]]; };
const mul3 = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
/** A view's outline (V.outline: its dots in order) as unit normals in its photo, out from its dots' centre: Map(dot → [x, y]). */
function outlineNormals(V) {
  const out = new Map(), L = V.outline && V.outline.filter(i => V.vis[i]);
  if (!L || L.length < 3) return out;
  let cx = 0, cy = 0, k = 0;
  FM.POINTS.forEach((_, i) => { if (V.vis[i]) { cx += V.p[2 * i]; cy += V.p[2 * i + 1]; k++; } });
  cx /= k; cy /= k;
  L.forEach((i, q) => {
    const a = L[(q + L.length - 1) % L.length], b = L[(q + 1) % L.length];
    let nx = V.p[2 * b + 1] - V.p[2 * a + 1], ny = -(V.p[2 * b] - V.p[2 * a]);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (nx * (V.p[2 * i] - cx) + ny * (V.p[2 * i + 1] - cy) < 0) { nx = -nx; ny = -ny; }
    out.set(i, [nx, ny]);
  });
  return out;
}
// a view's starting rotation: rows map the model's (x, y up, z forward) onto the photo's (x, y down, away)
const VIEW_R = { front: [[1, 0, 0], [0, -1, 0], [0, 0, -1]], left: [[0, 0, -1], [0, -1, 0], [-1, 0, 0]], right: [[0, 0, 1], [0, -1, 0], [1, 0, 0]] };

/**
 * Fit the head to face maps. views: [{ view ('front' | 'left' | 'right'), p (Float32Array of the map's
 * dots, photo px), vis, weight(i) → 0…1, outline (a side map's outline, its dots in order) }] — the
 * first one is the photo whose depths are wanted.
 * Returns { c (identity weights), poses: [{ s, R, t }], X (fitted vertices, model frame), rms (cm) }.
 */
function fit(views, opt = {}) {
  // (the prior: dots placed ≈ 4 mm apart from the model's points still fit, and no mode goes past ±3σ —
  // a face map that's a little off, or a face unlike the scans, mustn't bend the head into a caricature)
  const m = model, C = correspond(), K = Math.min(opt.K || m.K, m.K), N = m.N, lam = (opt.sigma || .4) ** 2, cmax = opt.cmax || 3;
  const c = new Float64Array(K), X = Float32Array.from(m.neu);
  const shape = () => { X.set(m.neu); for (let k = 0; k < K; k++) { const w = c[k]; if (!w) continue; const off = k * N * 3; for (let i = 0; i < N * 3; i++) X[i] += w * m.D[off + i]; } };
  // observations: per view, the dots used and their vertex (silhouette dots: chosen each round, and
  // only how far out the edge is counts — a dot on the outline says where the edge is, not which point;
  // in a side photo the same for the jaw line's dots, out from the outline its map draws)
  const obs = views.map(V => {
    const list = [], sn = V.view !== 'front' ? outlineNormals(V) : null;
    FM.POINTS.forEach((pt, i) => {
      const w = V.vis[i] ? V.weight(i) : 0;
      if (!(w > 0 && C[i] && C[i].v >= 0)) return;
      const o = { i, w, u: V.p[2 * i], v: V.p[2 * i + 1], vert: C[i].v, n: V.view === 'front' && C[i].cand ? C[i].nrm : null };
      if (sn && C[i].scand && sn.has(i)) { o.n = sn.get(i); o.sc = C[i].scand; }
      list.push(o);
    });
    return list;
  });
  // a dot's residual and its rows (cm): two for a dot, one (along the outline's normal) for an edge dot
  const rows = (o, eu, ev, Ju, Jv) => o.n ? [[eu * o.n[0] + ev * o.n[1], Ju.map((a, q) => a * o.n[0] + Jv[q] * o.n[1])]] : [[eu, Ju], [ev, Jv]];
  // starting poses: the nominal view, scale and shift from the dots
  const poses = views.map((V, q) => {
    const R0 = VIEW_R[V.view] || VIEW_R.front, L = obs[q];
    let sw = 0, mu = 0, mv = 0, mx = 0, my = 0, sxx = 0, sux = 0;
    for (const o of L) { const P = [m.neu[3 * o.vert], m.neu[3 * o.vert + 1], m.neu[3 * o.vert + 2]], y = [0, 1].map(r => R0[r][0] * P[0] + R0[r][1] * P[1] + R0[r][2] * P[2]); sw += o.w; mu += o.w * o.u; mv += o.w * o.v; mx += o.w * y[0]; my += o.w * y[1]; o._y = y; }
    mu /= sw; mv /= sw; mx /= sw; my /= sw;
    for (const o of L) { sxx += o.w * ((o._y[0] - mx) ** 2 + (o._y[1] - my) ** 2); sux += o.w * ((o._y[0] - mx) * (o.u - mu) + (o._y[1] - my) * (o.v - mv)); }
    const s = sux / sxx;
    return { s, R: R0, t: [mu - s * mx, mv - s * my] };
  });
  const proj = (P, pose) => { const R = pose.R; return [pose.s * (R[0][0] * P[0] + R[0][1] * P[1] + R[0][2] * P[2]) + pose.t[0], pose.s * (R[1][0] * P[0] + R[1][1] * P[1] + R[1][2] * P[2]) + pose.t[1]]; };
  const vert = i => [X[3 * i], X[3 * i + 1], X[3 * i + 2]];
  // the silhouette dots: the candidate furthest out along the outline's normal (in this view's photo); in a
  // side photo, of the jaw line's turn within ≈ 1 cm of the dot along the line
  const march = q => {
    const front = views[q].view === 'front', p = poses[q];
    for (const o of obs[q]) {
      const cs = front ? C[o.i].cand : o.sc;
      if (!cs || !o.n) continue;
      let best = o.vert, bv = -Infinity;
      for (const j of cs) {
        const [u, v] = proj(vert(j), p);
        if (!front && Math.abs((o.v - v) * o.n[0] - (o.u - u) * o.n[1]) > p.s) continue;
        const s = u * o.n[0] + v * o.n[1];
        if (s > bv) { bv = s; best = j; }
      }
      o.vert = best;
    }
  };
  let rms = 0;
  for (let it = 0; it < (opt.iters || 10); it++) {
    shape();
    // 1 · each photo's pose (Gauss–Newton on scale, rotation, shift; held near its nominal view)
    views.forEach((V, q) => {
      march(q);
      for (let g = 0; g < 3; g++) {
        const p = poses[q], A = Array.from({ length: 6 }, () => new Array(6).fill(0)), b = new Array(6).fill(0);
        for (const o of obs[q]) {
          // (in a side photo the pose is read off the upper face — eyes, nose, ears: the jaw, chin and lips are
          // where faces differ most from the scans, and fitted with the modes' guess of them they tilted the
          // whole head a few degrees to make up for a chin they couldn't reach)
          const P = vert(o.vert), Y = [0, 1, 2].map(r => p.R[r][0] * P[0] + p.R[r][1] * P[1] + p.R[r][2] * P[2]);
          const eu = o.u - (p.s * Y[0] + p.t[0]), ev = o.v - (p.s * Y[1] + p.t[1]), w = o.w * (V.view !== 'front' && (FM.POINTS[o.i].y > .3 || SIDE_EDGE.test(FM.POINTS[o.i].id)) ? .05 : 1) / (p.s * p.s);
          const Ju = [Y[0], 0, p.s * Y[2], -p.s * Y[1], 1, 0], Jv = [Y[1], -p.s * Y[2], 0, p.s * Y[0], 0, 1];
          for (const [e, Jr] of rows(o, eu, ev, Ju, Jv)) for (let a = 0; a < 6; a++) { b[a] += w * Jr[a] * e; for (let f = 0; f < 6; f++) A[a][f] += w * Jr[a] * Jr[f]; }
        }
        // (rotation held near the nominal view: the side photo's midline dots alone don't pin its yaw)
        const sw = obs[q].reduce((s, o) => s + o.w, 0) || 1;
        for (let a = 1; a < 4; a++) A[a][a] += sw * .02 * p.s * p.s;
        for (let a = 0; a < 6; a++) A[a][a] += 1e-9;
        const d = solve(A, b);
        p.s += d[0]; p.R = mul3(rotSmall([d[1], d[2], d[3]]), p.R); p.t = [p.t[0] + d[4], p.t[1] + d[5]];
      }
    });
    // 2 · the identity, given the poses (linear least squares with the modes' prior)
    const A = Array.from({ length: K }, () => new Float64Array(K)), b = new Float64Array(K), J = new Float64Array(2 * K);
    let se = 0, sw = 0;
    views.forEach((V, q) => {
      const p = poses[q];
      for (const o of obs[q]) {
        const P = vert(o.vert), [pu, pv] = proj(P, p);
        let eu = (o.u - pu) / p.s, ev = (o.v - pv) / p.s;
        for (let k = 0; k < K; k++) {
          const off = k * N * 3 + 3 * o.vert, dx = m.D[off], dy = m.D[off + 1], dz = m.D[off + 2];
          J[2 * k] = p.R[0][0] * dx + p.R[0][1] * dy + p.R[0][2] * dz; J[2 * k + 1] = p.R[1][0] * dx + p.R[1][1] * dy + p.R[1][2] * dz;
        }
        if (o.n) {   // (an edge dot: along the normal only)
          eu = eu * o.n[0] + ev * o.n[1]; ev = 0;
          for (let k = 0; k < K; k++) { J[2 * k] = J[2 * k] * o.n[0] + J[2 * k + 1] * o.n[1]; J[2 * k + 1] = 0; }
        }
        se += o.w * (eu * eu + ev * ev); sw += o.w;
        for (let k = 0; k < K; k++) {
          b[k] += o.w * (J[2 * k] * eu + J[2 * k + 1] * ev);
          for (let l = 0; l <= k; l++) A[k][l] += o.w * (J[2 * k] * J[2 * l] + J[2 * k + 1] * J[2 * l + 1]);
        }
      }
    });
    rms = Math.sqrt(se / Math.max(1e-9, sw));
    // Gauss–Newton step on c with the prior Σ c² (in cm²: the dots' scatter λ)
    const M = Array.from({ length: K }, (_, k) => Array.from({ length: K }, (_, l) => (l <= k ? A[k][l] : A[l][k]) + (k === l ? lam : 0)));
    const rhs = Array.from(b, (v, k) => v - lam * c[k]);
    const dc = solve(M, rhs);
    for (let k = 0; k < K; k++) c[k] = Math.max(-cmax, Math.min(cmax, c[k] + dc[k]));
  }
  shape();
  views.forEach((V, q) => march(q));
  return { c: Array.from(c), poses, X: Float32Array.from(X), rms, pairs: obs.map(L => L.map(o => ({ i: o.i, vert: o.vert, u: o.u, v: o.v, w: o.w, n: o.n, sc: !!o.sc }))) };
}

/* ---- what the modes can't reach ----
   The identity modes are 60 numbers learned from a few hundred scans: a chin longer or further forward
   than theirs, a squarer jaw — a face unlike the scans — they reach only part of the way (a chin 13 mm
   forward came out 5 mm short at pogonion and 15 mm short under it). So after the fit the head is bent,
   smoothly in 3D, to pass through what the photos show: every dot the fit used, and in the side photo
   its outline itself — the profile line from the glabella to the neck–chin angle and the jaw line from the
   lower border round the angle up the ramus — each where the head's edge is in that view.
   The bend is a sum of 3D Gaussians (≈ 1, 2.5 and 5 cm) on the constrained vertices: it fades out away
   from them (the back of the head stays the model's) and is least-squares, so dots that disagree between
   the photos meet halfway; one that disagrees by more than ≈ 3 mm counts less and less (res.misfit). */
// (e^(−d²/2σ²) at σ = 5, 2.5 and 1 cm: the one exponential's 4th and 25th powers)
const kern = d2 => { if (d2 > 900) return 0; const e1 = Math.exp(-d2 / 50), e2 = e1 * e1, e4 = e2 * e2, e8 = e4 * e4; return .35 * e8 * e8 * e8 * e1 + e4 + .5 * e1; };
/** Cholesky solve of a symmetric positive definite system (A: n×n Float64Array, row-major; overwritten). */
function cholSolve(A, b, n) {
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= A[j * n + k] * A[j * n + k];
    const d = Math.sqrt(Math.max(s, 1e-12));
    A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let t = A[i * n + j];
      for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = t / d;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i * n + k] * y[k]; y[i] = s / A[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= A[k * n + i] * y[k]; y[i] = s / A[i * n + i]; }
  return y;
}
/** Bend res.X to the views (as given to fit). Changes res.X; leaves res.dX (the bend) and res.misfit. */
function deform(res, views, opt = {}) {
  const t0 = performance.now(), m = model, C = correspond(), N = m.N, nS = m.nSkin, T = C.T, X0 = Float32Array.from(res.X), lam = opt.lambda ?? .02, P = FM.POINTS;
  // each view's outline chains: the side photo's profile (glabella → neck–chin angle) and jaw line
  const chains = views.map(V => {
    if (V.view === 'front' || !V.outline) return [];
    const L = V.outline, at = id => L.indexOf(FM.INDEX[id]), out = [];
    const a = at('gl'), b = at('cerv');
    if (a >= 0 && b > a) out.push({ idx: L.slice(a, b + 1), prof: true });
    const j0 = L.findIndex(i => /^jaw2[LR]$/.test(P[i].id)), j1 = L.findIndex(i => /^ramus[LR]$/.test(P[i].id));
    if (j0 >= 0 && j1 > j0) { const sg = Math.sign(P[L[j0]].x); out.push({ idx: L.slice(j0, j1 + 1), cand: v => C.turn[v] && T[3 * v] * sg > 0 }); }
    // the front of the neck below the neck–chin angle (V.neck: its dots in order), lightly — the neck's posture
    // on the head varies more than the face does
    if (V.neck && V.neck.length >= 2) out.push({ idx: V.neck, prof: true, w: .3 });
    return out.map(ch => ({ ...ch, idx: ch.idx.filter(i => V.vis[i]) })).filter(ch => ch.idx.length >= (ch.w ? 2 : 3));
  });
  const onChain = views.map((V, q) => new Set(chains[q].flatMap(ch => ch.idx)));
  // the chains as samples every ≈ 3 mm, each with its outward normal in the photo and a weight (its dots')
  const samples = views.map((V, q) => {
    const s = res.poses[q].s, out = [];
    let cx = 0, cy = 0, k = 0;
    P.forEach((_, i) => { if (V.vis[i]) { cx += V.p[2 * i]; cy += V.p[2 * i + 1]; k++; } });
    cx /= k || 1; cy /= k || 1;
    for (const [ci, ch] of chains[q].entries()) {
      const pts = ch.idx.map(i => ({ x: V.p[2 * i], y: V.p[2 * i + 1] })), ws = ch.idx.map(i => ch.w ?? V.weight(i));
      const seg = i => Math.max(1, Math.round(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) / (.3 * s)));
      const sp = FM.spline(pts, false, seg), wq = [], at = [];
      // (each sample's place on the template too: that far between the two dots it lies between)
      pts.slice(0, -1).forEach((_, i) => { const n = seg(i), A = P[ch.idx[i]], B = P[ch.idx[i + 1]]; for (let t = 0; t < n; t++) { wq.push(ws[i] + (ws[i + 1] - ws[i]) * t / n); at.push([0, 1, 2].map(k => [A.x, A.y, A.z][k] + ([B.x, B.y, B.z][k] - [A.x, A.y, A.z][k]) * t / n)); } });
      wq.push(ws[ws.length - 1]); at.push([P[ch.idx[ch.idx.length - 1]].x, P[ch.idx[ch.idx.length - 1]].y, P[ch.idx[ch.idx.length - 1]].z]);
      for (let t = 1; t < sp.length - 1; t++) {
        let nx = sp[t + 1].y - sp[t - 1].y, ny = -(sp[t + 1].x - sp[t - 1].x);
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        if (nx * (sp[t].x - cx) + ny * (sp[t].y - cy) < 0) { nx = -nx; ny = -ny; }
        out.push({ x: sp[t].x, y: sp[t].y, n: [nx, ny], w: .7 * wq[t], cand: ch.cand, prof: ch.prof, ch: ci, tp: at[t] });
      }
    }
    return out;
  });
  const dX = new Float32Array(3 * N), cur = v => [X0[3 * v] + dX[3 * v], X0[3 * v + 1] + dX[3 * v + 1], X0[3 * v + 2] + dX[3 * v + 2]];
  const proj = (p, pose) => [pose.s * (pose.R[0][0] * p[0] + pose.R[0][1] * p[1] + pose.R[0][2] * p[2]) + pose.t[0], pose.s * (pose.R[1][0] * p[0] + pose.R[1][1] * p[1] + pose.R[1][2] * p[2]) + pose.t[1]];
  // the head's own outline in a view (as bent so far): the skin seen on a ≈ 1 mm grid, and the vertices on its
  // edge — a profile sample is matched to the nearest of them (not the one furthest out along its normal:
  // at the creases — nasion, under the nose, between the lips — that one could be the nose's or a lip's)
  const outlineVerts = pose => {
    const uv = new Float32Array(2 * nS);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let v = 0; v < nS; v++) { const [u, w] = proj(cur(v), pose); uv[2 * v] = u; uv[2 * v + 1] = w; x0 = Math.min(x0, u); y0 = Math.min(y0, w); x1 = Math.max(x1, u); y1 = Math.max(y1, w); }
    const cell = .1 * pose.s, gw = Math.ceil((x1 - x0) / cell) + 3, gh = Math.ceil((y1 - y0) / cell) + 3, cov = new Uint8Array(gw * gh);
    x0 -= cell; y0 -= cell;
    for (let t = 0; t < m.nTri; t++) {
      const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2];
      if (a >= nS || b >= nS || c >= nS) continue;
      const ax = (uv[2 * a] - x0) / cell, ay = (uv[2 * a + 1] - y0) / cell, bx = (uv[2 * b] - x0) / cell, by = (uv[2 * b + 1] - y0) / cell, cx = (uv[2 * c] - x0) / cell, cy = (uv[2 * c + 1] - y0) / cell;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;
      for (let j = Math.max(0, Math.ceil(Math.min(ay, by, cy))); j <= Math.min(gh - 1, Math.floor(Math.max(ay, by, cy))); j++) for (let i = Math.max(0, Math.ceil(Math.min(ax, bx, cx))); i <= Math.min(gw - 1, Math.floor(Math.max(ax, bx, cx))); i++) {
        const l1 = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) / den, l2 = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) / den;
        if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6) cov[j * gw + i] = 1;
      }
    }
    const edge = k => cov[k] && (!cov[k - 1] || !cov[k + 1] || !cov[k - gw] || !cov[k + gw]), out = [];
    for (let v = 0; v < nS; v++) {
      if (C.ear[v]) continue;
      const i = Math.round((uv[2 * v] - x0) / cell), j = Math.round((uv[2 * v + 1] - y0) / cell);
      let on = false;
      for (let dj = -1; dj <= 1 && !on; dj++) for (let di = -1; di <= 1 && !on; di++) { const ii = i + di, jj = j + dj; if (ii > 0 && jj > 0 && ii < gw - 1 && jj < gh - 1 && edge(jj * gw + ii)) on = true; }
      if (on) out.push(v, uv[2 * v], uv[2 * v + 1]);
    }
    return out;
  };
  let rows = [], prev = null;
  for (let it = 0; it < (opt.iters || 3); it++) {
    // the rows (cm): g · d(vertex) should equal e, both in the photo's plane (g: the view's direction in the model frame)
    rows = [];
    views.forEach((V, q) => {
      const pose = res.poses[q], R = pose.R, front = V.view === 'front', s = pose.s;
      for (const o of res.pairs[q] || []) {
        const pt = P[o.i];
        if (!front && pt.mid && onChain[q].has(o.i)) continue;   // (the dots between landmarks on the outline: the samples have them)
        // (in the front photo the landmarks and the outline: project()'s 2D bend lines the rest up with it)
        if (front && !o.n && !pt.lm) continue;
        let vert = o.vert;
        // an edge dot: the vertex furthest out along its normal (on the head as bent so far)
        const cs = o.n ? (front ? C[o.i].cand : C[o.i].scand) : null;
        if (cs) {
          let bv = -Infinity;
          for (const j of cs) { const [u, v] = proj(cur(j), pose); if (!front && Math.abs((o.v - v) * o.n[0] - (o.u - u) * o.n[1]) > s) continue; const sc = u * o.n[0] + v * o.n[1]; if (sc > bv) { bv = sc; vert = j; } }
        }
        const [u, v] = proj(X0.subarray(3 * vert, 3 * vert + 3), pose), eu = (o.u - u) / s, ev = (o.v - v) / s;
        if (o.n) rows.push({ v: vert, g: [0, 1, 2].map(k => o.n[0] * R[0][k] + o.n[1] * R[1][k]), e: eu * o.n[0] + ev * o.n[1], w: o.w, i: o.i, q });
        else if (!front && onChain[q].has(o.i)) {   // (a landmark on the side outline: firmly across it, lightly along)
          const L = chains[q].find(ch => ch.idx.includes(o.i)).idx, k = L.indexOf(o.i), a = L[Math.max(0, k - 1)], b = L[Math.min(L.length - 1, k + 1)];
          let nx = V.p[2 * b + 1] - V.p[2 * a + 1], ny = -(V.p[2 * b] - V.p[2 * a]);
          const l = Math.hypot(nx, ny) || 1, n = [nx / l, ny / l];
          rows.push({ v: vert, g: [0, 1, 2].map(k => n[0] * R[0][k] + n[1] * R[1][k]), e: eu * n[0] + ev * n[1], w: o.w, i: o.i, q });
          rows.push({ v: vert, g: [0, 1, 2].map(k => -n[1] * R[0][k] + n[0] * R[1][k]), e: -eu * n[1] + ev * n[0], w: .3 * o.w, i: o.i, q });
        } else {
          rows.push({ v: vert, g: R[0].slice(), e: eu, w: o.w, i: o.i, q }, { v: vert, g: R[1].slice(), e: ev, w: o.w, i: o.i, q });
        }
      }
      // the outline's samples: the head's edge there — on the profile, the nearest vertex of the head's own
      // outline (across the line counts double: ahead of the sample, not beside it); on the jaw line, of its
      // turn the one furthest out near the line across it
      const OV = samples[q].some(S => S.prof) ? outlineVerts(pose) : null;
      for (const S of samples[q]) {
        let best = -1, bv = -Infinity;
        if (S.prof) {
          let bd = (3 * s) ** 2;
          // (any of the outline's vertices, not only the midline's: under the chin the skin beside it hangs lower)
          for (let k = 0; k < OV.length; k += 3) {
            const du = OV[k + 1] - S.x, dv = OV[k + 2] - S.y, al = du * S.n[0] + dv * S.n[1], pe = dv * S.n[0] - du * S.n[1], d = al * al + 4 * pe * pe;
            if (d < bd) { bd = d; best = OV[k]; }
          }
        } else for (let j = 0; j < nS; j++) {
          if (!S.cand(j)) continue;
          const [u, v] = proj(cur(j), pose), du = u - S.x, dv = v - S.y, along = du * S.n[0] + dv * S.n[1];
          if (Math.abs(dv * S.n[0] - du * S.n[1]) > .25 * s || Math.abs(along) > 2.5 * s) continue;
          if (along > bv) { bv = along; best = j; }
        }
        // no edge there — the ramus's back edge up to the ear lobe isn't one (the head's side faces out
        // smoothly): the skin at the sample's anatomical place, held to the photo's line across it
        if (best < 0 && !S.prof && S.tp) {
          if (S.v == null) { let bd = Infinity; S.v = -1; for (let j = 0; j < nS; j++) { if (C.ear[j] || C.neck[j]) continue; const d = (T[3 * j] - S.tp[0]) ** 2 + (T[3 * j + 1] - S.tp[1]) ** 2 + (T[3 * j + 2] - S.tp[2]) ** 2; if (d < bd) { bd = d; S.v = j; } } }
          best = S.v;
        }
        if (best < 0) continue;
        const [u, v] = proj(X0.subarray(3 * best, 3 * best + 3), pose);
        rows.push({ v: best, g: [0, 1, 2].map(k => S.n[0] * R[0][k] + S.n[1] * R[1][k]), e: ((S.x - u) * S.n[0] + (S.y - v) * S.n[1]) / s, w: S.w, q, at: S });
      }
    });
    // depths set by hand (opt.pins: { v, depth — toward the front camera, model cm — w }): firmly, the head bends to them
    const R0 = res.poses[0].R;
    for (const p of opt.pins || []) {
      const v = p.v, d0 = -(R0[2][0] * X0[3 * v] + R0[2][1] * X0[3 * v + 1] + R0[2][2] * X0[3 * v + 2]);
      rows.push({ v, g: R0[2].map(c => -c), e: p.depth - d0, w: p.w ?? 2, i: p.i, q: 0, pin: true });
    }
    // (robust: a row the last bend still missed by more than 3 mm — a dot the other photo disagrees with — counts less)
    if (prev) for (const r of rows) { if (r.pin) continue; const d = prev(r.v), e = Math.abs(r.e - (r.g[0] * d[0] + r.g[1] * d[1] + r.g[2] * d[2])); if (e > .3) r.w *= .3 / e; }
    // per row vertex: Σ w g gᵀ and Σ w e g
    const rv = new Map();
    for (const r of rows) {
      if (!(r.w > 0)) continue;
      let o = rv.get(r.v);
      if (!o) rv.set(r.v, o = { G: new Float64Array(9), B: new Float64Array(3) });
      for (let x = 0; x < 3; x++) { o.B[x] += r.w * r.e * r.g[x]; for (let y = 0; y < 3; y++) o.G[3 * x + y] += r.w * r.g[x] * r.g[y]; }
    }
    // the centres: the rows' vertices, one per ≈ 4 mm cell; normal equations (Σ w (k_v ⊗ g)ᵀ(k_v ⊗ g) + λ K ⊗ I) a = Σ w e (k_v ⊗ g)
    const cell = new Set(), cv = [];
    const cs = opt.cell || .6;   // (≈ 6 mm: as close as 4 mm on test heads, in two thirds of the time)
    for (const v of rv.keys()) { const key = `${Math.round(X0[3 * v] / cs)},${Math.round(X0[3 * v + 1] / cs)},${Math.round(X0[3 * v + 2] / cs)}`; if (!cell.has(key)) { cell.add(key); cv.push(v); } }
    const nc = cv.length, n3 = 3 * nc;
    if (!nc) break;
    const CX = new Float64Array(3 * nc);
    cv.forEach((v, c) => { CX[3 * c] = X0[3 * v]; CX[3 * c + 1] = X0[3 * v + 1]; CX[3 * c + 2] = X0[3 * v + 2]; });
    const kvec = (p, out) => { for (let c = 0; c < nc; c++) out[c] = kern((CX[3 * c] - p[0]) ** 2 + (CX[3 * c + 1] - p[1]) ** 2 + (CX[3 * c + 2] - p[2]) ** 2); return out; };
    const A = new Float64Array(n3 * n3), rhs = new Float64Array(n3), kv = new Float64Array(nc);
    for (const [v, o] of rv) {
      kvec(X0.subarray(3 * v, 3 * v + 3), kv);
      const Gc = o.G;
      for (let a = 0; a < nc; a++) {
        const ka = kv[a];
        for (let x = 0; x < 3; x++) rhs[3 * a + x] += ka * o.B[x];
        for (let b = 0; b <= a; b++) { const kab = ka * kv[b]; for (let x = 0; x < 3; x++) { const row = (3 * a + x) * n3 + 3 * b; A[row] += kab * Gc[3 * x]; A[row + 1] += kab * Gc[3 * x + 1]; A[row + 2] += kab * Gc[3 * x + 2]; } }
      }
    }
    for (let a = 0; a < nc; a++) for (let b = 0; b <= a; b++) { const k = lam * kern((CX[3 * a] - CX[3 * b]) ** 2 + (CX[3 * a + 1] - CX[3 * b + 1]) ** 2 + (CX[3 * a + 2] - CX[3 * b + 2]) ** 2); for (let x = 0; x < 3; x++) A[(3 * a + x) * n3 + 3 * b + x] += k; }
    for (let i = 0; i < n3; i++) { A[i * n3 + i] += 1e-6; for (let j = i + 1; j < n3; j++) A[i * n3 + j] = A[j * n3 + i]; }
    const coef = cholSolve(A, rhs, n3);
    for (let v = 0; v < N; v++) {
      kvec(X0.subarray(3 * v, 3 * v + 3), kv);
      let dx = 0, dy = 0, dz = 0;
      for (let c = 0; c < nc; c++) { const k = kv[c]; dx += k * coef[3 * c]; dy += k * coef[3 * c + 1]; dz += k * coef[3 * c + 2]; }
      dX[3 * v] = dx; dX[3 * v + 1] = dy; dX[3 * v + 2] = dz;
    }
    prev = v => [dX[3 * v], dX[3 * v + 1], dX[3 * v + 2]];
  }
  for (let i = 0; i < 3 * N; i++) res.X[i] = X0[i] + dX[i];
  // what's left per dot (mm, worst row): where the photos and the head still disagree
  const mis = new Map();
  const wOf = new Map(views.map((V, q) => (res.pairs[q] || []).map(o => [`${q}:${o.i}`, o.w])).flat());
  for (const r of rows) { if (r.i == null) continue; const d = [dX[3 * r.v], dX[3 * r.v + 1], dX[3 * r.v + 2]], e = Math.abs(r.e - (r.g[0] * d[0] + r.g[1] * d[1] + r.g[2] * d[2])) * 10, key = `${r.q}:${r.i}`; if (!(mis.get(key) >= e)) mis.set(key, e); }
  res.dX = dX;
  res.bendMs = performance.now() - t0;
  // (the outline's samples: where, and what's left — mm across the outline, + = the head inside it)
  res.outline = rows.filter(r => r.at).map(r => ({ x: r.at.x, y: r.at.y, q: r.q, ch: r.at.ch, v: r.v, mm: 10 * (r.e - (r.g[0] * dX[3 * r.v] + r.g[1] * dX[3 * r.v + 1] + r.g[2] * dX[3 * r.v + 2])) }));
  res.misfit = [...mis].map(([k, e]) => { const [q, i] = k.split(':').map(Number); return { q, i, mm: e, w: wOf.get(k) || 0 }; }).sort((a, b) => b.mm - a.mm);
  return res;
}

/**
 * The fitted head seen in a view's photo: per vertex its photo position (px) and depth toward the camera
 * (cm, forward from the ear plane — measured at the dot `ear`, the tragion's vertex, or the template's).
 */
function project(res, q = 0, earDot = 'traL', opt = {}) {
  const m = model, p = res.poses[q], R = p.R, X = res.X, uv = new Float32Array(m.N * 2), z = new Float32Array(m.N);
  for (let i = 0; i < m.N; i++) {
    const x = X[3 * i], y = X[3 * i + 1], w = X[3 * i + 2];
    uv[2 * i] = p.s * (R[0][0] * x + R[0][1] * y + R[0][2] * w) + p.t[0];
    uv[2 * i + 1] = p.s * (R[1][0] * x + R[1][1] * y + R[1][2] * w) + p.t[1];
    z[i] = -(R[2][0] * x + R[2][1] * y + R[2][2] * w);   // toward the camera
  }
  const C = correspond(), ei = FM.INDEX[earDot], ev = ei != null && C[ei] ? C[ei].v : -1;
  const z0 = ev >= 0 ? z[ev] : 0;
  for (let i = 0; i < m.N; i++) z[i] -= z0;
  // What the model couldn't fit is taken up in the photo's plane: a smooth 2D bend through the eye,
  // nose, lip and ear dots and the face's outline, so they line up with the photo (the face's edge where
  // the photo's is, not the model's; its ears where the photo's are — else the photo's ear was painted on
  // the skull beside the model's); the depth stays the fitted head's. (Not through every dot: the soft
  // lines in between don't agree with each other closely enough, and bending through them put lumps in
  // the cheeks.) opt.all: through every dot (only for looking a photo's colours up, never for shape).
  // (opt.noBend: the head as it is, for its shape — the bend is only for where the photo's colours lie on it)
  const L = !opt.noBend && res.pairs && res.pairs[q];
  if (L && L.length > 3) {
    const ctl = [], seen = new Set();
    for (const o of L) {
      const pt = FM.POINTS[o.i], edge = !!C[o.i].cand || !!o.sc;
      if (seen.has(o.vert) || !(opt.all || edge || (!pt.mid && /^(eyes|nose|lips|ears)$/.test(pt.group))) || /^(pu|irI|irO)$/.test(pt.id.replace(/[LR]$/, ''))) continue;
      seen.add(o.vert); ctl.push(uv[2 * o.vert], uv[2 * o.vert + 1], o.u, o.v);
    }
    if (ctl.length >= 24) {
      const span = Math.max(...L.map(o => o.u)) - Math.min(...L.map(o => o.u)) || 1, T = FM.tpsFit(ctl, ctl.length / 4, span, 2e-2);
      for (let i = 0; i < m.N; i++) { const [x, y] = FM.tpsEval(T, uv[2 * i], uv[2 * i + 1]); uv[2 * i] = x; uv[2 * i + 1] = y; }
    }
  }
  return { uv, z, s: p.s };
}
/** Rasterise the projected head (front-most surface) onto a grid: depth (cm) per node, NaN where it isn't.
    opt.noNeck: without the neck and the underside of the jaw. */
function raster(P, grid, which = 'all', opt = {}) {
  const m = model, { x0, y0, cell, gw, gh } = grid, out = new Float32Array(gw * gh).fill(NaN), tri = m.tri, uv = P.uv, z = P.z;
  for (let t = 0; t < m.nTri; t++) {
    const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    if (which === 'skin' && (a >= m.nSkin || b >= m.nSkin || c >= m.nSkin)) continue;
    if (opt.noNeck && (corr.neck[a] || corr.neck[b] || corr.neck[c])) continue;
    const ax = (uv[2 * a] - x0) / cell, ay = (uv[2 * a + 1] - y0) / cell, bx = (uv[2 * b] - x0) / cell, by = (uv[2 * b + 1] - y0) / cell, cx = (uv[2 * c] - x0) / cell, cy = (uv[2 * c + 1] - y0) / cell;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    // (only the side facing the camera: the lips' and nostrils' insides showed through as slits)
    if (Math.abs(den) < 1e-9 || den * (P.flip || 1) > 0) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(gw - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), j1 = Math.min(gh - 1, Math.floor(Math.max(ay, by, cy)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l1 = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) / den, l2 = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const d = l1 * z[a] + l2 * z[b] + l3 * z[c], k = j * gw + i;
      if (!(out[k] >= d)) out[k] = d;
    }
  }
  // the gaps inside it (the lips' slit, the nostrils — the mouth and nose cavities aren't in the model)
  // filled from around them; what's outside the head stays empty
  const outside = new Uint8Array(gw * gh), stack = [];
  for (let i = 0; i < gw; i++) { stack.push(i, (gh - 1) * gw + i); }
  for (let j = 0; j < gh; j++) { stack.push(j * gw, j * gw + gw - 1); }
  while (stack.length) {
    const k = stack.pop();
    if (outside[k] || Number.isFinite(out[k])) continue;
    outside[k] = 1;
    const i = k % gw, j = (k / gw) | 0;
    if (i > 0) stack.push(k - 1); if (i < gw - 1) stack.push(k + 1); if (j > 0) stack.push(k - gw); if (j < gh - 1) stack.push(k + gw);
  }
  for (let pass = 0; pass < 200; pass++) {
    let left = 0;
    const nxt = Float32Array.from(out);
    for (let k = 0; k < gw * gh; k++) {
      if (Number.isFinite(out[k]) || outside[k]) continue;
      const i = k % gw, j = (k / gw) | 0;
      let s = 0, n = 0;
      for (const q of [i > 0 ? k - 1 : -1, i < gw - 1 ? k + 1 : -1, j > 0 ? k - gw : -1, j < gh - 1 ? k + gw : -1]) if (q >= 0 && Number.isFinite(out[q])) { s += out[q]; n++; }
      if (n) nxt[k] = s / n; else left++;
    }
    out.set(nxt);
    if (!left) break;
  }
  // and softened a little (≈ 1 mm): the scan's triangles and pores aren't this face's
  if (opt.smooth !== 0) {
    const r = Math.max(1, Math.round((opt.smooth || .1) * (P.s || 30) / cell)), tmp = Float32Array.from(out);
    for (let pass = 0; pass < 2; pass++) for (const [di, dj] of [[1, 0], [0, 1]]) {
      const src = Float32Array.from(tmp);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        if (!Number.isFinite(src[k])) continue;
        let s = 0, n = 0;
        for (let d = -r; d <= r; d++) { const ii = i + d * di, jj = j + d * dj; if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue; const v = src[jj * gw + ii]; if (Number.isFinite(v)) { s += v; n++; } }
        tmp[k] = s / n;
      }
    }
    out.set(tmp);
  }
  return out;
}

/* ---- the skin as a surface: neighbours, mirror images, normals ---- */
let topo = null;
/** Per skin vertex: its neighbours (CSR: off, nb), its edges' mean length (cm) and its mirror image across
    the midline (the skin vertex nearest to it reflected). Cached. */
function topology() {
  if (topo) return topo;
  const m = model, nS = m.nSkin, V = m.neu, E = new Set();
  for (let t = 0; t < m.nTri; t++) {
    const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2];
    if (a >= nS || b >= nS || c >= nS) continue;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) E.add(p < q ? p * nS + q : q * nS + p);
  }
  const off = new Int32Array(nS + 1);
  for (const e of E) { off[Math.floor(e / nS) + 1]++; off[e % nS + 1]++; }
  for (let i = 0; i < nS; i++) off[i + 1] += off[i];
  const nb = new Int32Array(off[nS]), fill = off.slice(0, nS), len = new Float32Array(nS);
  for (const e of E) {
    const a = Math.floor(e / nS), b = e % nS, d = Math.hypot(V[3 * a] - V[3 * b], V[3 * a + 1] - V[3 * b + 1], V[3 * a + 2] - V[3 * b + 2]);
    nb[fill[a]++] = b; nb[fill[b]++] = a; len[a] += d; len[b] += d;
  }
  for (let i = 0; i < nS; i++) len[i] /= Math.max(1, off[i + 1] - off[i]);
  // the mirror images (on a hash grid of the neutral head, which is symmetric about x = 0)
  const g = .6, cellOf = (x, y, z) => `${Math.floor(x / g)},${Math.floor(y / g)},${Math.floor(z / g)}`, grid = new Map();
  for (let i = 0; i < nS; i++) { const k = cellOf(V[3 * i], V[3 * i + 1], V[3 * i + 2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const mir = new Int32Array(nS);
  for (let i = 0; i < nS; i++) {
    const x = -V[3 * i], y = V[3 * i + 1], z = V[3 * i + 2], cx = Math.floor(x / g), cy = Math.floor(y / g), cz = Math.floor(z / g);
    let best = i, bd = Infinity;
    for (let r = 1; r <= 3 && bd === Infinity; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const L = grid.get(`${cx + a},${cy + b},${cz + c}`);
      if (L) for (const j of L) { const d = (V[3 * j] - x) ** 2 + (V[3 * j + 1] - y) ** 2 + (V[3 * j + 2] - z) ** 2; if (d < bd) { bd = d; best = j; } }
    }
    mir[i] = best;
  }
  topo = { off, nb, len, mir };
  return topo;
}
/** Unit normals of the skin, pointing out of the head, for vertex positions X (the model's frame). */
function normals(X) {
  const m = model, nS = m.nSkin, n = new Float32Array(nS * 3);
  for (let t = 0; t < m.nTri; t++) {
    const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2];
    if (a >= nS || b >= nS || c >= nS) continue;
    const ux = X[3 * b] - X[3 * a], uy = X[3 * b + 1] - X[3 * a + 1], uz = X[3 * b + 2] - X[3 * a + 2], vx = X[3 * c] - X[3 * a], vy = X[3 * c + 1] - X[3 * a + 1], vz = X[3 * c + 2] - X[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { n[3 * v] += nx; n[3 * v + 1] += ny; n[3 * v + 2] += nz; }
  }
  const ip = LM68[30], sg = n[3 * ip + 2] < 0 ? -1 : 1;   // (the nose tip's points forward)
  for (let i = 0; i < nS; i++) { const L = sg / (Math.hypot(n[3 * i], n[3 * i + 1], n[3 * i + 2]) || 1); n[3 * i] *= L; n[3 * i + 1] *= L; n[3 * i + 2] *= L; }
  return n;
}

window.CraniHead = { load, fit, deform, project, raster, correspond, topology, normals, get model() { return model; }, build: '46' };
})();
