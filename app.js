/* ==========================================================================
   Cranimeter · app
   Plain JS, no build step. Everything runs locally in the browser.
   ========================================================================== */
(() => {
'use strict';

/* ---------------------------------------------------------------- data -- */

const BUILD = '9';   // must match <meta name="cranimeter-build"> in index.html and warp.js
const { GROUPS, LANDMARKS } = window.CRANI;
const P = {};
GROUPS.forEach(g => g.items.forEach(it => { it.group = g.name; P[it.id] = it; }));
const PRESET_IDS = Object.keys(P);

const KIND_N = { ruler: 2, ratio: 4, angle: 3, tilt: 2, segments: 0, calib: 2 };
const KIND_LABEL = { ruler: 'Ruler', ratio: 'Ratio', angle: 'Angle', tilt: 'Tilt', segments: 'Proportions', calib: 'Scale' };
const TOOLS = {
  move:     { title: 'Select',      help: 'Click a line to select it, or drag on empty space to box-select. Drag a selected line to move it and drag points to fine-tune. Right-drag or Space-drag pans; Ctrl A selects everything visible.' },
  ruler:    { title: 'Ruler',       help: 'Click two points to draw a line. With two or more rulers, each one shows its length as a multiple of the reference line (1.00x).' },
  angle:    { title: 'Angle',       help: 'Click three points — the middle one is the vertex.' },
  tilt:     { title: 'Tilt',        help: 'Click two points. The angle is read against the horizontal; positive means the second point sits higher.' },
  segments: { title: 'Proportions', help: 'Click points along a feature, then press Enter, double-click or right-click to finish. Each segment is shown relative to the first.' },
  calib:    { title: 'Scale',       help: 'Draw across something of known size — the iris is about 11.7 mm — so rulers can also show millimetres.' },
  morph:    { title: 'Morph',       help: 'Drag on the photo to reshape it. Landmarks stay attached to the face, so every ratio updates live as you morph.' },
  adjust:   { title: 'Adjust image', help: 'Straighten, zoom and correct close-range lens distortion. Measurements stay attached to the face.' },
};
const TOOL_KEYS = { v: 'move', r: 'ruler', a: 'angle', t: 'tilt', s: 'segments', c: 'calib', m: 'morph', e: 'adjust' };
const EDIT_TOOLS = new Set(['morph', 'adjust']);

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const TAU = Math.PI * 2, DEG = 180 / Math.PI;
const LOUPE = 132, LOUPE_ZOOM = 3;
const LEAVE_MS = 320, PAINT_MS = 260;
const HIT_NODE = 12, HIT_LINE = 9;

const I = {
  reset: '<svg class="ic" viewBox="0 0 20 20"><path d="M4 10a6 6 0 1 0 1.8-4.3"/><path d="M4 4v3.5h3.5"/></svg>',
  trash: '<svg class="ic" viewBox="0 0 20 20"><path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5a1.5 1.5 0 0 0 1.5 1.5h3.6a1.5 1.5 0 0 0 1.5-1.5L14 6"/></svg>',
  anchor: '<svg class="ic" viewBox="0 0 20 20"><path d="M3.5 10h13"/><path d="M3.5 7v6M16.5 7v6"/></svg>',
  x: '<svg class="ic" viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8"/></svg>',
  chev: '<svg class="ic chev" viewBox="0 0 20 20"><path d="m5.5 8 4.5 4.5L14.5 8"/></svg>',
};

/* ------------------------------------------------------------- helpers -- */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = t => { t = clamp(t, 0, 1); return t * t * t; };
const easeInOut = t => { t = clamp(t, 0, 1); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const now = () => performance.now();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = v => String(Math.round(v * 100) / 100);
const normAng = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

function hexRGB(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function rgba(hex, a) { const [r, g, b] = hexRGB(hex); return `rgba(${r},${g},${b},${a})`; }
function colorGap(a, b) {
  const [r1, g1, b1] = hexRGB(a), [r2, g2, b2] = hexRGB(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}
function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(((px - a.x) * dx + (py - a.y) * dy) / L2, 0, 1) : 0;
  return Math.hypot(px - a.x - dx * t, py - a.y - dy * t);
}
function angleAt(a, v, b) {
  const x1 = a.x - v.x, y1 = a.y - v.y, x2 = b.x - v.x, y2 = b.y - v.y;
  const d = Math.hypot(x1, y1) * Math.hypot(x2, y2);
  return d ? Math.acos(clamp((x1 * x2 + y1 * y2) / d, -1, 1)) * DEG : 0;
}
function tiltOf(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return dx || dy ? Math.atan2(-dy, Math.abs(dx)) * DEG : 0;
}
/** Project points onto the first→last axis. Returns projected points and segment lengths. */
function segInfo(p) {
  const a = p[0], b = p[p.length - 1];
  let ux = b.x - a.x, uy = b.y - a.y;
  const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
  const t = p.map(q => (q.x - a.x) * ux + (q.y - a.y) * uy);
  const q = t.map(v => ({ x: a.x + ux * v, y: a.y + uy * v }));
  const lens = [];
  for (let i = 0; i < t.length - 1; i++) lens.push(Math.abs(t[i + 1] - t[i]));
  return { ux, uy, q, lens };
}
function snapAngle(a, p) {
  const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
  const L = dist(a, p);
  return { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function setText(el, s) { if (el && el._t !== s) { el._t = s; el.textContent = s; } }
function setBlur(el, b) {
  if (!el) return;
  const f = cfg.motion && b > 0.05 ? `blur(${(b * 0.55).toFixed(2)}px)` : '';
  if (el._f !== f) { el._f = f; el.style.filter = f; }
}

/* ------------------------------------------------------------ settings -- */

const DEFAULTS = {
  theme: 'system',
  c1: '#7CCBF5', c2: '#F2A7C6', c3: '#F0CD6E',
  width: 1.5, label: 10.5,
  loupe: false, names: true, gridFx: true,
  mMode: 'push', mSize: .09, mStrength: .55, mHard: .25, mProtect: false, mLimit: false,
  motion: !matchMedia('(prefers-reduced-motion: reduce)').matches,
};
const SWATCHES = ['#7CCBF5', '#F2A7C6', '#F0CD6E', '#8FE0B4', '#BCAEF7', '#F5A3A3', '#6ED8CB', '#F2F2F3'];
const SKEY = 'cranimeter:settings';
let cfg = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; }
  catch (e) { return { ...DEFAULTS }; }
})();
const saveCfg = () => { try { localStorage.setItem(SKEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } };

/* ----------------------------------------------------------------- DOM -- */

const root = document.documentElement;
const body = document.body;
const imgcv = $('#imgcv'), ictx = imgcv.getContext('2d');
// GPU renderer for the photo (needed for Morph and Adjust); falls back to plain 2D drawing.
const glcv = document.createElement('canvas');
glcv.id = 'glcv'; glcv.setAttribute('aria-hidden', 'true');
imgcv.after(glcv);
let GLR = null, GL_REASON = null;
const pageBuild = (document.querySelector('meta[name="cranimeter-build"]') || {}).content;
const STALE = pageBuild !== BUILD || (window.CraniWarp && window.CraniWarp.build !== BUILD);
if (STALE) GL_REASON = 'stale';
else if (!window.CraniWarp) GL_REASON = 'missing';
else {
  try { GLR = window.CraniWarp.createRenderer(glcv); } catch (e) { console.error(e); }
  if (!GLR) GL_REASON = 'webgl';
}
if (GLR) imgcv.style.display = 'none'; else glcv.remove();
const GL_MESSAGES = {
  missing: 'warp.js didn’t load. Make sure warp.js is uploaded next to index.html, then hard-refresh (Ctrl + F5).',
  stale: 'Your browser is mixing old and new files. Hard-refresh the page (Ctrl + F5, or ⌘ + Shift + R on a Mac).',
  webgl: 'This browser couldn’t start WebGL 2. Turn on hardware acceleration (Chrome/Edge: Settings → System) or try another browser.',
  broken: 'The GPU renderer stopped working for this image. Reload the page to try again.',
};
/** Turn the GPU path off (and keep the app running with plain 2D drawing). */
function disableGL(reason) {
  if (!GLR) return;
  GLR = null; GL_REASON = reason;
  glcv.remove(); imgcv.style.display = '';
  imgKey = '';
  if (EDIT_TOOLS.has(S.tool)) { toolOptsFor = null; renderToolOpts(); }
  toast(GL_MESSAGES[reason], 7000);
}
const ov = $('#overlay'), octx = ov.getContext('2d');
const bg = $('#bg'), bctx = bg.getContext('2d');
const loupe = $('#loupe'), lctx = loupe.getContext('2d');
const panel = $('#panel'), listEl = $('#list'), readoutEl = $('#readout');
const hintEl = $('#hint'), hintIn = $('.hint-in');
const toastEl = $('#toast');
const toolbar = $('#toolbar');
const fileInput = $('#file');
const calibPop = $('#calib'), calibInput = $('#calibInput');
const settingsEl = $('#settings');
const zoomPct = $('#zoomPct');

let W = innerWidth, H = innerHeight, dpr = 1;

/* --------------------------------------------------------------- state -- */

const S = {
  img: null, imgRec: null, iw: 0, ih: 0, imgA: 1, imgSeq: 0,
  view: { x: 0, y: 0, k: 1 },
  viewT: { x: 0, y: 0, k: 1 },
  fitK: 1,
  tool: 'ruler',
  meas: new Map(),
  sel: [],            // layers shown (panel selection)
  active: null,
  showAll: false,
  picked: new Set(),  // measurements selected on the canvas
  draft: null, draftM: null,
  cursor: null, cursorIn: false,
  hover: null, listHover: null,
  drag: null, mdrag: null, press: null, pan: null, rpress: null, box: null,
  space: false, shift: false,
  refId: null, calibId: null, calibMM: 11.7,
  seq: 0,
  undo: [], redo: [],
  leaving: [],
  awakeUntil: 0,
  // image edits: rotation (deg), zoom, flip, lens 0–100 and the face ellipse (U space)
  adj: { rot: 0, zoom: 1, aspect: 1, flip: 1, tx: 0, ty: 0, lens: 0, ell: null },
  // morph displacement field over the photo (P space); field === null means no morph
  warp: { field: null, gw: 1, gh: 1, cs: 1 },
  scratch: null, stroke: null, hdrag: null, compare: false, adjSnap: null,
  glDirty: true, fieldDirty: false,
};
const wake = (ms = 1200) => { S.awakeUntil = Math.max(S.awakeUntil, now() + ms); };

const toS = p => ({ x: p.x * S.view.k + S.view.x, y: p.y * S.view.k + S.view.y });
const toI = (sx, sy) => ({ x: (sx - S.view.x) / S.view.k, y: (sy - S.view.y) / S.view.k });

/* ------------------------------------------------- geometry pipeline --
   Mirrors warp.js exactly:  V (what you see) → U (un-rotated) → P (lens) → S (source photo).
   Measurement points are anchored in S, so they ride along with every
   rotation, lens correction and morph stroke. ---------------------------- */

/* ---- image transform: rotate · scale (with stretch + flip) · move, about the image centre ---- */
const DEFAULT_ADJ = () => ({ rot: 0, zoom: 1, aspect: 1, flip: 1, tx: 0, ty: 0, lens: 0, ell: null });
const scaleXY = (a = S.adj) => [a.flip * a.zoom * Math.sqrt(a.aspect), a.zoom / Math.sqrt(a.aspect)];
const affineIdentity = () => { const a = S.adj; return !a.rot && a.zoom === 1 && a.aspect === 1 && a.flip === 1 && !a.tx && !a.ty; };

function vToU(v, a = S.adj) {
  const cx = S.iw / 2, cy = S.ih / 2, t = a.rot / DEG, c = Math.cos(t), s = Math.sin(t), [sx, sy] = scaleXY(a);
  const dx = v.x - cx - a.tx, dy = v.y - cy - a.ty;
  return { x: cx + (c * dx + s * dy) / sx, y: cy + (-s * dx + c * dy) / sy };
}
function uToV(u, a = S.adj) {
  const cx = S.iw / 2, cy = S.ih / 2, t = a.rot / DEG, c = Math.cos(t), s = Math.sin(t), [sx, sy] = scaleXY(a);
  const dx = (u.x - cx) * sx, dy = (u.y - cy) * sy;
  return { x: cx + a.tx + c * dx - s * dy, y: cy + a.ty + s * dx + c * dy };
}

/* ---- close-range lens (perspective) model — keep in sync with depthAt() in warp.js ----
   A camera at distance D renders a point at depth z (cm in front of the ear plane) at
   D/(D − z) times its far-away size. Typical depths: nose tip ≈ 11 cm, nasion / lips / chin ≈ 8–9,
   zygion ≈ 3, ears and hair edge ≈ 0. Correcting to a far camera with the cheekbone width held
   fixed shrinks the nose and chin, shortens the face and lets the head outline widen naturally. */
const lensDistanceCm = v => 25 / (v / 100);              // slider 100 → 25 cm, 50 → 50 cm, 10 → 2.5 m
const lensD = () => (S.adj.ell && S.adj.lens > 0) ? lensDistanceCm(S.adj.lens) : 0;
const hump = t => { t = clamp(t, 0, 1); return 1 - t * t * (3 - 2 * t); };
const gauss = (qx, qy, cx, cy, sx, sy) => { const dx = (qx - cx) / sx, dy = (qy - cy) / sy; return Math.exp(-.5 * (dx * dx + dy * dy)); };
function depthAt(qx, qy) {
  const hx = hump(qx * qx / (1.3 * 1.3));
  const hy = qy < -1 ? hump((-1 - qy) / 1.9) : qy > .9 ? 1 + (.25 - 1) * (1 - hump((qy - .9) / .6)) : 1;
  let z = 8.5 * hx * hy;
  z += 2.8 * gauss(qx, qy, 0, -.3, .19, .40);
  z += .8 * gauss(qx, qy, 0, .25, .30, .16);
  z += .5 * gauss(qx, qy, 0, .85, .30, .20);
  z -= 1.2 * (gauss(qx, qy, .47, -.9, .2, .14) + gauss(qx, qy, -.47, -.9, .2, .14));
  return Math.max(z, 0);
}
const ZREF = depthAt(1, -.6);   // zygion depth
function lensG(p) {
  const D = lensD();
  if (!D) return 1;
  const e = S.adj.ell, qx = (p.x - e.cx) / e.ax, qy = (p.y - e.cy) / e.ay;
  const ee = qx * qx / (1.3 * 1.3) + (qy + .95) * (qy + .95) / 4;
  const w = 1 - smooth01(1, 3.5, ee);
  return (D - ZREF * w) / (D - depthAt(qx, qy));
}
/** Lens-corrected view → original photo position (fixed-point; mirrors lensUP in warp.js). */
function uToP(u) {
  if (!lensD()) return { x: u.x, y: u.y };
  const e = S.adj.ell;
  let p = { x: u.x, y: u.y };
  for (let i = 0; i < 10; i++) { const g = lensG(p); p = { x: e.cx + (u.x - e.cx) * g, y: e.cy + (u.y - e.cy) * g }; }
  return p;
}
/** Original photo position → lens-corrected view (closed form). */
function pToU(p) {
  if (!lensD()) return { x: p.x, y: p.y };
  const e = S.adj.ell, g = lensG(p);
  return { x: e.cx + (p.x - e.cx) / g, y: e.cy + (p.y - e.cy) / g };
}
const isIdentity = () => affineIdentity() && !lensD() && !S.warp.field;
function fieldAt(f, x, y) {
  const W_ = S.warp, cs = W_.cs, gw = W_.gw, gh = W_.gh;
  const fx = x / cs, fy = y / cs, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const i0 = clamp(i, 0, gw - 1), i1 = clamp(i + 1, 0, gw - 1), j0 = clamp(j, 0, gh - 1), j1 = clamp(j + 1, 0, gh - 1);
  const a = (j0 * gw + i0) * 2, b = (j0 * gw + i1) * 2, c = (j1 * gw + i0) * 2, d = (j1 * gw + i1) * 2;
  const top0 = f[a] + (f[b] - f[a]) * tx, bot0 = f[c] + (f[d] - f[c]) * tx;
  const top1 = f[a + 1] + (f[b + 1] - f[a + 1]) * tx, bot1 = f[c + 1] + (f[d + 1] - f[c + 1]) * tx;
  return [top0 + (bot0 - top0) * ty, top1 + (bot1 - top1) * ty];
}
function pToS(p) {
  const f = S.warp.field;
  if (!f) return { x: p.x, y: p.y };
  const [dx, dy] = fieldAt(f, p.x, p.y);
  return { x: p.x + dx, y: p.y + dy };
}
function sToP(s) {
  const f = S.warp.field;
  if (!f) return { x: s.x, y: s.y };
  let p = { x: s.x, y: s.y };
  for (let i = 0; i < 16; i++) {
    const [dx, dy] = fieldAt(f, p.x, p.y);
    const nx = s.x - dx, ny = s.y - dy;
    if (Math.abs(nx - p.x) < .01 && Math.abs(ny - p.y) < .01) { p = { x: nx, y: ny }; break; }
    p = { x: p.x + (nx - p.x) * .85, y: p.y + (ny - p.y) * .85 };
  }
  return p;
}
const vToP = v => uToP(vToU(v));
const fwdMap = v => isIdentity() ? { x: v.x, y: v.y } : pToS(vToP(v));
const invMap = s => isIdentity() ? { x: s.x, y: s.y } : uToV(pToU(sToP(s)));

/** Record where each point sits on the source photo. */
function anchor(m) { m.src = m.pts.map(fwdMap); }
/** Re-place every point after the image geometry changed. */
function syncPts() {
  for (const m of S.meas.values()) if (m.src) m.pts = m.src.map(invMap);
  S.glDirty = true;
  wake();
}

/* ---- morph field ---- */
function initWarp() {
  const cs = Math.max(1, Math.max(S.iw, S.ih) / 400);
  S.warp = { field: null, gw: Math.ceil(S.iw / cs) + 1, gh: Math.ceil(S.ih / cs) + 1, cs };
  S.scratch = null;
}
/** Copy-on-write: a stroke edits a fresh copy so undo snapshots stay intact. */
function beginStroke() {
  const W_ = S.warp, n = W_.gw * W_.gh * 2;
  const field = W_.field ? W_.field.slice() : new Float32Array(n);
  S.warp = { ...W_, field };
  if (!S.scratch || S.scratch.length !== n) S.scratch = new Float32Array(n);
  S.scratch.set(field);
}
const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/**
 * One brush dab in P space.  push: content moves by d.  bloat / pinch: magnify / shrink
 * around the centre.  restore: relax back toward the original photo.
 */
function morphDab(pc, d, R, mode, amt) {
  const W_ = S.warp, f = W_.field, old = S.scratch, cs = W_.cs, gw = W_.gw, gh = W_.gh;
  if (!f || R < 1) return;
  const i0 = Math.max(0, Math.floor((pc.x - R) / cs)), i1 = Math.min(gw - 1, Math.ceil((pc.x + R) / cs));
  const j0 = Math.max(0, Math.floor((pc.y - R) / cs)), j1 = Math.min(gh - 1, Math.ceil((pc.y + R) / cs));
  if (i1 < i0 || j1 < j0) return;
  const hard = clamp(cfg.mHard, 0, 1) * .85, R2 = R * R;
  const nw = i1 - i0 + 1, nh = j1 - j0 + 1;
  // Beta · protect hair & background: weight each node by how much its colour matches the skin under the brush
  let mask = null;
  if (cfg.mProtect && mode !== 'restore' && S.stroke && S.stroke.ref) {
    const ref = S.stroke.ref, sg2 = 2 * 34 * 34;
    mask = new Float32Array(nw * nh);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = (j * gw + i) * 2, col = colorAt(i * cs + old[idx], j * cs + old[idx + 1]);
      const dr = col[0] - ref[0], dg = col[1] - ref[1], db = col[2] - ref[2];
      const d2 = (2 * dr * dr + 4 * dg * dg + 3 * db * db) / 9;
      mask[(j - j0) * nw + (i - i0)] = .06 + .94 * Math.exp(-d2 / sg2);
    }
    // feather the edge in proportion to the brush so skin/hair borders bend smoothly instead of tearing
    const passes = clamp(Math.round(R / cs / 6), 2, 10);
    for (let k = 0; k < passes; k++) blurGrid(mask, nw, nh);
  }
  for (let j = j0; j <= j1; j++) {
    const y = j * cs, dy = y - pc.y;
    for (let i = i0; i <= i1; i++) {
      const x = i * cs, dx = x - pc.x, r2 = dx * dx + dy * dy;
      if (r2 >= R2) continue;
      let w = (1 - smooth01(hard, 1, Math.sqrt(r2) / R)) * amt;
      if (mask) w *= mask[(j - j0) * nw + (i - i0)];
      if (w <= 0) continue;
      const idx = (j * gw + i) * 2;
      if (mode === 'restore') { f[idx] = old[idx] * (1 - w); f[idx + 1] = old[idx + 1] * (1 - w); continue; }
      let qx, qy;
      if (mode === 'push') { qx = x - w * d.x; qy = y - w * d.y; }
      else { const s = mode === 'bloat' ? 1 - w : 1 + w; qx = pc.x + dx * s; qy = pc.y + dy * s; }
      const o = fieldAt(old, qx, qy);
      f[idx] = o[0] + qx - x; f[idx + 1] = o[1] + qy - y;
    }
  }
  // Beta · limit stretching: hold back changes wherever they would stretch or squash beyond ~1.7×
  if (cfg.mLimit && mode !== 'restore') {
    // Scale the whole dab (never parts of it — partial freezing would itself create hard
    // stretch lines) to the largest strength that keeps every node within the limits,
    // or no worse than it already was.
    const delta = new Float32Array(nw * nh * 2), before = new Float32Array(nw * nh);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = (j * gw + i) * 2, k = (j - j0) * nw + (i - i0);
      delta[k * 2] = f[idx] - old[idx]; delta[k * 2 + 1] = f[idx + 1] - old[idx + 1];
      before[k] = stretchBad(old, i, j);
    }
    const apply = a => {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const idx = (j * gw + i) * 2, k = (j - j0) * nw + (i - i0);
        f[idx] = old[idx] + delta[k * 2] * a; f[idx + 1] = old[idx + 1] + delta[k * 2 + 1] * a;
      }
    };
    const ok = () => {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (stretchBad(f, i, j) > before[(j - j0) * nw + (i - i0)] + 1e-4) return false;
      }
      return true;
    };
    if (!ok()) {
      let lo = 0, hi = 1;
      for (let it = 0; it < 7; it++) { const mid = (lo + hi) / 2; apply(mid); if (ok()) lo = mid; else hi = mid; }
      apply(lo);
    }
  }
  for (let j = j0; j <= j1; j++) old.set(f.subarray((j * gw + i0) * 2, (j * gw + i1 + 1) * 2), (j * gw + i0) * 2);
  S.fieldDirty = true;
}
/** How far the mapping at node (i, j) exceeds the stretch limits (0 = fine). */
function stretchBad(buf, i, j) {
  const W_ = S.warp, gw = W_.gw, gh = W_.gh, cs = W_.cs;
  const il = Math.max(0, i - 1), ir = Math.min(gw - 1, i + 1), jt = Math.max(0, j - 1), jb = Math.min(gh - 1, j + 1);
  const L = (j * gw + il) * 2, Rr = (j * gw + ir) * 2, T = (jt * gw + i) * 2, B = (jb * gw + i) * 2;
  const hx = (ir - il) * cs || 1, hy = (jb - jt) * cs || 1;
  const a = 1 + (buf[Rr] - buf[L]) / hx, b = (buf[B] - buf[T]) / hy;
  const c = (buf[Rr + 1] - buf[L + 1]) / hx, d = 1 + (buf[B + 1] - buf[T + 1]) / hy;
  const det = a * d - b * c;
  if (det <= 0) return 2;
  const E = (a * a + b * b + c * c + d * d) / 2;
  const smax = Math.sqrt(E + Math.sqrt(Math.max(0, E * E - det * det))), smin = det / smax;
  return Math.max(0, .58 - smin) + Math.max(0, smax - 1.75);
}
/** 3×3 box blur in place (edges clamped). */
function blurGrid(a, w, h) {
  const t = new Float32Array(a.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= h) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= w) continue; s += a[jj * w + ii]; n++; } }
    t[j * w + i] = s / n;
  }
  a.set(t);
}
/** A small CPU copy of the photo, used to read colours for “Protect hair & background”. */
function ensurePix() {
  if (S.pix && S.pix.rec === S.imgRec) return S.pix;
  const sc = Math.min(1, 768 / Math.max(S.iw, S.ih));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(S.iw * sc)); c.height = Math.max(1, Math.round(S.ih * sc));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(S.img, 0, 0, c.width, c.height);
  S.pix = { rec: S.imgRec, data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, sc };
  return S.pix;
}
function colorAt(x, y) {
  const P_ = S.pix;
  if (!P_) return [0, 0, 0];
  const i = clamp(Math.round(x * P_.sc), 0, P_.w - 1), j = clamp(Math.round(y * P_.sc), 0, P_.h - 1), k = (j * P_.w + i) * 4;
  return [P_.data[k], P_.data[k + 1], P_.data[k + 2]];
}
/** Average skin colour under the brush centre at the start of a stroke. */
function strokeRef(v) {
  ensurePix();
  const { pc, R } = brushAt(v), acc = [0, 0, 0];
  const pts = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos(i / 8 * TAU) * .18, Math.sin(i / 8 * TAU) * .18])];
  for (const [ox, oy] of pts) {
    const s = pToS({ x: pc.x + ox * R, y: pc.y + oy * R }), c = colorAt(s.x, s.y);
    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
  }
  return acc.map(v_ => v_ / pts.length);
}
const brushV = () => cfg.mSize * Math.max(S.iw, S.ih);   // brush radius in view px
function brushAt(v) {
  const pc = vToP(v), e = vToP({ x: v.x + brushV(), y: v.y });
  return { pc, R: dist(pc, e) };
}
/** Push along the cursor path in small steps so drags read as natural, not smeared. */
function morphPush(v0, v1) {
  const R = brushV(), n = Math.max(1, Math.ceil(dist(v0, v1) / (R * .08)));
  for (let s = 0; s < n; s++) {
    const a = { x: v0.x + (v1.x - v0.x) * s / n, y: v0.y + (v1.y - v0.y) * s / n };
    const b = { x: v0.x + (v1.x - v0.x) * (s + 1) / n, y: v0.y + (v1.y - v0.y) * (s + 1) / n };
    const { pc, R: rp } = brushAt(a), pb = vToP(b);
    morphDab(pc, { x: pb.x - pc.x, y: pb.y - pc.y }, rp, 'push', cfg.mStrength);
  }
  syncPts();
}

/* ---------------------------------------------------------------- theme -- */

const mqDark = matchMedia('(prefers-color-scheme: dark)');
const grid = { dirty: true, base: null, rgb: '255,255,255', a0: .075, a1: .2, ox: 0, oy: 0, cols: 0, rows: 0, energy: null, active: new Set(), lx: null, ly: null, inside: false, needs: true };

function applyTheme() {
  const t = cfg.theme === 'system' ? (mqDark.matches ? 'dark' : 'light') : cfg.theme;
  root.dataset.theme = t;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#080A0F' : '#EFF2F7';
  grid.rgb = getComputedStyle(root).getPropertyValue('--dot-rgb').trim() || '175,195,255';
  grid.a0 = t === 'dark' ? .085 : .13;
  grid.a1 = t === 'dark' ? .32 : .3;
  grid.dirty = true;
}
mqDark.addEventListener && mqDark.addEventListener('change', () => { if (cfg.theme === 'system') applyTheme(); });

function applyCfg() {
  root.style.setProperty('--c1', cfg.c1);
  root.style.setProperty('--c2', cfg.c2);
  root.style.setProperty('--c3', cfg.c3);
  applyTheme();
  grid.needs = true;
  $('#btnLoupe').classList.toggle('on', !!cfg.loupe);
  wake();
}

/* -------------------------------------------------------------- resize -- */

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  W = innerWidth; H = innerHeight;
  for (const c of [ov, bg, imgcv]) {
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    c.style.width = W + 'px'; c.style.height = H + 'px';
  }
  loupe.width = loupe.height = Math.round(LOUPE * dpr);
  grid.dirty = true;
  imgKey = '';
  wake();
}

/* ------------------------------------------------------- measurements -- */

function topo(kind) {
  switch (kind) {
    case 'ratio': return [[0, 1, 1], [2, 3, 2]];
    case 'angle': return [[0, 1, 3], [1, 2, 3]];
    case 'tilt': return [[0, 1, 3]];
    case 'calib': return [[0, 1, 0]];
    case 'ruler': return [[0, 1, 1]];
  }
  return [];
}
const connects = (kind, idx) => kind === 'segments' || topo(kind).some(([i, j]) => j === idx && i === idx - 1);
const customs = () => [...S.meas.values()].filter(m => !m.preset);
const rulerCount = () => { let n = 0; for (const m of S.meas.values()) if (m.kind === 'ruler') n++; return n; };
const segBase = m => (m.preset && P[m.preset].base) || 0;
const titleOf = m => m.preset ? P[m.preset].name : (m.name || KIND_LABEL[m.kind]);

function colorIdx(m, ci) {
  if (ci === 0) return '#F2F2F3';
  if (m.kind === 'ruler') return m.id === S.refId && rulerCount() > 1 ? cfg.c2 : cfg.c1;
  return ci === 2 ? cfg.c2 : ci === 3 ? cfg.c3 : cfg.c1;
}
function nodeColor(m, i) {
  if (m.kind === 'segments') return Math.min(i, Math.max(0, m.pts.length - 2)) % 2 ? cfg.c2 : cfg.c1;
  const s = topo(m.kind).find(([a, b]) => a === i || b === i);
  return colorIdx(m, s ? s[2] : 1);
}
const mainColor = m => m.kind === 'angle' || m.kind === 'tilt' ? cfg.c3 : m.kind === 'calib' ? '#F2F2F3' : colorIdx(m, 1);

function mmPerPx() {
  const c = S.meas.get(S.calibId);
  if (!c) return 0;
  const L = dist(c.pts[0], c.pts[1]);
  return L > 0 ? S.calibMM / L : 0;
}
function refLen(m) {
  const ref = S.meas.get(S.refId);
  if (!ref || ref.kind !== 'ruler') return 0;
  if (m.id === ref.id) {
    for (const o of S.meas.values()) if (o.kind === 'ruler' && o !== ref) return dist(ref.pts[0], ref.pts[1]);
    return 0;
  }
  return dist(ref.pts[0], ref.pts[1]);
}

/** Target numeric values for a measurement (what the display counts toward). */
function targets(m) {
  const p = m.pts, n = p.length, o = {};
  switch (m.kind) {
    case 'ratio':
      if (n >= 4) { const b = dist(p[2], p[3]); if (b > 0) o.v = dist(p[0], p[1]) / b; }
      break;
    case 'angle': if (n >= 3) o.v = angleAt(p[0], p[1], p[2]); break;
    case 'tilt': if (n >= 2) o.v = tiltOf(p[0], p[1]); break;
    case 'ruler':
      if (n >= 2) {
        const L = dist(p[0], p[1]); o.len = L;
        const r = refLen(m); if (r) o.v = L / r;
        const s = mmPerPx(); if (s) o.mm = L * s;
      }
      break;
    case 'segments':
      if (n >= 2) {
        const { lens } = segInfo(p), b = segBase(m);
        if (lens.length > b && lens[b] > 0) lens.forEach((x, i) => { o['s' + i] = x / lens[b]; });
      }
      break;
  }
  return o;
}

const precOf = (kind, k) => k === 'len' ? 1 : k === 'mm' ? 0.1 : (kind === 'angle' || kind === 'tilt') ? 0.1 : 0.01;

/** Ease displayed values toward their targets so numbers count rather than jump. */
function tween(d, tg, dt, kind) {
  let moving = false, blur = 0;
  for (const k in d) if (k[0] !== '_' && !(k in tg)) delete d[k];
  for (const k in tg) {
    const t = tg[k];
    if (!Number.isFinite(t)) continue;
    if (d[k] === undefined) d[k] = cfg.motion && k !== 'len' ? 0 : t;
    const diff = t - d[k], pr = precOf(kind, k);
    if (!cfg.motion || Math.abs(diff) <= pr * 0.5) { d[k] = t; continue; }
    d[k] += diff * (1 - Math.exp(-dt * 13));
    moving = true;
    blur = Math.max(blur, clamp(Math.abs(diff) / (pr * 30), 0, 1));
  }
  d._b = blur;
  return moving;
}

function rulerText(d) {
  if (d.v != null) return d.v.toFixed(2) + 'x' + (d.mm != null ? ' · ' + d.mm.toFixed(1) + ' mm' : '');
  if (d.mm != null) return d.mm.toFixed(1) + ' mm';
  if (d.len != null) return Math.round(d.len) + ' px';
  return '—';
}
function fmt(m, d = m.disp) {
  const v = d.v;
  switch (m.kind) {
    case 'ratio': return v == null ? '—' : v.toFixed(2) + 'x';
    case 'angle': return v == null ? '—' : v.toFixed(1) + '°';
    case 'tilt': return v == null ? '—' : (v < -0.05 ? '−' : '+') + Math.abs(v).toFixed(1) + '°';
    case 'ruler': return rulerText(d);
    case 'calib': return fmtNum(S.calibMM) + ' mm';
    case 'segments': {
      const a = [];
      for (let i = 0; ('s' + i) in d; i++) a.push(d['s' + i].toFixed(2));
      return a.length ? a.join(' : ') : '—';
    }
  }
  return '—';
}
function refText(it) {
  const [a, b] = it.ref;
  if (it.kind === 'angle') return `${a}–${b}°`;
  if (it.kind === 'tilt') return `+${a}° to +${b}°`;
  return `${a.toFixed(2)}–${b.toFixed(2)}`;
}
function subText(it) {
  if (it.kind === 'segments') return `Proportions · ${it.ideal.join(' : ')}`;
  return `${KIND_LABEL[it.kind]} · ref ${refText(it)}`;
}
function isVisible(m) {
  if (S.showAll) return true;
  if (S.sel.length) return S.sel.includes(m.id);
  return !m.preset;
}
function mkMeas(o) {
  return {
    id: o.id, preset: o.preset || null, kind: o.kind, name: o.name || null,
    pts: o.pts.map(p => ({ x: p.x, y: p.y })),
    src: o.src ? o.src.map(p => ({ x: p.x, y: p.y })) : null,
    times: null, disp: {}, alpha: 0, shown: now(), wasVis: false, painted: 0,
  };
}
function autoName(kind) {
  if (kind === 'calib') return 'Scale';
  let n = 1;
  for (const m of S.meas.values()) if (!m.preset && m.kind === kind) n++;
  return `${KIND_LABEL[kind]} ${n}`;
}

/* ---------------------------------------------------------- undo/redo -- */

function snapshot() {
  const cp = p => ({ x: p.x, y: p.y });
  return {
    img: S.imgRec,
    adj: { ...S.adj, ell: S.adj.ell ? { ...S.adj.ell } : null },
    warp: S.warp,   // field arrays are copy-on-write, so sharing the reference is safe
    list: [...S.meas.values()].map(m => ({ id: m.id, preset: m.preset, kind: m.kind, name: m.name, pts: m.pts.map(cp), src: m.src ? m.src.map(cp) : null })),
    refId: S.refId, calibId: S.calibId, calibMM: S.calibMM, seq: S.seq,
  };
}
function pushUndo(s = snapshot()) {
  S.undo.push(s);
  if (S.undo.length > 150) S.undo.shift();
  // morph fields are large — keep at most ~24 distinct ones in history
  const fields = () => new Set(S.undo.map(u => u.warp && u.warp.field).filter(Boolean)).size;
  while (S.undo.length > 1 && fields() > 24) S.undo.shift();
  S.redo = [];
}
function restore(s) {
  const imgChanged = s.img !== S.imgRec;
  if (imgChanged) setImageState(s.img);
  if (s.adj) S.adj = { ...DEFAULT_ADJ(), ...s.adj, ell: s.adj.ell ? { ...s.adj.ell } : null };
  if (s.warp) { S.warp = s.warp; S.fieldDirty = true; }
  S.glDirty = true;
  const old = S.meas;
  S.meas = new Map();
  for (const o of s.list) {
    const m = mkMeas(o), prev = imgChanged ? null : old.get(o.id);
    if (prev) Object.assign(m, { disp: prev.disp, alpha: prev.alpha, wasVis: prev.wasVis, shown: prev.shown, times: prev.times });
    if (m.src) m.pts = m.src.map(invMap); else anchor(m);
    S.meas.set(o.id, m);
  }
  syncToolOpts();
  if (!imgChanged) for (const [id, m] of old) if (!S.meas.has(id)) startLeave(m);
  Object.assign(S, { refId: s.refId, calibId: s.calibId, calibMM: s.calibMM, seq: Math.max(S.seq, s.seq), draft: null, draftM: null, drag: null, mdrag: null, hover: null });
  S.sel = S.sel.filter(id => P[id] || S.meas.has(id));
  if (S.active && !S.sel.includes(S.active)) S.active = S.sel[S.sel.length - 1] || null;
  S.picked = new Set([...S.picked].filter(id => S.meas.has(id)));
  syncUI();
}
function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }

/* -------------------------------------------------------- create/delete -- */

function placeTarget() {
  if (!S.img || EDIT_TOOLS.has(S.tool) || !(S.tool in KIND_N || S.tool === 'move')) return null;   // unknown tools never place points
  if (S.sel.length) {
    const pick = [S.active, ...S.sel].find(id => id && P[id] && S.sel.includes(id) && !S.meas.has(id));
    return pick ? { kind: P[pick].kind, preset: pick } : null;
  }
  if (S.tool === 'move') return null;
  return { kind: S.tool, preset: null };
}
const canPlace = () => !!S.img && (!!S.draft || !!placeTarget());
/** With nothing to place, the canvas behaves like the Select tool. */
const selectMode = () => !!S.img && !S.draft && !placeTarget() && !EDIT_TOOLS.has(S.tool);

function startDraft(tgt) {
  S.draft = {
    kind: tgt.kind, preset: tgt.preset,
    need: tgt.preset ? P[tgt.preset].pts.length : KIND_N[tgt.kind],
    pts: [], times: [], disp: {}, lastT: 0, lastS: null,
  };
  S.picked.clear();
}
function addPoint(ip, sx, sy, shift) {
  const d = S.draft;
  if (shift && d.pts.length && connects(d.kind, d.pts.length)) ip = snapAngle(d.pts[d.pts.length - 1], ip);
  d.pts.push(ip); d.times.push(now());
  d.lastT = now(); d.lastS = { x: sx, y: sy };
  if (d.need && d.pts.length >= d.need) commitDraft();
  else syncUI();
}
function cancelDraft(animate) {
  if (!S.draft) return;
  if (animate && S.draftM && S.draft.pts.length > 1) startLeave(S.draftM);
  S.draft = null; S.draftM = null;
  syncUI();
}
function commitDraft() {
  const d = S.draft;
  S.draft = null; S.draftM = null;
  if (!d) return;
  const segs = d.kind === 'segments' ? [[0, d.pts.length - 1]] : topo(d.kind);
  for (const [i, j] of segs) {
    if (dist(d.pts[i], d.pts[j]) * S.view.k < 4) { toast('Too short — try again'); syncUI(); return; }
  }
  pushUndo();
  if (d.kind === 'calib' && S.calibId) {
    const old = S.meas.get(S.calibId);
    if (old) { startLeave(old); S.meas.delete(old.id); }
  }
  const id = d.preset || 'c' + (++S.seq);
  const m = mkMeas({ id, preset: d.preset, kind: d.kind, name: d.preset ? null : autoName(d.kind), pts: d.pts });
  Object.assign(m, { times: d.times, disp: d.disp, alpha: 1, shown: now() - 2000, wasVis: true, painted: now() });
  anchor(m);
  S.meas.set(id, m);
  if (d.kind === 'ruler' && !(S.meas.get(S.refId) && S.meas.get(S.refId).kind === 'ruler')) S.refId = id;
  if (d.kind === 'calib') { S.calibId = id; openCalib(m, true); }
  syncUI();
}
function removeOne(id) {
  const m = S.meas.get(id);
  if (!m) return;
  startLeave(m);
  S.meas.delete(id);
  if (S.refId === id) { S.refId = null; for (const o of S.meas.values()) if (o.kind === 'ruler') { S.refId = o.id; break; } }
  if (S.calibId === id) S.calibId = null;
  S.picked.delete(id);
  if (S.hover && S.hover.id === id) S.hover = null;
  if (!P[id]) {
    S.sel = S.sel.filter(x => x !== id);
    if (S.active === id) S.active = S.sel[S.sel.length - 1] || null;
  }
}
function removeMany(ids) {
  ids = ids.filter(id => S.meas.has(id));
  if (!ids.length) return;
  pushUndo();
  ids.forEach(removeOne);
  syncUI();
  if (ids.length > 1) toast(`Deleted ${ids.length} measurements · Ctrl Z to undo`);
}
const removeMeas = id => removeMany([id]);

function pickAll() {
  const ids = [...S.meas.values()].filter(isVisible).map(m => m.id);
  if (S.draft) cancelDraft();
  S.picked = new Set(ids);
  syncUI();
  toast(ids.length ? `${ids.length} selected · Del to delete · Esc to clear` : 'Nothing to select here');
}
function deleteSelection() {
  const ids = [...S.picked].filter(id => S.meas.has(id) && isVisible(S.meas.get(id)));
  if (ids.length) { removeMany(ids); return; }
  const id = (S.hover && S.hover.id) || (S.sel.length === 1 && S.meas.has(S.sel[0]) ? S.sel[0] : null);
  if (id) removeMany([id]);
}

/* ------------------------------------------------------- leave & motes -- */

/** Screen-space coloured segments of a measurement (for hit tests and effects). */
function screenSegs(m) {
  const s = m.pts.map(toS);
  if (m.kind === 'segments') {
    if (s.length < 2) return [];
    const { q } = segInfo(s), out = [];
    for (let i = 0; i < q.length - 1; i++) out.push([q[i], q[i + 1], i % 2 ? cfg.c2 : cfg.c1]);
    return out;
  }
  return topo(m.kind).filter(([, j]) => j < s.length).map(([i, j, ci]) => [s[i], s[j], colorIdx(m, ci)]);
}
/** Removal: a quick, smooth draw-back toward the centre while thinning and fading. */
function startLeave(m) {
  if (!cfg.motion || !S.img || m.alpha < .05) return;
  const ghost = { ...m, pts: m.pts.map(p => ({ ...p })), disp: { ...m.disp }, painted: 0 };
  S.leaving.push({ m: ghost, t0: now(), alpha: m.alpha });
  wake(800);
}

/* -------------------------------------------------------------- drawing -- */

/**
 * Stroke a → b between fractions f0..f1.
 * fx: { halo, pulse (0..1 creation flash), head (draw-in tip) }
 */
function seg(ctx, a, b, col, lw, u, f0, f1, fx) {
  if (f1 - f0 <= 0.0005) return;
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  const x0 = a.x + dx * f0, y0 = a.y + dy * f0, x1 = a.x + dx * f1, y1 = a.y + dy * f1;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  if (fx && fx.halo) { ctx.strokeStyle = rgba(col, .2); ctx.lineWidth = lw + 7 * u; ctx.stroke(); }
  if (fx && fx.pulse > 0) { ctx.strokeStyle = rgba(col, .4 * fx.pulse); ctx.lineWidth = lw + (1 - fx.pulse) * 9 * u + 2 * u; ctx.stroke(); }
  ctx.strokeStyle = 'rgba(0,0,0,.34)'; ctx.lineWidth = lw + 1.8 * u; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
  if (!fx) return;
  if (fx.head) {
    const r = 7 * u, gr = ctx.createRadialGradient(x1, y1, 0, x1, y1, r);
    gr.addColorStop(0, rgba(col, .55)); gr.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x1, y1, r, 0, TAU); ctx.fill();
  }
}
function dashed(ctx, a, b, u, alpha = .55) {
  if (dist(a, b) < .5) return;
  ctx.save();
  ctx.setLineDash([3 * u, 4 * u]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 2.4 * u; ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = u; ctx.stroke();
  ctx.restore();
}
function node(ctx, p, col, u, s, hov, picked, ghost) {
  if (s <= .01) return;
  const r = 3.4 * u * s * (hov ? 1.35 : 1);
  ctx.save();
  if (ghost) ctx.globalAlpha *= .5;
  if (hov) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    g.addColorStop(0, rgba(col, .3)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3, 0, TAU); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.5 * u, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,.36)'; ctx.fill();
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.fillStyle = picked ? col : 'rgba(14,15,18,.8)'; ctx.fill();
  ctx.lineWidth = 1.4 * u; ctx.strokeStyle = col; ctx.stroke();
  ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.5, 1.05 * u * s), 0, TAU);
  ctx.fillStyle = picked ? '#0E0F12' : '#FFFFFF'; ctx.fill();
  ctx.restore();
}
/**
 * Value label: no box — just the number with a thin dark halo and a small colour tick,
 * so it stays readable on any photo while covering as little of it as possible.
 * Candidates are tried in order until one does not collide with an earlier label.
 */
function label(ctx, text, cands, col, o, alpha, blur, muted) {
  if (alpha <= 0.01) return;
  const u = o.u, fs = cfg.label * u;
  ctx.font = `500 ${fs}px ${MONO}`;
  const tw = ctx.measureText(text).width;
  const w = tw + 8 * u, h = fs + 3 * u;
  let r = null;
  for (const c of cands) {
    const cx = c.x + (c.ax || 0) * w / 2, cy = c.y + (c.ay || 0) * h / 2;
    const rr = { x: cx - w / 2, y: cy - h / 2, w, h };
    if (!r) r = rr;
    const hit = o.labels.some(q => rr.x < q.x + q.w + 3 && rr.x + rr.w + 3 > q.x && rr.y < q.y + q.h + 3 && rr.y + rr.h + 3 > q.y);
    if (!hit) { r = rr; break; }
  }
  o.labels.push(r);
  const y = r.y + (1 - alpha) * 2 * u;
  ctx.save();
  ctx.globalAlpha *= alpha * (muted ? .75 : 1);
  // colour tick
  roundRect(ctx, r.x + u, y + h * .22, 2 * u, h * .56, u);
  ctx.fillStyle = 'rgba(8,10,16,.55)'; ctx.fill();
  roundRect(ctx, r.x + 1.4 * u, y + h * .25, 1.4 * u, h * .5, .7 * u);
  ctx.fillStyle = col; ctx.fill();
  // text with halo
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const tx = r.x + 6.5 * u, ty = y + h / 2 + .5 * u;
  ctx.strokeStyle = 'rgba(8,10,16,.62)'; ctx.lineWidth = 3 * u;
  ctx.strokeText(text, tx, ty);
  ctx.fillStyle = muted ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.95)';
  if (blur > 0.05) {
    ctx.save(); ctx.globalAlpha *= 0.2 * blur;
    ctx.fillText(text, tx, ty - 1.2 * u); ctx.fillText(text, tx, ty + 1.2 * u);
    ctx.restore();
  }
  ctx.fillText(text, tx, ty);
  ctx.restore();
}
/** Unit normal of a→b pointing up (or right, for steep lines) — labels sit beside the line, not on it. */
function sideNormal(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  let nx = -dy / L, ny = dx / L;
  if (Math.abs(dy) > Math.abs(dx) ? nx < 0 : ny > 0) { nx = -nx; ny = -ny; }
  return { nx, ny };
}
function lineLabel(ctx, a, b, text, col, o, alpha, blur, muted) {
  const { nx, ny } = sideNormal(a, b), off = 5 * o.u, cands = [];
  for (const f of [.5, .34, .66, .2, .8]) {
    const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
    cands.push({ x: x + nx * off, y: y + ny * off, ax: nx, ay: ny });
    cands.push({ x: x - nx * off, y: y - ny * off, ax: -nx, ay: -ny });
  }
  label(ctx, text, cands, col, o, alpha, blur, muted);
}
function tag(ctx, text, x, y) {
  ctx.save();
  ctx.font = `500 11.5px ${FONT}`;
  const w = ctx.measureText(text).width + 16, h = 22;
  let tx = x + 18, ty = y + 18;
  if (tx + w > W - 8) tx = x - 18 - w;
  if (ty + h > H - 8) ty = y - 18 - h;
  roundRect(ctx, tx, ty, w, h, 6);
  ctx.fillStyle = 'rgba(13,14,17,.86)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle';
  ctx.fillText(text, tx + 8, ty + h / 2 + .5);
  ctx.restore();
}

/**
 * Draw one measurement.
 * o: { toS, u (scale), t (time), alpha, labels[], hl, picked, final, disp, ghost, leave }
 */
function drawMeas(ctx, m, o) {
  const pts = m.pts.map(o.toS), n = pts.length;
  if (!n) return;
  const u = o.u, d = o.disp || m.disp, t = o.t, fin = !!o.final;
  const lv = o.leave == null ? -1 : o.leave;
  const age = fin ? 1e9 : t - m.shown;
  // removal: lines draw back toward their centres while thinning and fading (lv: 0 → 1)
  const prog = fin || lv >= 0 ? 1 : ease(age / 280);
  const f0 = lv >= 0 ? lv / 2 : 0, f1 = lv >= 0 ? 1 - lv / 2 : prog;
  const sweep = lv >= 0 ? 1 - lv : prog;
  const la = fin ? 1 : lv >= 0 ? clamp(1 - lv * 2.5, 0, 1) : ease((age - 60) / 200);
  const pg = fin || lv >= 0 || !m.painted ? 1 : (t - m.painted) / PAINT_MS;
  const fx = { halo: !fin && !!o.picked && lv < 0, pulse: pg < 1 ? 1 - ease(pg) : 0, head: !fin && lv < 0 && prog < 1 };
  const fxAt = () => fx;
  const lw = cfg.width * u * (o.hl && !fin ? 1.25 : 1) * (lv >= 0 ? 1 - lv * .55 : 1);
  const blur = fin ? 0 : (d._b || 0);
  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (m.kind === 'segments') {
    if (n >= 2) drawSegments(ctx, m, pts, d, o, { f0, f1, prog, lv, la, lw, blur, fx, fxAt });
  } else {
    topo(m.kind).forEach(([i, j, ci], k) => { if (j < n) seg(ctx, pts[i], pts[j], colorIdx(m, ci), lw, u, f0, f1, fxAt(k)); });

    if (m.kind === 'ratio' && n >= 4 && d.v != null) {
      lineLabel(ctx, pts[0], pts[1], d.v.toFixed(2) + 'x', cfg.c1, o, la, blur);
      lineLabel(ctx, pts[2], pts[3], '1.00x', cfg.c2, o, la, 0, true);
    }
    if (m.kind === 'ruler' && n >= 2) lineLabel(ctx, pts[0], pts[1], rulerText(d), colorIdx(m, 1), o, la, blur);
    if (m.kind === 'calib' && n >= 2) lineLabel(ctx, pts[0], pts[1], fmtNum(S.calibMM) + ' mm', '#F2F2F3', o, la, 0);

    if (m.kind === 'angle' && n >= 3) {
      const [a, v, b] = pts;
      const a1 = Math.atan2(a.y - v.y, a.x - v.x), a2 = Math.atan2(b.y - v.y, b.x - v.x);
      const del = normAng(a2 - a1);
      const r = Math.min(26 * u, 0.38 * Math.min(dist(a, v), dist(b, v)));
      if (r > 3 * u && sweep > 0) {
        ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.arc(v.x, v.y, r, a1, a1 + del * sweep, del < 0); ctx.closePath();
        ctx.fillStyle = rgba(cfg.c3, .08); ctx.fill();
        ctx.beginPath(); ctx.arc(v.x, v.y, r, a1, a1 + del * sweep, del < 0);
        ctx.strokeStyle = cfg.c3; ctx.lineWidth = Math.max(u, lw * .8); ctx.stroke();
      }
      if (d.v != null) {
        const mid = a1 + del / 2, c = Math.cos(mid), s = Math.sin(mid), R = Math.max(r, 10 * u) + 10 * u;
        label(ctx, fmt(m, d), [
          { x: v.x + c * R, y: v.y + s * R, ax: c, ay: s },
          { x: v.x + c * (R + 22 * u), y: v.y + s * (R + 22 * u), ax: c, ay: s },
          { x: v.x - c * R, y: v.y - s * R, ax: -c, ay: -s },
        ], cfg.c3, o, la, blur);
      }
    }

    if (m.kind === 'tilt' && n >= 2) {
      const [a, b] = pts, L = dist(a, b);
      if (L > 1) {
        const sg = b.x >= a.x ? 1 : -1;
        dashed(ctx, a, { x: a.x + sg * L * sweep, y: a.y }, u);
        const h0 = sg > 0 ? 0 : Math.PI, ang = Math.atan2(b.y - a.y, b.x - a.x), del = normAng(ang - h0);
        const r = Math.min(38 * u, L * .6);
        if (sweep > 0) {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, r, h0, h0 + del * sweep, del < 0); ctx.closePath();
          ctx.fillStyle = rgba(cfg.c3, .08); ctx.fill();
          ctx.beginPath(); ctx.arc(a.x, a.y, r, h0, h0 + del * sweep, del < 0);
          ctx.strokeStyle = cfg.c3; ctx.lineWidth = Math.max(u, lw * .8); ctx.stroke();
        }
        if (d.v != null) {
          const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
          label(ctx, fmt(m, d), [
            { x: b.x + ux * 12 * u, y: b.y + uy * 12 * u, ax: ux, ay: uy },
            { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 14 * u, ax: 0, ay: -1 },
            { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 14 * u, ax: 0, ay: 1 },
          ], cfg.c3, o, la, blur);
        }
      }
    }
  }

  // nodes
  const hov = S.hover, drag = S.drag;
  for (let i = 0; i < n; i++) {
    let s = 1;
    if (!fin) {
      if (lv >= 0) s = 1 - ease(clamp(lv * 1.25, 0, 1));
      else {
        const base = Math.max(m.times && m.times[i] != null ? m.times[i] : -1e9, m.shown + i * 25);
        s = ease((t - base) / 180);
      }
    }
    const isHov = !fin && lv < 0 && ((hov && hov.id === m.id && hov.node === i) || (drag && drag.id === m.id && drag.i === i));
    node(ctx, pts[i], nodeColor(m, i), u, s, isHov, !fin && !!o.picked, i === o.ghost);
  }
  ctx.restore();
}

function drawSegments(ctx, m, pts, d, o, s) {
  const u = o.u;
  const { q, lens, ux, uy } = segInfo(pts);
  const nx = -uy, ny = ux;
  const fade = s.lv >= 0 ? 1 - s.lv : s.prog;
  for (let i = 0; i < pts.length; i++) if (dist(pts[i], q[i]) > 2 * u) dashed(ctx, pts[i], q[i], u, .4 * fade);
  const T = lens.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    const col = i % 2 ? cfg.c2 : cfg.c1, len = lens[i] || 1e-6;
    const fx = s.fxAt(i);
    if (s.lv >= 0) seg(ctx, q[i], q[i + 1], col, s.lw, u, s.f0, s.f1, fx);
    else {
      const sp = clamp((s.prog * T - acc) / len, 0, 1);
      seg(ctx, q[i], q[i + 1], col, s.lw, u, 0, sp, { ...fx, head: fx.head && sp > 0 && sp < 1 });
    }
    acc += lens[i];
  }
  const tl = 6 * u * fade;
  if (tl > .3) {
    for (let i = 0; i < q.length; i++) {
      seg(ctx, { x: q[i].x - nx * tl, y: q[i].y - ny * tl }, { x: q[i].x + nx * tl, y: q[i].y + ny * tl }, 'rgba(255,255,255,.85)', Math.max(u, s.lw * .75), u, 0, 1, null);
    }
  }
  for (let i = 0; i < lens.length; i++) {
    const v = d['s' + i];
    if (v == null) continue;
    const mx = (q[i].x + q[i + 1].x) / 2, my = (q[i].y + q[i + 1].y) / 2, off = 10 * u;
    const sn = sideNormal(q[i], q[i + 1]);
    label(ctx, v.toFixed(2) + 'x', [
      { x: mx + sn.nx * off, y: my + sn.ny * off, ax: sn.nx, ay: sn.ny },
      { x: mx - sn.nx * off, y: my - sn.ny * off, ax: -sn.nx, ay: -sn.ny },
      { x: mx, y: my },
    ], i % 2 ? cfg.c2 : cfg.c1, o, s.la, s.blur, i === segBase(m));
  }
}

/* ------------------------------------------------------------ image layer -- */

let imgKey = '';
let glImgRec = null;
/** Upload the photo to the GPU (once per image), downscaling only if it exceeds the GPU limit. */
function ensureGLImage() {
  if (!GLR || !S.imgRec || glImgRec === S.imgRec) return;
  glImgRec = S.imgRec;
  const max = GLR.maxTex, sc = Math.min(1, max / Math.max(S.iw, S.ih));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(S.iw * sc)); c.height = Math.max(1, Math.round(S.ih * sc));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(S.img, 0, 0, c.width, c.height);
  GLR.setImage(c, c.width, c.height);
  S.fieldDirty = true;
}
function glParams(view, d, cw, ch, alpha) {
  const a = S.adj, e = a.ell;
  return {
    cw, ch, view, dpr: d, size: [S.iw, S.ih],
    rot: a.rot / DEG, scale: scaleXY(a), trans: [a.tx, a.ty],
    ell: e ? [e.cx, e.cy, e.ax, e.ay] : null, lensD: lensD(), zref: ZREF,
    morph: !!S.warp.field && !S.compare, cell: S.warp.cs, alpha,
  };
}
function drawImageLayer(dt) {
  if (S.img && S.imgA < 1) S.imgA = Math.min(1, S.imgA + dt * 2.4);
  const v = S.view;
  if (GLR) {
    try {
      if (!S.img) { if (imgKey !== 'none') { imgKey = 'none'; GLR.clear(); } return; }
      if (GLR.isLost()) { disableGL('broken'); return; }
      ensureGLImage();
      if (S.fieldDirty) { S.fieldDirty = false; GLR.setField(S.warp.field, S.warp.gw, S.warp.gh); S.glDirty = true; }
      const key = `${v.x.toFixed(2)}|${v.y.toFixed(2)}|${v.k.toFixed(6)}|${S.imgA.toFixed(3)}|${S.imgSeq}|${ov.width}x${ov.height}`;
      if (key === imgKey && !S.glDirty) return;
      imgKey = key; S.glDirty = false;
      GLR.render(glParams(v, dpr, ov.width, ov.height, ease(S.imgA)));
      if (S.imgA < 1) wake();
      return;
    } catch (err) {
      console.error(err);
      disableGL('broken');
    }
  }
  const key = S.img ? `${v.x.toFixed(2)}|${v.y.toFixed(2)}|${v.k.toFixed(6)}|${S.imgA.toFixed(3)}|${S.imgSeq}` : 'none';
  if (key === imgKey) return;
  imgKey = key;
  ictx.setTransform(1, 0, 0, 1, 0, 0);
  ictx.clearRect(0, 0, imgcv.width, imgcv.height);
  if (!S.img) return;
  // Draw straight from the original pixels at the current zoom, so zooming in never
  // shows a resampled low-resolution copy.
  ictx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
  ictx.imageSmoothingEnabled = true;
  ictx.imageSmoothingQuality = 'high';
  ictx.globalAlpha = ease(S.imgA);
  ictx.drawImage(S.img, 0, 0);
  ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ictx.strokeStyle = 'rgba(255,255,255,.07)'; ictx.lineWidth = 1;
  ictx.strokeRect(Math.round(v.x) - .5, Math.round(v.y) - .5, Math.round(S.iw * v.k) + 1, Math.round(S.ih * v.k) + 1);
  ictx.globalAlpha = 1;
  if (S.imgA < 1) wake();
}

/* --------------------------------------------------- edit-tool overlays -- */

function drawBrush(ctx, c) {
  const r = brushV() * S.view.k, hard = clamp(cfg.mHard, 0, 1) * .85;
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU);
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.stroke();
  if (hard > .05 && r * hard > 4) {
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.arc(c.x, c.y, r * hard, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath(); ctx.arc(c.x, c.y, 1.6, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
  ctx.restore();
}
/* Face frame lives in P (original photo) space: origin between nasion and menton,
   ax = half the bizygomatic width, ay = half the nasion–menton height. */
const pToScreen = p => toS(uToV(pToU(p)));
/** Screen positions of the face-frame handles (centre, cheekbone side, chin). */
function ellHandles() {
  const e = S.adj.ell;
  if (!e) return [];
  return [
    { id: 'c', p: pToScreen({ x: e.cx, y: e.cy }) },
    { id: 'x', p: pToScreen({ x: e.cx + e.ax, y: e.cy }) },
    { id: 'y', p: pToScreen({ x: e.cx, y: e.cy + e.ay }) },
  ];
}
/** Image-transform handles in screen space: the four corners and the rotate knob. */
function xfHandles() {
  const C = [{ x: 0, y: 0 }, { x: S.iw, y: 0 }, { x: S.iw, y: S.ih }, { x: 0, y: S.ih }].map(u => toS(uToV(u)));
  const top = toS(uToV({ x: S.iw / 2, y: 0 })), ctr = toS(uToV({ x: S.iw / 2, y: S.ih / 2 }));
  const L = Math.hypot(top.x - ctr.x, top.y - ctr.y) || 1;
  const knob = { x: top.x + (top.x - ctr.x) / L * 26, y: top.y + (top.y - ctr.y) / L * 26 };
  return { C, top, ctr, knob };
}
function outline(ctx, f, n = 72) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) { const p = f(i / n * TAU); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
}
function drawAdjustGuides(ctx) {
  const blue = getComputedStyle(root).getPropertyValue('--blue').trim() || '#7EA6FF';
  ctx.save();
  // export frame with faint level guides
  const a = toS({ x: 0, y: 0 }), b = toS({ x: S.iw, y: S.ih });
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 8; i++) {
    const y = Math.round(a.y + (b.y - a.y) * i / 8) + .5, x = Math.round(a.x + (b.x - a.x) * i / 8) + .5;
    ctx.moveTo(a.x, y); ctx.lineTo(b.x, y);
    ctx.moveTo(x, a.y); ctx.lineTo(x, b.y);
  }
  ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(b.x - a.x), Math.round(b.y - a.y));
  ctx.setLineDash([]);

  // face + modelled head outline used by the lens correction
  const e = S.adj.ell;
  if (e && S.adj.lens > 0) {
    const fr = (X, Y) => pToScreen({ x: e.cx + X * e.ax, y: e.cy + Y * e.ay });
    outline(ctx, t => fr(1.3 * Math.cos(t), -.95 + 2 * Math.sin(t)));
    ctx.setLineDash([2, 5]); ctx.strokeStyle = rgba(blue, .4); ctx.lineWidth = 1; ctx.stroke();
    outline(ctx, t => fr(Math.cos(t), Math.sin(t)));
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = rgba(blue, .9); ctx.lineWidth = 1.3; ctx.stroke();
    ctx.setLineDash([]);
    for (const h of ellHandles()) {
      const hov = S.hdrag ? S.hdrag.id === h.id : (S.hoverHandle === h.id);
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, hov ? 6 : 4.5, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, hov ? 5 : 3.6, 0, TAU);
      ctx.fillStyle = h.id === 'c' ? '#FFFFFF' : blue; ctx.fill();
    }
  }

  // transform frame: corners stretch, knob / outside a corner rotates
  const { C, top, knob } = xfHandles(), hz = S.tdrag ? S.tdrag.zone : S.hoverXf;
  ctx.beginPath(); C.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = rgba(blue, .85); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(knob.x, knob.y);
  ctx.strokeStyle = rgba(blue, .85); ctx.lineWidth = 1.2; ctx.stroke();
  const sq = (p, on) => {
    const r = on ? 5.5 : 4.5;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(p.x - r - 1.5, p.y - r - 1.5, 2 * r + 3, 2 * r + 3);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
    ctx.fillStyle = blue; ctx.fillRect(p.x - r + 2, p.y - r + 2, 2 * r - 4, 2 * r - 4);
  };
  C.forEach((p, i) => sq(p, hz && hz.type === 'corner' && hz.i === i));
  const kon = hz && hz.type === 'rotate';
  ctx.beginPath(); ctx.arc(knob.x, knob.y, kon ? 6.5 : 5.5, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
  ctx.beginPath(); ctx.arc(knob.x, knob.y, kon ? 5 : 4, 0, TAU); ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------ overlay -- */

function drawOverlay(t, dt) {
  const ctx = octx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ov.width, ov.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let busy = false;
  const labels = [];
  const base = { toS, u: 1, t, labels };
  const hlId = (S.drag && S.drag.id) || (S.hover && S.hover.id) || S.listHover;

  for (let i = S.leaving.length - 1; i >= 0; i--) {
    const L = S.leaving[i], e = (t - L.t0) / LEAVE_MS;
    if (e >= 1) { S.leaving.splice(i, 1); continue; }
    const lv = easeInOut(e);
    drawMeas(ctx, L.m, { ...base, labels: [], alpha: L.alpha * (1 - lv * lv), leave: lv });
    busy = true;
  }

  const list = [...S.meas.values()].sort((a, b) => (a.id === hlId) - (b.id === hlId));
  for (const m of list) {
    const vis = isVisible(m);
    if (vis && !m.wasVis) m.shown = t;
    m.wasVis = vis;
    const ta = vis ? 1 : 0;
    if (Math.abs(m.alpha - ta) > .004) { m.alpha += (ta - m.alpha) * (1 - Math.exp(-dt * (vis ? 10 : 14))); busy = true; }
    else m.alpha = ta;
    if (tween(m.disp, targets(m), dt, m.kind)) busy = true;
    if (m.alpha <= .004) continue;
    if (t - m.shown < 900 || (m.painted && t - m.painted < PAINT_MS + 50)) busy = true;
    drawMeas(ctx, m, { ...base, alpha: m.alpha, hl: m.id === hlId, picked: S.picked.has(m.id) });
  }

  S.draftM = null;
  if (S.draft) {
    const d = S.draft, pts = d.pts.slice();
    let ghost = -1;
    if (S.cursorIn && S.cursor && (!d.need || pts.length < d.need)) {
      let p = toI(S.cursor.x, S.cursor.y);
      if (S.shift && pts.length && connects(d.kind, pts.length)) p = snapAngle(pts[pts.length - 1], p);
      pts.push(p); ghost = pts.length - 1;
    }
    const tmp = { id: '__draft', preset: d.preset, kind: d.kind, pts, times: d.times, disp: d.disp, shown: -1e9, alpha: 1, painted: 0 };
    tween(d.disp, targets(tmp), dt, d.kind);
    S.draftM = tmp;
    drawMeas(ctx, tmp, { ...base, alpha: 1, ghost });
    busy = true;
  }

  if (S.box && S.box.moved) {
    const b = S.box, x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
    const blue = getComputedStyle(root).getPropertyValue('--blue').trim() || '#7EA6FF';
    ctx.save();
    roundRect(ctx, x + .5, y + .5, w, h, 3);
    ctx.fillStyle = rgba(blue, .08); ctx.fill();
    ctx.strokeStyle = rgba(blue, .7); ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  if (S.tool === 'adjust') drawAdjustGuides(ctx);
  if (S.tool === 'morph' && S.cursorIn && S.cursor && !S.pan && !(S.rpress && S.rpress.moved)) drawBrush(ctx, S.cursor);

  const overNode = S.hover && S.hover.node >= 0 && !S.draft;
  const placing = S.cursorIn && S.cursor && canPlace() && !S.drag && !S.pan && !(S.press && S.press.moved) && !overNode;
  updateLoupe(placing || !!S.drag);

  if (S.cursorIn && S.cursor) {
    const { x, y } = S.cursor;
    if (placing) {
      const a = toS({ x: 0, y: 0 }), b = toS({ x: S.iw, y: S.ih });
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.max(a.x, 0), Math.round(y) + .5); ctx.lineTo(Math.min(b.x, W), Math.round(y) + .5);
      ctx.moveTo(Math.round(x) + .5, Math.max(a.y, 0)); ctx.lineTo(Math.round(x) + .5, Math.min(b.y, H));
      ctx.stroke();
      ctx.restore();
      const tgt = S.draft ? { preset: S.draft.preset, kind: S.draft.kind } : placeTarget();
      if (tgt && tgt.preset) {
        const it = P[tgt.preset], i = S.draft ? S.draft.pts.length : 0;
        if (it.pts[i]) tag(ctx, `${i + 1}/${it.pts.length}  ${it.pts[i]}`, x, y);
      } else if (S.draft && S.draft.kind === 'segments') {
        tag(ctx, `${S.draft.pts.length} pts · Enter to finish`, x, y);
      }
    } else if (cfg.names && overNode) {
      const m = S.meas.get(S.hover.id);
      if (m && m.preset) {
        const p = toS(m.pts[S.hover.node]);
        tag(ctx, P[m.preset].pts[S.hover.node], p.x, p.y);
      }
    }
  }
  if (busy) wake();
}

function drawClipped(c, src, sw, sh, sx, sy, span, D) {
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
  const x1 = Math.min(sw, sx + span), y1 = Math.min(sh, sy + span);
  if (x1 <= x0 || y1 <= y0) return;
  const f = D / span;
  c.drawImage(src, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * f, (y0 - sy) * f, (x1 - x0) * f, (y1 - y0) * f);
}
function updateLoupe(show) {
  const on = !!(show && cfg.loupe && S.cursor && S.cursorIn && S.img);
  if (loupe._on !== on) { loupe._on = on; loupe.classList.toggle('on', on); }
  if (!on) return;
  const { x: cx, y: cy } = S.cursor;
  let lx = cx + 28, ly = cy - LOUPE - 28;
  if (ly < 72) ly = cy + 28;
  if (lx + LOUPE > W - 8) lx = cx - LOUPE - 28;
  loupe.style.left = lx + 'px';
  loupe.style.top = ly + 'px';
  const c = lctx, D = loupe.width;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#0B0B0D'; c.fillRect(0, 0, D, D);
  const span = LOUPE / LOUPE_ZOOM, k = S.view.k, ip = toI(cx, cy), is = span / k;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  if (GLR && !isIdentity()) drawClipped(c, glcv, glcv.width, glcv.height, (cx - span / 2) * dpr, (cy - span / 2) * dpr, span * dpr, D);
  else drawClipped(c, S.img, S.iw, S.ih, ip.x - is / 2, ip.y - is / 2, is, D);
  drawClipped(c, ov, ov.width, ov.height, (cx - span / 2) * dpr, (cy - span / 2) * dpr, span * dpr, D);
  const m = D / 2, g = 5 * dpr, l = 15 * dpr;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(m - l, m); c.lineTo(m - g, m); c.moveTo(m + g, m); c.lineTo(m + l, m);
  c.moveTo(m, m - l); c.lineTo(m, m - g); c.moveTo(m, m + g); c.lineTo(m, m + l);
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 3 * dpr; c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 1.2 * dpr; c.stroke();
}

/* --------------------------------------------------------- background -- */

const SP = 26;
function buildGridBase() {
  const c = grid.base || (grid.base = document.createElement('canvas'));
  c.width = bg.width; c.height = bg.height;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.fillStyle = `rgba(${grid.rgb},${grid.a0})`;
  grid.ox = (W % SP) / 2; grid.oy = (H % SP) / 2;
  grid.cols = Math.floor((W - grid.ox) / SP) + 1;
  grid.rows = Math.floor((H - grid.oy) / SP) + 1;
  for (let x = grid.ox; x <= W; x += SP) for (let y = grid.oy; y <= H; y += SP) g.fillRect(x - .65, y - .65, 1.3, 1.3);
  grid.energy = new Float32Array(grid.cols * grid.rows);
  grid.active = new Set();
  grid.dirty = false; grid.needs = true;
}

/* Each dot holds an "energy" that the cursor tops up and that decays slowly,
   so moving the cursor leaves a softly fading trail of lit dots. */
const GRID_R = 30, GRID_FADE = .9;   // radius (px) · trail half-life-ish (s)
function gridStamp(x, y) {
  if (!grid.energy) return;
  const E = GRID_R * 2.2;
  const i0 = Math.max(0, Math.ceil((x - E - grid.ox) / SP)), i1 = Math.min(grid.cols - 1, Math.floor((x + E - grid.ox) / SP));
  const j0 = Math.max(0, Math.ceil((y - E - grid.oy) / SP)), j1 = Math.min(grid.rows - 1, Math.floor((y + E - grid.oy) / SP));
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const dx = grid.ox + i * SP - x, dy = grid.oy + j * SP - y;
      const f = Math.exp(-(dx * dx + dy * dy) / (2 * GRID_R * GRID_R));
      if (f < .02) continue;
      const idx = j * grid.cols + i;
      if (f > grid.energy[idx]) { grid.energy[idx] = f; grid.active.add(idx); }
    }
  }
}
function gridTrail(x, y) {
  if (!cfg.gridFx) return;
  const lx = grid.lx, ly = grid.ly;
  if (lx == null) gridStamp(x, y);
  else {
    // fill in fast moves so the trail stays continuous
    const n = Math.min(40, Math.ceil(Math.hypot(x - lx, y - ly) / (GRID_R * .5)));
    for (let s = 1; s <= n; s++) gridStamp(lx + (x - lx) * s / n, ly + (y - ly) * s / n);
  }
  grid.lx = x; grid.ly = y;
}
function drawGrid(dt) {
  if (grid.dirty) buildGridBase();
  if (grid.inside && cfg.gridFx) gridStamp(grid.lx, grid.ly);
  if (!grid.active.size && !grid.needs) return;
  grid.needs = false;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, bg.width, bg.height);
  bctx.drawImage(grid.base, 0, 0);
  if (!grid.active.size) return;
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const decay = Math.exp(-dt / (GRID_FADE * .45));
  for (const idx of grid.active) {
    const e = grid.energy[idx] * decay;
    const i = idx % grid.cols, j = (idx - i) / grid.cols;
    const px = grid.ox + i * SP, py = grid.oy + j * SP;
    bctx.clearRect(px - 3, py - 3, 6, 6);
    if (e < .01) { grid.energy[idx] = 0; grid.active.delete(idx); bctx.fillStyle = `rgba(${grid.rgb},${grid.a0})`; bctx.fillRect(px - .65, py - .65, 1.3, 1.3); continue; }
    grid.energy[idx] = e;
    const s = 1.3 + e * .7;
    bctx.fillStyle = `rgba(${grid.rgb},${(grid.a0 + e * grid.a1).toFixed(3)})`;
    bctx.fillRect(px - s / 2, py - s / 2, s, s);
  }
}

/* ---------------------------------------------------------------- view -- */

function stepView(dt) {
  const v = S.view, g = S.viewT, a = 1 - Math.exp(-dt * 16);
  if (Math.abs(v.k - g.k) > g.k * 1e-4 || Math.abs(v.x - g.x) > .05 || Math.abs(v.y - g.y) > .05) {
    v.k += (g.k - v.k) * a; v.x += (g.x - v.x) * a; v.y += (g.y - v.y) * a;
    wake();
  } else { v.k = g.k; v.x = g.x; v.y = g.y; }
  setText(zoomPct, Math.round(g.k * 100) + '%');
}
function setViewNow(v) { S.view = { ...v }; S.viewT = { ...v }; S.fitted = false; wake(); }
const TOOLPANEL_W = 272;
function safeRect() {
  const mob = W <= 860, drawer = !mob && body.classList.contains('topts-open') ? TOOLPANEL_W : 0;
  const l = mob ? 12 : 84 + drawer, r = mob ? 12 : 352, t = mob ? 76 : 24, b = 48;
  return { x: l, y: t, w: Math.max(120, W - l - r), h: Math.max(120, H - t - b) };
}
function fitView(intro) {
  if (!S.img) return;
  const r = safeRect();
  const k = Math.min(r.w / S.iw, r.h / S.ih) * .96;
  const v = { k, x: r.x + (r.w - S.iw * k) / 2, y: r.y + (r.h - S.ih * k) / 2 };
  S.fitK = k; S.viewT = v; S.fitted = true;
  if (intro) {
    const k0 = k * .94;
    S.view = { k: k0, x: v.x + S.iw * (k - k0) / 2, y: v.y + S.ih * (k - k0) / 2 };
  }
  wake();
}
function zoomAt(sx, sy, f) {
  if (!S.img) return;
  const v = S.viewT, k = clamp(v.k * f, S.fitK * .2, 64);
  const ix = (sx - v.x) / v.k, iy = (sy - v.y) / v.k;
  S.viewT = { k, x: sx - ix * k, y: sy - iy * k };
  S.fitted = false;
  wake();
}
const zoomCenter = f => { const r = safeRect(); zoomAt(r.x + r.w / 2, r.y + r.h / 2, f); };

/* -------------------------------------------------------------- pointer -- */

function hitTest(sx, sy) {
  const arr = [...S.meas.values()].filter(m => isVisible(m) && m.alpha > .4);
  let best = null, bd = HIT_NODE;
  for (const m of arr) m.pts.forEach((pt, i) => {
    const p = toS(pt), d = Math.hypot(p.x - sx, p.y - sy);
    if (d <= bd) { bd = d; best = { id: m.id, node: i }; }
  });
  if (best) return best;
  for (let j = arr.length - 1; j >= 0; j--) {
    for (const [a, b] of screenSegs(arr[j])) if (segDist(sx, sy, a, b) <= HIT_LINE) return { id: arr[j].id, node: -1 };
  }
  return null;
}
/** Measurements touched by the selection box (any point inside, or any line crossing it). */
function boxHits(b) {
  const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
  const inside = p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const out = [];
  for (const m of S.meas.values()) {
    if (!isVisible(m) || m.alpha < .4) continue;
    let hit = m.pts.some(p => inside(toS(p)));
    if (!hit) {
      for (const [a, c] of screenSegs(m)) {
        const n = Math.max(2, Math.ceil(dist(a, c) / 4));
        for (let i = 0; i <= n && !hit; i++) hit = inside({ x: a.x + (c.x - a.x) * i / n, y: a.y + (c.y - a.y) * i / n });
        if (hit) break;
      }
    }
    if (hit) out.push(m.id);
  }
  return out;
}
/** Cheap refresh of selection highlights while box-selecting. */
function syncPicks() {
  for (const [id, el] of itemEls) el.classList.toggle('picked', S.picked.has(id));
  renderHint();
  wake();
}
function refreshCursor() {
  let c;
  const xz = S.tdrag ? S.tdrag.zone : S.hoverXf;
  if (S.tool === 'adjust' && xz && !S.space && !S.pan && !(S.press && S.press.moved)) c = xfCursor(xz);
  else if (S.drag || S.pan || S.hdrag || (S.press && S.press.moved) || (S.mdrag && S.mdrag.moved) || (S.rpress && S.rpress.moved)) c = 'grabbing';
  else if (S.box) c = 'crosshair';
  else if (S.space) c = 'grab';
  else if (S.tool === 'morph') c = 'none';
  else if (S.tool === 'adjust') c = S.hoverHandle ? 'grab' : 'default';
  else if (S.hover && S.hover.node >= 0) c = 'grab';
  else if (S.hover && selectMode()) c = 'move';
  else if (canPlace()) c = 'crosshair';
  else c = 'default';
  if (ov._c !== c) { ov._c = c; ov.style.cursor = c; }
}
function handleAt(sx, sy) {
  if (S.tool !== 'adjust' || !(S.adj.lens > 0)) return null;
  for (const h of ellHandles()) if (Math.hypot(h.p.x - sx, h.p.y - sy) <= 11) return h.id;
  return null;
}
/** Which part of the transform frame is under the cursor: corner (stretch), rotate, or inside (move). */
function xfZoneAt(sx, sy) {
  if (S.tool !== 'adjust' || !GLR || !S.img) return null;
  const { C, ctr, knob } = xfHandles();
  if (Math.hypot(knob.x - sx, knob.y - sy) <= 11) return { type: 'rotate' };
  for (let i = 0; i < 4; i++) if (Math.hypot(C[i].x - sx, C[i].y - sy) <= 10) return { type: 'corner', i };
  const inside = (() => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const a = C[i], b = C[(i + 1) % 4], cr = (b.x - a.x) * (sy - a.y) - (b.y - a.y) * (sx - a.x);
      if (cr !== 0) { if (!s) s = Math.sign(cr); else if (Math.sign(cr) !== s) return false; }
    }
    return true;
  })();
  if (!inside) for (let i = 0; i < 4; i++) {
    const d = Math.hypot(C[i].x - sx, C[i].y - sy);
    if (d > 10 && d <= 34) return { type: 'rotate', i };
  }
  if (inside) return { type: 'move' };
  return null;
}
const ROT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 9A7 7 0 1 0 19 14" stroke="#000" stroke-width="4"/><path d="M19 4v5h-5" stroke="#000" stroke-width="4"/><path d="M18.5 9A7 7 0 1 0 19 14" stroke="#fff" stroke-width="1.6"/><path d="M19 4v5h-5" stroke="#fff" stroke-width="1.6"/></g></svg>')}") 12 12, crosshair`;
function xfCursor(z) {
  if (z.type === 'move') return 'move';
  if (z.type === 'rotate') return ROT_CURSOR;
  const { C, ctr } = xfHandles(), p = C[z.i];
  const ang = ((Math.atan2(p.y - ctr.y, p.x - ctr.x) * DEG) + 360) % 180;
  return ang < 90 ? 'nwse-resize' : 'nesw-resize';
}
function updateHover(sx, sy) {
  const hh = handleAt(sx, sy);
  if (hh !== (S.hoverHandle || null)) { S.hoverHandle = hh; wake(); }
  const xz = hh ? null : xfZoneAt(sx, sy);
  if (JSON.stringify(xz) !== JSON.stringify(S.hoverXf || null)) { S.hoverXf = xz; wake(); }
  const h = S.draft || !S.img || EDIT_TOOLS.has(S.tool) ? null : hitTest(sx, sy);
  const changed = (h && h.id) !== (S.hover && S.hover.id) || (h && h.node) !== (S.hover && S.hover.node);
  S.hover = h;
  if (changed) wake();
  refreshCursor();
}
function pickOnPress(id, shift) {
  if (shift) S.picked.add(id);
  else if (!S.picked.has(id)) S.picked = new Set([id]);
}

const pointers = new Map();
let pinch = null;

ov.addEventListener('pointerdown', e => {
  if (!S.img) return;
  try { ov.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  wake();
  if (pointers.size === 2) {
    S.press = null; S.pan = null; S.mdrag = null; S.box = null; S.rpress = null;
    if (S.drag) endDrag();
    if (S.stroke) endStroke();
    if (S.hdrag) endHandle();
    if (S.tdrag) endXf();
    const [a, b] = [...pointers.values()];
    pinch = { d: dist(a, b) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...S.view } };
    return;
  }
  const sx = e.clientX, sy = e.clientY;
  S.cursor = { x: sx, y: sy }; S.cursorIn = true;
  if (e.button === 1 || (e.button === 0 && S.space)) {
    e.preventDefault();
    S.pan = { x: sx, y: sy, vx: S.view.x, vy: S.view.y };
    refreshCursor();
    return;
  }
  if (e.button === 2) {
    // right-click deletes; right-drag pans
    S.rpress = { x: sx, y: sy, moved: false, vx: S.view.x, vy: S.view.y };
    return;
  }
  if (e.button !== 0) return;
  if (EDIT_TOOLS.has(S.tool) && !GLR) {
    S.press = { x: sx, y: sy, moved: false, vx: S.view.x, vy: S.view.y };   // tools unavailable: drag just pans
    return;
  }
  if (S.tool === 'morph') { startStroke(sx, sy); return; }
  if (S.tool === 'adjust') {
    const h = handleAt(sx, sy);
    if (h) { S.hdrag = { id: h, snap: snapshot(), moved: false }; refreshCursor(); return; }
    const z = xfZoneAt(sx, sy);
    if (z) { S.tdrag = { zone: z, snap: snapshot(), start: { ...S.adj }, v0: toI(sx, sy), moved: false }; refreshCursor(); return; }
    S.press = { x: sx, y: sy, moved: false, vx: S.view.x, vy: S.view.y };   // outside the photo: drag pans
    return;
  }
  const sel = selectMode();
  const hit = S.draft ? null : hitTest(sx, sy);
  if (hit && hit.node >= 0) {
    if (sel) pickOnPress(hit.id, e.shiftKey);
    S.drag = { id: hit.id, i: hit.node, last: toI(sx, sy), snap: snapshot(), moved: false };
    if (sel) syncUI();
    refreshCursor();
    return;
  }
  if (hit && sel) {
    const was = S.picked.has(hit.id);
    pickOnPress(hit.id, e.shiftKey);
    S.mdrag = { sx, sy, last: toI(sx, sy), snap: snapshot(), moved: false, toggle: e.shiftKey && was ? hit.id : null };
    syncUI();
    return;
  }
  if (sel) {
    // select mode: dragging on empty space draws a selection box
    S.box = { x0: sx, y0: sy, x1: sx, y1: sy, moved: false, add: e.shiftKey, base: new Set(e.shiftKey ? S.picked : []) };
    return;
  }
  S.press = { x: sx, y: sy, moved: false, vx: S.view.x, vy: S.view.y };
});

ov.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) {
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dd = dist(a, b), c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v0 = pinch.view, k = clamp(v0.k * dd / pinch.d, S.fitK * .2, 64);
      const ix = (pinch.c.x - v0.x) / v0.k, iy = (pinch.c.y - v0.y) / v0.k;
      setViewNow({ k, x: c.x - ix * k, y: c.y - iy * k });
    }
    return;
  }
  const sx = e.clientX, sy = e.clientY;
  S.cursor = { x: sx, y: sy }; S.cursorIn = true;
  wake();
  const fine = e.shiftKey ? .25 : 1;
  if (S.stroke) {
    const v = toI(sx, sy);
    if (cfg.mMode === 'push' && dist(S.stroke.last, v) > 0) { morphPush(S.stroke.last, v); S.stroke.changed = true; }
    S.stroke.last = v;
    return;
  }
  if (S.hdrag) { moveHandle(toI(sx, sy)); return; }
  if (S.tdrag) { moveXf(toI(sx, sy), e); return; }
  if (S.drag) {
    const d = S.drag, m = S.meas.get(d.id);
    if (!m) { S.drag = null; return; }
    const ip = toI(sx, sy), p = m.pts[d.i];
    p.x += (ip.x - d.last.x) * fine; p.y += (ip.y - d.last.y) * fine;
    d.last = ip; d.moved = true;
    return;
  }
  if (S.mdrag) {
    const md = S.mdrag;
    if (!md.moved && Math.hypot(sx - md.sx, sy - md.sy) < 3) return;
    if (!md.moved) { md.moved = true; refreshCursor(); }
    const ip = toI(sx, sy), dx = (ip.x - md.last.x) * fine, dy = (ip.y - md.last.y) * fine;
    for (const id of S.picked) {
      const m = S.meas.get(id);
      if (m && isVisible(m)) m.pts.forEach(p => { p.x += dx; p.y += dy; });
    }
    md.last = ip;
    return;
  }
  if (S.pan) { setViewNow({ k: S.view.k, x: S.pan.vx + sx - S.pan.x, y: S.pan.vy + sy - S.pan.y }); return; }
  if (S.rpress) {
    const r = S.rpress;
    if (!r.moved && Math.hypot(sx - r.x, sy - r.y) > 4) { r.moved = true; refreshCursor(); }
    if (r.moved) setViewNow({ k: S.view.k, x: r.vx + sx - r.x, y: r.vy + sy - r.y });
    return;
  }
  if (S.box) {
    const b = S.box;
    b.x1 = sx; b.y1 = sy;
    if (!b.moved && Math.hypot(sx - b.x0, sy - b.y0) > 4) b.moved = true;
    if (b.moved) {
      const hits = boxHits(b);
      S.picked = new Set([...b.base, ...hits]);
      syncPicks();
    }
    return;
  }
  if (S.press) {
    if (!S.press.moved && Math.hypot(sx - S.press.x, sy - S.press.y) > 4) { S.press.moved = true; refreshCursor(); }
    if (S.press.moved) { setViewNow({ k: S.view.k, x: S.press.vx + sx - S.press.x, y: S.press.vy + sy - S.press.y }); return; }
  }
  updateHover(sx, sy);
});

/* morph strokes */
function startStroke(sx, sy) {
  const snap = snapshot();
  beginStroke();
  const v = toI(sx, sy);
  S.stroke = { last: v, snap, changed: false, ref: cfg.mProtect ? strokeRef(v) : null };
  if (cfg.mMode !== 'push') dabHere(1 / 60);
  wake();
}
/** Bloat / pinch / restore build up while the button is held. */
function dabHere(dt) {
  const { pc, R } = brushAt(S.stroke.last);
  const rate = cfg.mMode === 'restore' ? 3.2 : 1.5;
  morphDab(pc, null, R, cfg.mMode, clamp(cfg.mStrength * rate * dt, 0, .4));
  S.stroke.changed = true;
  syncPts();
}
function endStroke() {
  const st = S.stroke;
  S.stroke = null;
  if (!st) return;
  if (st.changed) pushUndo(st.snap);
  else { S.warp = st.snap.warp; S.fieldDirty = true; }
  syncUI();
}
/* face-outline handles (Adjust → lens) */
function moveHandle(v) {
  const e = S.adj.ell;
  if (!e) return;
  const p = uToP(vToU(v));   // the face frame lives on the original photo
  if (S.hdrag.id === 'c') { e.cx = p.x; e.cy = p.y; }
  else if (S.hdrag.id === 'x') e.ax = Math.max(8, Math.hypot(p.x - e.cx, p.y - e.cy));
  else e.ay = Math.max(8, Math.hypot(p.x - e.cx, p.y - e.cy));
  S.hdrag.moved = true;
  syncPts();
}
/* image transform drags (Adjust): move · rotate · corner stretch */
const IMG_CORNERS = () => [{ x: 0, y: 0 }, { x: S.iw, y: 0 }, { x: S.iw, y: S.ih }, { x: 0, y: S.ih }];
function moveXf(v, e) {
  const d = S.tdrag, st = d.start, z = d.zone, a = S.adj;
  d.moved = true;
  const c0 = { x: S.iw / 2, y: S.ih / 2 };
  if (z.type === 'move') {
    a.tx = st.tx + v.x - d.v0.x; a.ty = st.ty + v.y - d.v0.y;
  } else if (z.type === 'rotate') {
    const cx = c0.x + st.tx, cy = c0.y + st.ty;
    let r = st.rot + (Math.atan2(v.y - cy, v.x - cx) - Math.atan2(d.v0.y - cy, d.v0.x - cx)) * DEG;
    r = ((r + 180) % 360 + 360) % 360 - 180;
    if (e.shiftKey) r = Math.round(r / 15) * 15;
    a.rot = +r.toFixed(2);
  } else {
    const Cs = IMG_CORNERS(), Ci = Cs[z.i], O = e.altKey ? c0 : Cs[(z.i + 2) % 4];
    const anchor = uToV(O, st);                       // stays put while stretching
    const t = st.rot / DEG, c = Math.cos(t), s = Math.sin(t);
    const dx = v.x - anchor.x, dy = v.y - anchor.y;
    const lx = c * dx + s * dy, ly = -s * dx + c * dy;   // in the image's own axes
    const Lx = Ci.x - O.x, Ly = Ci.y - O.y;
    const [sx0, sy0] = scaleXY(st);
    let sx, sy;
    if (e.shiftKey) {                                  // keep proportions
      const px = Lx * sx0, py = Ly * sy0;
      const f = Math.max(.05, (lx * px + ly * py) / (px * px + py * py));
      sx = sx0 * f; sy = sy0 * f;
    } else {
      sx = Math.sign(sx0) * Math.max(.05, lx / Lx * Math.sign(sx0));
      sy = Math.max(.05, ly / Ly);
    }
    const ax = Math.abs(sx);
    a.flip = Math.sign(sx) || 1;
    a.zoom = clamp(Math.sqrt(ax * sy), .05, 20);
    a.aspect = clamp(ax / sy, .2, 5);
    const p0 = uToV(O, { ...a, tx: 0, ty: 0 });
    a.tx = anchor.x - p0.x; a.ty = anchor.y - p0.y;
  }
  syncPts(); syncToolOpts();
}
function endXf() {
  const d = S.tdrag;
  S.tdrag = null;
  if (d && d.moved) pushUndo(d.snap);
  syncUI();
}
function endHandle() {
  const h = S.hdrag;
  S.hdrag = null;
  if (h && h.moved) pushUndo(h.snap);
  syncUI();
}
function endDrag() {
  const d = S.drag;
  S.drag = null;
  if (d && d.moved) { const m = S.meas.get(d.id); if (m) anchor(m); pushUndo(d.snap); syncUI(); }
}
function pointerUp(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; S.press = null; return; }
  if (S.stroke) endStroke();
  else if (S.hdrag) endHandle();
  else if (S.tdrag) endXf();
  else if (S.drag) endDrag();
  else if (S.mdrag) {
    const md = S.mdrag;
    S.mdrag = null;
    if (md.moved) { for (const id of S.picked) { const m = S.meas.get(id); if (m) anchor(m); } pushUndo(md.snap); }
    else if (md.toggle) S.picked.delete(md.toggle);
    syncUI();
  }
  else if (S.pan) S.pan = null;
  else if (S.rpress) {
    const r = S.rpress;
    S.rpress = null;
    if (!r.moved && !EDIT_TOOLS.has(S.tool)) onRightClick(e.clientX, e.clientY);
  }
  else if (S.box) {
    const b = S.box;
    S.box = null;
    if (!b.moved && !b.add && S.picked.size) S.picked.clear();   // plain click on empty space clears
    syncUI();
  }
  else if (S.press) {
    const p = S.press;
    S.press = null;
    if (!p.moved && e.button === 0 && e.type === 'pointerup') onClick(e.clientX, e.clientY, e);
  }
  updateHover(e.clientX, e.clientY);
}
ov.addEventListener('pointerup', pointerUp);
ov.addEventListener('pointercancel', pointerUp);
ov.addEventListener('pointerleave', () => { if (!S.drag && !S.pan && !S.mdrag && !S.box && !S.rpress) { S.cursorIn = false; S.hover = null; wake(); } });
ov.addEventListener('contextmenu', e => e.preventDefault());
ov.addEventListener('wheel', e => {
  e.preventDefault();
  if (!S.img) return;
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
}, { passive: false });
ov.addEventListener('dblclick', e => {
  if (!selectMode()) return;
  const h = hitTest(e.clientX, e.clientY), m = h && S.meas.get(h.id);
  if (m && m.kind === 'ruler' && S.refId !== m.id) setRef(m.id);
});

function onClick(sx, sy, e) {
  const ip = toI(sx, sy), d = S.draft;
  if (d) {
    // double-click finishes a free proportions draft
    if (d.kind === 'segments' && !d.need && d.lastS && now() - d.lastT < 380 && Math.hypot(sx - d.lastS.x, sy - d.lastS.y) < 8) {
      if (d.pts.length >= 3) commitDraft();
      return;
    }
    addPoint(ip, sx, sy, e.shiftKey);
    return;
  }
  const tgt = placeTarget();
  if (!tgt) {
    // select mode: clicking empty space clears the canvas selection
    if (S.picked.size && !e.shiftKey) { S.picked.clear(); syncUI(); }
    else if (S.tool !== 'move' && S.sel.length) toast('Press Esc or click the item again to draw freely');
    return;
  }
  startDraft(tgt);
  addPoint(ip, sx, sy, e.shiftKey);
}
function onRightClick(sx, sy) {
  const d = S.draft;
  if (d) {
    if (d.kind === 'segments' && !d.need && d.pts.length >= 3) commitDraft();
    else { d.pts.pop(); d.times.pop(); if (!d.pts.length) S.draft = null; syncUI(); }
    return;
  }
  const h = hitTest(sx, sy);
  if (!h) return;
  if (S.picked.has(h.id) && S.picked.size > 1) deleteSelection();
  else removeMeas(h.id);
}
function setRef(id) {
  pushUndo();
  S.refId = id;
  const m = S.meas.get(id);
  toast(`${m ? m.name : 'Line'} is now the reference (1.00x)`);
  syncUI();
}

/* --------------------------------------------------------- global input -- */

addEventListener('pointermove', e => {
  if (!grid.inside) { grid.lx = null; grid.inside = true; }
  gridTrail(e.clientX, e.clientY);
}, { passive: true });
document.addEventListener('pointerout', e => { if (!e.relatedTarget) grid.inside = false; });

addEventListener('keydown', e => {
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Shift') { S.shift = true; wake(); }
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (settingsEl.classList.contains('open')) { if (e.key === 'Escape') closeSettings(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { if (S.img) { e.preventDefault(); pickAll(); } return; }
  if (mod || e.altKey) return;
  if (e.key === ' ') {
    e.preventDefault();
    if (!S.space) { S.space = true; refreshCursor(); }
    return;
  }
  if (!S.img) return;
  if (TOOL_KEYS[k] && !e.repeat) { setTool(TOOL_KEYS[k]); return; }
  if (e.key === '[' || e.key === ']') {
    cfg.mSize = clamp(cfg.mSize * (e.key === ']' ? 1.15 : 1 / 1.15), .01, .5);
    saveCfg(); syncToolOpts(); wake();
    return;
  }
  if (k === 'b') { if (!e.repeat) setCompare(true); return; }
  switch (e.key) {
    case 'Escape':
      if (calibCtx) closeCalib(false);
      else if (S.draft) cancelDraft(true);
      else if (S.tool !== 'move') setTool('move');
      else if (S.picked.size) { S.picked.clear(); syncUI(); }
      else if (S.sel.length || S.showAll) deselectAll();
      break;
    case 'Enter':
      if (S.draft && S.draft.kind === 'segments' && !S.draft.need && S.draft.pts.length >= 3) commitDraft();
      break;
    case 'Backspace':
      e.preventDefault();
      if (S.draft) { S.draft.pts.pop(); S.draft.times.pop(); if (!S.draft.pts.length) S.draft = null; syncUI(); }
      else deleteSelection();
      break;
    case 'Delete':
      if (S.draft) cancelDraft(true); else deleteSelection();
      break;
    case 'f': case 'F': fitView(); break;
    case 'h': case 'H': toggleShowAll(); break;
    case 'l': case 'L': toggleLoupe(); break;
    case '+': case '=': zoomCenter(1.25); break;
    case '-': case '_': zoomCenter(.8); break;
  }
});
addEventListener('keyup', e => {
  if (e.key === ' ') { S.space = false; refreshCursor(); }
  if (e.key.toLowerCase() === 'b') setCompare(false);
  if (e.key === 'Shift') { S.shift = false; wake(); }
});
addEventListener('blur', () => { S.space = false; S.shift = false; setCompare(false); if (S.stroke) endStroke(); });
addEventListener('resize', () => { resize(); if (S.img) fitView(); });

/* --------------------------------------------------------- image input -- */

function loadFile(file) {
  if (!file || !/^image\//.test(file.type)) { toast('That doesn’t look like an image'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    pushUndo();   // loading an image is undoable — the previous image and its measurements come back
    setImageState({ img, url, iw: img.naturalWidth, ih: img.naturalHeight });
    S.meas = new Map();
    S.refId = null; S.calibId = null;
    syncUI();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Couldn’t read that image — try PNG, JPG or WebP'); };
  img.src = url;
}
function setImageState(rec) {
  Object.assign(S, {
    sel: [], active: null, showAll: false, draft: null, draftM: null, hover: null,
    drag: null, mdrag: null, press: null, rpress: null, box: null, leaving: [],
  });
  S.picked = new Set();
  customSig = null;
  S.imgRec = rec || null;
  S.imgSeq++;
  if (!rec) {
    Object.assign(S, { img: null, iw: 0, ih: 0 });
    body.classList.remove('has-img');
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, ov.width, ov.height);
    loupe._on = false; loupe.classList.remove('on');
    return;
  }
  Object.assign(S, { img: rec.img, iw: rec.iw, ih: rec.ih, imgA: 0, stroke: null, hdrag: null, compare: false });
  S.adj = DEFAULT_ADJ();
  initWarp();
  S.pix = null;
  S.fieldDirty = true; S.glDirty = true;
  body.classList.add('has-img');
  fitView(true);
  toolOptsFor = null;
  renderToolOpts();
}

$('#btnBrowse').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
$('#dropZone').addEventListener('click', () => fileInput.click());
$('#dropZone').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
$('#btnNew').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; });

let dragDepth = 0;
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; body.classList.add('dragging'); });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) body.classList.remove('dragging'); });
addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0; body.classList.remove('dragging');
  const f = Array.from((e.dataTransfer && e.dataTransfer.files) || []).find(x => /^image\//.test(x.type));
  if (f) loadFile(f); else toast('Drop an image file');
});
document.addEventListener('paste', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
  const it = items.find(x => x.kind === 'file' && /^image\//.test(x.type));
  if (it) { e.preventDefault(); loadFile(it.getAsFile()); }
  else toast('No image on the clipboard');
});

/* --------------------------------------------------------------- export -- */

async function exportPNG() {
  if (!S.img) return;
  try { await Promise.all([document.fonts.load(`500 12px 'JetBrains Mono'`), document.fonts.load('600 12px Inter')]); } catch (e) { /* system fonts */ }
  const vis = [...S.meas.values()].filter(isVisible);
  const iw = S.iw, ih = S.ih;
  const u = Math.max(1, Math.max(iw, ih) / 1000);
  const rows = vis.map(m => ({ name: titleOf(m), val: fmt(m, targets(m)), col: mainColor(m) }));
  const pad = 26 * u, rowH = 28 * u;
  const cols = Math.max(1, Math.min(rows.length, Math.floor((iw - pad * 2) / (260 * u))));
  const legendH = rows.length ? pad * 2 + 30 * u + Math.ceil(rows.length / cols) * rowH : 0;
  const c = document.createElement('canvas');
  c.width = iw; c.height = Math.round(ih + legendH);
  const ctx = c.getContext('2d');
  if (GLR && !isIdentity()) {
    // render the edited photo at full resolution (scaled only if the GPU can't fit it)
    const sc = Math.min(1, GLR.maxView[0] / iw, GLR.maxView[1] / ih, 8192 / Math.max(iw, ih));
    const cw = Math.round(iw * sc), ch = Math.round(ih * sc);
    GLR.render({ ...glParams({ x: 0, y: 0, k: sc }, 1, cw, ch, 1), morph: !!S.warp.field });
    ctx.drawImage(glcv, 0, 0, cw, ch, 0, 0, iw, ih);
    imgKey = ''; S.glDirty = true;   // restore the on-screen render next frame
  } else ctx.drawImage(S.img, 0, 0);
  const labels = [];
  for (const m of vis) drawMeas(ctx, m, { toS: p => p, u, t: 0, alpha: 1, labels, final: true, disp: targets(m) });
  if (rows.length) {
    ctx.fillStyle = '#0D0E11'; ctx.fillRect(0, ih, iw, legendH);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, ih, iw, Math.max(1, u));
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${13 * u}px ${FONT}`; ctx.fillStyle = '#ECEDEF'; ctx.textAlign = 'left';
    ctx.fillText('cranimeter', pad, ih + pad + 6 * u);
    ctx.font = `500 ${11 * u}px ${MONO}`; ctx.fillStyle = '#6B7079'; ctx.textAlign = 'right';
    ctx.fillText(new Date().toISOString().slice(0, 10), iw - pad, ih + pad + 6 * u);
    const cw = (iw - pad * 2) / cols;
    rows.forEach((r, i) => {
      const x = pad + (i % cols) * cw, y = ih + pad + 30 * u + Math.floor(i / cols) * rowH + rowH / 2;
      ctx.fillStyle = r.col; ctx.fillRect(x, y - 6 * u, 2 * u, 12 * u);
      ctx.font = `500 ${12 * u}px ${MONO}`; ctx.textAlign = 'right'; ctx.fillStyle = '#FFFFFF';
      const vx = x + cw - 18 * u;
      ctx.fillText(r.val, vx, y);
      const vw = ctx.measureText(r.val).width;
      ctx.font = `500 ${12.5 * u}px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#9BA0A8';
      let name = r.name;
      const maxW = cw - 18 * u - vw - 24 * u;
      while (name.length > 3 && ctx.measureText(name).width > maxW) name = name.slice(0, -2);
      if (name !== r.name) name = name.trimEnd() + '…';
      ctx.fillText(name, x + 12 * u, y);
    });
  }
  c.toBlob(b => {
    if (!b) { toast('Export failed — the image may be too large'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `cranimeter-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(rows.length ? 'Exported' : 'Exported — select layers or Show all to include measurements');
  }, 'image/png');
}
$('#btnExport').addEventListener('click', exportPNG);

/* ------------------------------------------------------------ calibrate -- */

let calibCtx = null;
function openCalib(m, isNew) {
  calibCtx = { id: m.id, isNew };
  calibInput.value = fmtNum(S.calibMM);
  const a = toS(m.pts[0]), b = toS(m.pts[1]);
  let x = (a.x + b.x) / 2 - 125, y = Math.max(a.y, b.y) + 22;
  if (y > H - 190) y = Math.min(a.y, b.y) - 180;
  calibPop.style.left = clamp(x, 12, W - 262) + 'px';
  calibPop.style.top = clamp(y, 72, H - 190) + 'px';
  calibPop.classList.add('open');
  setTimeout(() => { calibInput.focus(); calibInput.select(); }, 40);
}
function closeCalib(ok) {
  if (!calibCtx) return;
  const c = calibCtx;
  calibCtx = null;
  calibPop.classList.remove('open');
  calibInput.blur();
  if (ok) {
    const v = parseFloat(calibInput.value);
    if (v > 0 && v !== S.calibMM) { if (!c.isNew) pushUndo(); S.calibMM = v; }
  } else if (c.isNew && S.undo.length) {
    restore(S.undo.pop());
    return;
  }
  syncUI();
}
calibPop.addEventListener('click', e => {
  const mm = e.target.closest('[data-mm]');
  if (mm) { calibInput.value = mm.dataset.mm; calibInput.focus(); return; }
  const b = e.target.closest('[data-pop]');
  if (b) closeCalib(b.dataset.pop === 'ok');
});
calibInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') closeCalib(true);
  if (e.key === 'Escape') closeCalib(false);
});

/* ------------------------------------------------------------ selection -- */

function onItemClick(id, multi) {
  S.showAll = false;
  if (S.draft) { S.draft = null; S.draftM = null; }
  if (multi) {
    if (S.sel.includes(id)) {
      S.sel = S.sel.filter(x => x !== id);
      if (S.active === id) S.active = S.sel[S.sel.length - 1] || null;
    } else { S.sel.push(id); S.active = id; }
  } else if (S.sel.length === 1 && S.sel[0] === id) {
    S.sel = []; S.active = null;
  } else {
    S.sel = [id]; S.active = id;
  }
  if (W <= 860 && S.sel.length && P[id] && !S.meas.has(id)) panel.classList.remove('open');
  syncUI();
}
function deselectAll() {
  if (!S.sel.length && !S.showAll) return;
  S.sel = []; S.active = null; S.showAll = false;
  if (S.draft && S.draft.preset) { S.draft = null; S.draftM = null; }
  syncUI();
}
function toggleShowAll() {
  S.showAll = !S.showAll;
  S.sel = []; S.active = null;
  if (S.draft && S.draft.preset) { S.draft = null; S.draftM = null; }
  syncUI();
}
/** Select keeps the open layers; a drawing tool returns to free mode. */
/** Select, Morph and Adjust keep the open layers (so ratios stay in view); drawing tools return to free mode. */
function setTool(t) {
  if (S.draft) { S.draft = null; S.draftM = null; }
  if (S.stroke) endStroke();
  if (EDIT_TOOLS.has(t) && !GLR) toast(GL_MESSAGES[GL_REASON] || GL_MESSAGES.webgl, 7000);
  S.tool = t;
  if (t !== 'move' && !EDIT_TOOLS.has(t) && S.sel.length) { S.sel = []; S.active = null; }
  if (EDIT_TOOLS.has(t)) S.picked.clear();
  renderToolOpts();
  syncUI();
}

/* -------------------------------------------------------- tool options -- */

const toolOpts = $('#toolOpts'), toolOptsBody = $('#toolOptsBody');
let toolOptsFor = null;

const sliderRow = (id, label, min, max, step, tip) =>
  `<label class="srow"${tip ? ` title="${esc(tip)}"` : ''}><span>${label}</span><input class="rng" type="range" id="${id}" min="${min}" max="${max}" step="${step}"><b id="${id}V"></b></label>`;

function renderToolOpts() {
  const t = S.img && EDIT_TOOLS.has(S.tool) ? S.tool : null;
  const was = toolOpts.classList.contains('open');
  toolOpts.classList.toggle('open', !!t);
  body.classList.toggle('topts-open', !!t);
  if (was !== !!t && S.fitted) setTimeout(() => fitView(), 0);   // make room for the drawer
  if (t === toolOptsFor) { syncToolOpts(); return; }
  toolOptsFor = t;
  if (!t) return;
  if (!GLR) {
    toolOptsBody.innerHTML = `
      <div class="to-head"><span class="to-title">${t === 'morph' ? 'Morph' : 'Adjust image'}</span><span class="to-sub">unavailable</span></div>
      <p class="to-note">${esc(GL_MESSAGES[GL_REASON] || GL_MESSAGES.webgl)}</p>`;
    return;
  }
  if (t === 'morph') {
    toolOptsBody.innerHTML = `
      <div class="to-head"><span class="to-title">Morph</span><span class="to-sub">landmarks follow the face</span></div>
      <div class="seg full" id="mMode">
        <button type="button" data-v="push">Push</button><button type="button" data-v="bloat">Bloat</button>
        <button type="button" data-v="pinch">Pinch</button><button type="button" data-v="restore">Restore</button>
      </div>
      ${sliderRow('mSize', 'Size', 1, 50, .1)}
      ${sliderRow('mStrength', 'Strength', 1, 100, 1)}
      ${sliderRow('mHard', 'Hardness', 0, 100, 1)}
      <div class="to-actions">
        <button type="button" class="btn ghost sm" id="mCompare">Hold to compare</button>
        <button type="button" class="btn ghost sm" id="mReset">Reset morph</button>
      </div>
      <div class="to-group">
        <div class="to-beta"><span>Beta</span>for big reshapes like pushing the cheekbones out</div>
        <label class="tg sm"><span>Protect hair &amp; background<small>Only drags areas that match the skin under the brush, so hair and background stay put</small></span><input type="checkbox" class="sw-toggle" id="mProtect"></label>
        <label class="tg sm"><span>Limit stretching<small>Stops a push once any area would stretch or squash past ≈ 1.7× — never smears, but moves less. With both on, the hair edge limits how far skin can push into it</small></span><input type="checkbox" class="sw-toggle" id="mLimit"></label>
      </div>
      <p class="to-note" style="margin-top:10px">Drag on the photo · <kbd>[</kbd> <kbd>]</kbd> brush size · hold <kbd>B</kbd> to compare</p>`;
    $('#mMode').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { cfg.mMode = b.dataset.v; saveCfg(); syncToolOpts(); renderHint(); } });
    $('#mProtect').addEventListener('change', e => { cfg.mProtect = e.target.checked; saveCfg(); });
    $('#mLimit').addEventListener('change', e => { cfg.mLimit = e.target.checked; saveCfg(); });
    const bind = (id, key, f) => $('#' + id).addEventListener('input', e => { cfg[key] = f(+e.target.value); saveCfg(); syncToolOpts(); wake(); });
    bind('mSize', 'mSize', v => v / 100);
    bind('mStrength', 'mStrength', v => v / 100);
    bind('mHard', 'mHard', v => v / 100);
    const cmp = $('#mCompare');
    cmp.addEventListener('pointerdown', () => setCompare(true));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => setCompare(false)));
    $('#mReset').addEventListener('click', () => {
      if (!S.warp.field) return;
      pushUndo();
      S.warp = { ...S.warp, field: null };
      S.fieldDirty = true;
      syncPts(); syncUI();
      toast('Morph reset');
    });
  } else {
    toolOptsBody.innerHTML = `
      <div class="to-head"><span class="to-title">Adjust image</span><span class="to-sub">measurements stay attached</span></div>
      <p class="to-note">Drag a <b>corner</b> to stretch (<kbd>Shift</kbd> keeps proportions, <kbd>Alt</kbd> from the centre), the <b>knob</b> or just outside a corner to rotate, and <b>inside</b> to move.</p>
      ${sliderRow('aRot', 'Rotation', -45, 45, .1)}
      ${sliderRow('aZoom', 'Scale', 25, 300, 1)}
      ${sliderRow('aStretch', 'Stretch', 50, 200, 1, 'Width ÷ height')}
      <div class="to-actions" style="margin-top:4px">
        <button type="button" class="btn ghost sm" id="aLevel">Level eyes</button>
        <button type="button" class="btn ghost sm" id="aFlip">Flip</button>
        <button type="button" class="btn ghost sm" id="aResetXf">Reset</button>
      </div>
      <div class="to-group">
        <div class="to-head" style="margin:2px 0 6px"><span class="to-title" style="font-size:12.5px">Lens distortion</span><span class="to-sub">selfie correction</span></div>
        ${sliderRow('aLens', 'Strength', 0, 100, 1, 'How close the camera was — higher means closer')}
        <p class="to-note" id="aLensNote"></p>
        <div class="to-actions" style="margin-top:2px">
          <button type="button" class="btn ghost sm" id="aFit">Fit to face</button>
          <button type="button" class="btn ghost sm" id="aReset">Reset all</button>
        </div>
      </div>`;
    // one undo step per slider gesture
    const start = () => { if (!S.adjSnap) S.adjSnap = snapshot(); };
    const commit = () => { if (S.adjSnap) { pushUndo(S.adjSnap); S.adjSnap = null; syncUI(); } };
    const bind = (id, apply) => {
      const el = $('#' + id);
      el.addEventListener('pointerdown', start);
      el.addEventListener('keydown', start);
      el.addEventListener('input', e => { start(); apply(+e.target.value); syncPts(); syncToolOpts(); });
      el.addEventListener('change', commit);
      el.closest('.srow').querySelector('span').addEventListener('dblclick', () => {
        start(); apply(id === 'aZoom' || id === 'aStretch' ? 100 : 0); syncPts(); syncToolOpts(); commit();
      });
    };
    bind('aRot', v => { S.adj.rot = v; });
    bind('aZoom', v => { S.adj.zoom = v / 100; });
    bind('aStretch', v => { S.adj.aspect = v / 100; });
    bind('aLens', v => {
      if (v > 0 && !S.adj.ell) S.adj.ell = guessFace();
      S.adj.lens = v;
    });
    $('#aLevel').addEventListener('click', levelEyes);
    $('#aFlip').addEventListener('click', () => { pushUndo(); S.adj.flip *= -1; syncPts(); syncToolOpts(); syncUI(); });
    $('#aResetXf').addEventListener('click', () => {
      pushUndo();
      Object.assign(S.adj, { rot: 0, zoom: 1, aspect: 1, flip: 1, tx: 0, ty: 0 });
      syncPts(); syncToolOpts(); syncUI();
    });
    $('#aFit').addEventListener('click', () => fitFace(true));
    $('#aReset').addEventListener('click', () => {
      pushUndo();
      S.adj = { ...DEFAULT_ADJ(), ell: S.adj.ell };
      syncPts(); syncToolOpts(); syncUI();
    });
  }
  syncToolOpts();
  if (cfg.motion && toolOptsBody.animate) toolOptsBody.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' });
}
function setRange(id, v, text) {
  const el = $('#' + id);
  if (!el) return;
  if (document.activeElement !== el || +el.value !== v) el.value = v;
  const p = (v - +el.min) / (+el.max - +el.min) * 100;
  el.style.setProperty('--p', p.toFixed(1) + '%');
  setText($('#' + id + 'V'), text);
}
function syncToolOpts() {
  if (toolOptsFor === 'morph') {
    $$('#mMode [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === cfg.mMode));
    setRange('mSize', +(cfg.mSize * 100).toFixed(1), Math.round(brushV()) + ' px');
    setRange('mStrength', Math.round(cfg.mStrength * 100), Math.round(cfg.mStrength * 100) + '%');
    setRange('mHard', Math.round(cfg.mHard * 100), Math.round(cfg.mHard * 100) + '%');
    $('#mReset').disabled = !S.warp.field;
    $('#mProtect').checked = !!cfg.mProtect;
    $('#mLimit').checked = !!cfg.mLimit;
  } else if (toolOptsFor === 'adjust') {
    const a = S.adj;
    setRange('aRot', clamp(a.rot, -45, 45), (a.rot > 0 ? '+' : '') + a.rot.toFixed(1) + '°');
    setRange('aZoom', clamp(Math.round(a.zoom * 100), 25, 300), Math.round(a.zoom * 100) + '%');
    setRange('aStretch', clamp(Math.round(a.aspect * 100), 50, 200), a.aspect === 1 ? 'none' : (a.aspect > 1 ? 'wider ' : 'taller ') + Math.round(Math.abs(a.aspect - 1) * 100) + '%');
    setRange('aLens', a.lens, a.lens > 0 ? a.lens + '%' : 'Off');
    $('#aFlip').classList.toggle('on', a.flip < 0);
    $('#aResetXf').disabled = affineIdentity();
    const d = a.lens > 0 ? lensDistanceCm(a.lens) : 0;
    const dTxt = d < 100 ? Math.round(d) + ' cm' : (d / 100).toFixed(1) + ' m';
    setText($('#aLensNote'), a.lens > 0
      ? `Re-shoots the face from far away, assuming the camera was ≈ ${dTxt} away: the nose and chin shrink, the face gets less long, and the head outline widens while the cheekbone width stays fixed. Drag the face outline (centre, cheekbone, chin handles) to fit.`
      : 'Close-up selfies enlarge the nose and chin, narrow the cheekbones and lengthen the face. Raise this to see the face as it looks from a normal distance.');
    $('#aLevel').disabled = !eyePair();
  }
}
function setCompare(on) {
  if (S.compare === on) return;
  S.compare = on;
  S.glDirty = true;
  const b = $('#mCompare');
  if (b) b.classList.toggle('on', on);
  wake();
}

/* ---- smart helpers for Adjust ---- */
/** First measured landmark whose name starts with one of the given labels (in view space). */
function landmark(...names) {
  for (const n of names) {
    for (const m of S.meas.values()) {
      if (!m.preset) continue;
      const i = P[m.preset].pts.indexOf(n);
      if (i >= 0 && m.pts[i]) return m.pts[i];
    }
  }
  return null;
}
function eyePair() {
  const pairs = [['Pupil · left', 'Pupil · right'], ['Exocanthion · left', 'Exocanthion · right'], ['Endocanthion · left', 'Endocanthion · right'], ['Zygion · left', 'Zygion · right']];
  for (const [a, b] of pairs) { const l = landmark(a), r = landmark(b); if (l && r && dist(l, r) > 4) return [l, r]; }
  return null;
}
function levelEyes() {
  const pr = eyePair();
  if (!pr) { toast('Measure the pupils, eye corners or cheekbones first'); return; }
  const [l, r] = pr[0].x <= pr[1].x ? pr : [pr[1], pr[0]];
  const ang = Math.atan2(r.y - l.y, r.x - l.x) * DEG;
  pushUndo();
  S.adj.rot = clamp(+(S.adj.rot - ang).toFixed(2), -45, 45);
  syncPts(); syncToolOpts(); syncUI();
  toast(`Rotated ${(-ang).toFixed(1)}° to level the eyes`);
}
/**
 * Estimate the face frame on the original photo (P space): origin midway between nasion and menton,
 * ax = half the bizygomatic width, ay = half the nasion–menton height. Uses landmarks when available,
 * otherwise typical proportions (nasion–menton ≈ 0.88 × bizygomatic width).
 */
function guessFace() {
  const P_ = v => v && uToP(vToU(v));
  const mid = (a, b) => a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  const zl = P_(landmark('Zygion · left', 'Face edge · left')), zr = P_(landmark('Zygion · right', 'Face edge · right'));
  let n = P_(landmark('Nasion'));
  const g = P_(landmark('Glabella')), tr = P_(landmark('Trichion'));
  const me = P_(landmark('Menton', 'Gnathion'));
  if (!n && g) n = g;
  if (!n && tr && me) n = { x: tr.x + (me.x - tr.x) * .36, y: tr.y + (me.y - tr.y) * .36 };
  const nose = P_(landmark('Subnasale')) || mid(P_(landmark('Alare · left')), P_(landmark('Alare · right')));
  let cx = S.iw / 2, cy = S.ih * .5, ax = Math.min(S.iw * .27, S.ih * .2), ay = ax * .88;
  if (zl && zr) {
    ax = dist(zl, zr) / 2; ay = ax * .88;
    cx = (zl.x + zr.x) / 2; cy = (zl.y + zr.y) / 2 + ay * .55;   // zygions sit ≈ 0.6 above the frame centre
  }
  if (n && me) { ay = dist(n, me) / 2; cx = (n.x + me.x) / 2; cy = (n.y + me.y) / 2; }
  else if (nose) { cx = nose.x; cy = nose.y + ay * .13; }
  return { cx, cy, ax: Math.max(10, ax), ay: Math.max(10, ay) };
}
async function fitFace(announce) {
  const before = snapshot();
  let ell = guessFace(), how = landmark('Zygion · left', 'Face edge · left') ? 'your landmarks' : null;
  if (!how && 'FaceDetector' in window && isIdentity()) {
    try {
      const [f] = await new window.FaceDetector({ fastMode: false, maxDetectedFaces: 1 }).detect(S.img);
      if (f) {
        const b = f.boundingBox;   // roughly brow-to-chin, cheek-to-cheek
        ell = { cx: b.x + b.width / 2, cy: b.y + b.height * .58, ax: b.width * .46, ay: b.height * .36 };
        how = 'face detection';
      }
    } catch (e) { /* not supported here */ }
  }
  S.adj.ell = ell;
  if (!S.adj.lens) S.adj.lens = 50;
  pushUndo(before);
  syncPts(); syncToolOpts(); syncUI();
  if (announce) toast(how ? `Outline fitted from ${how}` : 'Outline centred — drag it to fit the face, or measure FWHR first for an automatic fit');
}
function toggleLoupe() {
  cfg.loupe = !cfg.loupe;
  saveCfg();
  $('#btnLoupe').classList.toggle('on', cfg.loupe);
  if (settingsEl.classList.contains('open')) syncSettingsUI();
  toast(cfg.loupe ? 'Magnifier on' : 'Magnifier off');
  wake();
}

/* ---------------------------------------------------------------- panel -- */

const itemEls = new Map();
let customBody = null, customCount = null, customSig = null;
const groupEls = [];

function makeItem(id, name, sub) {
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.id = id;
  el.innerHTML = `<span class="dot"></span><span class="it-text"><span class="it-name"></span><span class="it-sub"></span></span><span class="it-val"></span><button class="it-x" type="button" aria-label="Clear measurement">${I.x}</button>`;
  el.querySelector('.it-name').textContent = name;
  el.querySelector('.it-sub').textContent = sub;
  el._val = el.querySelector('.it-val');
  el.addEventListener('click', e => {
    if (e.target.closest('.it-x')) { removeMeas(id); return; }
    onItemClick(id, e.shiftKey || e.metaKey || e.ctrlKey);
  });
  el.addEventListener('mouseenter', () => { S.listHover = id; wake(); });
  el.addEventListener('mouseleave', () => { if (S.listHover === id) { S.listHover = null; wake(); } });
  itemEls.set(id, el);
  return el;
}
function makeGroup(name) {
  const sec = document.createElement('section');
  sec.className = 'grp';
  sec.innerHTML = `<button class="grp-head" type="button">${I.chev}<span>${esc(name)}</span><span class="grp-count"></span></button><div class="grp-body"><div class="grp-inner"></div></div>`;
  sec.querySelector('.grp-head').addEventListener('click', () => sec.classList.toggle('collapsed'));
  listEl.appendChild(sec);
  return { sec, inner: sec.querySelector('.grp-inner'), count: sec.querySelector('.grp-count') };
}
function buildList() {
  listEl.innerHTML = '';
  for (const g of GROUPS) {
    const G = makeGroup(g.name);
    g.items.forEach(it => G.inner.appendChild(makeItem(it.id, it.name, subText(it))));
    groupEls.push({ ...G, ids: g.items.map(it => it.id) });
  }
  const C = makeGroup('Custom');
  customBody = C.inner; customCount = C.count;
}
function renderCustom() {
  const list = customs();
  const sig = list.map(m => m.id + (m.id === S.refId ? '*' : '')).join(',') + '|' + rulerCount();
  if (sig === customSig) return;
  customSig = sig;
  for (const id of [...itemEls.keys()]) if (!P[id]) itemEls.delete(id);
  customBody.innerHTML = '';
  if (!list.length) customBody.innerHTML = '<div class="empty">Lines you draw in free mode show up here as layers.</div>';
  const multi = rulerCount() > 1;
  for (const m of list) {
    const sub = KIND_LABEL[m.kind] + (m.kind === 'ruler' && m.id === S.refId && multi ? ' · reference' : '');
    customBody.appendChild(makeItem(m.id, m.name, sub));
  }
  customCount.textContent = list.length ? String(list.length) : '';
}
function applyFilter() {
  const q = $('#filter').value.trim().toLowerCase();
  for (const G of groupEls) {
    let any = false;
    for (const id of G.ids) {
      const it = P[id];
      const hit = !q || (it.name + ' ' + (it.full || '') + ' ' + it.group).toLowerCase().includes(q);
      itemEls.get(id).classList.toggle('hidden', !hit);
      any = any || hit;
    }
    G.sec.classList.toggle('hidden', !any);
  }
}
$('#filter').addEventListener('input', applyFilter);
$('#filter').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; applyFilter(); e.target.blur(); } });

panel.addEventListener('click', e => {
  if (e.target.closest('.item, .grp-head, button, input, .readout, .search')) return;
  deselectAll();
});
$('#btnShowAll').addEventListener('click', toggleShowAll);
$('#btnPanel').addEventListener('click', () => panel.classList.toggle('open'));

/* -------------------------------------------------------------- readout -- */

let RO = null, roKey = '';

function freeReadout() {
  const t = TOOLS[S.tool], cal = S.meas.get(S.calibId);
  const done = PRESET_IDS.filter(id => S.meas.has(id)).length;
  return `
    <div class="ro-kicker">${S.showAll ? 'All layers' : 'Free measure'}</div>
    <div class="ro-title">${S.showAll ? 'Showing everything' : t.title}</div>
    <p class="ro-desc">${S.showAll ? 'Every measurement is overlaid. Export saves exactly what you see as an annotated image.' : t.help}</p>
    <div class="ro-meta"><span>Scale</span><button class="link" type="button" data-act="calib">${cal ? fmtNum(S.calibMM) + ' mm reference' : 'Not calibrated'}</button></div>
    <div class="ro-meta"><span>Measured</span><span>${done} / ${PRESET_IDS.length} presets · ${customs().length} custom</span></div>`;
}
function presetReadout(id) {
  const it = P[id], m = S.meas.get(id);
  const placing = S.draft && S.draft.preset === id;
  const done = m ? it.pts.length : placing ? S.draft.pts.length : 0;
  RO.id = id;
  let range = '';
  if (it.kind === 'segments') {
    const tot = it.ideal.reduce((a, b) => a + b, 0);
    let acc = 0;
    const ticks = it.ideal.slice(0, -1).map(x => { acc += x; return `<b style="left:${(acc / tot * 100).toFixed(2)}%"></b>`; }).join('');
    range = `<div class="rb"><div class="sb" data-r="bars">${it.ideal.map((x, i) => `<i style="background:var(--c${i % 2 ? 2 : 1});flex-grow:${x}"></i>`).join('')}${ticks}</div>
      <div class="rb-foot"><span>Ideal ${it.ideal.join(' : ')}</span><span class="rb-status" data-r="status"></span></div></div>`;
  } else if (it.ref) {
    const [lo, hi] = it.dom, a = (it.ref[0] - lo) / (hi - lo) * 100, b = (it.ref[1] - it.ref[0]) / (hi - lo) * 100;
    range = `<div class="rb"><div class="rb-track"><div class="rb-band" style="left:${a.toFixed(2)}%;width:${b.toFixed(2)}%"></div><div class="rb-mark" data-r="mark"></div></div>
      <div class="rb-foot"><span>Ref ${refText(it)}</span><span class="rb-status" data-r="status"></span></div></div>`;
  }
  let lines = '';
  if (it.kind === 'ratio') lines = `<div class="ro-lines"><div><i style="background:var(--c1)"></i>Line 1 · ${esc(it.lines[0])}</div><div><i style="background:var(--c2)"></i>Line 2 · ${esc(it.lines[1])}</div></div>`;
  else if (it.kind === 'angle') lines = `<div class="ro-lines"><div><i style="background:var(--c3)"></i>Vertex · ${esc(it.pts[1])}</div></div>`;
  else if (it.kind === 'tilt') lines = `<div class="ro-lines"><div><i style="background:var(--c3)"></i>Measured against the horizontal</div></div>`;
  const sided = it.pts.some(p => /· (left|right)/.test(p));
  const steps = it.pts.map((p, i) => `<li class="${i < done ? 'done' : i === done && !m ? 'cur' : ''}"><span>${i + 1}</span>${esc(p)}</li>`).join('');
  return `
    <div class="ro-top">
      <div><div class="ro-kicker">${esc(it.group)} · ${KIND_LABEL[it.kind]}</div><div class="ro-title">${esc(it.name)}</div>${it.full ? `<div class="ro-sub">${esc(it.full)}</div>` : ''}</div>
      <div class="ro-actions">${m ? `<button class="icon-btn sm" type="button" data-act="redo" data-tip="Re-measure">${I.reset}</button><button class="icon-btn sm" type="button" data-act="del" data-tip="Delete">${I.trash}</button>` : ''}</div>
    </div>
    <div class="ro-value${it.kind === 'segments' ? ' small' : ''}${m ? '' : ' empty'}" data-r="val">${m ? esc(fmt(m)) : '—'}</div>
    ${range}${lines}
    <p class="ro-desc">${esc(it.desc)}</p>
    <ol class="ro-steps">${steps}</ol>
    ${sided ? '<div class="ro-note">Left / right as seen in the image.</div>' : ''}`;
}
function customReadout(id) {
  const m = S.meas.get(id);
  if (!m) return freeReadout();
  RO.id = id;
  const isRef = m.kind === 'ruler' && S.refId === id && rulerCount() > 1;
  const acts = (m.kind === 'ruler' && !isRef ? `<button class="icon-btn sm" type="button" data-act="ref" data-tip="Make reference">${I.anchor}</button>` : '')
    + `<button class="icon-btn sm" type="button" data-act="del" data-tip="Delete">${I.trash}</button>`;
  const extra = m.kind === 'calib'
    ? `<div class="ro-meta"><span>Known length</span><button class="link" type="button" data-act="calib">${fmtNum(S.calibMM)} mm · edit</button></div>`
    : isRef ? '<div class="ro-meta"><span>Role</span><span>Reference line (1.00x)</span></div>' : '';
  return `
    <div class="ro-top">
      <div><div class="ro-kicker">Custom · ${KIND_LABEL[m.kind]}</div><div class="ro-title">${esc(m.name)}</div></div>
      <div class="ro-actions">${acts}</div>
    </div>
    <div class="ro-value${m.kind === 'segments' || m.kind === 'ruler' ? ' small' : ''}" data-r="val">${esc(fmt(m))}</div>
    <p class="ro-desc">${TOOLS[m.kind] ? TOOLS[m.kind].help : ''}</p>${extra}`;
}
function multiReadout() {
  const rows = S.sel.map(id => {
    const name = P[id] ? P[id].name : (S.meas.get(id) || {}).name || id;
    return `<div class="ro-row${id === S.active ? ' act' : ''}"><span>${esc(name)}</span><b data-row="${esc(id)}">—</b></div>`;
  }).join('');
  return `
    <div class="ro-kicker">${S.sel.length} layers</div>
    <div class="ro-title">Comparison</div>
    <div class="ro-rows">${rows}</div>
    <p class="ro-desc">Shift-click items to add or remove layers. Click empty space in the list to clear.</p>`;
}
function renderReadout() {
  RO = { rows: new Map() };
  let html = '';
  if (S.img) {
    if (!S.sel.length) html = freeReadout();
    else if (S.sel.length === 1) html = P[S.sel[0]] ? presetReadout(S.sel[0]) : customReadout(S.sel[0]);
    else html = multiReadout();
  }
  readoutEl.innerHTML = html;
  RO.val = readoutEl.querySelector('[data-r=val]');
  RO.mark = readoutEl.querySelector('[data-r=mark]');
  RO.status = readoutEl.querySelector('[data-r=status]');
  RO.bars = $$('[data-r=bars] i', readoutEl);
  $$('[data-row]', readoutEl).forEach(el => RO.rows.set(el.dataset.row, el));
  const key = S.showAll ? '*' : S.sel.join(',') + '|' + (S.sel.length ? '' : S.tool);
  if (key !== roKey) {
    roKey = key;
    if (cfg.motion && readoutEl.animate) {
      readoutEl.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }
}
readoutEl.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = RO && RO.id;
  switch (b.dataset.act) {
    case 'redo':
      if (id && S.meas.has(id)) { removeMeas(id); toast('Place the landmarks again'); }
      break;
    case 'del':
      if (id) {
        removeMeas(id);
        if (P[id]) { S.sel = S.sel.filter(x => x !== id); if (S.active === id) S.active = S.sel[S.sel.length - 1] || null; syncUI(); }
      }
      break;
    case 'ref': if (id) setRef(id); break;
    case 'calib': {
      const c = S.meas.get(S.calibId);
      if (c) openCalib(c, false);
      else { setTool('calib'); toast('Draw a line across something of known size'); }
      break;
    }
  }
});

function statusText(it, v) {
  if (it.classify) return it.classify(v);
  return v < it.ref[0] ? 'Below reference' : v > it.ref[1] ? 'Above reference' : 'Within reference';
}
function updateValues() {
  for (const [id, el] of itemEls) {
    const m = S.meas.get(id);
    setText(el._val, m ? fmt(m) : '');
    setBlur(el._val, m ? m.disp._b : 0);
  }
  if (!RO) return;
  for (const [id, el] of RO.rows) { const m = S.meas.get(id); setText(el, m ? fmt(m) : '—'); }
  if (!RO.id) return;
  const m = S.meas.get(RO.id) || (S.draftM && S.draftM.preset === RO.id ? S.draftM : null);
  const d = m ? m.disp : null;
  if (RO.val) {
    const s = m ? fmt(m) : '—';
    setText(RO.val, s);
    RO.val.classList.toggle('empty', s === '—');
    setBlur(RO.val, d ? d._b : 0);
  }
  const it = P[RO.id];
  if (!it) return;
  if (RO.mark) {
    const v = d && d.v;
    if (v == null) { RO.mark.classList.remove('on'); setText(RO.status, ''); RO.status.classList.remove('ok'); }
    else {
      const [lo, hi] = it.dom;
      RO.mark.style.left = (clamp((v - lo) / (hi - lo), 0, 1) * 100).toFixed(2) + '%';
      RO.mark.classList.add('on');
      setText(RO.status, statusText(it, v));
      RO.status.classList.toggle('ok', v >= it.ref[0] && v <= it.ref[1]);
    }
  }
  if (RO.bars.length && RO.status) {
    const vals = it.ideal.map((_, i) => d && d['s' + i]);
    if (vals.every(v => v != null)) {
      const tot = vals.reduce((a, b) => a + b, 0), itot = it.ideal.reduce((a, b) => a + b, 0);
      let dev = 0;
      vals.forEach((v, i) => {
        RO.bars[i].style.flexGrow = v.toFixed(4);
        const ideal = it.ideal[i] / itot;
        dev = Math.max(dev, Math.abs(v / tot - ideal) / ideal);
      });
      setText(RO.status, `max deviation ${(dev * 100).toFixed(1)}%`);
      RO.status.classList.toggle('ok', dev < .06);
    } else {
      RO.bars.forEach((b, i) => { b.style.flexGrow = String(it.ideal[i]); });
      setText(RO.status, ''); RO.status.classList.remove('ok');
    }
  }
}

/* ------------------------------------------------------------------ hint -- */

function renderHint() {
  let html = '';
  if (S.img) {
    const d = S.draft;
    const tgt = d ? { preset: d.preset, kind: d.kind } : placeTarget();
    if (S.tool === 'morph') {
      const mode = { push: 'Push', bloat: 'Bloat', pinch: 'Pinch', restore: 'Restore' }[cfg.mMode];
      html = `<b>Morph · ${mode}</b><span class="h-desc">${cfg.mMode === 'push' ? 'Drag' : 'Hold'} on the photo · <kbd>[</kbd> <kbd>]</kbd> size · hold <kbd>B</kbd> to compare · right-drag pans</span>`;
    } else if (S.tool === 'adjust') {
      html = `<b>Adjust image</b><span class="h-desc">Corners stretch (<kbd>Shift</kbd> keep ratio) · outside a corner rotates · inside moves${S.adj.lens > 0 ? ' · blue dots fit the face' : ''}</span>`;
    } else if (tgt && tgt.preset) {
      const it = P[tgt.preset], i = d ? d.pts.length : 0, name = it.pts[i] || '';
      const desc = LANDMARKS[name.split(' · ')[0]] || '';
      html = `<span class="h-step">${i + 1}/${it.pts.length}</span><b>${esc(name)}</b><span class="h-desc">${esc(desc)}</span>`;
    } else if (d) {
      if (d.kind === 'segments') html = `<b>${d.pts.length} point${d.pts.length === 1 ? '' : 's'}</b><span class="h-desc"><kbd>Enter</kbd> or double-click to finish · <kbd>Esc</kbd> cancels</span>`;
      else html = `<b>${TOOLS[d.kind].title}</b><span class="h-desc">Point ${d.pts.length + 1} of ${d.need} · <kbd>Shift</kbd> snaps to 45° · <kbd>Esc</kbd> cancels</span>`;
    } else if (tgt) {
      const short = { ruler: 'Click two points', angle: 'Click three points — the middle one is the vertex', tilt: 'Click two points to read the angle from horizontal', segments: 'Click points along a feature', calib: 'Draw across something of known size' }[tgt.kind];
      html = `<b>${TOOLS[tgt.kind].title}</b><span class="h-desc">${short} · <kbd>Esc</kbd> back to select</span>`;
    } else if (S.picked.size) {
      html = `<b>${S.picked.size} selected</b><span class="h-desc">Drag to move · <kbd>Del</kbd> delete · <kbd>Esc</kbd> clear</span>`;
    } else {
      html = `<b>Select</b><span class="h-desc">Click or drag a box to select · right-drag to pan · <kbd>Ctrl</kbd> <kbd>A</kbd> all</span>`;
    }
  }
  hintEl.classList.toggle('show', !!html);
  if (hintIn._h === html) return;
  hintIn._h = html;
  hintIn.innerHTML = html;
  if (cfg.motion && hintIn.animate) hintIn.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
}

let toastTimer = 0;
function toast(msg, ms = 2400) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ---------------------------------------------------------------- sync -- */

function syncUI() {
  wake();
  for (const id of [...S.picked]) { const m = S.meas.get(id); if (!m || !isVisible(m)) S.picked.delete(id); }
  if (customBody) renderCustom();
  const ph = S.draft && S.draft.preset;
  const tgt = S.draft ? { kind: S.draft.kind, preset: S.draft.preset } : placeTarget();
  for (const [id, el] of itemEls) {
    const has = S.meas.has(id);
    el.classList.toggle('measured', has);
    el.classList.toggle('sel', S.sel.includes(id) || (S.showAll && has));
    el.classList.toggle('active', S.sel.length > 1 && S.active === id);
    el.classList.toggle('placing', ph === id || (!ph && !!tgt && tgt.preset === id));
    el.classList.toggle('picked', S.picked.has(id));
  }
  for (const G of groupEls) {
    const n = G.ids.filter(id => S.meas.has(id)).length;
    G.count.textContent = `${n}/${G.ids.length}`;
  }
  $('#progress').textContent = `${PRESET_IDS.filter(id => S.meas.has(id)).length}/${PRESET_IDS.length}`;
  $('#btnShowAll').classList.toggle('on', S.showAll);
  const placingPreset = !!(tgt && tgt.preset);
  const shown = placingPreset ? (tgt.kind === 'ratio' ? 'ruler' : tgt.kind) : S.tool;
  $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === shown));
  toolbar.classList.toggle('locked', placingPreset);
  $('#btnUndo').disabled = !S.undo.length;
  $('#btnRedo').disabled = !S.redo.length;
  body.classList.toggle('has-hist', !!(S.img || S.undo.length || S.redo.length));
  renderReadout();
  renderHint();
  refreshCursor();
  if (toolOptsFor) syncToolOpts();
}

/* ------------------------------------------------------------- settings -- */

function buildSettings() {
  $$('.color-row').forEach(row => {
    const key = row.dataset.key, wrap = row.querySelector('.swatches');
    wrap.innerHTML = SWATCHES.map(c => `<button class="sw" type="button" data-c="${c}" style="--sw:${c}" aria-label="Colour ${c}"></button>`).join('')
      + '<label class="sw custom" title="Custom colour"><input type="color" aria-label="Custom colour"></label>';
    wrap.addEventListener('click', e => {
      const b = e.target.closest('.sw[data-c]');
      if (b) { cfg[key] = b.dataset.c; commitCfg(); }
    });
    const inp = wrap.querySelector('input');
    inp.addEventListener('input', () => { cfg[key] = inp.value.toUpperCase(); commitCfg(); });
  });
  $('#themeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (b) { cfg.theme = b.dataset.v; commitCfg(); }
  });
  $('#setWidth').addEventListener('input', e => { cfg.width = +e.target.value; commitCfg(); });
  $('#setLabel').addEventListener('input', e => { cfg.label = +e.target.value; commitCfg(); });
  $$('[data-cfg]').forEach(inp => inp.addEventListener('change', () => { cfg[inp.dataset.cfg] = inp.checked; commitCfg(); }));
  $('#resetSettings').addEventListener('click', () => { cfg = { ...DEFAULTS }; commitCfg(); toast('Settings reset'); });
  $('#btnSettings').addEventListener('click', () => settingsEl.classList.contains('open') ? closeSettings() : openSettings());
  settingsEl.addEventListener('click', e => { if (e.target === settingsEl || e.target.closest('[data-close]')) closeSettings(); });
  $('#btnTheme').addEventListener('click', () => { cfg.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; commitCfg(); });
  $('#btnLoupe').addEventListener('click', toggleLoupe);
}
function drawPreview() {
  const cv = $('#previewCv');
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ratio = mkMeas({ id: 'pv1', kind: 'ratio', pts: [{ x: w * .1, y: h * .52 }, { x: w * .56, y: h * .52 }, { x: w * .33, y: h * .14 }, { x: w * .33, y: h * .88 }] });
  const ang = mkMeas({ id: 'pv2', kind: 'angle', pts: [{ x: w * .68, y: h * .82 }, { x: w * .79, y: h * .22 }, { x: w * .91, y: h * .82 }] });
  const o = { toS: p => p, u: 1, t: 0, alpha: 1, labels: [], final: true };
  drawMeas(ctx, ratio, { ...o, disp: targets(ratio) });
  drawMeas(ctx, ang, { ...o, disp: targets(ang) });
}
function syncSettingsUI() {
  $$('.color-row').forEach(row => {
    const key = row.dataset.key, val = String(cfg[key]).toUpperCase();
    let preset = false;
    row.querySelectorAll('.sw[data-c]').forEach(b => {
      const on = b.dataset.c.toUpperCase() === val;
      b.classList.toggle('on', on);
      preset = preset || on;
    });
    const cu = row.querySelector('.sw.custom');
    cu.classList.toggle('on', !preset);
    cu.style.setProperty('--sw', val);
    cu.querySelector('input').value = val.toLowerCase();
    row.querySelector('.cr-name i').style.background = val;
  });
  $$('#themeSeg [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === cfg.theme));
  $('#setWidth').value = cfg.width;
  $('#setLabel').value = cfg.label;
  $$('[data-cfg]').forEach(inp => { inp.checked = !!cfg[inp.dataset.cfg]; });
  $('#colorWarn').classList.toggle('on', colorGap(cfg.c1, cfg.c2) < 110);
  drawPreview();
}
function commitCfg() { saveCfg(); applyCfg(); syncSettingsUI(); syncUI(); }
function openSettings() {
  settingsEl.classList.add('open');
  settingsEl.setAttribute('aria-hidden', 'false');
  $('#btnSettings').classList.add('on');
  syncSettingsUI();
}
function closeSettings() {
  settingsEl.classList.remove('open');
  settingsEl.setAttribute('aria-hidden', 'true');
  $('#btnSettings').classList.remove('on');
}

/* ------------------------------------------------------------- toolbar -- */

$$('.tool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#zoomIn').addEventListener('click', () => zoomCenter(1.25));
$('#zoomOut').addEventListener('click', () => zoomCenter(.8));
$('#zoomFit').addEventListener('click', () => fitView());
$('#zoomPct').addEventListener('click', () => zoomCenter(1 / S.viewT.k));
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) $$('.mod-key').forEach(k => { k.textContent = '⌘'; });

/* ---------------------------------------------------------------- loop -- */

let lastT = now();
function frame(t) {
  // keep the loop alive no matter what — one bad frame must never freeze the app
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  try {
    stepView(dt);
    if (S.stroke && cfg.mMode !== 'push') dabHere(dt);
    drawImageLayer(dt);
    drawGrid(dt);
    if (S.img && t < S.awakeUntil) { drawOverlay(t, dt); updateValues(); }
    else if (!S.img && S.leaving.length) S.leaving = [];
  } catch (err) {
    if (!frame.warned) { frame.warned = true; console.error(err); }
  }
}

/* ---------------------------------------------------------------- init -- */

resize();
applyCfg();
buildList();
buildSettings();
syncSettingsUI();
syncUI();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { wake(); if (settingsEl.classList.contains('open')) drawPreview(); });
requestAnimationFrame(frame);
if (STALE) setTimeout(() => toast(GL_MESSAGES.stale, 9000), 600);

// tiny scripting hook (handy for debugging from the console)
window.cranimeter = { loadFile, state: S, build: BUILD, gpu: () => (GLR ? 'webgl2' : GL_REASON) };

})();
