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
  // … nor an ear's (at the jaw angle the ear lobe reaches further out)
  const earPts = P.filter(p => p.group === 'ears' && p.x > 0), ear = new Uint8Array(m.N);
  for (let i = 0; i < nS; i++) { const x = Math.abs(T[3 * i]), y = T[3 * i + 1], z = T[3 * i + 2]; if (earPts.some(p => (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 < 1.2 * 1.2)) ear[i] = 1; }
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
          const P = vert(o.vert), Y = [0, 1, 2].map(r => p.R[r][0] * P[0] + p.R[r][1] * P[1] + p.R[r][2] * P[2]);
          const eu = o.u - (p.s * Y[0] + p.t[0]), ev = o.v - (p.s * Y[1] + p.t[1]), w = o.w / (p.s * p.s);
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
  return { c: Array.from(c), poses, X: Float32Array.from(X), rms, pairs: obs.map(L => L.map(o => ({ i: o.i, vert: o.vert, u: o.u, v: o.v, w: o.w }))) };
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
  const L = res.pairs && res.pairs[q];
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

window.CraniHead = { load, fit, project, raster, correspond, topology, normals, get model() { return model; }, build: '33' };
})();
