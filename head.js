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
    // the expressions (ICT's blendshapes, 0…1 each), if the file has them
    const exprNames = H.expr || [], E = new Float32Array(exprNames.length * N * 3);
    for (let e = 0; e < exprNames.length; e++) { const q = new Int8Array(buf, o, N * 3), sc = H.escales[e]; for (let i = 0; i < N * 3; i++) E[e * N * 3 + i] = q[i] * sc; o += N * 3; }
    model = { N, nSkin: H.nSkin, nTri: nt, K, neu, tri, D, E, exprNames };
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
    if (/^(pu|irI|irO|cor1)$/.test(base)) return { v: near(p, nS, m.N, j => T[3 * j + 2] > pt.z - 1) };
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
/* A photo's camera (a pose): s (px per cm at the model's origin), R, t — and f, the lens's focal length (px),
   when the photo says what it was (else it's seen from afar: no perspective). With the camera at f / s cm from
   the origin, a point nearer to it by ζ cm is enlarged by k = f / (f − s ζ): ≈ 1.25 at the nose tip from 45 cm. */
/** A model-frame point in a pose's photo: [u, v, k (the enlargement there), Y (the point turned into the camera's frame)]. */
function projK(pose, P) {
  const R = pose.R, Y = [0, 1, 2].map(r => R[r][0] * P[0] + R[r][1] * P[1] + R[r][2] * P[2]), k = pose.f ? pose.f / (pose.f + pose.s * Y[2]) : 1;
  return [pose.s * k * Y[0] + pose.t[0], pose.s * k * Y[1] + pose.t[1], k, Y];
}
/** How (u, v) / s move per cm the point moves (model frame): two 3-vectors. */
function projJ(pose, P) {
  const [, , k, Y] = projK(pose, P), R = pose.R, a = pose.f ? k * pose.s / pose.f : 0;
  return [0, 1].map(r => [0, 1, 2].map(j => k * (R[r][j] - a * Y[r] * R[2][j])));
}
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
  // Each photo's expression (ICT's blendshapes, 0…1): the face is one, but a photo's lids, mouth corners and
  // lips are as it caught them — fitted with the identity alone, the head took the eyes' and the mouth's
  // set into its own shape (eyes 2 mm too tall and sunk deeper, the corners of the mouth turned down).
  // Held near none (lamE) and left like right (lamLR); the brows' aren't fitted (their dots aren't used). The
  // ones that part or purse the lips only for a side photo, and not tied to the front's: on the front photo
  // (its head is the one shown) they traded the lips' thickness for a gap between them, but a side photo's
  // lips set otherwise — 4 mm higher on a real pair — had lifted the head's lips off the front photo's.
  const LIPS = /^mouth(LowerDown|UpperUp|Pucker|Funnel)/;
  // (not the eyes' — blink, wide, squint: since the head follows the front map across the photo (alignFront) the
  // lids land on its dots anyway, and a half blink only folded the upper lid in depth, a crease under the outer
  // brow that the face didn't have)
  const EX = opt.expr === false ? [] : m.exprNames.map((nm, j) => ({ nm, j })).filter(o => (opt.exprRe || /^(cheekSquint|mouth(Smile|Frown|Stretch|Press|Dimple|LowerDown|UpperUp|Pucker|Funnel))/).test(o.nm));
  const nE = EX.length, lamE = opt.lamE ?? .05, lamLR = opt.lamLR ?? .2, lamS = opt.lamS ?? lamLR, nV = views.length;
  const twin = EX.map(o => EX.findIndex(p => p.nm === o.nm.replace(/_L$/, '_R')) ).map((t, a) => /_L$/.test(EX[a].nm) ? t : -1);
  const ex = views.map(() => new Float64Array(nE)), OFF = views.map(() => new Float32Array(3 * N));
  const exprOff = q => { const o = OFF[q]; o.fill(0); for (let a = 0; a < nE; a++) { const w = ex[q][a]; if (!w) continue; const off = EX[a].j * N * 3; for (let i = 0; i < 3 * N; i++) o[i] += w * m.E[off + i]; } };
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
      // (opt.profileAlong: a side photo's profile dots firmly across the profile and only that much along it —
      // tried on a real pair whose mouths sat 4 mm apart, it changed nothing: off by default)
      else if (sn && sn.has(i) && pt.side === 0 && opt.profileAlong != null) { o.n = sn.get(i); o.al = opt.profileAlong; }
      list.push(o);
    });
    return list;
  });
  // a dot's residual and its rows (cm): two for a dot, one (along the outline's normal) for an edge dot
  const rows = (o, eu, ev, Ju, Jv) => {
    if (!o.n) return [[eu, Ju], [ev, Jv]];
    const [a, b] = o.n, out = [[eu * a + ev * b, Ju.map((x, q) => x * a + Jv[q] * b)]];
    if (o.al) { const r = Math.sqrt(o.al); out.push([r * (-eu * b + ev * a), Ju.map((x, q) => r * (-x * b + Jv[q] * a))]); }
    return out;
  };
  // starting poses: the nominal view, scale and shift from the dots
  const poses = views.map((V, q) => {
    const R0 = VIEW_R[V.view] || VIEW_R.front, L = obs[q];
    let sw = 0, mu = 0, mv = 0, mx = 0, my = 0, sxx = 0, sux = 0;
    for (const o of L) { const P = [m.neu[3 * o.vert], m.neu[3 * o.vert + 1], m.neu[3 * o.vert + 2]], y = [0, 1].map(r => R0[r][0] * P[0] + R0[r][1] * P[1] + R0[r][2] * P[2]); sw += o.w; mu += o.w * o.u; mv += o.w * o.v; mx += o.w * y[0]; my += o.w * y[1]; o._y = y; }
    mu /= sw; mv /= sw; mx /= sw; my /= sw;
    for (const o of L) { sxx += o.w * ((o._y[0] - mx) ** 2 + (o._y[1] - my) ** 2); sux += o.w * ((o._y[0] - mx) * (o.u - mu) + (o._y[1] - my) * (o.v - mv)); }
    const s = sux / sxx;
    // (V.f: the lens, px; or V.dist: the camera's distance from the head's middle, cm — the lens follows the scale)
    return { s, R: R0, t: [mu - s * mx, mv - s * my], f: V.f || (V.dist ? V.dist * s : 0) };
  });
  const proj = (P, pose) => projK(pose, P);
  // (a vertex as photo q caught it: the identity's shape and that photo's expression)
  const vert = (q, i) => [X[3 * i] + OFF[q][3 * i], X[3 * i + 1] + OFF[q][3 * i + 1], X[3 * i + 2] + OFF[q][3 * i + 2]];
  // the silhouette dots: the candidate furthest out along the outline's normal (in this view's photo); in a
  // side photo, of the jaw line's turn within ≈ 1 cm of the dot along the line
  const march = q => {
    const front = views[q].view === 'front', p = poses[q];
    for (const o of obs[q]) {
      const cs = front ? C[o.i].cand : o.sc;
      if (!cs || !o.n) continue;
      let best = o.vert, bv = -Infinity;
      for (const j of cs) {
        const [u, v] = proj(vert(q, j), p);
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
    for (let q = 0; q < nV; q++) exprOff(q);
    // 1 · each photo's pose (Gauss–Newton on scale, rotation, shift; held near its nominal view)
    views.forEach((V, q) => {
      march(q);
      for (let g = 0; g < 3; g++) {
        const p = poses[q], A = Array.from({ length: 6 }, () => new Array(6).fill(0)), b = new Array(6).fill(0);
        for (const o of obs[q]) {
          // (in a side photo the pose is read off the upper face — eyes, nose, ears: the jaw, chin and lips are
          // where faces differ most from the scans, and fitted with the modes' guess of them they tilted the
          // whole head a few degrees to make up for a chin they couldn't reach)
          // (with a lens, the enlargement k's own change left out of the steps: they're a little short, not wrong)
          const P = vert(q, o.vert), [pu, pv, k, Y] = projK(p, P);
          const eu = o.u - pu, ev = o.v - pv, w = o.w * (V.view !== 'front' && (FM.POINTS[o.i].y > .3 || SIDE_EDGE.test(FM.POINTS[o.i].id)) ? .05 : 1) / (p.s * p.s);
          const Ju = [k * Y[0], 0, p.s * k * Y[2], -p.s * k * Y[1], 1, 0], Jv = [k * Y[1], -p.s * k * Y[2], 0, p.s * k * Y[0], 0, 1];
          for (const [e, Jr] of rows(o, eu, ev, Ju, Jv)) for (let a = 0; a < 6; a++) { b[a] += w * Jr[a] * e; for (let f = 0; f < 6; f++) A[a][f] += w * Jr[a] * Jr[f]; }
        }
        // (rotation held near the nominal view: the side photo's midline dots alone don't pin its yaw)
        const sw = obs[q].reduce((s, o) => s + o.w, 0) || 1;
        for (let a = 1; a < 4; a++) A[a][a] += sw * .02 * p.s * p.s;
        for (let a = 0; a < 6; a++) A[a][a] += 1e-9;
        const d = solve(A, b);
        p.s += d[0]; p.R = mul3(rotSmall([d[1], d[2], d[3]]), p.R); p.t = [p.t[0] + d[4], p.t[1] + d[5]];
        if (V.dist && !V.f) p.f = V.dist * p.s;
      }
    });
    // 2 · the identity and each photo's expression, given the poses (linear least squares with their priors;
    // the unknowns: K identity weights, then nE expression weights per photo)
    const n = K + nV * nE, A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n), J = new Float64Array(2 * n), nz = [];
    let se = 0, sw = 0;
    views.forEach((V, q) => {
      const p = poses[q], e0 = K + q * nE;
      for (const o of obs[q]) {
        const P = vert(q, o.vert), [pu, pv] = proj(P, p), [gu, gv] = projJ(p, P);
        let eu = (o.u - pu) / p.s, ev = (o.v - pv) / p.s;
        nz.length = 0;
        for (let k = 0; k < K; k++) {
          const off = k * N * 3 + 3 * o.vert, dx = m.D[off], dy = m.D[off + 1], dz = m.D[off + 2];
          J[2 * k] = gu[0] * dx + gu[1] * dy + gu[2] * dz; J[2 * k + 1] = gv[0] * dx + gv[1] * dy + gv[2] * dz; nz.push(k);
        }
        for (let a = 0; a < nE; a++) {
          const off = EX[a].j * N * 3 + 3 * o.vert, dx = m.E[off], dy = m.E[off + 1], dz = m.E[off + 2];
          if (!dx && !dy && !dz) continue;
          const k = e0 + a; J[2 * k] = gu[0] * dx + gu[1] * dy + gu[2] * dz; J[2 * k + 1] = gv[0] * dx + gv[1] * dy + gv[2] * dz; nz.push(k);
        }
        if (o.n) {   // (an edge dot: along the normal only — a profile dot: and lightly along the line, o.al)
          const [na, nb] = o.n, r = Math.sqrt(o.al || 0);
          [eu, ev] = [eu * na + ev * nb, r * (-eu * nb + ev * na)];
          for (const k of nz) { const ju = J[2 * k], jv = J[2 * k + 1]; J[2 * k] = ju * na + jv * nb; J[2 * k + 1] = r * (-ju * nb + jv * na); }
        }
        se += o.w * (eu * eu + ev * ev); sw += o.w;
        for (const k of nz) {
          b[k] += o.w * (J[2 * k] * eu + J[2 * k + 1] * ev);
          for (const l of nz) if (l <= k) A[k][l] += o.w * (J[2 * k] * J[2 * l] + J[2 * k + 1] * J[2 * l + 1]);
        }
      }
    });
    rms = Math.sqrt(se / Math.max(1e-9, sw));
    // Gauss–Newton step with the priors: Σ c² (in cm²: the dots' scatter λ); each expression λE e², its left
    // and right alike λLR (eL − eR)²; and a side photo's like the front's (λLR too: it shows the face a moment apart)
    const M = Array.from({ length: n }, (_, k) => Array.from({ length: n }, (_, l) => l <= k ? A[k][l] : A[l][k]));
    const x = [...c, ...ex.flatMap(e => [...e])], rhs = Array.from(b);
    const tie = (i, j, w) => { M[i][i] += w; M[j][j] += w; M[i][j] -= w; M[j][i] -= w; const d = x[i] - x[j]; rhs[i] -= w * d; rhs[j] += w * d; };
    for (let k = 0; k < K; k++) { M[k][k] += lam; rhs[k] -= lam * c[k]; }
    for (let q = 0; q < nV; q++) for (let a = 0; a < nE; a++) {
      const k = K + q * nE + a, lips = LIPS.test(EX[a].nm), l = !q && lips ? 1e4 : lamE;
      M[k][k] += l; rhs[k] -= l * x[k];
      if (twin[a] >= 0) tie(k, K + q * nE + twin[a], lamLR);
      if (q && !lips) tie(k, K + a, lamS);
    }
    // (an expression's weight stays within 0…1: one the step would take past a bound is held there and the
    // rest solved again — clamped after the step instead, the others' share of it was lost: a blink that
    // made up for a squint taken past 1 stayed, and the lids came out further off than without expressions)
    const held = new Map();
    let dx = null;
    for (let round = 0; round < 8; round++) {
      const free = [];
      for (let k = 0; k < n; k++) if (!held.has(k)) free.push(k);
      const r2 = free.map(k => { let v = rhs[k]; for (const [h, d] of held) v -= M[k][h] * d; return v; });
      const sol = solve(free.map(k => free.map(l => M[k][l])), r2);
      dx = new Float64Array(n);
      for (const [h, d] of held) dx[h] = d;
      free.forEach((k, i) => { dx[k] = sol[i]; });
      let more = false;
      for (const k of free) if (k >= K) { const v = x[k] + dx[k]; if (v < -1e-6 || v > 1 + 1e-6) { held.set(k, (v < 0 ? 0 : 1) - x[k]); more = true; } }
      if (!more) break;
    }
    for (let k = 0; k < K; k++) c[k] = Math.max(-cmax, Math.min(cmax, c[k] + dx[k]));
    for (let q = 0; q < nV; q++) for (let a = 0; a < nE; a++) ex[q][a] = Math.max(0, Math.min(1, ex[q][a] + dx[K + q * nE + a]));
  }
  shape();
  for (let q = 0; q < nV; q++) exprOff(q);
  views.forEach((V, q) => march(q));
  // X: the head as the front photo caught it (its expression too); exOff[q]: how photo q's differs from that
  const Xf = Float32Array.from(X, (v, i) => v + OFF[0][i]);
  const exOff = views.map((V, q) => q && nE ? Float32Array.from(OFF[q], (v, i) => v - OFF[0][i]) : null);
  const expr = ex.map(e => Object.fromEntries(EX.map((o, a) => [o.nm, +e[a].toFixed(3)]).filter(([, v]) => v > .01)));
  // (a profile dot hands on no normal: the bend holds it across and along the profile itself)
  return { c: Array.from(c), poses, X: Xf, exOff, expr, rms, pairs: obs.map(L => L.map(o => ({ i: o.i, vert: o.vert, u: o.u, v: o.v, w: o.w, n: o.al ? null : o.n, sc: !!o.sc }))) };
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
// (e^(−d²/2σ²) at σ = 5, 2.5 and 1 cm: the one exponential's 4th and 25th powers; KW: their weights, the 1 cm one,
// the 2.5 cm and the 5 cm. The 1 cm one is off: on a real face it put dents and humps into the jaw and a dent
// in the chin — the head's own shape holds there, and the broad ones still carry a chin set further forward)
let KW = [0, 1, .5];
const kern = d2 => { if (d2 > 900) return 0; const e1 = Math.exp(-d2 / 50), e2 = e1 * e1, e4 = e2 * e2, e8 = e4 * e4; return (KW[0] ? KW[0] * e8 * e8 * e8 * e1 : 0) + KW[1] * e4 + KW[2] * e1; };
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
/**
 * The fine fit, after the bend: the bend's Gaussians are ≈ 1–5 cm, so the shape of a lid, a nostril or a lip
 * stayed the scans' — the photo was then warped onto it, and smeared round the eyes' inner corners and the
 * nose. Here every dot the front photo marks well (the eyes' and lids' lines, the nose, the lips, the outline —
 * not the brows or the hair) and what the bend still misses go into a smooth displacement of the mesh itself:
 * the least bending (its Laplacian, squared) that meets them, screened so it fades ≈ 2 cm from them, solved
 * by conjugate gradients on the skin near the dots. Then the eyeballs follow their lids. Adds to dX.
 */
function fineFit(res, views, X0, dX, rows, opt) {
  // (α 10: tested on a real face, 1 rippled the skin between the dots; ε: the screening)
  const m = model, C = correspond(), N = m.N, nS = m.nSkin, T = topology(), P = FM.POINTS, alpha = opt.fineAlpha ?? 10, eps = opt.fineEps ?? 2e-3;
  const cur = v => [X0[3 * v] + dX[3 * v], X0[3 * v + 1] + dX[3 * v + 1], X0[3 * v + 2] + dX[3 * v + 2]];
  // the rows: the bend's own (what's left of them), and the front photo's other dots as points
  const F = [];
  for (const r of rows) { if (!(r.w > 0) || r.v >= nS) continue; const res0 = r.e - (r.g[0] * dX[3 * r.v] + r.g[1] * dX[3 * r.v + 1] + r.g[2] * dX[3 * r.v + 2]); F.push({ v: r.v, g: r.g, r: res0, w: r.w }); }
  const p0 = res.poses[0], R0 = p0.R;
  for (const o of res.pairs[0] || []) {
    const pt = P[o.i];
    if (o.n || pt.lm || !(o.w > 0) || o.vert >= nS || !(opt.fineGroups || /^(eyes|nose|lips)$/).test(pt.group)) continue;
    const x = cur(o.vert), u = p0.s * (R0[0][0] * x[0] + R0[0][1] * x[1] + R0[0][2] * x[2]) + p0.t[0], v = p0.s * (R0[1][0] * x[0] + R0[1][1] * x[1] + R0[1][2] * x[2]) + p0.t[1];
    F.push({ v: o.vert, g: R0[0].slice(), r: (o.u - u) / p0.s, w: o.w }, { v: o.vert, g: R0[1].slice(), r: (o.v - v) / p0.s, w: o.w });
  }
  // (a dot the bend couldn't bring within 4 mm disagrees with the rest: it counts less)
  for (const f of F) if (Math.abs(f.r) > .4) f.w *= .4 / Math.abs(f.r);
  if (!F.length) return;
  // the skin within ≈ 2 cm of the dots is solved for; beyond, the bend's shape stays
  const cv = [...new Set(F.map(f => f.v))], act = new Int32Array(nS).fill(-1), list = [], R2 = (opt.fineR || 2) ** 2;
  for (let v = 0; v < nS; v++) {
    const x = X0[3 * v], y = X0[3 * v + 1], z = X0[3 * v + 2];
    for (const c of cv) if ((X0[3 * c] - x) ** 2 + (X0[3 * c + 1] - y) ** 2 + (X0[3 * c + 2] - z) ** 2 < R2) { act[v] = list.length; list.push(v); break; }
  }
  const n = list.length, n3 = 3 * n, deg = new Float64Array(nS);
  for (let v = 0; v < nS; v++) deg[v] = Math.max(1, T.off[v + 1] - T.off[v]);
  // data: per vertex Σ w g gᵀ and Σ w r g
  const Gd = new Float64Array(9 * n), b = new Float64Array(n3);
  for (const f of F) { const a = act[f.v]; if (a < 0) continue; for (let x = 0; x < 3; x++) { b[3 * a + x] += f.w * f.r * f.g[x]; for (let y = 0; y < 3; y++) Gd[9 * a + 3 * x + y] += f.w * f.g[x] * f.g[y]; } }
  // A u = α LᵀL u + G u + ε u, matrix-free (L: the uniform Laplacian over the solved skin; outside it, 0) —
  // the neighbours as local indices once (with 1 / their degree), not looked up on every product
  const t0 = performance.now(), lo = new Int32Array(n + 1), lnb = [], lw = [], ideg = new Float64Array(n);
  for (let a = 0; a < n; a++) {
    const v = list[a];
    ideg[a] = 1 / deg[v];
    for (let q = T.off[v]; q < T.off[v + 1]; q++) { const k = act[T.nb[q]]; if (k >= 0) { lnb.push(k); lw.push(1 / deg[T.nb[q]]); } }
    lo[a + 1] = lnb.length;
  }
  const NB = Int32Array.from(lnb), NW = Float64Array.from(lw);
  const Lu = new Float64Array(n3), Au = (u, out) => {
    for (let a = 0; a < n; a++) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let q = lo[a]; q < lo[a + 1]; q++) { const k = 3 * NB[q]; s0 += u[k]; s1 += u[k + 1]; s2 += u[k + 2]; }
      const d = ideg[a], o = 3 * a;
      Lu[o] = u[o] - s0 * d; Lu[o + 1] = u[o + 1] - s1 * d; Lu[o + 2] = u[o + 2] - s2 * d;
    }
    for (let a = 0; a < n; a++) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let q = lo[a]; q < lo[a + 1]; q++) { const k = 3 * NB[q], w = NW[q]; s0 += Lu[k] * w; s1 += Lu[k + 1] * w; s2 += Lu[k + 2] * w; }
      const o = 3 * a, g = 9 * a, u0 = u[o], u1 = u[o + 1], u2 = u[o + 2];
      out[o] = alpha * (Lu[o] - s0) + eps * u0 + Gd[g] * u0 + Gd[g + 1] * u1 + Gd[g + 2] * u2;
      out[o + 1] = alpha * (Lu[o + 1] - s1) + eps * u1 + Gd[g + 3] * u0 + Gd[g + 4] * u1 + Gd[g + 5] * u2;
      out[o + 2] = alpha * (Lu[o + 2] - s2) + eps * u2 + Gd[g + 6] * u0 + Gd[g + 7] * u1 + Gd[g + 8] * u2;
    }
  };
  // (Jacobi preconditioner: the diagonal)
  const Md = new Float64Array(n3);
  for (let a = 0; a < n; a++) {
    const v = list[a];
    let s = 1;
    for (let q = T.off[v]; q < T.off[v + 1]; q++) if (act[T.nb[q]] >= 0) s += 1 / deg[T.nb[q]] ** 2;
    for (let x = 0; x < 3; x++) Md[3 * a + x] = 1 / (alpha * s + eps + Gd[9 * a + 4 * x]);
  }
  const u = new Float64Array(n3), r = Float64Array.from(b), z = r.map((v, i) => v * Md[i]), p = Float64Array.from(z), Ap = new Float64Array(n3);
  let rz = 0, b2 = 0;
  for (let i = 0; i < n3; i++) { rz += r[i] * z[i]; b2 += b[i] * b[i]; }
  let it = 0;
  for (; it < (opt.fineIters || 300) && rz > 0; it++) {
    Au(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n3; i++) pAp += p[i] * Ap[i];
    const al = rz / (pAp || 1e-30);
    let r2 = 0;
    for (let i = 0; i < n3; i++) { u[i] += al * p[i]; r[i] -= al * Ap[i]; r2 += r[i] * r[i]; }
    if (r2 < 1e-10 * b2) break;
    let rz1 = 0;
    for (let i = 0; i < n3; i++) { z[i] = r[i] * Md[i]; rz1 += r[i] * z[i]; }
    const be = rz1 / rz;
    rz = rz1;
    for (let i = 0; i < n3; i++) p[i] = z[i] + be * p[i];
  }
  for (let a = 0; a < n; a++) for (let x = 0; x < 3; x++) dX[3 * list[a] + x] += u[3 * a + x];
  // the eyeballs move with the lids round them (their mean shift within 2 cm of each eye's centre)
  for (const sg of [-1, 1]) {
    const c = [0, 0, 0];
    let ne = 0;
    for (let v = nS; v < N; v++) if (Math.sign(X0[3 * v]) === sg) { for (let k = 0; k < 3; k++) c[k] += X0[3 * v + k]; ne++; }
    if (!ne) continue;
    for (let k = 0; k < 3; k++) c[k] /= ne;
    const s = [0, 0, 0];
    let ns = 0;
    for (let a = 0; a < n; a++) { const v = list[a]; if ((X0[3 * v] - c[0]) ** 2 + (X0[3 * v + 1] - c[1]) ** 2 + (X0[3 * v + 2] - c[2]) ** 2 < 4) { for (let k = 0; k < 3; k++) s[k] += u[3 * a + k]; ns++; } }
    if (ns) for (let v = nS; v < N; v++) if (Math.sign(X0[3 * v]) === sg) for (let k = 0; k < 3; k++) dX[3 * v + k] += s[k] / ns;
  }
  res.fine = { n, rows: F.length, it, ms: Math.round(performance.now() - t0) };
}
/**
 * The lips closed (changes res.X): where they meet, the two lips are two surfaces — on the scans 0.8 mm apart at the
 * middle, and on a fitted head 1.3–1.7 mm, which showed as a parted mouth where the photos have it shut. Each pair of
 * points facing each other across the seam (on the neutral head: within 1.6 mm, across it — not near each other along
 * the skin) is drawn together, half way each, and the shift eased into either lip over ≈ 4 mm.
 * Returns the gap closed (mm, the middle's).
 */
let lipPairs = null;
function closeLips(res, opt = {}) {
  const m = model, nS = m.nSkin, V = m.neu, C = correspond(), X = res.X, Tp = topology();
  if (!lipPairs) {
    const sto = C[FM.INDEX.sto] && C[FM.INDEX.sto].v;
    if (!(sto >= 0)) return 0;
    const near = [];
    for (let v = 0; v < nS; v++) if (Math.hypot(V[3 * v] - V[3 * sto], V[3 * v + 1] - V[3 * sto + 1], V[3 * v + 2] - V[3 * sto + 2]) < 3.5) near.push(v);
    // (along the skin: within three rings of each other — those aren't across the seam)
    const ring = v => { const s = new Set([v]); let f = [v]; for (let r = 0; r < 3; r++) { const g = []; for (const u of f) for (let q = Tp.off[u]; q < Tp.off[u + 1]; q++) { const w = Tp.nb[q]; if (!s.has(w)) { s.add(w); g.push(w); } } f = g; } return s; };
    lipPairs = [];
    for (const v of near) {
      const R = ring(v);
      let best = -1, bd = .16 * .16;
      for (const u of near) { if (R.has(u)) continue; const d = (V[3 * u] - V[3 * v]) ** 2 + (V[3 * u + 1] - V[3 * v + 1]) ** 2 + (V[3 * u + 2] - V[3 * v + 2]) ** 2; if (d < bd) { bd = d; best = u; } }
      if (best >= 0 && V[3 * best + 1] < V[3 * v + 1]) lipPairs.push(v, best);   // (v the upper lip's, best the lower's)
    }
  }
  if (!lipPairs.length) return 0;
  // each side's shift: half the pair's gap now, less the neutral's own (which the scans have shut)
  const D = new Float32Array(3 * nS), W = new Float32Array(nS);
  for (let k = 0; k < lipPairs.length; k += 2) {
    const a = lipPairs[k], b = lipPairs[k + 1];
    for (let j = 0; j < 3; j++) { const g = (X[3 * b + j] - X[3 * a + j]) / 2; D[3 * a + j] += g; D[3 * b + j] -= g; }
    W[a]++; W[b]++;
  }
  for (let v = 0; v < nS; v++) if (W[v]) { for (let j = 0; j < 3; j++) D[3 * v + j] /= W[v]; W[v] = 1; }
  // eased into each lip: a few passes of averaging from the seam outward (the seam's own points held)
  const tmp = new Float32Array(3 * nS), held = Uint8Array.from(W);
  for (let pass = 0; pass < (opt.passes ?? 6); pass++) {
    tmp.set(D);
    for (let v = 0; v < nS; v++) {
      if (held[v]) continue;
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (let q = Tp.off[v]; q < Tp.off[v + 1]; q++) { const u = Tp.nb[q]; s0 += D[3 * u]; s1 += D[3 * u + 1]; s2 += D[3 * u + 2]; n++; }
      if (n) { tmp[3 * v] = .7 * s0 / n; tmp[3 * v + 1] = .7 * s1 / n; tmp[3 * v + 2] = .7 * s2 / n; }
    }
    D.set(tmp);
  }
  let mid = 0;
  for (let k = 0; k < lipPairs.length; k += 2) { const a = lipPairs[k]; if (Math.abs(V[3 * a]) < .2) mid = Math.max(mid, 20 * Math.hypot(D[3 * a], D[3 * a + 1], D[3 * a + 2])); }
  for (let v = 0; v < nS; v++) for (let j = 0; j < 3; j++) X[3 * v + j] += D[3 * v + j];
  return (res.lipsClosed = mid);
}
/** Each vertex's mirror image across the head's midline (the skin's from topology(), the eyeballs' by nearest; −1 for none). */
let mirr = null;
function mirrorOf() {
  if (mirr) return mirr;
  const m = model, nS = m.nSkin, N = m.N, V = m.neu, out = new Int32Array(N).fill(-1);
  out.set(topology().mir.subarray(0, nS));
  for (let v = nS; v < N; v++) {
    let best = -1, bd = Infinity;
    for (let u = nS; u < N; u++) { const d = (V[3 * u] + V[3 * v]) ** 2 + (V[3 * u + 1] - V[3 * v + 1]) ** 2 + (V[3 * u + 2] - V[3 * v + 2]) ** 2; if (d < bd) { bd = d; best = u; } }
    out[v] = bd < .01 ? best : -1;
  }
  return (mirr = out);
}
// What the bend uses (see deform), and how much — set from a real face, turning on one kind at a time: the side
// photo's profile, dots and jaw line in full; the front photo's outline lightly (in full it widened the jaw and
// creased the cheeks); its landmarks very lightly (in full they sheared the face — a flat, wide mid-face, pinched
// eyes, lumpy cheeks: the photo's eyes and mouth differ from the scans' by expression, lens and pose, and the
// photo is laid onto the head through its own 2D bend anyway); not the ears (they flared out). Your depths in full.
// Not the side photo's dots off the midline (the cheekbone and the like: how deep they lie is a guess in profile —
// they flattened the cheeks into planes and bulged them out sideways) — but its eye's ('sy': the pupil, the eye's
// corners), the eye's front being what a profile shows plainly: without them the front photo's eyes, fitted by
// the modes, sat 8 mm deeper under the brow than the side photo's on a real pair — a heavy brow, sunken corners.
let ROW_KINDS = ['fp', 'fm', 'fe', 'sp', 'sy', 'sa', 'se', 'ss', 'pin'], ROW_W = { fe: .3, fp: .1, fm: .1 };
/** Bend res.X to the views (as given to fit). Changes res.X; leaves res.dX (the bend) and res.misfit. */
function deform(res, views, opt = {}) {
  // (the bend's scales: 2.5 cm half as much as 5 cm, and held back more — with the 2.5 cm one leading, the side
  // photo's forehead line, a few mm off the modes' just above the brow, left a trough there and the brow a ledge;
  // the profile still fits to ½ mm, the jaw line to 1)
  const t0 = performance.now(), m = model, C = correspond(), N = m.N, nS = m.nSkin, T = C.T, X0 = Float32Array.from(res.X), lam = opt.lambda ?? .05, P = FM.POINTS;
  KW = opt.kw || [0, .5, 1];
  // each view's outline chains: the side photo's profile (glabella → neck–chin angle) and jaw line
  const chains = views.map((V, q) => {
    if (V.view === 'front' || !V.outline) return [];
    const L = V.outline, at = id => L.indexOf(FM.INDEX[id]), out = [];
    const a = at('gl'), b = at('cerv');
    if (a >= 0 && b > a) out.push({ idx: L.slice(a, b + 1), prof: true });
    const j0 = L.findIndex(i => /^jaw2[LR]$/.test(P[i].id)), j1 = L.findIndex(i => /^ramus[LR]$/.test(P[i].id));
    if (j0 >= 0 && j1 > j0) { const sg = Math.sign(P[L[j0]].x); out.push({ idx: L.slice(j0, j1 + 1), cand: v => C.turn[v] && T[3 * v] * sg > 0 }); }
    // the front of the neck below the neck–chin angle (V.neck: its dots in order), lightly — the neck's posture
    // on the head varies more than the face does
    if (V.neck && V.neck.length >= 2) out.push({ idx: V.neck, prof: true, w: .3 });
    out.splice(0, out.length, ...out.map(ch => ({ ...ch, idx: ch.idx.filter(i => V.vis[i]) })).filter(ch => ch.idx.length >= (ch.w ? 2 : 3)));
    // the jaw's lower border as the photo's labels have it (V.jawSeg: { pts in the photo, w }), on the jaw's turn
    // like the jaw line's dots — unless it's on average over 5 mm from the outline's dots there (the neck–chin
    // angle to the ramus): then it's the labels that are wrong
    const c0 = [at('cerv'), at('me')].find(k => k >= 0), jd = L.find(i => /^jaw2[LR]$/.test(P[i].id));
    if (V.jawSeg && jd != null && c0 != null && j1 > c0) {
      const D = L.slice(c0, j1 + 1).filter(i => V.vis[i]).map(i => ({ x: V.p[2 * i], y: V.p[2 * i + 1] }));
      const dist = p => Math.min(...D.slice(1).map((B, k) => { const A = D[k], ex = B.x - A.x, ey = B.y - A.y, t = Math.max(0, Math.min(1, ((p.x - A.x) * ex + (p.y - A.y) * ey) / (ex * ex + ey * ey || 1))); return Math.hypot(p.x - A.x - t * ex, p.y - A.y - t * ey); }));
      const off = V.jawSeg.pts.reduce((s, p) => s + dist(p), 0) / V.jawSeg.pts.length / res.poses[q].s, sg = Math.sign(P[jd].x);
      res.jawSegOff = off;
      if (D.length >= 2 && off < .5) out.push({ pts: V.jawSeg.pts, w: V.jawSeg.w, idx: [], cand: v => C.turn[v] && T[3 * v] * sg > 0 });
    }
    return out;
  });
  const onChain = views.map((V, q) => new Set(chains[q].flatMap(ch => ch.idx)));
  // the chains as samples every ≈ 3 mm, each with its outward normal in the photo and a weight (its dots')
  const samples = views.map((V, q) => {
    const s = res.poses[q].s, out = [];
    let cx = 0, cy = 0, k = 0;
    P.forEach((_, i) => { if (V.vis[i]) { cx += V.p[2 * i]; cy += V.p[2 * i + 1]; k++; } });
    cx /= k || 1; cy /= k || 1;
    for (const [ci, ch] of chains[q].entries()) {
      const pts = ch.pts || ch.idx.map(i => ({ x: V.p[2 * i], y: V.p[2 * i + 1] })), ws = ch.pts ? ch.pts.map(() => ch.w) : ch.idx.map(i => ch.w ?? V.weight(i));
      const seg = i => Math.max(1, Math.round(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) / (.3 * s)));
      const sp = FM.spline(pts, false, seg), wq = [], at = [];
      // (each sample's place on the template too: that far between the two dots it lies between — none on a
      // chain of points)
      pts.slice(0, -1).forEach((_, i) => { const n = seg(i), A = ch.pts ? null : P[ch.idx[i]], B = ch.pts ? null : P[ch.idx[i + 1]]; for (let t = 0; t < n; t++) { wq.push(ws[i] + (ws[i + 1] - ws[i]) * t / n); at.push(A && [0, 1, 2].map(k => [A.x, A.y, A.z][k] + ([B.x, B.y, B.z][k] - [A.x, A.y, A.z][k]) * t / n)); } });
      wq.push(ws[ws.length - 1]); at.push(ch.pts ? null : [P[ch.idx[ch.idx.length - 1]].x, P[ch.idx[ch.idx.length - 1]].y, P[ch.idx[ch.idx.length - 1]].z]);
      for (let t = 1; t < sp.length - 1; t++) {
        let nx = sp[t + 1].y - sp[t - 1].y, ny = -(sp[t + 1].x - sp[t - 1].x);
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        if (nx * (sp[t].x - cx) + ny * (sp[t].y - cy) < 0) { nx = -nx; ny = -ny; }
        out.push({ x: sp[t].x, y: sp[t].y, n: [nx, ny], w: .7 * wq[t], cand: ch.cand, prof: ch.prof, ch: ci, tp: at[t] });
      }
    }
    return out;
  });
  // (a vertex as photo q caught it — its expression, res.exOff[q], on the head — before the bend, and as bent so far)
  const XO = res.exOff || [], x0q = (v, q) => { const o = XO[q]; return o ? [X0[3 * v] + o[3 * v], X0[3 * v + 1] + o[3 * v + 1], X0[3 * v + 2] + o[3 * v + 2]] : X0.subarray(3 * v, 3 * v + 3); };
  const dX = new Float32Array(3 * N), cur = (v, q) => { const p = x0q(v, q); return [p[0] + dX[3 * v], p[1] + dX[3 * v + 1], p[2] + dX[3 * v + 2]]; };
  const proj = (p, pose) => projK(pose, p);
  // (a row's direction g for (a, b) across the photo's (u, v): how a vertex's move shows there)
  const dir = (pose, v, a, b) => { const [gu, gv] = projJ(pose, X0.subarray(3 * v, 3 * v + 3)); return [0, 1, 2].map(k => a * gu[k] + b * gv[k]); };
  // the head's own outline in a view (as bent so far): the skin seen on a ≈ 1 mm grid, and the vertices on its
  // edge — a profile sample is matched to the nearest of them (not the one furthest out along its normal:
  // at the creases — nasion, under the nose, between the lips — that one could be the nose's or a lip's)
  const outlineVerts = (pose, q) => {
    const uv = new Float32Array(2 * nS);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let v = 0; v < nS; v++) { const [u, w] = proj(cur(v, q), pose); uv[2 * v] = u; uv[2 * v + 1] = w; x0 = Math.min(x0, u); y0 = Math.min(y0, w); x1 = Math.max(x1, u); y1 = Math.max(y1, w); }
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
          for (const j of cs) { const [u, v] = proj(cur(j, q), pose); if (!front && Math.abs((o.v - v) * o.n[0] - (o.u - u) * o.n[1]) > s) continue; const sc = u * o.n[0] + v * o.n[1]; if (sc > bv) { bv = sc; vert = j; } }
        }
        const [u, v] = proj(x0q(vert, q), pose), eu = (o.u - u) / s, ev = (o.v - v) / s;
        if (o.n) rows.push({ v: vert, g: dir(pose, vert, o.n[0], o.n[1]), e: eu * o.n[0] + ev * o.n[1], w: o.w, i: o.i, q });
        else if (!front && onChain[q].has(o.i)) {   // (a landmark on the side outline: firmly across it, lightly along)
          const L = chains[q].find(ch => ch.idx.includes(o.i)).idx, k = L.indexOf(o.i), a = L[Math.max(0, k - 1)], b = L[Math.min(L.length - 1, k + 1)];
          let nx = V.p[2 * b + 1] - V.p[2 * a + 1], ny = -(V.p[2 * b] - V.p[2 * a]);
          const l = Math.hypot(nx, ny) || 1, n = [nx / l, ny / l];
          rows.push({ v: vert, g: dir(pose, vert, n[0], n[1]), e: eu * n[0] + ev * n[1], w: o.w, i: o.i, q });
          rows.push({ v: vert, g: dir(pose, vert, -n[1], n[0]), e: -eu * n[1] + ev * n[0], w: .3 * o.w, i: o.i, q });
        } else {
          rows.push({ v: vert, g: dir(pose, vert, 1, 0), e: eu, w: o.w, i: o.i, q }, { v: vert, g: dir(pose, vert, 0, 1), e: ev, w: o.w, i: o.i, q });
        }
      }
      // a side photo's anatomy (V.anat(i) → weight: the cheekbone, the orbit's rims, the tear trough, the brow's
      // ridge, the submalar hollow — dots you placed): how far forward each lies, which is what a profile shows
      // of them (not how high: that's the front photo's) — 'sa'. Without them a face with well-projected
      // cheekbones and infraorbital rims came out as the scans' average there
      // (which point of the head: the one under the front map's dot of the same name — a profile shows how far
      // forward a cheek point is, the front photo which one it is; taken as the scans' own place for it instead, a
      // submalar dot came out 22 mm off its point and dug the cheek in. Within 3 cm of that place; and a dot still
      // over 12 mm off its point is left out — the two photos don't agree what it marks)
      if (!front && V.anat) {
        const F = views.findIndex(W => W.view === 'front'), Vf = views[F], pf = res.poses[F];
        for (let i = 0; i < P.length; i++) {
          const w = V.vis[i] ? V.anat(i) : 0;
          if (!(w > 0) || !C[i] || C[i].v < 0) continue;
          let vert = C[i].v;
          if (Vf && Vf.vis[i]) {
            const t = C[i].v, fx = Vf.p[2 * i], fy = Vf.p[2 * i + 1], n0 = res.nrm0 || (res.nrm0 = normals(X0)), vd = [0, 1, 2].map(j => -pf.R[2][j]);
            let bd = Infinity;
            for (let j = 0; j < nS; j++) {
              if ((X0[3 * j] - X0[3 * t]) ** 2 + (X0[3 * j + 1] - X0[3 * t + 1]) ** 2 + (X0[3 * j + 2] - X0[3 * t + 2]) ** 2 > 9) continue;
              if (n0[3 * j] * vd[0] + n0[3 * j + 1] * vd[1] + n0[3 * j + 2] * vd[2] < .2) continue;
              const [a2, b2] = proj(x0q(j, F), pf), d = (a2 - fx) ** 2 + (b2 - fy) ** 2;
              if (d < bd) { bd = d; vert = j; }
            }
          }
          const [u] = proj(x0q(vert, q), pose), e = (V.p[2 * i] - u) / s;
          if (Math.abs(e) > 1.2) continue;
          // (along the photo's across — the face's forward in a profile)
          rows.push({ v: vert, g: dir(pose, vert, 1, 0), e, w, i, q, anat: true });
        }
      }
      // the outline's samples: the head's edge there — on the profile, the nearest vertex of the head's own
      // outline (across the line counts double: ahead of the sample, not beside it); on the jaw line, of its
      // turn the one furthest out near the line across it
      const OV = samples[q].some(S => S.prof) ? outlineVerts(pose, q) : null;
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
          const [u, v] = proj(cur(j, q), pose), du = u - S.x, dv = v - S.y, along = du * S.n[0] + dv * S.n[1];
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
        const [u, v] = proj(x0q(best, q), pose);
        rows.push({ v: best, g: dir(pose, best, S.n[0], S.n[1]), e: ((S.x - u) * S.n[0] + (S.y - v) * S.n[1]) / s, w: S.w, q, at: S });
      }
    });
    // depths set by hand (opt.pins: { v, depth — toward the front camera, model cm — w }): firmly, the head bends to them
    const R0 = res.poses[0].R;
    for (const p of opt.pins || []) {
      const v = p.v, d0 = -(R0[2][0] * X0[3 * v] + R0[2][1] * X0[3 * v + 1] + R0[2][2] * X0[3 * v + 2]);
      rows.push({ v, g: R0[2].map(c => -c), e: p.depth - d0, w: p.w ?? 2, i: p.i, q: 0, pin: true });
    }
    // (opt.only, for testing: the kinds of rows used — 'fp' front points, 'fe' front edges, 'sp' side points,
    // 'se' side edges, 'ss' the side outline's samples, 'ear', 'pin')
    // (opt.catW: their weights, × the row's own)
    const only = opt.only || ROW_KINDS, catW = opt.catW || ROW_W;
    {
      const edge = new Set(res.pairs.flatMap((L, q) => L.filter(o => o.n).map(o => `${q}:${o.i}`)));
      // (a side photo's dot off the midline that isn't an edge: 'sl')
      // (a front photo's dot of the lips: 'fm'; a side photo's of the eye — its pupil, its corners: 'sy')
      const kind = r => r.pin ? 'pin' : r.at ? 'ss' : r.anat ? 'sa' : P[r.i].group === 'ears' ? 'ear' : (r.q ? 's' : 'f') + (edge.has(`${r.q}:${r.i}`) ? 'e' : r.q && /^(pu|en|ex)[LR]$/.test(P[r.i].id) ? 'y' : r.q && P[r.i].side !== 0 ? 'l' : !r.q && P[r.i].group === 'lips' ? 'm' : 'p');
      rows = rows.filter(r => { const k = kind(r); if (!only.includes(k)) return false; if (catW[k] != null) r.w *= catW[k]; r.w0 = r.w; return true; });
    }
    // (a side photo's rows on the other side of the face too, mirrored: the photo sees one side, and bent on that
    // side alone the head came out twisted from above — the temples 6 mm, the jaw 3 mm apart in depth; the front
    // photo, which sees both, keeps what's really uneven across the face)
    if (opt.mirrorSide !== false) {
      const mir = mirrorOf(), add = [];
      for (const r of rows) { if (!r.q || r.pin) continue; const w = mir[r.v]; if (w < 0 || w === r.v || Math.abs(X0[3 * r.v]) < .3) continue; add.push({ v: w, g: [-r.g[0], r.g[1], r.g[2]], e: r.e, w: r.w, w0: r.w0, q: r.q, mirror: true }); }
      rows.push(...add);
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
  // (the fine fit is off unless asked for: on a real face it pulled the lids and lips to the front photo's dots and
  // the face came out humped and pinched round the eyes — "Quasimodo")
  if (opt.fine === true) fineFit(res, views, X0, dX, rows, opt);
  for (let i = 0; i < 3 * N; i++) res.X[i] = X0[i] + dX[i];
  // what's left per dot (mm, worst row): where the photos and the head still disagree
  const mis = new Map();
  // (with each dot's weight in the bend: the front photo's landmarks count little in it — they aren't a
  // disagreement between the photos when the head passes them by)
  const wOf = new Map();
  for (const r of rows) { if (r.i == null) continue; const d = [dX[3 * r.v], dX[3 * r.v + 1], dX[3 * r.v + 2]], e = Math.abs(r.e - (r.g[0] * d[0] + r.g[1] * d[1] + r.g[2] * d[2])) * 10, key = `${r.q}:${r.i}`; if (!(mis.get(key) >= e)) mis.set(key, e); wOf.set(key, Math.max(wOf.get(key) || 0, r.w0 ?? r.w)); }
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
  // (opt.ortho: the head's own shape, seen from afar at the face's scale — with a lens, where it is on the photo
  // is enlarged by its nearness to the camera; its shape isn't)
  // (photo q's own expression on the head, where its colours are looked up)
  const m = model, p = opt.ortho ? { ...res.poses[q], s: faceScale(res, q), f: 0 } : res.poses[q], X = res.X, uv = new Float32Array(m.N * 2), z = new Float32Array(m.N);
  const xo = res.exOff && res.exOff[q], at = new Float32Array(3);
  for (let i = 0; i < m.N; i++) {
    for (let k = 0; k < 3; k++) at[k] = X[3 * i + k] + (xo ? xo[3 * i + k] : 0);
    const [u, v, , Y] = projK(p, at);
    uv[2 * i] = u; uv[2 * i + 1] = v;
    z[i] = -Y[2];   // toward the camera
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
/**
 * Each photo's camera fitted again to the head as bent (changes res.poses): the poses came from the modes' head,
 * before the bend gave it the profile's chin and nose — on a real pair the front photo's camera, nodded for
 * that head, left the chin 5–8 mm short of the photo's and the lips 4 mm high. Gauss–Newton on scale, rotation
 * and shift, as in fit (edge dots along their normal, at the head's edge as it is now; a side photo's pose from
 * its upper face), held near the pose it had. Returns each pose's change: [{ deg, px }].
 */
function refitPoses(res, views, opt = {}) {
  const C = correspond(), X = res.X, at = v => X.subarray(3 * v, 3 * v + 3), out = [];
  views.forEach((V, q) => {
    const p = res.poses[q], front = V.view === 'front', L = res.pairs && res.pairs[q], R0 = p.R, s0 = p.s, t0 = p.t.slice();
    if (!L || !L.length) return;
    for (let it = 0; it < (opt.iters || 6); it++) {
      const A = Array.from({ length: 6 }, () => new Array(6).fill(0)), b = new Array(6).fill(0);
      let sw = 0;
      for (const o of L) {
        const cs = o.n ? (front ? C[o.i].cand : o.sc ? C[o.i].scand : null) : null;
        let v = o.vert;
        if (cs) { let bv = -Infinity; for (const j of cs) { const [u, w] = projK(p, at(j)); if (!front && Math.abs((o.v - w) * o.n[0] - (o.u - u) * o.n[1]) > p.s) continue; const sc = u * o.n[0] + w * o.n[1]; if (sc > bv) { bv = sc; v = j; } } }
        const [pu, pv, k, Y] = projK(p, at(v)), eu = o.u - pu, ev = o.v - pv;
        const w = o.w * (!front && (FM.POINTS[o.i].y > .3 || SIDE_EDGE.test(FM.POINTS[o.i].id)) ? .05 : 1) / (p.s * p.s);
        const Ju = [k * Y[0], 0, p.s * k * Y[2], -p.s * k * Y[1], 1, 0], Jv = [k * Y[1], -p.s * k * Y[2], 0, p.s * k * Y[0], 0, 1];
        const R = o.n ? [[eu * o.n[0] + ev * o.n[1], Ju.map((x, a) => x * o.n[0] + Jv[a] * o.n[1])]] : [[eu, Ju], [ev, Jv]];
        for (const [e, Jr] of R) for (let a = 0; a < 6; a++) { b[a] += w * Jr[a] * e; for (let f = 0; f < 6; f++) A[a][f] += w * Jr[a] * Jr[f]; }
        sw += o.w;
      }
      // (held near the pose it had: rotation and scale lightly — the bend has already met the dots, the pose
      // only takes up what the modes' head had it wrong)
      const hold = (opt.hold ?? .02) * sw;
      for (let a = 1; a < 4; a++) A[a][a] += hold * p.s * p.s;
      for (let a = 0; a < 6; a++) A[a][a] += 1e-9;
      const d = solve(A, b);
      p.s += d[0]; p.R = mul3(rotSmall([d[1], d[2], d[3]]), p.R); p.t = [p.t[0] + d[4], p.t[1] + d[5]];
      if (V.dist && !V.f) p.f = V.dist * p.s;
    }
    let tr = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += p.R[i][j] * R0[i][j];
    out.push({ deg: Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI, px: Math.hypot(p.t[0] - t0[0], p.t[1] - t0[1]), ds: p.s / s0 - 1 });
  });
  return (res.poseRefit = out);
}
/**
 * The head moved in the front photo's plane through that photo's dots (changes res.X): the face's outline, the
 * eyes, nose, lips and ears land where the face map has them, so the head seen from the front is the photo —
 * its depth stays the fit's and the bend's. (The 3D bend counts the front photo's dots lightly — in full they
 * sheared the face in depth — and the head's own layout showed through: the photo laid on it was pulled to
 * the model's lids and mouth corners, a face too slim. A shift across the photo can't put lumps in depth.)
 * Two passes: a smooth one through all of them (the face's width and outline — through every dot at once, the
 * skin between moved unevenly and the clay showed lumps along the jaw and creases from the mouth's corners),
 * faded over the head's whole depth (1 cm behind the ears' plane to its back) and away from the dots (3–9 cm);
 * then a close one through the eyes', nose's and lips' own dots, fading within 1–2.5 cm of them. Each eyeball
 * moves whole, as its lids around it do. Returns the shift's rms over the face (mm).
 */
function alignFront(res, opt = {}) {
  const m = model, C = correspond(), N = m.N, nS = m.nSkin, p = res.poses[0], R = p.R, X = res.X, L = res.pairs && res.pairs[0];
  if (!L) return 0;
  const at = v => X.subarray(3 * v, 3 * v + 3), span = Math.max(...L.map(o => o.u)) - Math.min(...L.map(o => o.u)) || 1;
  const ev = C[FM.INDEX.traL] ? C[FM.INDEX.traL].v : -1, zEar = ev >= 0 ? -(R[2][0] * X[3 * ev] + R[2][1] * X[3 * ev + 1] + R[2][2] * X[3 * ev + 2]) : 0;
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const Dall = new Float32Array(3 * N);
  // (the jaw's outline: from the jaw angles' height down — above, at the cheekbones, the photo's outline is where
  // the skin meets the hair and the ears, inside the head's widest — and the chin's: its edge dots between the
  // chin's two sides)
  const yJaw = Math.min(FM.POINTS[FM.INDEX.jaw1L].y, FM.POINTS[FM.INDEX.jaw1R].y) - .3, xChin = Math.abs(FM.POINTS[FM.INDEX.chinR].x) + .2;
  const pass = (fine, reg, fd, jaw) => {
    const ctl = [], seen = new Set();
    for (const o of L) {
      const pt = FM.POINTS[o.i], edge = !!(C[o.i].cand && o.n), chin = edge && pt.y >= yJaw && Math.abs(pt.x) <= xChin;
      if (/^(pu|irI|irO)$/.test(pt.id.replace(/[LR]$/, ''))) continue;
      if (jaw ? !edge || pt.y < yJaw : fine ? !(chin && opt.chin === true) && (edge || pt.mid || !/^(eyes|nose|lips)$/.test(pt.group)) : !edge && (pt.mid || !/^(eyes|nose|lips|ears)$/.test(pt.group))) continue;
      let v = o.vert;
      // (an edge dot: the head's edge there as it is now — the vertex furthest out along the outline's normal)
      if (edge) { let bv = -Infinity; for (const j of C[o.i].cand) { const [u, w] = projK(p, at(j)), sc = u * o.n[0] + w * o.n[1]; if (sc > bv) { bv = sc; v = j; } } }
      if (seen.has(v)) continue;
      seen.add(v);
      const [u, w] = projK(p, at(v));
      ctl.push(u, w, o.u, o.v);
    }
    if (ctl.length < (jaw ? 20 : 24)) return;
    // (the jaw's: the eyes', nose's and lips' dots held where they are — the face inside stays put)
    const nj = ctl.length;
    if (jaw) for (const o of L) { const pt = FM.POINTS[o.i]; if (!(C[o.i].cand && o.n) && !pt.mid && /^(eyes|nose|lips)$/.test(pt.group) && !/^(pu|irI|irO)$/.test(pt.id.replace(/[LR]$/, ''))) { const [u, w] = projK(p, at(o.vert)); ctl.push(u, w, u, w); } }
    // (opt.keepDown, in the smooth pass: skin facing down — under the chin and the jaw — keeps its height. The front
    // photo sees it edge on, and moved up or down with the face above it the chin's underside came out 2 mm further
    // off on a test head; but kept, even spread over the skin round it, the real jaw came out with a boxy shelf
    // along it: off)
    const T = FM.tpsFit(ctl, ctl.length / 4, span, reg), D = new Float32Array(3 * N), nrm = normals(X), keepH = new Float32Array(nS);
    // (the jaw's: not the neck — pulled out with the jaw's edge, it flared into a collar round the lower face —
    // eased in over the skin between)
    let face = null;
    if (jaw) {
      face = Float32Array.from({ length: nS }, (_, v) => C.neck[v] ? 0 : 1);
      const Tp = topology(), tmp = new Float32Array(nS);
      for (let it = 0; it < 8; it++) { for (let v = 0; v < nS; v++) { const a = Tp.off[v], b = Tp.off[v + 1]; let s = 0; for (let q = a; q < b; q++) s += face[Tp.nb[q]]; tmp[v] = b > a ? .5 * face[v] + .5 * s / (b - a) : face[v]; } face.set(tmp); }
    }
    if (!fine && opt.keepDown === true) {
      for (let v = 0; v < nS; v++) keepH[v] = ss(.3, .8, R[1][0] * nrm[3 * v] + R[1][1] * nrm[3 * v + 1] + R[1][2] * nrm[3 * v + 2]);
      const Tp = topology(), tmp = new Float32Array(nS);
      for (let it = 0; it < 25; it++) {
        for (let v = 0; v < nS; v++) { const a = Tp.off[v], b = Tp.off[v + 1]; let s = 0; for (let q = a; q < b; q++) s += keepH[Tp.nb[q]]; tmp[v] = b > a ? .5 * keepH[v] + .5 * s / (b - a) : keepH[v]; }
        keepH.set(tmp);
      }
    }
    for (let v = 0; v < N; v++) {
      const [u, w, k, Y] = projK(p, at(v));
      let dc = Infinity;
      for (let q = 0; q < nj; q += 4) dc = Math.min(dc, (ctl[q] - u) ** 2 + (ctl[q + 1] - w) ** 2);
      const f = (fine ? 1 : ss(fd[0], fd[1], -Y[2] - zEar)) * (1 - ss(fd[2] * p.s, fd[3] * p.s, Math.sqrt(dc))) * (face && v < nS ? face[v] : 1);
      if (!f) continue;
      const [u2, w2] = FM.tpsEval(T, u, w), du = f * (u2 - u) / (p.s * k), dw = f * (1 - (v < nS ? keepH[v] : 0)) * (w2 - w) / (p.s * k);
      for (let j = 0; j < 3; j++) D[3 * v + j] = du * R[0][j] + dw * R[1][j];
    }
    // (the eyeballs whole: each its vertices' mean shift)
    for (const sg of [-1, 1]) {
      const s = [0, 0, 0];
      let n = 0;
      for (let v = nS; v < N; v++) if (Math.sign(X[3 * v]) === sg) { for (let j = 0; j < 3; j++) s[j] += D[3 * v + j]; n++; }
      if (n) for (let v = nS; v < N; v++) if (Math.sign(X[3 * v]) === sg) for (let j = 0; j < 3; j++) D[3 * v + j] = s[j] / n;
    }
    for (let i = 0; i < 3 * N; i++) { X[i] += D[i]; Dall[i] += D[i]; }
  };
  pass(false, opt.reg ?? .1, opt.fade || [-11, -1, 3, 9]);
  // (opt.jawIters: then the jaw's own edge onto the photo's outline, a few times over — moved, another vertex
  // becomes its edge. The jaw's edge met the photo's, but pulled out across the photo the skin between the face
  // and the jaw's turn bulged into a jowl: off. opt.chin: the chin's edge with the close pass — it met the
  // photo's, but the chin's corners came out as two lumps: off)
  for (let it = 0; it < (opt.jawIters ?? 0); it++) pass(false, opt.jawReg ?? .02, [-11, -1, 1.5, 4], true);
  if (opt.fine !== false) pass(true, opt.fineReg ?? 2e-3, [0, 0, 1, 2.5]);
  let se = 0, sn = 0;
  for (let v = 0; v < nS; v++) { se += Dall[3 * v] ** 2 + Dall[3 * v + 1] ** 2 + Dall[3 * v + 2] ** 2; sn++; }
  res.alignD = Dall;
  return (res.alignMm = 10 * Math.sqrt(se / (sn || 1)));
}
/**
 * The head's depth set by the photos' light and shade (changes res.X): what the dots can't say — how the brow rolls
 * into the eye socket, the cheekbones' and the maxilla's projection, the infraorbital hollow — the shading can, the
 * side photo's most (it sees those forms edge on). Each photo with its pixels (V.px: { d, w, h, sc }), where it
 * shows the face's skin (V.skin(x, y) → 0…1) and where each vertex's colour is on it (V.uv: photo px per vertex, as
 * the head is painted) gets a light — ambient plus one direction, none past the shadow's edge — and a skin
 * brightness that changes only slowly over the face. The head is then moved along the front camera's line of sight
 * (from the front it stays where the dots put it) by a sum of ≈ 1.2 cm bumps ≈ 1.5 cm apart over the skin the
 * photos see, fitted (Gauss–Newton, robust) so its shading matches theirs: held near none, alike between neighbours
 * and between the face's two sides, and not on the midline (the profile has it exactly) nor over the eyes, brows,
 * lips and nostrils (their colour isn't the skin's light). Returns { rms (mm moved), max, nc, it, ms, light }.
 */
function shading(res, views, opt = {}) {
  const t0 = performance.now(), m = model, C = correspond(), N = m.N, nS = m.nSkin, X = res.X, T = C.T, P = FM.POINTS;
  const used = views.map((V, q) => V.px && V.uv ? q : -1).filter(q => q >= 0);
  if (!used.length) return null;
  const p0 = res.poses[0], dir = [0, 1, 2].map(j => -p0.R[2][j]);   // (toward the front camera, model frame)
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // the skin the shading speaks for: not the neck or ears, nor the eyebrows' hair and the lids' margins themselves
  // (≈ 3 mm round their dots), the lips' red or the nostrils (≈ 5 mm). (At 7 mm round every eye and brow dot, the
  // whole brow — the supraorbital roll, the very form the side photo's shading shows — was left out.)
  const rE = opt.eyeR ?? .3, rB = opt.browR ?? .3, rL = opt.lipR ?? .5;
  const feat = P.map(pt => pt.group === 'eyes' ? [pt.x, pt.y, pt.z, rE] : pt.group === 'brows' ? [pt.x, pt.y, pt.z, rB] : pt.group === 'lips' || /^(sn|al|ac|sbal)/.test(pt.id) ? [pt.x, pt.y, pt.z, rL] : null).filter(Boolean);
  const ok = new Uint8Array(nS);
  for (let v = 0; v < nS; v++) {
    if (C.neck[v] || C.ear[v]) continue;
    let near = false;
    for (const f of feat) if ((T[3 * v] - f[0]) ** 2 + (T[3 * v + 1] - f[1]) ** 2 + (T[3 * v + 2] - f[2]) ** 2 < f[3] * f[3]) { near = true; break; }
    ok[v] = near ? 0 : 1;
  }
  const sig = opt.sigma || 1.2, cs = opt.cell || 1.5, nrm0 = normals(X);
  // (linear light: sRGB to the power 2.2)
  const lum = (I, x, y) => {
    const fx = Math.max(0, Math.min(I.w - 1.001, x * I.sc)), fy = Math.max(0, Math.min(I.h - 1.001, y * I.sc)), i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
    const at = (a2, b) => { const k = 4 * (b * I.w + a2); return Math.pow((.299 * I.d[k] + .587 * I.d[k + 1] + .114 * I.d[k + 2]) / 255, 2.2); };
    return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
  };
  // each photo's samples: the skin it faces squarely and shows as skin — where on the photo, and how that moves as
  // the vertex moves toward the front camera (px per cm: the side photo sees that move across it)
  const S = used.map(q => {
    const V = views[q], p = res.poses[q], vd = [0, 1, 2].map(j => -p.R[2][j]), v0 = [], u0 = [], du = [];
    for (let v = 0; v < nS; v++) {
      if (!ok[v] || nrm0[3 * v] * vd[0] + nrm0[3 * v + 1] * vd[1] + nrm0[3 * v + 2] * vd[2] < .35) continue;
      const u = V.uv[2 * v], w = V.uv[2 * v + 1];
      if (!(u > 1 && w > 1 && u < V.px.w / V.px.sc - 2 && w < V.px.h / V.px.sc - 2)) continue;
      if ((V.skin ? V.skin(u, w) : 1) < .5) continue;
      const [gu, gv] = projJ(p, X.subarray(3 * v, 3 * v + 3));
      v0.push(v); u0.push(u, w); du.push(p.s * (gu[0] * dir[0] + gu[1] * dir[1] + gu[2] * dir[2]), p.s * (gv[0] * dir[0] + gv[1] * dir[1] + gv[2] * dir[2]));
    }
    return { q, V, v: Int32Array.from(v0), u0: Float32Array.from(u0), du: Float32Array.from(du), I: new Float32Array(v0.length), light: null, rho: null };
  });
  const Tp = topology(), seen = new Float32Array(nS);
  for (const s of S) for (const v of s.v) seen[v] = 1;
  { const tmp = new Float32Array(nS); for (let pass = 0; pass < 6; pass++) { for (let v = 0; v < nS; v++) { let su = seen[v], c = 1; for (let qq = Tp.off[v]; qq < Tp.off[v + 1]; qq++) { su += seen[Tp.nb[qq]]; c++; } tmp[v] = su / c; } seen.set(tmp); } }
  // the bumps: one per ≈ 1.5 cm cell with ≥ 12 samples, eased off over ≈ 1 cm round the skin seen (reaching under
  // the chin, where nothing holds them, they moved it 17 mm on a test head)
  // … and round the eyes finer (≈ 0.75 cm, ≈ 0.9 cm apart, within 3.5 cm of each eye): whether the brow rolls
  // smoothly into the socket or juts and caves in under it, and the under-eye's hollow, are forms ≈ 1 cm across
  const eyeC = ['puL', 'puR'].map(id => { const i = FM.INDEX[id]; return i != null && C[i] ? X.subarray(3 * C[i].v, 3 * C[i].v + 3) : null; }).filter(Boolean);
  const nearEye = v => opt.fineCell !== 0 && eyeC.some(e => (X[3 * v] - e[0]) ** 2 + (X[3 * v + 1] - e[1]) ** 2 + (X[3 * v + 2] - e[2]) ** 2 < 3.5 * 3.5);
  const fine = opt.fineCell ?? .9, fsig = opt.fineSigma ?? .75, cells = new Map();
  for (const s of S) for (const v of s.v) { const f = nearEye(v), c0 = f ? fine : cs, key = `${f ? 'f' : 'c'}${Math.round(X[3 * v] / c0)},${Math.round(X[3 * v + 1] / c0)},${Math.round(X[3 * v + 2] / c0)}`; if (!cells.has(key)) cells.set(key, new Set()); cells.get(key).add(v); }
  const CX = [], SG = [], CS = [];
  for (const [key, L] of cells) {
    const f = key[0] === 'f';
    if (L.size < (f ? 6 : 12)) continue;
    const c = [0, 1, 2].map(j => [...L].reduce((t, v) => t + X[3 * v + j], 0) / L.size);
    CX.push(c); SG.push(f ? fsig : sig); CS.push(f ? fine : cs);
  }
  const nc = CX.length;
  if (!nc) return null;
  // (eased off toward the lids' margins, 3–9 mm: moved by the brow's bumps, the upper lid sank into the eyeball, which
  // showed through it)
  const eyeDots = P.filter(pt => pt.group === 'eyes').map(pt => [pt.x, pt.y, pt.z]), lidF = new Float32Array(nS);
  for (let v = 0; v < nS; v++) { let d = Infinity; for (const e of eyeDots) d = Math.min(d, (T[3 * v] - e[0]) ** 2 + (T[3 * v + 1] - e[1]) ** 2 + (T[3 * v + 2] - e[2]) ** 2); lidF[v] = ss(.3, .9, Math.sqrt(d)); }
  const phi = new Float32Array(nc * nS);
  for (let c = 0; c < nc; c++) { const sg = SG[c]; for (let v = 0; v < nS; v++) { const d2 = (X[3 * v] - CX[c][0]) ** 2 + (X[3 * v + 1] - CX[c][1]) ** 2 + (X[3 * v + 2] - CX[c][2]) ** 2; if (d2 < 9 * sg * sg) phi[c * nS + v] = Math.exp(-d2 / (2 * sg * sg)) * seen[v] * lidF[v]; } }
  // the midline held softly where the bumps reach it (the profile has it): a row "moves by none" per vertex there —
  // held still outright and faded in beside it, it stood as ridges either side of the nose's bridge
  const midV = [];
  for (let v = 0; v < nS; v++) if (Math.abs(X[3 * v]) < .25) { let any = false; for (let c = 0; c < nc && !any; c++) if (phi[c * nS + v]) any = true; if (any) midV.push(v); }
  // (neighbouring bumps alike, and each like its mirror image across the face)
  const nbr = [], mir = [];
  for (let c = 0; c < nc; c++) {
    let bm = -1, bd = (.6 * CS[c]) ** 2;
    for (let d = 0; d < nc; d++) {
      if (d > c && (CX[c][0] - CX[d][0]) ** 2 + (CX[c][1] - CX[d][1]) ** 2 + (CX[c][2] - CX[d][2]) ** 2 < (1.6 * Math.max(CS[c], CS[d])) ** 2) nbr.push([c, d]);
      const e = (CX[c][0] + CX[d][0]) ** 2 + (CX[c][1] - CX[d][1]) ** 2 + (CX[c][2] - CX[d][2]) ** 2;
      if (d !== c && e < bd) { bd = e; bm = d; }
    }
    if (bm > c) mir.push([c, bm]);
  }
  // (a vertex's normal from its own triangles, as normals() has it; and each bump's reach: the vertices it moves)
  const vt = Array.from({ length: nS }, () => []);
  for (let t = 0; t < m.nTri; t++) { const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2]; if (a < nS && b < nS && c < nS) { vt[a].push(t); vt[b].push(t); vt[c].push(t); } }
  const ip = LM68[30], sgn = (() => { let s = 0; for (const t of vt[ip]) { const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2]; s += (X[3 * b] - X[3 * a]) * (X[3 * c + 1] - X[3 * a + 1]) - (X[3 * b + 1] - X[3 * a + 1]) * (X[3 * c] - X[3 * a]); } return Math.sign(s) * Math.sign(nrm0[3 * ip + 2]) || 1; })();
  const vnorm = v => {
    let nx = 0, ny = 0, nz = 0;
    for (const t of vt[v]) {
      const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2];
      const ux = X[3 * b] - X[3 * a], uy = X[3 * b + 1] - X[3 * a + 1], uz = X[3 * b + 2] - X[3 * a + 2], wx = X[3 * c] - X[3 * a], wy = X[3 * c + 1] - X[3 * a + 1], wz = X[3 * c + 2] - X[3 * a + 2];
      nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nz += ux * wy - uy * wx;
    }
    const L = sgn / (Math.hypot(nx, ny, nz) || 1);
    return [nx * L, ny * L, nz * L];
  };
  const SUP = [];
  for (let c = 0; c < nc; c++) { const L = [], o = c * nS; for (let v = 0; v < nS; v++) if (phi[o + v]) L.push(v); SUP.push(Int32Array.from(L)); }
  // (each photo's samples' neighbours among its own samples, for smoothing the skin's brightness along the skin)
  for (const s of S) {
    const at = new Int32Array(nS).fill(-1), off = [0], nb = [];
    s.v.forEach((v, k) => { at[v] = k; });
    for (const v of s.v) { for (let q = Tp.off[v]; q < Tp.off[v + 1]; q++) { const k = at[Tp.nb[q]]; if (k >= 0) nb.push(k); } off.push(nb.length); }
    s.nOff = Int32Array.from(off); s.nb = Int32Array.from(nb);
  }
  const X0 = Float32Array.from(X), a = new Float64Array(nc), sh = new Float32Array(nS);
  // (the shift levels off past ± 4 mm, and a fine bump reaches half a coarse one's: where the two kinds overlap at
  // the eyes' zone's edge, their sum had put 9 mm spikes into the brow and the temple)
  const cap = opt.cap ?? .4, apply = () => { sh.fill(0); for (let c = 0; c < nc; c++) { const ac = a[c]; if (!ac) continue; const o = c * nS; for (let v = 0; v < nS; v++) { const f = phi[o + v]; if (f) sh[v] += ac * f; } } for (let v = 0; v < nS; v++) { sh[v] = cap * Math.tanh(sh[v] / cap); for (let j = 0; j < 3; j++) X[3 * v + j] = X0[3 * v + j] + sh[v] * dir[j]; } };
  // (opt.strength: how far the light may move the head — the priors' weights divided by it)
  const kS = opt.strength ?? 1, lamA = (opt.lambda ?? 1) / kS, lamN = opt.lambdaN ?? 3, lamM = opt.lambdaM ?? 2, amax = opt.amax ?? .5, amaxC = CS.map(c => c === cs ? amax : amax / 2);
  // shading at a normal: l₀ + max(0, l·n) — none past the shadow's edge (the linear light, on a test head lit from one
  // side, pulled the shape wherever the face turned away from it)
  const shade = (l, n0, n1, n2) => { const d = l[1] * n0 + l[2] * n1 + l[3] * n2; return l[0] + Math.max(0, d); };
  let it = 0;
  for (; it < (opt.iters || 5); it++) {
    apply();
    const nrm = normals(X);
    for (const s of S) for (let k = 0; k < s.v.length; k++) { const v = s.v[k]; s.I[k] = lum(s.V.px, s.u0[2 * k] + s.du[2 * k] * sh[v], s.u0[2 * k + 1] + s.du[2 * k + 1] * sh[v]); }
    // 1 · each photo's light and skin brightness, given the shape: I ≈ ρ (l₀ + max(0, l·n)), ρ smooth over the face
    for (const s of S) {
      const n = s.v.length;
      for (let r = 0; r < (it ? 2 : 4); r++) {
        const rho = s.rho || new Float32Array(n).fill(1), A = Array.from({ length: 4 }, () => new Array(4).fill(0)), b = new Array(4).fill(0);
        for (let k = 0; k < n; k++) {
          const v = s.v[k], lit = !s.light || s.light[1] * nrm[3 * v] + s.light[2] * nrm[3 * v + 1] + s.light[3] * nrm[3 * v + 2] > 0;
          const f = [rho[k], lit ? rho[k] * nrm[3 * v] : 0, lit ? rho[k] * nrm[3 * v + 1] : 0, lit ? rho[k] * nrm[3 * v + 2] : 0];
          for (let i = 0; i < 4; i++) { b[i] += f[i] * s.I[k]; for (let j = 0; j < 4; j++) A[i][j] += f[i] * f[j]; }
        }
        for (let i = 0; i < 4; i++) A[i][i] += 1e-6;
        s.light = solve(A, b);
        // ρ: the ratio I / shading, smoothed along the skin it samples (200 passes, ≈ 3–5 cm: any finer, it took up the
        // very shading that tells the shape; smoothed across the face in a straight line instead — or fitted as a
        // quadratic, or jointly with the light — it reached over the eyes and lips, and the bumps made up for it)
        let val = Float32Array.from({ length: n }, (_, k) => { const v = s.v[k]; return s.I[k] / Math.max(.02, shade(s.light, nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2])); }), tmp = new Float32Array(n);
        for (let pass = 0; pass < (opt.rhoPasses ?? 200); pass++) {
          for (let k = 0; k < n; k++) { let su = val[k]; const a0 = s.nOff[k], a1 = s.nOff[k + 1]; for (let q = a0; q < a1; q++) su += val[s.nb[q]]; tmp[k] = su / (1 + a1 - a0); }
          [val, tmp] = [tmp, val];
        }
        s.rho = Float32Array.from(val, x => Math.max(.05, x));
      }
    }
    // 2 · the bumps, given the light: Gauss–Newton with the shading's change per bump (finite differences)
    const rows = [];
    // (each photo's residuals in its own brightness — divided by its mean — so the side photo, which sees the brow's
    // roll and the cheekbone's and the maxilla's projection edge on, counts as fully as the front; counted double
    // besides, on a test head it overshot: the chin's front +1.3 mm, the lips and nose further off)
    for (const s of S) { s.norm = s.v.length / (s.I.reduce((t, x) => t + x, 0) || 1); s.wt = s.V.view === 'front' ? 1 : (opt.sideWeight ?? 1); }
    for (const s of S) for (let k = 0; k < s.v.length; k++) { const v = s.v[k]; rows.push({ s, k, v, r: s.norm * (s.I[k] - s.rho[k] * shade(s.light, nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2])) }); }
    const scale = Math.sqrt(rows.reduce((t, o) => t + o.r * o.r, 0) / (rows.length || 1)) || 1;
    for (const o of rows) o.w = o.s.wt * Math.min(1, 2 * scale / (Math.abs(o.r) || 1e-9));   // (robust: Huber at 2× the rms)
    const rowAt = new Map(); rows.forEach((o, i) => { if (!rowAt.has(o.v)) rowAt.set(o.v, []); rowAt.get(o.v).push(i); });
    const A = Array.from({ length: nc }, () => new Float64Array(nc)), b = new Float64Array(nc), J = rows.map(() => new Float32Array(nc)), eps = .05;
    // (each bump's normals worked out only where it reaches: the sampled vertices it moves)
    for (let c = 0; c < nc; c++) {
      const o = c * nS, sup = SUP[c];
      for (const v of sup) for (let j = 0; j < 3; j++) X[3 * v + j] += eps * phi[o + v] * dir[j];
      const NF = opt.fullJ ? normals(X) : null;
      for (const v of sup) {
        const L2 = rowAt.get(v); if (!L2) continue;
        const n2 = NF ? [NF[3 * v], NF[3 * v + 1], NF[3 * v + 2]] : vnorm(v);
        for (const i of L2) { const w = rows[i], l = w.s.light; J[i][c] = w.s.norm * w.s.rho[w.k] * (shade(l, n2[0], n2[1], n2[2]) - shade(l, nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2])) / eps; }
      }
      for (const v of sup) for (let j = 0; j < 3; j++) X[3 * v + j] -= eps * phi[o + v] * dir[j];
    }
    const lam = lamA * scale * scale * rows.length / nc;
    rows.forEach((o, i) => { const Ji = J[i]; for (let c = 0; c < nc; c++) { if (!Ji[c]) continue; b[c] += o.w * Ji[c] * o.r; for (let d = 0; d <= c; d++) if (Ji[d]) A[c][d] += o.w * Ji[c] * Ji[d]; } });
    const M = Array.from({ length: nc }, (_, c) => Array.from({ length: nc }, (_, d) => (d <= c ? A[c][d] : A[d][c]) + (c === d ? lam : 0)));
    const rhs = Array.from(b, (x, c) => x - lam * a[c]);
    const tie = (c, d, l) => { M[c][c] += l; M[d][d] += l; M[c][d] -= l; M[d][c] -= l; const df = a[c] - a[d]; rhs[c] -= l * df; rhs[d] += l * df; };
    for (const [c, d] of nbr) tie(c, d, lamN * lam);
    for (const [c, d] of mir) tie(c, d, lamM * lam);
    // (only form, not a shift of the whole face: the bumps' mean and their tilt across the face and up it held at
    // none — on a real face, its light not quite as modelled, they moved the face 2.5 mm back all over and left the
    // midline, which the profile holds, standing as a keel down the forehead)
    // (the midline's rows: Σ a_c φ_c(v) = 0, each as much as ≈ 40 samples)
    const lamMid = (opt.lambdaMid ?? 40) * scale * scale / kS, fv = new Float64Array(nc);
    for (const v of midV) {
      let cur = 0;
      for (let c = 0; c < nc; c++) { fv[c] = phi[c * nS + v]; cur += a[c] * fv[c]; }
      for (let c = 0; c < nc; c++) { if (!fv[c]) continue; rhs[c] -= lamMid * fv[c] * cur; for (let d = 0; d < nc; d++) if (fv[d]) M[c][d] += lamMid * fv[c] * fv[d]; }
    }
    const lamF = (opt.lambdaF ?? 20) * lam * nc;
    for (const f of [() => 1, c => CX[c][0] / 4, c => CX[c][1] / 4]) {
      const g = CX.map((_, c) => f(c)), gn = Math.hypot(...g) || 1, u = g.map(x => x / gn), proj = u.reduce((t, x, c) => t + x * a[c], 0);
      for (let c = 0; c < nc; c++) { rhs[c] -= lamF * u[c] * proj; for (let d = 0; d < nc; d++) M[c][d] += lamF * u[c] * u[d]; }
    }
    const da = solve(M, rhs);
    for (let c = 0; c < nc; c++) a[c] = Math.max(-amaxC[c], Math.min(amaxC[c], a[c] + da[c]));
  }
  apply();
  let se = 0, sn = 0;
  for (let v = 0; v < nS; v++) if (sh[v]) { se += sh[v] * sh[v]; sn++; }
  return (res.shading = { rms: 10 * Math.sqrt(se / (sn || 1)), max: 10 * Math.max(...Array.from(a, Math.abs)), nc, it, ms: Math.round(performance.now() - t0), light: S.map(s => s.light.map(x => +x.toFixed(3))), n: S.map(s => s.v.length), sh: Float32Array.from(sh) });
}
/**
 * How much of each of the face map's anatomical forms this face has, read from the photos' light and shade — the
 * side photo's above all — and the head given them (changes res.X): the cheekbones' and the infraorbital rims'
 * forward projection, the brow ridge's projection and height, the upper lid's fold (a crease under the brow, or a
 * smooth roll into it), the under-eye and cheek hollows, the midface, the temples (LIGHT_OPS). Each is one smooth
 * shape over the template (FM.anatomyAt), so the head stays a face however much of it the light asks for; their
 * amounts are fitted (Gauss–Newton, robust, held near none) so the head's shading — under each photo's light,
 * with a skin brightness that changes only slowly, at where each photo shows each point (it moves on the side photo
 * as it moves forward) — matches the photos'. Views as for shading(). Returns { values, ms }.
 * (Generic bumps alone, held back enough to stay smooth, changed a real face's cheekbones and under-eyes by under
 * a millimetre: these forms are the ones those bumps had to build from nothing.)
 */
// (not the brow's height nor the upper lid's fold: read from the side photo's light they came out ≈ +36 % — the
// brow pulled down over the lid — and the upper lids folded over themselves: on trvejester 104 triangles turned
// inside out against 57 without the side photo, the "holes" round the eyes. Without them, 59; and the brow ridge
// read as projecting, +24 %, not −33 %)
const LIGHT_OPS = ['malarProj', 'infraorbital', 'browRidge', 'underEye', 'buccal', 'midfaceProj', 'temples'];
/**
 * The face map's anatomical forms on a head (X, model frame): each at full strength, per skin vertex (B: 3 per vertex,
 * cm, y up) and where it reaches (SUP). Each skin vertex is taken as a template point — its place on the template,
 * the soft tissue's depth there (the dots' own, spread), its normal (template frame: y down) and what it belongs to
 * (round the eye openings: the eyes, which the forms leave be).
 */
function anatBasis(X, keys) {
  const m = model, C = correspond(), nS = m.nSkin, T = C.T, P = FM.POINTS, nrm0 = normals(X);
  const dots = P.filter(pt => pt.t != null && pt.field !== 'back'), eyeD = P.filter(pt => pt.group === 'eyes'), pts = new Array(nS);
  for (let v = 0; v < nS; v++) {
    const x = T[3 * v], y = T[3 * v + 1], z = T[3 * v + 2];
    let sw = 0, st = 0, de = Infinity;
    for (const d of dots) { const w = 1 / (.05 + (d.x - x) ** 2 + (d.y - y) ** 2 + (d.z - z) ** 2) ** 2; sw += w; st += w * d.t; }
    for (const e of eyeD) de = Math.min(de, (e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2);
    pts[v] = { x, y, z, t: st / (sw || 1), n: [nrm0[3 * v], -nrm0[3 * v + 1], nrm0[3 * v + 2]], m: de < .35 * .35 ? { eyes: 1 } : { skin: 1 } };
  }
  const B = [], SUP = [];
  for (const key of keys) {
    const Dt = FM.anatomyAt({ [key]: 1 }, pts), D = new Float32Array(3 * nS), L = [];
    for (let v = 0; v < nS; v++) { D[3 * v] = Dt[3 * v]; D[3 * v + 1] = -Dt[3 * v + 1]; D[3 * v + 2] = Dt[3 * v + 2]; if (Math.abs(Dt[3 * v]) + Math.abs(Dt[3 * v + 1]) + Math.abs(Dt[3 * v + 2]) > 1e-5) L.push(v); }
    B.push(D); SUP.push(Int32Array.from(L));
  }
  return { B, SUP };
}
function anatomyFromLight(res, views, opt = {}) {
  const t0 = performance.now(), m = model, C = correspond(), nS = m.nSkin, X = res.X, T = C.T, P = FM.POINTS;
  const used = views.map((V, q) => V.px && V.uv ? q : -1).filter(q => q >= 0);
  if (!used.length || !FM.anatomyAt) return null;
  const nrm0 = normals(X), Tp = topology(), keys = opt.ops || LIGHT_OPS, nk = keys.length, { B, SUP } = anatBasis(X, keys);
  // the samples: as shading() takes them (the skin each photo faces squarely and shows as skin, not the eyebrows'
  // hair, the lids' margins, the lips or nostrils)
  const feat = P.map(pt => pt.group === 'eyes' || pt.group === 'brows' ? [pt.x, pt.y, pt.z, .3] : pt.group === 'lips' || /^(sn|al|ac|sbal)/.test(pt.id) ? [pt.x, pt.y, pt.z, .5] : null).filter(Boolean);
  const ok = new Uint8Array(nS);
  for (let v = 0; v < nS; v++) {
    if (C.neck[v] || C.ear[v]) continue;
    let near = false;
    for (const f of feat) if ((T[3 * v] - f[0]) ** 2 + (T[3 * v + 1] - f[1]) ** 2 + (T[3 * v + 2] - f[2]) ** 2 < f[3] * f[3]) { near = true; break; }
    ok[v] = near ? 0 : 1;
  }
  const lum = (I, x, y) => {
    const fx = Math.max(0, Math.min(I.w - 1.001, x * I.sc)), fy = Math.max(0, Math.min(I.h - 1.001, y * I.sc)), i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
    const at = (a2, b) => { const k = 4 * (b * I.w + a2); return Math.pow((.299 * I.d[k] + .587 * I.d[k + 1] + .114 * I.d[k + 2]) / 255, 2.2); };
    return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
  };
  const S = used.map(q => {
    const V = views[q], p = res.poses[q], vd = [0, 1, 2].map(j => -p.R[2][j]), v0 = [], u0 = [], p0 = [];
    for (let v = 0; v < nS; v++) {
      if (!ok[v] || nrm0[3 * v] * vd[0] + nrm0[3 * v + 1] * vd[1] + nrm0[3 * v + 2] * vd[2] < .35) continue;
      const u = V.uv[2 * v], w = V.uv[2 * v + 1];
      if (!(u > 1 && w > 1 && u < V.px.w / V.px.sc - 2 && w < V.px.h / V.px.sc - 2)) continue;
      if ((V.skin ? V.skin(u, w) : 1) < .5) continue;
      const [a, b] = projK(p, X.subarray(3 * v, 3 * v + 3));
      v0.push(v); u0.push(u, w); p0.push(a, b);
    }
    const at = new Int32Array(nS).fill(-1), off = [0], nb = [];
    v0.forEach((v, k) => { at[v] = k; });
    for (const v of v0) { for (let q2 = Tp.off[v]; q2 < Tp.off[v + 1]; q2++) { const k = at[Tp.nb[q2]]; if (k >= 0) nb.push(k); } off.push(nb.length); }
    return { q, V, p, v: Int32Array.from(v0), u0: Float32Array.from(u0), p0: Float32Array.from(p0), I: new Float32Array(v0.length), nOff: Int32Array.from(off), nb: Int32Array.from(nb), light: null, rho: null, at };
  });
  // (a vertex's normal from its own triangles, as normals() has it)
  const vt = Array.from({ length: nS }, () => []);
  for (let t = 0; t < m.nTri; t++) { const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2]; if (a < nS && b < nS && c < nS) { vt[a].push(t); vt[b].push(t); vt[c].push(t); } }
  const ip = LM68[30], sgn = (() => { let s = 0; for (const t of vt[ip]) { const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2]; s += (X[3 * b] - X[3 * a]) * (X[3 * c + 1] - X[3 * a + 1]) - (X[3 * b + 1] - X[3 * a + 1]) * (X[3 * c] - X[3 * a]); } return Math.sign(s) || 1; })();
  const vnorm = v => {
    let nx = 0, ny = 0, nz = 0;
    for (const t of vt[v]) { const a = m.tri[3 * t], b = m.tri[3 * t + 1], c = m.tri[3 * t + 2], ux = X[3 * b] - X[3 * a], uy = X[3 * b + 1] - X[3 * a + 1], uz = X[3 * b + 2] - X[3 * a + 2], wx = X[3 * c] - X[3 * a], wy = X[3 * c + 1] - X[3 * a + 1], wz = X[3 * c + 2] - X[3 * a + 2]; nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nz += ux * wy - uy * wx; }
    const L = sgn / (Math.hypot(nx, ny, nz) || 1);
    return [nx * L, ny * L, nz * L];
  };
  const shade = (l, n0, n1, n2) => l[0] + Math.max(0, l[1] * n0 + l[2] * n1 + l[3] * n2);
  // (each sample's brightness where the photo shows its point now — moved, a point moves across the side photo)
  const sampleI = (s, k, v) => { const [a, b] = projK(s.p, X.subarray(3 * v, 3 * v + 3)); return lum(s.V.px, s.u0[2 * k] + a - s.p0[2 * k], s.u0[2 * k + 1] + b - s.p0[2 * k + 1]); };
  const X0 = Float32Array.from(X), a = new Float64Array(nk), kS = opt.strength ?? 1, amax = opt.amax ?? 2;
  const apply = () => { X.set(X0); for (let k = 0; k < nk; k++) { const ak = a[k], D = B[k]; if (!ak) continue; for (const v of SUP[k]) for (let j = 0; j < 3; j++) X[3 * v + j] += ak * D[3 * v + j]; } };
  let it = 0;
  for (; it < (opt.iters || 6); it++) {
    apply();
    const nrm = normals(X);
    for (const s of S) for (let k = 0; k < s.v.length; k++) s.I[k] = sampleI(s, k, s.v[k]);
    // 1 · each photo's light and skin brightness, given the shape (as in shading())
    for (const s of S) {
      const n = s.v.length;
      for (let r = 0; r < (it ? 2 : 4); r++) {
        const rho = s.rho || new Float32Array(n).fill(1), A = Array.from({ length: 4 }, () => new Array(4).fill(0)), b = new Array(4).fill(0);
        for (let k = 0; k < n; k++) {
          const v = s.v[k], lit = !s.light || s.light[1] * nrm[3 * v] + s.light[2] * nrm[3 * v + 1] + s.light[3] * nrm[3 * v + 2] > 0;
          const f = [rho[k], lit ? rho[k] * nrm[3 * v] : 0, lit ? rho[k] * nrm[3 * v + 1] : 0, lit ? rho[k] * nrm[3 * v + 2] : 0];
          for (let i = 0; i < 4; i++) { b[i] += f[i] * s.I[k]; for (let j = 0; j < 4; j++) A[i][j] += f[i] * f[j]; }
        }
        for (let i = 0; i < 4; i++) A[i][i] += 1e-6;
        s.light = solve(A, b);
        let val = Float32Array.from({ length: n }, (_, k) => { const v = s.v[k]; return s.I[k] / Math.max(.02, shade(s.light, nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2])); }), tmp = new Float32Array(n);
        for (let pass = 0; pass < (opt.rhoPasses ?? 200); pass++) { for (let k = 0; k < n; k++) { let su = val[k]; const a0 = s.nOff[k], a1 = s.nOff[k + 1]; for (let q2 = a0; q2 < a1; q2++) su += val[s.nb[q2]]; tmp[k] = su / (1 + a1 - a0); } [val, tmp] = [tmp, val]; }
        s.rho = Float32Array.from(val, x => Math.max(.05, x));
      }
      s.norm = s.v.length / (s.I.reduce((t, x) => t + x, 0) || 1);
    }
    // 2 · the forms' amounts, given the light: Gauss–Newton, the change per form by finite differences (the shading
    // and where the photo shows the point)
    const rows = [];
    for (const s of S) for (let k = 0; k < s.v.length; k++) { const v = s.v[k]; rows.push({ s, k, v, r: s.norm * (s.I[k] - s.rho[k] * shade(s.light, nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2])) }); }
    const scale = Math.sqrt(rows.reduce((t, o) => t + o.r * o.r, 0) / (rows.length || 1)) || 1;
    for (const o of rows) o.w = Math.min(1, 2 * scale / (Math.abs(o.r) || 1e-9));
    const rowOf = S.map(s => new Int32Array(s.v.length));
    { let i = 0; S.forEach((s, si) => { for (let k = 0; k < s.v.length; k++) rowOf[si][k] = i++; }); }
    const J = rows.map(() => new Float32Array(nk)), eps = .1;
    for (let c = 0; c < nk; c++) {
      const D = B[c];
      for (const v of SUP[c]) for (let j = 0; j < 3; j++) X[3 * v + j] += eps * D[3 * v + j];
      S.forEach((s, si) => {
        for (const v of SUP[c]) {
          const k = s.at[v]; if (k < 0) continue;
          const n2 = vnorm(v), i = rowOf[si][k], o = rows[i], I2 = sampleI(s, k, v);
          const pred1 = s.rho[k] * shade(s.light, nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]), pred2 = s.rho[k] * shade(s.light, n2[0], n2[1], n2[2]);
          J[i][c] = s.norm * ((pred2 - pred1) - (I2 - s.I[k])) / eps;
        }
      });
      for (const v of SUP[c]) for (let j = 0; j < 3; j++) X[3 * v + j] -= eps * D[3 * v + j];
    }
    // (held near none — the lid's fold and the brow's height 4× as firmly: on test heads they read ≈ −1 whatever
    // the truth, the lids' own shading too close by; the infraorbital rim and the brow ridge came back to within
    // ≈ 10–40 %, the cheekbones' projection to within ≈ half — its forward move changes the shading least)
    const lam = (opt.lambda ?? .1) / kS * scale * scale * rows.length / nk, lamK = keys.map(k => /^(hooding|browDrop)$/.test(k) ? 4 : 1);
    const M = Array.from({ length: nk }, () => new Array(nk).fill(0)), rhs = new Array(nk).fill(0);
    rows.forEach((o, i) => { const Ji = J[i]; for (let c = 0; c < nk; c++) { if (!Ji[c]) continue; rhs[c] += o.w * Ji[c] * o.r; for (let d = 0; d < nk; d++) M[c][d] += o.w * Ji[c] * Ji[d]; } });
    for (let c = 0; c < nk; c++) { M[c][c] += lam * lamK[c]; rhs[c] -= lam * lamK[c] * a[c]; }
    const da = solve(M, rhs);
    for (let c = 0; c < nk; c++) a[c] = Math.max(-amax, Math.min(amax, a[c] + da[c]));
  }
  apply();
  const values = Object.fromEntries(keys.map((k, c) => [k, +a[c].toFixed(2)]));
  return (res.anatLight = { values, it, ms: Math.round(performance.now() - t0), n: S.map(s => s.v.length) });
}
/**
 * The convexity points (the Convexity step): each one you placed says how far the surface between its link's two
 * ends bulges or sinks — how far off the straight line between them the photo shows it. The head gets each as a
 * smooth bump along the skin's normal round the mid's point (reaching 0.6 of the link's length, so its ends
 * hardly move), its height fitted so that, from that photo, the head's mid point lies as far off the line between
 * its ends (as the head has them) as yours does, for the link's length on each — so it's the curve that's
 * matched, not where the line lies. (The bend before it can't make anything under ≈ 2.5 cm: its finest shape is
 * that wide.) Where the photo sees the surface face on — a link on the cheek's front, from the front — the bump
 * barely moves the point in the photo and is held near none. A side photo's bumps go on the other side too,
 * unless the front photo has that side's own.
 * views: [{ q (pose), p (the map's photo positions), user(i), links: [{ a, m, b }] }]. Changes res.X (skin) and
 * keeps the head before them in res.Xcv0; returns res.convex = { n, ms, h: Map(mid → cm) }.
 */
/**
 * A point of a link on the head (Y): the skin a fraction t of the way between its ends' vertices — the one under
 * that point of the line between them, pushed out along their normals (on the surface between them, not through
 * it). (The template's own point for it was sometimes its end's vertex: under the jaw, on a 4 mm link above the
 * eye beside it.) Cached per head state.
 */
const midCache = new WeakMap();
const linkMid = (Y, va, vb) => linkPoint(Y, va, vb, .5);
function linkPoint(Y, va, vb, t0) {
  let c = midCache.get(Y);
  if (!c) midCache.set(Y, c = { nrm: normals(Y), map: new Map() });
  const key = `${va},${vb},${t0.toFixed(3)}`;
  if (c.map.has(key)) return c.map.get(key);
  const n = c.nrm, nS = model.nSkin, L = Math.hypot(Y[3 * va] - Y[3 * vb], Y[3 * va + 1] - Y[3 * vb + 1], Y[3 * va + 2] - Y[3 * vb + 2]);
  let nx = n[3 * va] + n[3 * vb], ny = n[3 * va + 1] + n[3 * vb + 1], nz = n[3 * va + 2] + n[3 * vb + 2];
  const nl = Math.hypot(nx, ny, nz) || 1, k = 2 * t0 * (1 - t0) * L / nl;
  const p = [0, 1, 2].map(j => Y[3 * va + j] + t0 * (Y[3 * vb + j] - Y[3 * va + j]) + k * [nx, ny, nz][j]);
  // (between the ends along the line, near it, and facing the way they do: round the eye the nearest was the
  // lid's margin under both ends)
  const ax = Y[3 * va], ay = Y[3 * va + 1], az = Y[3 * va + 2], bx = Y[3 * vb] - ax, by = Y[3 * vb + 1] - ay, bz = Y[3 * vb + 2] - az, L2 = L * L || 1;
  let best = -1, bd = Infinity, any = -1, ad = Infinity;
  for (let v = 0; v < nS; v++) {
    if (v === va || v === vb) continue;
    const dx = Y[3 * v] - p[0], dy = Y[3 * v + 1] - p[1], dz = Y[3 * v + 2] - p[2], d = dx * dx + dy * dy + dz * dz;
    if (d < ad) { ad = d; any = v; }
    const t = ((Y[3 * v] - ax) * bx + (Y[3 * v + 1] - ay) * by + (Y[3 * v + 2] - az) * bz) / L2;
    if (Math.abs(t - t0) > .2 || (n[3 * v] * nx + n[3 * v + 1] * ny + n[3 * v + 2] * nz) / nl < .3) continue;
    const qx = Y[3 * v] - ax - t * bx, qy = Y[3 * v + 1] - ay - t * by, qz = Y[3 * v + 2] - az - t * bz;
    if (qx * qx + qy * qy + qz * qz > .36 * L2) continue;
    if (d < bd) { bd = d; best = v; }
  }
  if (best < 0) best = any;
  c.map.set(key, best);
  return best;
}
/**
 * One link's bump on the head (Y): 1 at its mid's vertex c, none at its ends a and e and beyond ≈ 0.8 of its length
 * round c (≥ 6 mm — across the face too: a brow's roll runs on beside it, and the next link's bump joins it),
 * then smoothed over the skin so neighbouring bumps run together into one form and it has no edge; and none at
 * the eyes' openings — the lids' margins stay on the eyeball (moved along their normals they crumpled against
 * it). Sparse: { idx, w, at: Map(vertex → w) }, cached per head state.
 */
/** The skin's normals smoothed over ≈ 3 mm (the bumps' direction: each vertex's own made the lid's two layers part). Cached per head state. */
const snCache = new WeakMap();
function smoothNormals(Y) {
  if (snCache.has(Y)) return snCache.get(Y);
  const n = normals(Y), Tp = topology(), nS = model.nSkin, tmp = new Float32Array(n.length);
  for (let it = 0; it < 6; it++) {
    tmp.set(n);
    for (let v = 0; v < nS; v++) {
      const o0 = Tp.off[v], o1 = Tp.off[v + 1];
      let x = n[3 * v], y = n[3 * v + 1], z = n[3 * v + 2];
      for (let k = o0; k < o1; k++) { const u = Tp.nb[k]; x += n[3 * u]; y += n[3 * u + 1]; z += n[3 * u + 2]; }
      const L = Math.hypot(x, y, z) || 1;
      tmp[3 * v] = x / L; tmp[3 * v + 1] = y / L; tmp[3 * v + 2] = z / L;
    }
    n.set(tmp);
  }
  snCache.set(Y, n);
  return n;
}
const bumpCache = new WeakMap();
function bumpField(Y, c, a, e) {
  let K = bumpCache.get(Y);
  if (!K) bumpCache.set(Y, K = { map: new Map(), eye: null });
  const key = `${c},${a},${e}`;
  if (K.map.has(key)) return K.map.get(key);
  const m = model, nS = m.nSkin, Tp = topology();
  // (the lids' margins stay: none within 1 mm of the line round each eye's opening — the map's lid dots on the
  // head — full beyond 3 mm. By the distance to the eyeballs instead, the lid's outer skin moved and its inner
  // skin, on the eyeball, didn't: the margin tore; or, held off further, the middle of a 4 mm link under the
  // brow couldn't move at all. Both layers lie within the 1 mm of the line and stay together)
  if (!K.eye) {
    const eye = new Float32Array(nS).fill(1), C = correspond(), line = [];
    for (const s of ['L', 'R']) {
      const ring = ['en', 'eu1', 'eu2', 'eu3', 'ex', 'el4', 'el3', 'el2', 'el1', 'el0'].map(id => FM.INDEX[id + s]).filter(i => i != null && C[i] && C[i].v >= 0 && C[i].v < nS).map(i => C[i].v);
      ring.forEach((u, k) => { const w = ring[(k + 1) % ring.length]; for (let q = 0; q < 8; q++) { const t = q / 8; line.push([0, 1, 2].map(j => Y[3 * u + j] * (1 - t) + Y[3 * w + j] * t)); } });
    }
    for (let v = 0; v < nS; v++) {
      let d2 = Infinity;
      for (const p of line) { const dd = (p[0] - Y[3 * v]) ** 2 + (p[1] - Y[3 * v + 1]) ** 2 + (p[2] - Y[3 * v + 2]) ** 2; if (dd < d2) d2 = dd; }
      const t = Math.max(0, Math.min(1, (Math.sqrt(d2) - .1) / .2));
      eye[v] = t * t * (3 - 2 * t);
    }
    K.eye = eye;
  }
  const d = (u, v) => Math.sqrt((Y[3 * u] - Y[3 * v]) ** 2 + (Y[3 * u + 1] - Y[3 * v + 1]) ** 2 + (Y[3 * u + 2] - Y[3 * v + 2]) ** 2);
  const len = Math.max(.15, d(a, e)), R = Math.max(.6, Math.min(1.8, .8 * len)), half = .5 * len;
  const ease = x => x >= 1 ? 1 : x <= 0 ? 0 : x * x * (3 - 2 * x);
  // the region (R and a little more, for the smoothing), as local indices
  const loc = new Map(), idx = [];
  for (let v = 0; v < nS; v++) if (d(v, c) < R + .3) { loc.set(v, idx.length); idx.push(v); }
  let w = Float32Array.from(idx, v => { const r2 = (d(v, c) / R) ** 2; return r2 >= 1 ? 0 : (1 - r2) ** 2 * ease(d(v, a) / half) * ease(d(v, e) / half); });
  let tmp = new Float32Array(idx.length);
  for (let it = 0; it < 6; it++) {
    for (let q = 0; q < idx.length; q++) { const v = idx[q], o0 = Tp.off[v], o1 = Tp.off[v + 1]; let s = 0; for (let k = o0; k < o1; k++) { const l = loc.get(Tp.nb[k]); s += l == null ? 0 : w[l]; } tmp[q] = o1 > o0 ? .5 * w[q] + .5 * s / (o1 - o0) : w[q]; }
    [w, tmp] = [tmp, w];
  }
  // (normalised: 1 at its mid again — the smoothing lowered the peak — then the eyes' openings)
  const peak = w[loc.get(c)] || Math.max(...w) || 1, at = new Map(), oi = [], ow = [];
  idx.forEach((v, q) => { const x = w[q] / peak * K.eye[v]; if (x > 1e-3) { oi.push(v); ow.push(x); at.set(v, x); } });
  const F = { idx: Int32Array.from(oi), w: Float32Array.from(ow), at };
  K.map.set(key, F);
  return F;
}
function convexFit(res, views, opt = {}) {
  const t0 = performance.now(), m = model, C = correspond(), nS = m.nSkin, X = res.X;
  if (!res.Xcv0 || opt.fresh) res.Xcv0 = Float32Array.from(X);
  const X0 = res.Xcv0, n0 = smoothNormals(X0), mir = mirrorOf(), FMIR = FM.MIRROR;
  const vOf = i => C[i] && C[i].v >= 0 && C[i].v < nS ? C[i].v : -1;
  // the rows: one per link point you placed, per photo. A link's points are the head's a fraction 1/(n+1), 2/(n+1)…
  // of the way between its ends; each bends between its neighbours on the link (the points before and after it,
  // or its ends) — so 2 or 3 points on a link draw a curve, not one bump
  const L = [];
  views.forEach(V => {
    for (const k of V.links) {
      if (!k.ms.some(i => V.user(i))) continue;
      const va = vOf(k.a), vb = vOf(k.b), n = k.ms.length;
      if (va < 0 || vb < 0 || va === vb) continue;
      const nodes = [va, ...k.ms.map((_, j) => linkPoint(X0, va, vb, (j + 1) / (n + 1))), vb];
      if (nodes.some(v => v < 0)) continue;
      const A = [V.p[2 * k.a], V.p[2 * k.a + 1]], B = [V.p[2 * k.b], V.p[2 * k.b + 1]], cx = B[0] - A[0], cy = B[1] - A[1], Lu = Math.hypot(cx, cy);
      if (!(Lu > 3)) continue;
      k.ms.forEach((i, j) => {
        if (!V.user(i)) return;
        const d = ((V.p[2 * i] - A[0]) * -cy + (V.p[2 * i + 1] - A[1]) * cx) / Lu;
        L.push({ q: V.q, i, va, vb, vm: nodes[j + 1], prev: nodes[j], next: nodes[j + 2], du: d, ex: -cy / Lu, ey: cx / Lu });
      });
    }
  });
  // … and the points set by hand in 3D (opt.fixed: point → how far out, cm), each where it lies on its link
  // (opt.links: every link): those aren't fitted, the head just has them — and the photos' points there give way
  const fixed = opt.fixed || new Map(), geo = new Map();
  for (const [i] of fixed) {
    const k = (opt.links || []).find(l => l.ms.includes(i));
    if (!k) continue;
    const va = vOf(k.a), vb = vOf(k.b), n = k.ms.length, j = k.ms.indexOf(i);
    if (va < 0 || vb < 0 || va === vb) continue;
    const nodes = [va, ...k.ms.map((_, q) => linkPoint(X0, va, vb, (q + 1) / (n + 1))), vb];
    if (nodes.some(v => v < 0)) continue;
    geo.set(i, { vm: nodes[j + 1], prev: nodes[j], next: nodes[j + 2] });
  }
  for (let q = L.length - 1; q >= 0; q--) if (geo.has(L[q].i)) L.splice(q, 1);
  const ids = [...new Set(L.map(r => r.i)), ...geo.keys()], nk = ids.length, col = new Map(ids.map((i, c) => [i, c]));
  const isFixed = ids.map(i => geo.has(i));
  res.convex = { n: nk, ms: 0, h: new Map() };
  if (!nk) { X.set(X0); return res.convex; }
  // each bump (bumpField): set on one photo or side alone, its mirror on the other side too
  const bump = ids.map(i => {
    const r = geo.get(i) || L.find(o => o.i === i), onlySide = geo.has(i) || L.every(o => o.i !== i || o.q > 0), mi = FMIR[i], ms = [r.vm, r.prev, r.next].map(v => mir[v]);
    const F = bumpField(X0, r.vm, r.prev, r.next);
    if (!(onlySide && !col.has(mi) && ms.every(v => v >= 0) && ms[0] !== r.vm)) return F;
    const G = bumpField(X0, ms[0], ms[1], ms[2]), idx = Int32Array.from([...F.idx, ...G.idx]), w = Float32Array.from([...F.w, ...G.w]), at = new Map(F.at);
    G.at.forEach((x, v) => at.set(v, (at.get(v) || 0) + x));
    return { idx, w, at };
  });
  const phi = (v, j) => bump[j].at.get(v) || 0;
  const h = Float64Array.from(ids, i => geo.has(i) ? Math.max(-1, Math.min(1, fixed.get(i))) : 0);
  const apply = () => {
    X.set(X0);
    for (let j = 0; j < nk; j++) {
      if (!h[j]) continue;
      const { idx, w } = bump[j];
      for (let q = 0; q < idx.length; q++) { const v = idx[q], s = h[j] * w[q]; X[3 * v] += s * n0[3 * v]; X[3 * v + 1] += s * n0[3 * v + 1]; X[3 * v + 2] += s * n0[3 * v + 2]; }
    }
  };
  // (held near none: at .3 a point where the skin faces the photo sideways — a cheek, the outer orbit, from the
  // side — came out at a third of how far you moved it; at .12 at ⅔–⅘, but where the photo barely sees the
  // bulge — skin facing it — 1 mm off on the photo became 4 mm of bump: the head came out humped. At .25, at most
  // 2×, and ⅘ where the photo sees it well. A bump the lids' guard mostly mutes is held the harder: unseen, it
  // swung to the cap)
  const sbar = views.length ? views.reduce((s, V) => s + res.poses[V.q].s, 0) / views.length : res.poses[0].s, lam = ((opt.lambda ?? .25) * sbar) ** 2, eps = .05;
  const lamOf = ids.map((i, j) => { const r = geo.get(i) || L.find(o => o.i === i); return lam / Math.max(.1, phi(r.vm, j)) ** 2; });
  if (!L.length) { apply(); ids.forEach((i, j) => res.convex.h.set(i, h[j])); res.convex.ms = Math.round(performance.now() - t0); return res.convex; }
  for (let it = 0; it < (opt.iters || 3); it++) {
    // (the image's motion when a vertex moves along its normal, per cm)
    const Dn = (pose, v) => { const p = X.subarray(3 * v, 3 * v + 3), a = projK(pose, p), b = projK(pose, [p[0] + eps * n0[3 * v], p[1] + eps * n0[3 * v + 1], p[2] + eps * n0[3 * v + 2]]); return [(b[0] - a[0]) / eps, (b[1] - a[1]) / eps]; };
    const M = Array.from({ length: nk }, () => new Float64Array(nk)), rhs = new Float64Array(nk);
    for (const r of L) {
      const pose = res.poses[r.q], A = projK(pose, X.subarray(3 * r.va, 3 * r.va + 3)), B = projK(pose, X.subarray(3 * r.vb, 3 * r.vb + 3)), Mh = projK(pose, X.subarray(3 * r.vm, 3 * r.vm + 3));
      const cx = B[0] - A[0], cy = B[1] - A[1], Lh = Math.hypot(cx, cy);
      // (both across your line, in the photo's px — the head's own ends can lie at another angle in a side photo,
      // whose dots off the midline the bend before doesn't follow: across its chord the bulge pointed elsewhere)
      const ex = r.ex, ey = r.ey, th = Lh > 1 ? Math.min(1, Math.max(0, ((Mh[0] - A[0]) * cx + (Mh[1] - A[1]) * cy) / (Lh * Lh))) : .5;
      const dh = (Mh[0] - A[0] - th * cx) * ex + (Mh[1] - A[1] - th * cy) * ey;
      const e = r.du - dh;
      const Da = Dn(pose, r.va), Db = Dn(pose, r.vb), Dm = Dn(pose, r.vm), J = new Float64Array(nk);
      for (let j = 0; j < nk; j++) {
        if (isFixed[j]) continue;
        const fa = phi(r.va, j), fb = phi(r.vb, j), fm = phi(r.vm, j);
        if (!fa && !fb && !fm) continue;
        J[j] = ex * (fm * Dm[0] - (1 - th) * fa * Da[0] - th * fb * Db[0]) + ey * (fm * Dm[1] - (1 - th) * fa * Da[1] - th * fb * Db[1]);
      }
      for (let a = 0; a < nk; a++) { if (!J[a]) continue; rhs[a] += J[a] * e; for (let b = 0; b < nk; b++) M[a][b] += J[a] * J[b]; }
    }
    for (let a = 0; a < nk; a++) { if (isFixed[a]) { M[a][a] = 1; rhs[a] = 0; continue; } M[a][a] += lamOf[a]; rhs[a] -= lamOf[a] * h[a]; }
    const dh = solve(M.map(r => Array.from(r)), Array.from(rhs));
    for (let j = 0; j < nk; j++) if (!isFixed[j]) h[j] = Math.max(-.5, Math.min(.5, h[j] + dh[j]));
    apply();
  }
  ids.forEach((i, j) => res.convex.h.set(i, h[j]));
  res.convex.ms = Math.round(performance.now() - t0);
  return res.convex;
}
/** A photo's scale (px per cm) at the face's own depth: the pose's, enlarged as its lens enlarges the dots it fitted. */
function faceScale(res, q = 0) {
  const p = res.poses[q];
  if (!p.f || !res.pairs || !res.pairs[q]) return p.s;
  let sk = 0, sw = 0;
  for (const o of res.pairs[q]) { sk += o.w * projK(p, res.X.subarray(3 * o.vert, 3 * o.vert + 3))[2]; sw += o.w; }
  return p.s * (sw ? sk / sw : 1);
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

window.CraniHead = { load, fit, deform, refitPoses, alignFront, shading, anatomyFromLight, anatBasis, LIGHT_OPS, closeLips, convexFit, linkMid, linkPoint, project, faceScale, projK, raster, correspond, topology, normals, get model() { return model; }, build: '62' };
})();
