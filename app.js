/* ==========================================================================
   Cranimeter · app
   Plain JS, no build step. Everything runs locally in the browser.
   ========================================================================== */
(async () => {
'use strict';

/* ---------------------------------------------------------------- data -- */

const BUILD = '14';   // must match the build in presets.js, warp.js and facemap.js
/*
 * Make sure the helper scripts belong to this release. Browsers and GitHub Pages cache files for
 * a while, so right after an upload a page can get the new app.js next to an old warp.js (or an
 * old index.html without the newer script tags). Anything missing or from another release is
 * fetched again, bypassing every cache — so stale files fix themselves instead of blocking the app.
 */
const MODULES = [['CRANI', 'presets.js'], ['CraniWarp', 'warp.js'], ['CraniMap', 'facemap.js']];
const moduleOk = g => !!window[g] && window[g].build === BUILD;
const loadFresh = file => new Promise(res => {
  const s = document.createElement('script');
  s.src = `${file}?v=${BUILD}&fresh=${Date.now()}`;
  s.onload = s.onerror = () => res();
  document.head.appendChild(s);
});
for (const [g, file] of MODULES) if (!moduleOk(g)) await loadFresh(file);
/** Files that are still missing or out of date on the server after a fresh fetch. */
const OLD_FILES = MODULES.filter(([g]) => !moduleOk(g)).map(([, f]) => f);
if (!window.CRANI) { document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;inset:auto 0 24px;text-align:center;color:#f5a3a3;font:14px system-ui">presets.js didn’t load — upload it next to index.html.</p>'); return; }
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
  morph:    { title: 'Morph',       help: 'Scan the face once (front or profile), then change the anatomy — bone, soft tissue and proportions — or brush freely. Landmarks stay attached, so every ratio updates live.' },
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
  mMode: 'push', mSize: .09, mStrength: .55, mHard: .25, mLimit: false,
  mSub: 'map', mShowLayers: true, mShade: .6, mOpen: 'bone',
  motion: !matchMedia('(prefers-reduced-motion: reduce)').matches,
};
const SWATCHES = ['#7CCBF5', '#F2A7C6', '#F0CD6E', '#8FE0B4', '#BCAEF7', '#F5A3A3', '#6ED8CB', '#F2F2F3'];
const SKEY = 'cranimeter:settings';
let cfg = (() => {
  try {
    const c = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') };
    if (c.mSub !== 'map' && c.mSub !== 'morph') c.mSub = 'morph';   // older releases had more sub-modes
    for (const k of ['mSmooth', 'mLevels', 'mLevelStrict', 'mShowLevels', 'mProtect', 'mLevel']) delete c[k];
    if (/^s[A-Z]/.test(c.mMode)) c.mMode = 'push';   // the 3D sculpt brushes of build 13 are gone
    return c;
  } catch (e) { return { ...DEFAULTS }; }
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
// presets.js is plain data, so an older copy still works; the renderer and the face map must match
const OLD_CODE = OLD_FILES.filter(f => f !== 'presets.js');
if (OLD_CODE.length) GL_REASON = 'stale';
else {
  try { GLR = window.CraniWarp.createRenderer(glcv); } catch (e) { console.error(e); }
  if (!GLR) GL_REASON = 'webgl';
}
if (GLR) imgcv.style.display = 'none'; else glcv.remove();
const fileList = OLD_CODE.join(' and ');
const GL_MESSAGES = {
  stale: OLD_CODE.some(f => !window[MODULES.find(m => m[1] === f)[0]])
    ? `${fileList} is missing from the site. Upload it next to index.html — Morph and Adjust need it.`
    : `The site still has an older ${fileList}. Upload the new ${OLD_CODE.length > 1 ? 'files' : 'file'} — Morph and Adjust need ${OLD_CODE.length > 1 ? 'them' : 'it'}.`,
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
  // face scan (Morph → Map) and the anatomy settings on top of it (Morph → Morph)
  map: null, mapSel: new Set(), mapHover: null, mapDrag: null, mapBox: null, qfit: null,
  anat: {}, anatBase: {}, anatHover: null, anatSnap: null, hideGroups: new Set(),
  // dodge & burn paint: log brightness per tone-grid node on the original photo; copy-on-write
  tone: { field: null, base: null }, toneRev: 0, tstroke: null,
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
const isIdentity = () => affineIdentity() && !lensD() && !S.warp.field && !mapActive();

/** Source-space position of a measured landmark (by exact preset label). */
function landmarkS(...names) {
  for (const n of names) for (const m of S.meas.values()) {
    if (!m.preset || !m.src) continue;
    const i = P[m.preset].pts.indexOf(n);
    if (i >= 0) return m.src[i];
  }
  return null;
}
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

/* ------------------------------------------------ face scan (Morph) --
   Pipeline after the free brush:  P′ ──(two thin-plate-spline layers)──▶ S.
   S.map.p = where each scan dot sits on the original photo (S). The anatomy settings move the 3D
   template; projecting that change into the photo gives where each dot is now (q, in P′).
   The face layer is composited over the head / background layer; the tone layer (dodge & burn)
   then re-lights what moved toward or away from the camera. */
const FM = window.CraniMap || null;
const NMAP = FM ? FM.POINTS.length : 0;
/** Spacing of the dense contour controls (≈ 2% of the photo — the spline is smooth in between). */
const mapGap = () => .02 * Math.max(S.iw, S.ih);
/** Smoothing radius² for the moving-least-squares template fit. */
const mlsEps = () => Math.pow(.004 * Math.max(S.iw, S.ih), 2);
/** Thin-plate-spline smoothing for the two layers (photo size = 1). */
const TPS_SMOOTH = 2e-4;
/** While mapping (Morph → Map) the photo is shown unchanged so you align to the original. */
const mapping = () => S.tool === 'morph' && cfg.mSub === 'map';
const anatOn = (a = S.anat) => Object.values(a).some(v => Math.abs(v) > 1e-3);
const toneOn = () => !!(S.tone && S.tone.field);
const mapActive = () => !!(S.map && anatOn() && !mapping());
const isProfile = (m = S.map) => !!m && Math.abs(m.yaw) > 45;
const anatSame = (a, b) => FM.OPS.every(o => Math.abs((a[o.key] || 0) - (b[o.key] || 0)) < 1e-3);
/** Something changed: the alignment (moved = true) or only the anatomy. */
function mapTouched(moved) { const m = S.map; m.ver++; if (moved) m.pver++; }
function borderAnchors() {
  const w = S.iw, h = S.ih, out = [];
  for (const fx of [0, .25, .5, .75, 1]) out.push({ x: fx * w, y: 0 }, { x: fx * w, y: h });
  out.push({ x: 0, y: h / 3 }, { x: 0, y: 2 * h / 3 }, { x: w, y: h / 3 }, { x: w, y: 2 * h / 3 });
  return out;
}
/** Landmark label a scan dot matches in this view (preset names), or null. */
function lmLabel(pt, view) {
  if (!pt.lm) return null;
  if (view === 'front') return pt.side ? `${pt.lm} · ${pt.side < 0 ? 'left' : 'right'}` : pt.lm;
  const near = FM.VIEWS[view] > 0 ? 1 : -1;
  return !pt.side || pt.side === near ? pt.lm : null;
}
/** Similarity from the template (cm, seen from this view) to the photo, fitted to every visible dot. */
function mapFrame() {
  const m = S.map;
  if (m.frame && m.frame.pver === m.pver) return m.frame;
  const A = [];
  let ax = 0, ay = 0, bx = 0, by = 0;
  FM.POINTS.forEach((pt, i) => {
    if (!m.vis[i]) return;
    const t = FM.project(pt, m.yaw);
    A.push([t.x, t.y, m.p[2 * i], m.p[2 * i + 1]]);
    ax += t.x; ay += t.y; bx += m.p[2 * i]; by += m.p[2 * i + 1];
  });
  const n = A.length || 1;
  ax /= n; ay /= n; bx /= n; by /= n;
  let sr = 0, si = 0, aa = 0;
  for (const [x, y, u, v] of A) {
    const hx = x - ax, hy = y - ay, gx = u - bx, gy = v - by;
    sr += hx * gx + hy * gy; si += hx * gy - hy * gx; aa += hx * hx + hy * hy;
  }
  const zr = sr / (aa || 1), zi = si / (aa || 1);
  // photo = z·template + t  (z = scale and roll as a complex number)
  m.frame = { pver: m.pver, zr, zi, scale: Math.hypot(zr, zi) || 1, tx: bx - (zr * ax - zi * ay), ty: by - (zi * ax + zr * ay) };
  return m.frame;
}
/**
 * The anatomy settings applied to the 3D template, projected into the photo:
 *   q  where every dot is now (P′) · dz  how far it moved toward the camera (px) · z0  its depth (px)
 */
function mapShape() {
  const m = S.map;
  if (m.shape && m.shape.ver === m.ver) return m.shape;
  const f = mapFrame(), D = FM.anatomy(S.anat), t = m.yaw * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const q = new Float32Array(NMAP * 2), dz = new Float32Array(NMAP), z0 = new Float32Array(NMAP);
  FM.POINTS.forEach((pt, i) => {
    const dx = D[3 * i] * c - D[3 * i + 2] * s, dy = D[3 * i + 1];
    q[2 * i] = m.p[2 * i] + f.zr * dx - f.zi * dy;
    q[2 * i + 1] = m.p[2 * i + 1] + f.zi * dx + f.zr * dy;
    dz[i] = f.scale * (D[3 * i] * s + D[3 * i + 2] * c);
    z0[i] = f.scale * (pt.x * s + pt.z * c);
  });
  m.shape = { ver: m.ver, q, dz, z0 };
  return m.shape;
}
const mapBoundary = (m = S.map) => m.contours.find(c => c.boundary);
/** Outward unit normals along a contour of dots (positions in arr), pointing away from the head (or, with own, from the contour's own centre). */
function contourNormals(c, arr, own) {
  const m = S.map, idx = c.idx, n = idx.length;
  let cx = 0, cy = 0, k = 0;
  if (own) idx.forEach(i => { cx += arr[2 * i]; cy += arr[2 * i + 1]; k++; });
  else FM.POINTS.forEach((_, i) => { if (m.vis[i]) { cx += m.p[2 * i]; cy += m.p[2 * i + 1]; k++; } });
  cx /= k || 1; cy /= k || 1;
  return idx.map((i, j) => {
    const a = idx[c.closed ? (j + n - 1) % n : Math.max(0, j - 1)], b = idx[c.closed ? (j + 1) % n : Math.min(n - 1, j + 1)];
    let nx = arr[2 * b + 1] - arr[2 * a + 1], ny = -(arr[2 * b] - arr[2 * a]);
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if (nx * (arr[2 * i] - cx) + ny * (arr[2 * i + 1] - cy) < 0) { nx = -nx; ny = -ny; }
    return [nx, ny];
  });
}
/**
 * Controls for the two layers (cached per scan version). Every contour is
 * densified along its spline so it moves as one smooth curve. The back layer only follows the
 * face edge where the face shrinks (to fill the gap); where the face grows it stays put and the
 * face covers it.
 */
function mapCtrl() {
  const m = S.map;
  if (m.ctrl && m.ctrl.ver === m.ver) return m.ctrl;
  const { q } = mapShape(), qb = q.slice(), F = [], B = [];
  const bound = mapBoundary(), onBound = new Set(bound.idx);
  contourNormals(bound, m.p).forEach(([nx, ny], k) => {
    const i = bound.idx[k];
    const dn = Math.min(0, (q[2 * i] - m.p[2 * i]) * nx + (q[2 * i + 1] - m.p[2 * i + 1]) * ny);
    qb[2 * i] = m.p[2 * i] + nx * dn; qb[2 * i + 1] = m.p[2 * i + 1] + ny * dn;
  });
  // The ears shift in part of the way with a narrowed face, so the revealed gap is filled
  // from the whole side of the head instead of stretching the ear.
  const sig = .35 * mapScale();
  FM.POINTS.forEach((pt, i) => {
    if (pt.group !== 'ears' || !m.vis[i]) return;
    let sw = 0, fx = 0, fy = 0;
    for (const o of bound.idx) {
      const d2 = (m.p[2 * o] - m.p[2 * i]) ** 2 + (m.p[2 * o + 1] - m.p[2 * i + 1]) ** 2, w = Math.exp(-d2 / (2 * sig * sig));
      sw += w; fx += w * (qb[2 * o] - m.p[2 * o]); fy += w * (qb[2 * o + 1] - m.p[2 * o + 1]);
    }
    if (sw > 1e-6) { qb[2 * i] += .6 * fx / sw; qb[2 * i + 1] += .6 * fy / sw; }
  });
  FM.POINTS.forEach((pt, i) => {
    if (!m.vis[i]) return;
    const both = pt.field === 'both' || onBound.has(i);
    if (both || pt.field === 'face') {
      F.push(q[2 * i], q[2 * i + 1], m.p[2 * i], m.p[2 * i + 1]);
    }
    if (both || pt.field === 'back') B.push(qb[2 * i], qb[2 * i + 1], m.p[2 * i], m.p[2 * i + 1]);
  });
  // Dense samples along each contour (same spline parameters before and after), so every
  // contour moves as one smooth curve. The back layer needs less detail than the face.
  const gap = mapGap();
  for (const c of m.contours) {
    if (c.idx.some(i => !m.vis[i])) continue;
    const P_ = c.idx.map(i => ({ x: m.p[2 * i], y: m.p[2 * i + 1] })), N_ = P_.length;
    const lay = c.field === 'both' ? ['face', 'back'] : [c.field];
    for (const L of lay) {
      const g = L === 'back' ? gap * 1.8 : gap, src = L === 'back' ? qb : q, arr = L === 'back' ? B : F;
      const steps = s => { const a = P_[s], b = P_[(s + 1) % N_]; return Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / g)); };
      const knots = new Set();
      for (let s = 0, k = 0; s < (c.closed ? N_ : N_ - 1); s++) { knots.add(k); k += steps(s); if (!c.closed && s === N_ - 2) knots.add(k); }
      const sp = FM.spline(P_, c.closed, steps), sq = FM.spline(c.idx.map(i => ({ x: src[2 * i], y: src[2 * i + 1] })), c.closed, steps);
      sp.forEach((s, k) => { if (!knots.has(k) && k < sq.length) arr.push(sq[k].x, sq[k].y, s.x, s.y); });
    }
  }
  // The eyeballs are rigid: anchors inside each eye opening move with the opening as a whole, so a
  // lid fold dropping over the eye covers it instead of squashing the iris.
  for (const c of m.contours) {
    if (!c.closed || !c.id.startsWith('eye') || c.idx.some(i => !m.vis[i])) continue;
    let cx = 0, cy = 0, dx = 0, dy = 0;
    for (const i of c.idx) { cx += m.p[2 * i]; cy += m.p[2 * i + 1]; dx += q[2 * i] - m.p[2 * i]; dy += q[2 * i + 1] - m.p[2 * i + 1]; }
    const n = c.idx.length; cx /= n; cy /= n; dx /= n; dy /= n;
    F.push(cx + dx, cy + dy, cx, cy);
    for (const f of [.3, .6]) for (const i of c.idx) {
      const ax = cx + (m.p[2 * i] - cx) * f, ay = cy + (m.p[2 * i + 1] - cy) * f;
      F.push(ax + dx, ay + dy, ax, ay);
    }
  }
  // the photo border stays put (keeps far-away areas still in both layers)
  for (const b of borderAnchors()) { B.push(b.x, b.y, b.x, b.y); F.push(b.x, b.y, b.x, b.y); }
  // A ring of fixed anchors just outside the face edge: when the face recedes, the background
  // that fills the gap is stretched only in a narrow band, instead of bending far across the photo.
  // (Skipped where the ring would land on hair, ears or neck dots, which carry their own motion.)
  const ringGap = .22 * mapScale(), others = [];
  FM.POINTS.forEach((pt, i) => { if (m.vis[i] && pt.field === 'back') others.push(i); });
  contourNormals(bound, m.p).forEach(([nx, ny], k) => {
    const i = bound.idx[k], ax = m.p[2 * i] + nx * ringGap, ay = m.p[2 * i + 1] + ny * ringGap;
    if (maskAt(ax, ay) > .02) return;
    if (others.some(o => (m.p[2 * o] - ax) ** 2 + (m.p[2 * o + 1] - ay) ** 2 < (ringGap * .8) ** 2)) return;
    B.push(ax, ay, ax, ay);
  });
  const s = Math.max(S.iw, S.ih);
  // A little smoothing (instead of passing exactly through every control) keeps tightly packed
  // controls that move differently — a lid fold dropping toward the lash line — from rippling.
  m.ctrl = { ver: m.ver, front: FM.tpsFit(F, F.length / 4, s, TPS_SMOOTH), back: FM.tpsFit(B, B.length / 4, s, TPS_SMOOTH) };
  return m.ctrl;
}
/** Bring the GPU's face-scan grid up to date (computed on the GPU, or on the CPU as a fallback). */
let glMapKey = '';
function syncMapGrid() {
  const key = `${S.imgSeq}|${S.map.ver}`;
  if (key === glMapKey) return;
  const c = mapCtrl();
  glMapKey = key;
  const big = Math.max(S.iw, S.ih);
  const cell = big / (GLR.gpuMap ? 320 : 96), gw = Math.ceil(S.iw / cell) + 1, gh = Math.ceil(S.ih / cell) + 1;
  if (GLR.gpuMap) { GLR.computeMap(c.front, c.back, gw, gh, cell); return; }
  const g = new Float32Array(gw * gh * 4);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = i * cell, y = j * cell, k = (j * gw + i) * 4;
    const f = FM.tpsEval(c.front, x, y), b = FM.tpsEval(c.back, x, y);
    g[k] = f[0]; g[k + 1] = f[1]; g[k + 2] = b[0]; g[k + 3] = b[1];
  }
  GLR.setMapGrid(g, gw, gh, cell);
}
function maskAt(x, y) {
  const k = S.map && S.map.mask;
  if (!k) return 0;
  const i = clamp(Math.round(x * k.sc), 0, k.w - 1), j = clamp(Math.round(y * k.sc), 0, k.h - 1);
  return k.data[(j * k.w + i) * 4] / 255;
}
/** P′ → S: which source pixel ends up here (face layer wins where its mask says so). */
function mapSrc(x) {
  if (!mapActive()) return { x: x.x, y: x.y };
  const c = mapCtrl();
  const [fx, fy] = FM.tpsEval(c.front, x.x, x.y);
  if (maskAt(fx, fy) >= .5) return { x: fx, y: fy };
  const [bx, by] = FM.tpsEval(c.back, x.x, x.y);
  return { x: bx, y: by };
}
/** S → P′: where a source point is shown now (used to keep measurements on the face). */
function mapInv(s) {
  if (!mapActive()) return { x: s.x, y: s.y };
  // a landmark on the face edge (zygion, gonion…) belongs to the face, so the edge counts as face
  const onFace = maskAt(s.x, s.y) >= .2;
  const c = mapCtrl(), T = onFace ? c.front : c.back;
  // solve f(x) = s: start from the reflected guess, then fixed-point steps
  let [fx, fy] = FM.tpsEval(T, s.x, s.y), x = 2 * s.x - fx, y = 2 * s.y - fy;
  for (let it = 0; it < 12; it++) {
    [fx, fy] = FM.tpsEval(T, x, y);
    const ex = s.x - fx, ey = s.y - fy;
    x += ex; y += ey;
    if (ex * ex + ey * ey < 1e-4) break;
  }
  return { x, y };
}
/** Rasterise the face layer (inside the face edge for this view) from the scan's photo positions. */
function buildMask() {
  const m = S.map, sc = Math.min(1, 1024 / Math.max(S.iw, S.ih));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(S.iw * sc)); c.height = Math.max(1, Math.round(S.ih * sc));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const pts = FM.spline(mapBoundary().idx.map(i => ({ x: m.p[2 * i] * sc, y: m.p[2 * i + 1] * sc })), true, 10);
  g.filter = 'blur(1.5px)';
  g.fillStyle = '#fff';
  g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fill();
  g.filter = 'none';
  m.mask = { canvas: c, data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, sc };
  m.maskVer = (m.maskVer || 0) + 1;
}
/** Similarity MLS (allows scaling) — used to fit the template onto the photo. */
function simFit(pairs, x, y) {
  let sw = 0, qx = 0, qy = 0, px = 0, py = 0;
  const e = mlsEps();
  for (const c of pairs) { const dx = c.a.x - x, dy = c.a.y - y, w = 1 / (dx * dx + dy * dy + e); sw += w; qx += w * c.a.x; qy += w * c.a.y; px += w * c.b.x; py += w * c.b.y; }
  qx /= sw; qy /= sw; px /= sw; py /= sw;
  if (pairs.length < 2) return { x: x + px - qx, y: y + py - qy };
  let mr = 0, mi = 0, mu = 0;
  for (const c of pairs) {
    const dx = c.a.x - x, dy = c.a.y - y, w = 1 / (dx * dx + dy * dy + e);
    const hx = c.a.x - qx, hy = c.a.y - qy, gx = c.b.x - px, gy = c.b.y - py;
    mr += w * (hx * gx + hy * gy); mi += w * (hx * gy - hy * gx); mu += w * (hx * hx + hy * hy);
  }
  const cr = mr / (mu || 1), ci = mi / (mu || 1), vx = x - qx, vy = y - qy;
  return { x: px + cr * vx - ci * vy, y: py + cr * vy + ci * vx };
}
/** A scan object for a view and photo positions (everything derived from them starts fresh). */
function makeMap(view, p, snapped, light) {
  const yaw = FM.VIEWS[view];
  const vis = new Uint8Array(NMAP);
  FM.POINTS.forEach((pt, i) => { vis[i] = FM.visible(pt, yaw) ? 1 : 0; });
  return { view, yaw, p, vis, contours: FM.contours(yaw), ver: 1, pver: 1, snapped: snapped || 0, light: light || null };
}
/**
 * Fit the face scan to the photo: the template seen from this view, then pulled onto every
 * measured landmark it shares a name with (and any quick-fit clicks), so matched points land exactly.
 */
function fitMap(view = (S.map && S.map.view) || 'front', extraPairs = []) {
  // the template sits on a first guess of the face frame (a profile is centred on the head)
  const yaw = FM.VIEWS[view], f = guessFace(), sx = f.ax / 6.75, sy = f.ay / 6;
  const T = FM.POINTS.map(pt => { const t = FM.project(pt, yaw); return { x: f.cx + t.x * sx, y: f.cy + t.y * sy }; });
  const pairs = extraPairs.map(c => ({ i: c.i, a: T[c.i], b: c.b }));
  FM.POINTS.forEach((pt, i) => {
    const lab = lmLabel(pt, view);
    if (!lab || pairs.some(c => c.i === i)) return;
    const s = landmarkS(lab);
    if (s) pairs.push({ i, a: T[i], b: s });
  });
  const pos = pairs.length ? T.map(t => simFit(pairs, t.x, t.y)) : T;
  for (const c of pairs) pos[c.i] = { x: c.b.x, y: c.b.y };
  const p = new Float32Array(NMAP * 2);
  pos.forEach((v, i) => { p[2 * i] = v.x; p[2 * i + 1] = v.y; });
  S.map = makeMap(view, p, pairs.length);
  buildMask();
  estimateLight();
  return pairs.length;
}
/** Luminance of the photo (downscaled, slightly blurred), for edge snapping and light estimation. */
function photoLum() {
  if (S.lum && S.lum.rec === S.imgRec) return S.lum.at;
  const sc = Math.min(1, 640 / Math.max(S.iw, S.ih));
  const w = Math.max(2, Math.round(S.iw * sc)), h = Math.max(2, Math.round(S.ih * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.filter = 'blur(1px)'; g.drawImage(S.img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = .299 * d[4 * i] + .587 * d[4 * i + 1] + .114 * d[4 * i + 2];
  const at = (x, y) => {
    const fx = clamp(x * sc, 0, w - 1.001), fy = clamp(y * sc, 0, h - 1.001), i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * w + i;
    return (L[k] * (1 - tx) + L[k + 1] * tx) * (1 - ty) + (L[k + w] * (1 - tx) + L[k + w + 1] * tx) * ty;
  };
  at.step = 1 / sc;
  S.lum = { rec: S.imgRec, at };
  return at;
}
/**
 * Where the light comes from, read off the photo: a brighter cheek on one side means light from
 * that side; a forehead brighter than the chin means light from above. Used to relight changes.
 */
function estimateLight() {
  const m = S.map, lum = photoLum(), r = .12 * mapScale();
  const avg = id => {
    const i = FM.INDEX[id];
    if (i == null || !m.vis[i]) return null;
    let s = 0, n = 0;
    for (let a = 0; a < 8; a++) for (const f of [.4, 1]) { s += lum(m.p[2 * i] + Math.cos(a * .785) * r * f, m.p[2 * i + 1] + Math.sin(a * .785) * r * f); n++; }
    return s / n;
  };
  let lx = 0, ly = -.35;
  if (!isProfile(m)) {
    const l = avg('malarL'), rr = avg('malarR');
    if (l != null && rr != null) lx = clamp((rr - l) / Math.max(1, rr + l) * 3, -.8, .8);
  }
  const top = avg('fhC'), bot = avg('pog');
  if (top != null && bot != null) ly = clamp(-.25 - (top - bot) / Math.max(1, top + bot) * 2, -.8, .2);
  m.light = [lx, ly, 1];
}
/**
 * Slide the dots of every edge contour (face edge, hair, neck…) along their normals onto the
 * nearest strong edge. A dot that disagrees with both neighbours takes their median instead.
 * The eye openings and the lips snap too, in a small radius and only onto an edge of the right
 * kind: the white of the eye is brighter than the lash line around it, lips darker than the skin.
 * Returns how many dots moved.
 */
function snapEdges() {
  const m = S.map, lum = photoLum(), sc = mapScale(), step = lum.step, moved = new Set();
  for (const c of m.contours) {
    if (!(c.snap || c.snapFine) || c.idx.some(i => !m.vis[i])) continue;
    const fine = !c.snap, R = (fine ? .045 : .15) * sc, e = (fine ? 1 : 1.5) * step;
    const sign = !fine ? 0 : c.id.startsWith('eye') ? 1 : -1;   // + inside brighter, − inside darker
    const st = fine ? Math.max(.5, Math.min(step, R / 8)) : step;
    // two passes, so a dot that starts a little far from the edge can walk onto it
    for (let pass = 0; pass < 2; pass++) {
      const N = contourNormals(c, m.p, fine);
      const offs = N.map(([nx, ny], k) => {
        const i = c.idx[k], px = m.p[2 * i], py = m.p[2 * i + 1];
        let best = 0, bestT = 0;
        for (let t = -R; t <= R; t += st) {
          const x = px + nx * t, y = py + ny * t, d = lum(x - nx * e, y - ny * e) - lum(x + nx * e, y + ny * e);
          const gd = sign ? Math.max(0, sign * d) : Math.abs(d);
          const score = gd * (1 - .4 * (t / R) * (t / R));   // prefer edges close to where the dot is
          if (score > best) { best = score; bestT = t; }
        }
        return best > (fine ? 7 : 10) ? bestT : 0;
      });
      // an offset far from both neighbours' is probably a wrong catch (a shadow, a strand): use the median
      const n = offs.length, tol = (fine ? .03 : .12) * sc;
      const fixed = offs.map((v, k) => {
        const a = offs[c.closed ? (k + n - 1) % n : Math.max(0, k - 1)], b = offs[c.closed ? (k + 1) % n : Math.min(n - 1, k + 1)];
        return Math.abs(v - a) > tol && Math.abs(v - b) > tol ? [a, v, b].sort((x, y) => x - y)[1] : v;
      });
      N.forEach(([nx, ny], k) => {
        const i = c.idx[k], t = fixed[k];
        if (Math.abs(t) < .5) return;
        m.p[2 * i] += nx * t; m.p[2 * i + 1] += ny * t;
        moved.add(i);
      });
    }
  }
  if (moved.size) { mapTouched(true); buildMask(); }
  return moved.size;
}
const mapPt = i => ({ x: S.map.p[2 * i], y: S.map.p[2 * i + 1] });
/** Photo → screen (while mapping the photo is shown unchanged) and back. */
const mapToScreen = x => toS(uToV(pToU(sToP(x))));
const screenToMap = (sx, sy) => pToS(vToP(toI(sx, sy)));
const mapPending = () => !anatSame(S.anat, S.anatBase) || (S.tone.field || null) !== (S.tone.base || null);

/* ------------------------------------------------- dodge & burn (Morph) --
   How retouchers make a reshaped face believable: the shape is moved with a smooth warp, and the
   light is changed with soft, low-opacity dodge & burn — brightness only, so the skin texture
   stays. A projected cheekbone catches more light on top and throws a soft shadow below it; a
   recessed infraorbital rim or a set-back chin falls into shade.
   The tone layer is a coarse grid on the original photo (so it moves with the face): an automatic
   part worked out from how far each part of the face moved toward or away from the camera, plus
   whatever you paint with the Dodge / Burn brushes. */
const TONE_DIV = 240;
const MEMB_GROUPS = ['outline', 'skin', 'brows', 'nose', 'lips'];
/** Tone grid for this photo — fixed per photo, so painting survives re-aligning the scan. */
function toneGrid() {
  const cell = Math.max(S.iw, S.ih) / TONE_DIV;
  return { cell, gw: Math.ceil(S.iw / cell) + 1, gh: Math.ceil(S.ih / cell) + 1 };
}
/** Scalar thin-plate spline through (x, y) → value. */
function scalarFit(xs, ys, vs, s) {
  const c = [];
  for (let i = 0; i < xs.length; i++) c.push(xs[i], ys[i], xs[i] + vs[i], ys[i]);
  return FM.tpsFit(c, xs.length, s, 1e-4);
}
const scalarAt = (T, x, y) => FM.tpsEval(T, x, y)[0] - x;
/** Closed contours of the scan (eye openings, lips) filled onto the grid: 0…1 per node. */
function gridMask(ids, cell, gw, gh) {
  const m = S.map, c = document.createElement('canvas');
  c.width = gw; c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  for (const ct of m.contours) {
    if (!ids.includes(ct.id) || !ct.closed || ct.idx.some(i => !m.vis[i])) continue;
    const pts = FM.spline(ct.idx.map(i => ({ x: m.p[2 * i] / cell + .5, y: m.p[2 * i + 1] / cell + .5 })), true, 6);
    g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fill();
  }
  const d = g.getImageData(0, 0, gw, gh).data, out = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) out[i] = d[4 * i + 3] / 255;
  return out;
}
/** Box average of a grid over the nodes where act is set (or all nodes), radius r cells. */
function boxBlur(a, gw, gh, r, act) {
  const tmp = new Float32Array(gw * gh), out = new Float32Array(gw * gh);
  const ok = v => !act || act[v];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const ii = i + d, v = j * gw + ii; if (ii >= 0 && ii < gw && ok(v)) { s += a[v]; n++; } }
    tmp[j * gw + i] = n ? s / n : a[j * gw + i];
  }
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const jj = j + d, v = jj * gw + i; if (jj >= 0 && jj < gh && ok(v)) { s += tmp[v]; n++; } }
    out[j * gw + i] = n ? s / n : tmp[j * gw + i];
  }
  return out;
}
/**
 * Per alignment: the face nodes of the tone grid lifted onto the 3D template — each one's template
 * position (cm), depth toward the camera, soft-tissue depth and how much it belongs to each feature.
 */
function denseFace() {
  const m = S.map;
  if (m.dense && m.dense.pver === m.pver && m.dense.seq === S.imgSeq) return m.dense;
  const { cell, gw, gh } = toneGrid(), nv = gw * gh, f = mapFrame();
  const yaw = m.yaw * Math.PI / 180, ct = Math.cos(yaw), st = Math.sin(yaw);
  const act = new Uint8Array(nv);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (maskAt(i * cell, j * cell) > .02) act[j * gw + i] = 1;
  // splines from the photo onto the template (as seen from this view), its depth and the tissue depth
  const ctl = [], gx = [], gy = [], dD = [], dT = [];
  FM.POINTS.forEach((pt, i) => {
    if (!m.vis[i] || pt.field === 'back') return;
    const tp = FM.project(pt, m.yaw);
    ctl.push(m.p[2 * i], m.p[2 * i + 1], f.zr * tp.x - f.zi * tp.y + f.tx, f.zi * tp.x + f.zr * tp.y + f.ty);
    gx.push(m.p[2 * i]); gy.push(m.p[2 * i + 1]);
    dD.push(pt.x * st + pt.z * ct); dT.push(pt.t);
  });
  const s = Math.max(S.iw, S.ih);
  const toT = FM.tpsFit(ctl, gx.length, s), toD = scalarFit(gx, gy, dD, s), toTis = scalarFit(gx, gy, dT, s);
  const z2 = f.zr * f.zr + f.zi * f.zi;
  const actIdx = [];
  for (let v = 0; v < nv; v++) if (act[v]) actIdx.push(v);
  const d0 = new Float32Array(nv), pts = new Array(actIdx.length);
  actIdx.forEach((v, k) => {
    const sx = (v % gw) * cell, sy = ((v / gw) | 0) * cell;
    const [ax, ay] = FM.tpsEval(toT, sx, sy), ux = ax - f.tx, uy = ay - f.ty;
    const X = (ux * f.zr + uy * f.zi) / z2, Y = (uy * f.zr - ux * f.zi) / z2, Dp = scalarAt(toD, sx, sy);
    d0[v] = Dp;
    pts[k] = { x: X * ct + Dp * st, y: Y, z: -X * st + Dp * ct, t: Math.max(0, scalarAt(toTis, sx, sy)), n: null, m: null };
  });
  // the template surface's normals (cm per cm), for the operations that push along the skin
  const cm = cell / f.scale, kOf = new Int32Array(nv).fill(-1);
  actIdx.forEach((v, k) => { kOf[v] = k; });
  const nb = (i, j, v) => (i >= 0 && j >= 0 && i < gw && j < gh && act[j * gw + i]) ? j * gw + i : v;
  const grad = (a, v) => {
    const i = v % gw, j = (v / gw) | 0, l = nb(i - 1, j, v), r = nb(i + 1, j, v), u = nb(i, j - 1, v), b = nb(i, j + 1, v);
    return [(a[r] - a[l]) / (cm * Math.max(1, (r - l))), (a[b] - a[u]) / (cm * Math.max(1, (b - u) / gw))];
  };
  actIdx.forEach((v, k) => {
    const [gX, gY] = grad(d0, v), L = Math.hypot(gX, gY, 1), nx = -gX / L, ny = -gY / L, nd = 1 / L;
    pts[k].n = [nx * ct + nd * st, ny, -nx * st + nd * ct];
  });
  // how much each node belongs to each feature: a soft blend of the nearby scan dots, with the
  // eye openings and the lips taken from their filled contours
  const eyes = gridMask(isProfile(m) ? ['eye'] : ['eyeL', 'eyeR'], cell, gw, gh);
  const lips = gridMask(['lips'], cell, gw, gh);
  const sig = .45 * f.scale, inv = 1 / (2 * sig * sig), reach = 9 * sig * sig, feat = [];
  FM.POINTS.forEach((pt, i) => { if (m.vis[i] && MEMB_GROUPS.includes(pt.group)) feat.push([m.p[2 * i], m.p[2 * i + 1], pt.group]); });
  actIdx.forEach((v, k) => {
    const sx = (v % gw) * cell, sy = ((v / gw) | 0) * cell;
    const w = { outline: 0, skin: .05, brows: 0, nose: 0, lips: 0 };
    for (const [px, py, g] of feat) { const d2 = (px - sx) ** 2 + (py - sy) ** 2; if (d2 < reach) w[g] += Math.exp(-d2 * inv); }
    w.lips = Math.max(w.lips, lips[v] * 4);
    let tot = 0;
    for (const g in w) tot += w[g];
    const e = eyes[v], o = { eyes: e };
    for (const g in w) o[g] = w[g] / tot * (1 - e);
    pts[k].m = o;
  });
  // how much light and shade the photo already shows on the face: flat light → gentler changes
  const lum = photoLum();
  let s1 = 0, s2 = 0;
  actIdx.forEach(v => { const L = lum((v % gw) * cell, ((v / gw) | 0) * cell); s1 += L; s2 += L * L; });
  const n = Math.max(1, actIdx.length), mean = s1 / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  const contrast = clamp(sd / Math.max(20, mean) / .16, .55, 1.35);
  // a feathered face mask, so the tone fades out at the face edge
  const feather = boxBlur(Float32Array.from(act), gw, gh, Math.max(1, Math.round(.35 * f.scale / cell)));
  m.dense = { pver: m.pver, seq: S.imgSeq, cell, gw, gh, nv, act, actIdx: Int32Array.from(actIdx), kOf, pts, d0, cm, grad, contrast, feather, eyes, auto: null };
  return m.dense;
}
/**
 * The automatic tone (log brightness per node) for the current anatomy, or null.
 * The face's depth before (template) and after (template + anatomy change) is lit by the photo's
 * light; the ratio, plus a little ambient occlusion where a spot moved back relative to its
 * surroundings, is softened, faded at the face edge and capped — like a retoucher's dodge & burn.
 */
function autoTone() {
  const m = S.map;
  if (!m || !anatOn() || cfg.mShade <= 0) return null;
  const M = denseFace(), key = `${m.ver}|${cfg.mShade}`;
  if (M.auto && M.auto.key === key) return M.auto.data;
  const f = mapFrame(), yaw = m.yaw * Math.PI / 180, ct = Math.cos(yaw), st = Math.sin(yaw);
  const { gw, gh, nv, actIdx, act, d0, cell } = M;
  const D = FM.anatomyAt(S.anat, M.pts), dz = new Float32Array(nv), d1 = new Float32Array(nv);
  actIdx.forEach((v, k) => { dz[v] = D[3 * k] * st + D[3 * k + 2] * ct; });
  // The eye openings don't move with the skin, but for light and shade they belong to the lids
  // around them (a lowered brow shades the eye too) — so fill them in from their surroundings.
  const eyes = M.eyes, skin = act.map((a, v) => a && eyes[v] < .5 ? 1 : 0);
  const fill = boxBlur(dz, gw, gh, Math.max(2, Math.round(.8 * f.scale / cell)), skin);
  actIdx.forEach(v => { dz[v] += (fill[v] - dz[v]) * eyes[v]; d1[v] = d0[v] + dz[v]; });
  const lt = m.light || [0, -.35, 1], lL = Math.hypot(...lt), L = lt.map(x => x / lL);
  const lit = (g) => {
    const gX = clamp(g[0], -2.5, 2.5), gY = clamp(g[1], -2.5, 2.5);
    return Math.max(0, (-gX * L[0] - gY * L[1] + L[2]) / Math.hypot(gX, gY, 1)) + .45;   // + ambient / skin scatter
  };
  const r = Math.max(2, Math.round(1.1 * f.scale / cell));
  const blur1 = boxBlur(dz, gw, gh, r, act);
  const raw = new Float32Array(nv);
  actIdx.forEach(v => {
    const k = Math.log(lit(M.grad(d1, v)) / lit(M.grad(d0, v)));
    const ao = .22 * (dz[v] - blur1[v]);   // cm in front of (+) or behind (−) the surroundings
    raw[v] = k + ao;
  });
  const sm = boxBlur(raw, gw, gh, Math.max(1, Math.round(.3 * f.scale / cell)), act);
  const out = new Float32Array(nv), g = cfg.mShade * M.contrast;
  for (let v = 0; v < nv; v++) {
    if (!act[v]) continue;
    const t = clamp(sm[v] * g, -.22, .16) * M.feather[v];
    out[v] = t > 0 ? t * (1 - .75 * eyes[v]) : t;   // shade may fall on the eyes; light hardly brightens them
  }
  M.auto = { key, data: out };
  return out;
}
/** Upload the tone grid (auto + painted) when it changed. Returns whether to draw it. */
let glTone = { auto: null, field: null, rev: -1, seq: -1, on: false };
function syncTone() {
  if (!GLR || mapping()) return false;
  const auto = mapActive() ? autoTone() : null, field = S.tone.field;
  if (!auto && !field) return false;
  if (glTone.auto === auto && glTone.field === field && glTone.rev === S.toneRev && glTone.seq === S.imgSeq) return glTone.on;
  glTone = { auto, field, rev: S.toneRev, seq: S.imgSeq, on: true };
  const { cell, gw, gh } = toneGrid(), nv = gw * gh, data = new Float32Array(nv);
  for (let v = 0; v < nv; v++) data[v] = Math.exp(clamp((auto ? auto[v] : 0) + (field ? field[v] : 0), -.7, .5));
  GLR.setTone(data, gw, gh, cell);
  return true;
}

const fwdMap = v => isIdentity() ? { x: v.x, y: v.y } : mapSrc(pToS(vToP(v)));
const invMap = s => isIdentity() ? { x: s.x, y: s.y } : uToV(pToU(sToP(mapInv(s))));

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
  S.warp = { field: null, base: null, gw: Math.ceil(S.iw / cs) + 1, gh: Math.ceil(S.ih / cs) + 1, cs };
  S.scratch = null;
}
/** True when there are morph changes since the last Confirm. */
const morphPending = () => (S.warp.field || null) !== (S.warp.base || null) || mapPending();
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
  const mask = null;
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
    map: S.map ? { view: S.map.view, p: S.map.p.slice(), snapped: S.map.snapped, light: S.map.light } : null,
    anat: { ...S.anat }, anatBase: { ...S.anatBase },
    tone: S.tone,   // paint arrays are copy-on-write too
    list: [...S.meas.values()].map(m => ({ id: m.id, preset: m.preset, kind: m.kind, name: m.name, pts: m.pts.map(cp), src: m.src ? m.src.map(cp) : null })),
    refId: S.refId, calibId: S.calibId, calibMM: S.calibMM, seq: S.seq,
  };
}
function pushUndo(s = snapshot()) {
  S.undo.push(s);
  if (S.undo.length > 150) S.undo.shift();
  // morph fields are large — keep at most ~24 distinct ones in history
  const fields = () => new Set(S.undo.flatMap(u => [u.warp && u.warp.field, u.tone && u.tone.field]).filter(Boolean)).size;
  while (S.undo.length > 1 && fields() > 24) S.undo.shift();
  S.redo = [];
}
function restore(s) {
  const imgChanged = s.img !== S.imgRec;
  if (imgChanged) setImageState(s.img);
  if (s.adj) S.adj = { ...DEFAULT_ADJ(), ...s.adj, ell: s.adj.ell ? { ...s.adj.ell } : null };
  if (s.warp) { S.warp = s.warp; S.fieldDirty = true; }
  if ('map' in s) {
    const old = S.map, sm = s.map;
    const same = old && sm && old.view === sm.view && old.p.every((v, i) => v === sm.p[i]);
    if (same) {
      // only the anatomy changed — keep the scan (and its mask) as it is
      mapTouched(false);
    } else {
      S.map = sm ? makeMap(sm.view, sm.p.slice(), sm.snapped, sm.light) : null;
      if (S.map) {
        // keep version numbers rising so cached GPU grids are never mistaken for current
        if (old) { S.map.ver = old.ver + 1; S.map.pver = old.pver + 1; S.map.maskVer = old.maskVer; }
        buildMask();
      } else S.mapSel.clear();
    }
  }
  if (s.anat) { S.anat = { ...s.anat }; S.anatBase = { ...(s.anatBase || {}) }; if (S.map) mapTouched(false); }
  if (s.tone) { S.tone = s.tone; S.toneRev++; }
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
let glImgRec = null, glMaskVer = -1;
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
/** Upload whatever changed (photo, free-brush field, face mask) before the GPU draws. */
function syncGLData() {
  ensureGLImage();
  if (S.fieldDirty) { S.fieldDirty = false; GLR.setField(S.warp.field, S.warp.gw, S.warp.gh); S.glDirty = true; }
  if (S.map && S.map.mask && S.map.maskVer !== glMaskVer) { glMaskVer = S.map.maskVer; GLR.setMask(S.map.mask.canvas); S.glDirty = true; }
}
/** Map parameters for the GPU — the two face-map layers, plus the layer tint while mapping. */
function mapParams(forExport) {
  if (S.compare) return null;
  const tone = syncTone();
  const tint = !!S.map && !forExport && mapping() && cfg.mShowLayers && !S.qfit;
  if (!mapActive() && !tint) return tone ? { plain: true, tone } : null;
  const on = mapActive();
  if (on) syncMapGrid();
  return { moved: on, showLayers: tint, tone };
}
function glParams(view, d, cw, ch, alpha) {
  const a = S.adj, e = a.ell;
  return {
    cw, ch, view, dpr: d, size: [S.iw, S.ih],
    rot: a.rot / DEG, scale: scaleXY(a), trans: [a.tx, a.ty],
    ell: e ? [e.cx, e.cy, e.ax, e.ay] : null, lensD: lensD(), zref: ZREF,
    morph: !!S.warp.field && !S.compare, cell: S.warp.cs, alpha,
    map: mapParams(false),
  };
}
function drawImageLayer(dt) {
  if (S.img && S.imgA < 1) S.imgA = Math.min(1, S.imgA + dt * 2.4);
  const v = S.view;
  if (GLR) {
    try {
      if (!S.img) { if (imgKey !== 'none') { imgKey = 'none'; GLR.clear(); } return; }
      if (GLR.isLost()) { disableGL('broken'); return; }
      syncGLData();
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

const MAP_GROUPS = [
  ['outline', 'Face edge', '#7EA6FF'], ['skin', 'Cheeks & chin', '#6FC3E8'], ['brows', 'Brows', '#A8D88F'],
  ['eyes', 'Eyes', '#F0CD6E'], ['nose', 'Nose', '#F2A7C6'], ['lips', 'Lips', '#BCAEF7'],
  ['ears', 'Ears', '#F5B27A'], ['hair', 'Hair', '#6ED8CB'], ['neck', 'Neck', '#D9A6E8'],
];
const MAP_COLORS = Object.fromEntries(MAP_GROUPS.map(([g, , c]) => [g, c]));
const LEVEL_COLORS = { bone: '#EDE3CF', soft: '#F5A3A3', shape: '#7EA6FF' };
const QFIT = {
  front: [
    { id: 'puL', label: 'Click the pupil on the left' },
    { id: 'puR', label: 'Click the pupil on the right' },
    { id: 'sto', label: 'Click the middle of the mouth' },
    { id: 'me', label: 'Click the bottom of the chin' },
  ],
  profile: [
    { id: 'n', label: 'Click the nasion (the dip between forehead and nose)' },
    { id: 'prn', label: 'Click the tip of the nose' },
    { id: 'pog', label: 'Click the front of the chin' },
    { id: 'tra#', label: 'Click the ear opening (tragus)' },
  ],
};
const qfitSteps = () => QFIT[isProfile() ? 'profile' : 'front'];
const qfitId = st => st.id.replace('#', FM.nearSide(S.map ? S.map.yaw : 0));
/** Is this dot shown (and grabbable) in Map? */
const dotShown = i => S.map.vis[i] && !S.hideGroups.has(FM.POINTS[i].group);
/** Screen positions of every scan dot (on the photo as it was). */
const mapScreenPts = () => FM.POINTS.map((_, i) => mapToScreen(mapPt(i)));
function drawMap(ctx) {
  const P_ = mapScreenPts(), m = S.map, busy = !!S.mapDrag;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // contours
  for (const c of m.contours) {
    if (c.draw === false) continue;
    const g = FM.POINTS[c.idx[0]].group;
    if (S.hideGroups.has(c.boundary ? 'outline' : g) || c.idx.some(i => !m.vis[i])) continue;
    const pts = FM.spline(c.idx.map(i => P_[i]), c.closed, 8);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (c.closed) ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = rgba(MAP_COLORS[c.boundary ? 'outline' : g], busy ? .4 : .8); ctx.lineWidth = 1.2; ctx.stroke();
  }
  // dots
  FM.POINTS.forEach((pt, i) => {
    if (!dotShown(i)) return;
    const p = P_[i], sel = S.mapSel.has(i), hov = S.mapHover === i, col = MAP_COLORS[pt.group];
    // detail dots (between the named ones) are drawn smaller
    const r = sel || hov ? 4.6 : pt.detail ? 2.1 : 3.2;
    if (busy && !sel) ctx.globalAlpha = .55;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + (pt.detail ? 1.1 : 1.5), 0, TAU); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fillStyle = sel ? '#FFFFFF' : col; ctx.fill();
    if (sel) { ctx.beginPath(); ctx.arc(p.x, p.y, r - 1.6, 0, TAU); ctx.fillStyle = col; ctx.fill(); }
    if (pt.lm && !sel) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.1, 0, TAU); ctx.fillStyle = '#0B0E14'; ctx.fill(); }
    ctx.globalAlpha = 1;
  });
  if (S.mapBox && S.mapBox.moved) {
    const b = S.mapBox, x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
    ctx.strokeStyle = rgba(MAP_COLORS.outline, .8); ctx.fillStyle = rgba(MAP_COLORS.outline, .08);
    ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    ctx.strokeRect(x + .5, y + .5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
  }
  ctx.restore();
  if (S.mapHover != null && !busy) {
    const pt = FM.POINTS[S.mapHover], p = P_[S.mapHover];
    tag(ctx, pt.t ? `${pt.name} · tissue ${pt.t} mm` : pt.name, p.x, p.y);
  }
}
/** While a Structure slider is hovered or dragged: where it acts, and how strongly (its "level"). */
function drawAnatomyFocus(ctx) {
  const key = S.anatHover, op = FM.OP_INDEX[key];
  if (!op || !S.map) return;
  const m = S.map;
  if (!m.focus || m.focus.key !== key) m.focus = { key, W: FM.anatomy({}, key).W };
  const W = m.focus.W, q = mapActive() ? mapShape().q : m.p, col = LEVEL_COLORS[op.level];
  ctx.save();
  FM.POINTS.forEach((pt, i) => {
    const w = W[i];
    if (!m.vis[i] || w < .04) return;
    const p = mapToScreen({ x: q[2 * i], y: q[2 * i + 1] }), r = 2 + 7 * Math.min(1, w);
    ctx.globalAlpha = .25 + .55 * Math.min(1, w);
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.2, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fillStyle = col; ctx.fill();
  });
  ctx.restore();
}

function drawBrush(ctx, c) {
  const r = brushV() * S.view.k, hard = clamp(cfg.mHard, 0, 1) * .85;
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU);
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 3; ctx.stroke();
  // dodge / burn brushes wear their own colour
  ctx.strokeStyle = isTone() ? rgba(TONE_COLORS[cfg.mMode], .95) : 'rgba(255,255,255,.85)';
  ctx.lineWidth = 1.2; ctx.stroke();
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
// In Morph the frame follows the photo content (source space); in Adjust it lives in lens space.
const frameToScreen = p => S.tool === 'morph' ? toS(invMap(p)) : pToScreen(p);
const viewToFrame = v => S.tool === 'morph' ? fwdMap(v) : uToP(vToU(v));
/** Screen positions of the face-frame handles (centre, cheekbone side, chin). */
function ellHandles() {
  const e = S.adj.ell;
  if (!e) return [];
  return [
    { id: 'c', p: frameToScreen({ x: e.cx, y: e.cy }) },
    { id: 'x', p: frameToScreen({ x: e.cx + e.ax, y: e.cy }) },
    { id: 'y', p: frameToScreen({ x: e.cx, y: e.cy + e.ay }) },
  ];
}
/** Face outline, modelled head outline and the three handles. */
function drawFaceFrame(ctx) {
  const e = S.adj.ell;
  if (!e) return;
  const blue = getComputedStyle(root).getPropertyValue('--blue').trim() || '#7EA6FF';
  const fr = (X, Y) => frameToScreen({ x: e.cx + X * e.ax, y: e.cy + Y * e.ay });
  ctx.save();
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
  ctx.restore();
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
  if (S.adj.ell && S.adj.lens > 0) drawFaceFrame(ctx);

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
  if (S.tool === 'morph' && S.map && !S.compare) { if (mapping()) drawMap(ctx); else drawAnatomyFocus(ctx); }
  const brushOn = S.tool === 'morph' && cfg.mSub === 'morph' && !S.anatHover;
  if (brushOn && !S.qfit && S.cursorIn && S.cursor && !S.pan && !(S.rpress && S.rpress.moved)) drawBrush(ctx, S.cursor);
  if (S.qfit && S.cursorIn && S.cursor) tag(ctx, qfitSteps()[S.qfit.step].label + `  ${S.qfit.step + 1}/4`, S.cursor.x, S.cursor.y);

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
  else if (S.drag || S.pan || S.hdrag || (S.mapDrag && S.mapDrag.moved) || (S.press && S.press.moved) || (S.mdrag && S.mdrag.moved) || (S.rpress && S.rpress.moved)) c = 'grabbing';
  else if (S.box || S.mapBox || S.qfit) c = 'crosshair';
  else if (S.space) c = 'grab';
  else if (S.tool === 'morph') c = S.mapHover != null ? 'grab' : (mapping() ? 'crosshair' : 'none');
  else if (S.tool === 'adjust') c = S.hoverHandle ? 'grab' : 'default';
  else if (S.hover && S.hover.node >= 0) c = 'grab';
  else if (S.hover && selectMode()) c = 'move';
  else if (canPlace()) c = 'crosshair';
  else c = 'default';
  if (ov._c !== c) { ov._c = c; ov.style.cursor = c; }
}
function handleAt(sx, sy) {
  if (!(S.tool === 'adjust' && S.adj.lens > 0)) return null;
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
  const mh = S.tool === 'morph' && !S.mapDrag && !S.mapBox ? mapHitAt(sx, sy) : null;
  if (mh !== S.mapHover && !S.mapDrag) { S.mapHover = mh; wake(); }
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
    if (S.tstroke) endTone();
    if (S.mapDrag || S.mapBox) morphUp(e);
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
  if (S.tool === 'morph') { morphDown(sx, sy, e); return; }
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
  if (S.mapDrag || S.mapBox) { morphMove(sx, sy, e); return; }
  if (S.tstroke) { S.tstroke.sx = sx; S.tstroke.sy = sy; return; }
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

/* ---- face scan interaction (Morph → Map) ---- */
function mapHitAt(sx, sy) {
  if (!S.map || !mapping() || S.qfit) return null;
  const P_ = mapScreenPts();
  let best = null, bd = 9;
  P_.forEach((p, i) => { if (!dotShown(i)) return; const d = Math.hypot(p.x - sx, p.y - sy); if (d < bd) { bd = d; best = i; } });
  return best;
}
/** A new scan changes nothing on the photo, so it isn't an undo step. */
function ensureMap(quiet) {
  if (S.map || !FM || !S.img) return;
  const n = fitMap();
  syncPts();
  if (!quiet) toast(n ? `Face scan placed from ${n} of your landmarks — check it in Map` : 'Face scan placed on a guess — use Map to fit it', 5000);
}
function setMorphSub(v) {
  if (v === cfg.mSub) return;
  cfg.mSub = v; saveCfg();
  S.qfit = null; S.anatHover = null;
  if (v === 'map') ensureMap(true); else S.mapSel.clear();
  syncPts();               // the anatomy is hidden while mapping, so points move
  toolOptsFor = null; renderToolOpts();
  renderHint(); refreshCursor();
}
/** Switch the scan to another view (front or a profile): re-placed from scratch for that view. */
function setMapView(view) {
  if (S.map && S.map.view === view) return;
  pushUndo();
  fitMap(view);
  S.mapSel.clear();
  syncPts(); syncUI();
  toast(view === 'front' ? 'Front scan — use Quick fit to place it' : 'Profile scan — use Quick fit to place it', 4000);
}
/** Half the cheekbone width of the scanned face in photo px (the scan's unit of size). */
const mapScale = () => mapFrame().scale * 6.75;
function moveMapPoints(dx, dy) {
  // aligning: each dot marks a new spot on the original photo
  const m = S.map, bound = new Set(mapBoundary().idx);
  let edge = false;
  S.mapSel.forEach(i => { m.p[2 * i] += dx; m.p[2 * i + 1] += dy; if (bound.has(i)) edge = true; });
  mapTouched(true);
  if (edge) {
    m.maskDirty = true;
    if (now() - (m.maskT || 0) > 120) { buildMask(); m.maskT = now(); m.maskDirty = false; }
  }
  wake();
}
function morphDown(sx, sy, e) {
  if (S.qfit) { quickFitClick(sx, sy); return; }
  if (cfg.mSub !== 'map') { startStroke(sx, sy); return; }
  ensureMap();
  const hit = mapHitAt(sx, sy), x = screenToMap(sx, sy);
  if (hit != null) {
    if (e.shiftKey) { if (S.mapSel.has(hit)) S.mapSel.delete(hit); else S.mapSel.add(hit); }
    else if (!S.mapSel.has(hit)) S.mapSel = new Set([hit]);
    S.mapDrag = { last: x, sx, sy, snap: snapshot(), moved: false };
    S.glDirty = true; wake(); refreshCursor();
    return;
  }
  S.mapBox = { x0: sx, y0: sy, x1: sx, y1: sy, moved: false, base: new Set(e.shiftKey ? S.mapSel : []) };
}
function morphMove(sx, sy, e) {
  const x = screenToMap(sx, sy);
  if (S.mapDrag) {
    const d = S.mapDrag;
    if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 2) return;
    d.moved = true;
    const fine = e.altKey ? .25 : 1;
    moveMapPoints((x.x - d.last.x) * fine, (x.y - d.last.y) * fine);
    d.last = x;
  } else if (S.mapBox) {
    const b = S.mapBox;
    b.x1 = sx; b.y1 = sy;
    if (!b.moved && Math.hypot(sx - b.x0, sy - b.y0) > 4) b.moved = true;
    if (b.moved) {
      const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
      S.mapSel = new Set(b.base);
      mapScreenPts().forEach((p, i) => { if (dotShown(i) && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) S.mapSel.add(i); });
    }
  }
  wake();
}
function morphUp(e) {
  if (S.mapDrag) {
    const d = S.mapDrag;
    S.mapDrag = null;
    if (d.moved) { buildMask(); S.map.maskDirty = false; pushUndo(d.snap); }
  } else if (S.mapBox) {
    const b = S.mapBox;
    S.mapBox = null;
    if (!b.moved && !e.shiftKey) S.mapSel.clear();
  }
  S.glDirty = true;
  syncUI();
}
/* quick fit: four clicks place the whole scan */
function startQuickFit() {
  if (cfg.mSub !== 'map') setMorphSub('map');
  ensureMap(true);
  S.qfit = { step: 0, clicks: [] };
  S.mapSel.clear();
  renderHint(); refreshCursor(); syncToolOpts(); wake();
}
function quickFitClick(sx, sy) {
  const q = S.qfit, steps = qfitSteps();
  q.clicks.push(fwdMap(toI(sx, sy)));   // position on the original photo
  q.step++;
  if (q.step < steps.length) { renderHint(); syncToolOpts(); wake(); return; }
  const snap = snapshot();
  S.qfit = null;
  fitMap(S.map.view, steps.map((st, k) => ({ i: FM.INDEX[qfitId(st)], b: q.clicks[k] })));
  pushUndo(snap);
  // then pull the edge contours onto the photo's edges (its own undo step)
  const snap2 = snapshot();
  if (snapEdges()) { pushUndo(snap2); estimateLight(); }
  syncPts(); syncUI();
  toast('Scanned and snapped to the edges — check the face edge, hairline and ears', 5000);
}

/* ---- Dodge & burn brushes (Morph → Light) ----
   Hold to paint light (Dodge) or shade (Burn) onto the photo — brightness only, so the skin
   texture stays — or take it away (Erase). They build up slowly, like a retoucher's soft,
   low-opacity brush, and the paint sits on the original photo, so it moves with the face. */
const isTone = () => /^t[A-Z]/.test(cfg.mMode);
const TONE_COLORS = { tDodge: '#F5E6A8', tBurn: '#9A86E8', tErase: '#F2F2F3' };
/** Brush radius in source px at a screen point. */
function brushSrcR(sx, sy) {
  const v = toI(sx, sy), a = fwdMap(v), b = fwdMap({ x: v.x + brushV(), y: v.y });
  return Math.max(2, dist(a, b));
}
function startTone(sx, sy) {
  const snap = snapshot(), { gw, gh } = toneGrid();
  // copy-on-write, so undo snapshots keep the old paint
  S.tone = { ...S.tone, field: S.tone.field ? S.tone.field.slice() : new Float32Array(gw * gh) };
  S.tstroke = { sx, sy, snap, changed: false };
  toneDab(1 / 60);
  S.glDirty = true; wake();
}
/** One dab where the brush is now; dt = seconds held. */
function toneDab(dt) {
  const st0 = S.tstroke, c = fwdMap(toI(st0.sx, st0.sy)), R = brushSrcR(st0.sx, st0.sy);
  const { cell, gw, gh } = toneGrid(), f = S.tone.field, hard = clamp(cfg.mHard, 0, 1) * .85, mode = cfg.mMode;
  const i0 = Math.max(0, Math.floor((c.x - R) / cell)), i1 = Math.min(gw - 1, Math.ceil((c.x + R) / cell));
  const j0 = Math.max(0, Math.floor((c.y - R) / cell)), j1 = Math.min(gh - 1, Math.ceil((c.y + R) / cell));
  let any = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i * cell - c.x, j * cell - c.y);
    if (d > R) continue;
    const w = (1 - smooth01(hard, 1, d / R)) * cfg.mStrength, v = j * gw + i;
    if (w < 1e-4) continue;
    if (mode === 'tErase') f[v] *= 1 - Math.min(1, w * dt * 4);
    else f[v] = clamp(f[v] + (mode === 'tDodge' ? 1 : -1) * w * dt * .3, -.6, .45);   // ≈ 30% per second at full strength
    any = true;
  }
  if (any) { st0.changed = true; S.toneRev++; S.glDirty = true; wake(); }
}
function endTone() {
  const s = S.tstroke;
  S.tstroke = null;
  if (!s) return;
  if (s.changed) {
    if (S.tone.field && !S.tone.field.some(v => Math.abs(v) > 1e-4)) S.tone = { ...S.tone, field: null };
    pushUndo(s.snap);
  } else S.tone = s.snap.tone;
  S.toneRev++; S.glDirty = true;
  syncUI();
}

/* ---- Looks: one-click starting points for what people most often want to see ----
   Each sets a few structure sliders (moderate amounts, so the result stays believable);
   fine-tune them afterwards. */
const LOOKS = [
  { id: 'hunter', label: 'Hunter eyes', tip: 'Lower, more projected brow ridge and a hooded upper lid — less visible lid, deeper-set look, slight positive tilt',
    v: { browRidge: .4, browDrop: .55, hooding: .5, tilt: .3, infraorbital: .2 } },
  { id: 'jaw', label: 'Defined jaw', tip: 'Wider, sharper jaw angle, a little more masseter, less fat along the jaw and under the chin',
    v: { jawWidth: .3, jawAngle: .4, masseter: .2, fat: -.35, submental: -.5 } },
  { id: 'cheek', label: 'Model cheekbones', tip: 'Wider, more projected cheekbones with hollower lower cheeks',
    v: { malarProj: .45, zygWidth: .25, buccal: .45, fat: -.15 } },
  { id: 'forward', label: 'Forward growth', tip: 'More projected midface and infraorbital rims, a slightly stronger jaw and chin',
    v: { midfaceProj: .45, infraorbital: .4, jawProj: .2, chinProj: .25, underEye: -.2 } },
  { id: 'chin', label: 'Strong chin', tip: 'More chin projection, a little taller and wider',
    v: { chinProj: .55, chinHeight: .2, chinWidth: .2 } },
  { id: 'lean', label: 'Leaner face', tip: 'Less facial fat and under-chin fullness, slightly hollower cheeks',
    v: { fat: -.5, submental: -.4, buccal: .2 } },
  { id: 'recessed', label: 'Recessed', tip: 'The opposite: flatter midface, set-back chin and rims — to see what recession looks like',
    v: { midfaceProj: -.4, infraorbital: -.45, chinProj: -.45, mandible: .35 } },
];
function applyLook(id) {
  const L = LOOKS.find(l => l.id === id);
  if (!L || !S.map) return;
  pushUndo();
  for (const [k, v] of Object.entries(L.v)) if (FM.OP_INDEX[k]) S.anat[k] = v;
  mapTouched(false);
  syncPts(); syncUI();
  toast(`${L.label} applied — fine-tune it with the sliders`, 3500);
}

/* morph strokes */
function startStroke(sx, sy) {
  if (isTone()) { startTone(sx, sy); return; }
  const snap = snapshot();
  beginStroke();
  const v = toI(sx, sy);
  S.stroke = { last: v, snap, changed: false };
  if (cfg.mMode !== 'push') dabHere(1 / 60);
  S.glDirty = true;
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
  S.glDirty = true;
  syncUI();
}
/* face-outline handles (Adjust → lens) */
function moveHandle(v) {
  const e = S.adj.ell;
  if (!e) return;
  const p = viewToFrame(v);
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
  if (S.mapDrag || S.mapBox) morphUp(e);
  else if (S.tstroke) endTone();
  else if (S.stroke) endStroke();
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
  if (mod && k === 'c' && !e.shiftKey && S.img && !String(getSelection())) { e.preventDefault(); copyExport(); return; }
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
  if (mapping() && S.map && S.mapSel.size && e.key.startsWith('Arrow')) {
    // nudge the selected scan dots (1 px on screen, Shift = 10)
    e.preventDefault();
    const st = (e.shiftKey ? 10 : 1) / S.view.k, dx = { ArrowLeft: -st, ArrowRight: st }[e.key] || 0, dy = { ArrowUp: -st, ArrowDown: st }[e.key] || 0;
    if (!S.nudge || now() - S.nudge.t > 900) { pushUndo(); S.nudge = {}; }
    S.nudge.t = now();
    moveMapPoints(dx, dy);
    buildMask(); S.map.maskDirty = false;
    syncUI();
    return;
  }
  switch (e.key) {
    case 'Escape':
      if (newPop.classList.contains('open')) closeNewPop();
      else if (exportPop.classList.contains('open')) closeExportPop();
      else if (calibCtx) closeCalib(false);
      else if (S.qfit) { S.qfit = null; renderHint(); refreshCursor(); syncToolOpts(); wake(); }
      else if (S.tool === 'morph' && S.mapSel.size) { S.mapSel.clear(); wake(); }
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
addEventListener('blur', () => { S.space = false; S.shift = false; setCompare(false); if (S.stroke) endStroke(); if (S.tstroke) endTone(); if (S.mapDrag || S.mapBox) morphUp({}); });
addEventListener('resize', () => { resize(); if (S.img) fitView(); });

/* --------------------------------------------------------- image input -- */

function loadFile(file) {
  if (!file || !/^image\//.test(file.type)) { toast('That doesn’t look like an image'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // Swapping images is undoable (the previous image and its measurements come back),
    // but the very first image is the starting point — Ctrl+Z never takes you back to the empty page.
    if (S.img) pushUndo();
    closeNewPop();
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
  Object.assign(S, { map: null, mapSel: new Set(), mapHover: null, mapDrag: null, mapBox: null, qfit: null, anat: {}, anatBase: {}, anatHover: null, lum: null, tone: { field: null, base: null }, tstroke: null });
  S.toneRev++;
  glMaskVer = -1; glMapKey = '';
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
  S.fieldDirty = true; S.glDirty = true;
  body.classList.add('has-img');
  fitView(true);
  if (S.tool === 'morph' && GLR) ensureMap(true);
  toolOptsFor = null;
  renderToolOpts();
}

$('#btnBrowse').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
$('#dropZone').addEventListener('click', () => fileInput.click());
$('#dropZone').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; });

/* "New" — a small panel with drop zone, browse and paste */
const newPop = $('#newPop');
function openNewPop() {
  const r = $('#btnNew').getBoundingClientRect();
  newPop.style.top = (r.bottom + 8) + 'px';
  newPop.style.left = clamp(r.right - 280, 8, W - 288) + 'px';
  newPop.classList.add('open');
}
function closeNewPop() { if (newPop) newPop.classList.remove('open'); }
$('#btnNew').addEventListener('click', e => { e.stopPropagation(); newPop.classList.contains('open') ? closeNewPop() : openNewPop(); });
document.addEventListener('pointerdown', e => { if (newPop.classList.contains('open') && !e.target.closest('#newPop, #btnNew')) closeNewPop(); });
$('#newDrop').addEventListener('click', () => fileInput.click());
$('#newDrop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
$('#newBrowse').addEventListener('click', () => fileInput.click());
$('#newPaste').addEventListener('click', pasteFromClipboard);
$('#btnPaste').addEventListener('click', e => { e.stopPropagation(); pasteFromClipboard(); });
/** Read an image straight from the clipboard (needs a click; the browser may ask for permission). */
async function pasteFromClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.read) { toast('Press Ctrl V to paste — this browser can’t read the clipboard from a button'); return; }
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(t => /^image\//.test(t));
      if (type) { const blob = await item.getType(type); loadFile(new File([blob], 'pasted', { type })); return; }
    }
    toast('No image on the clipboard — copy one first');
  } catch (err) {
    toast('Clipboard access was blocked — press Ctrl V instead');
  }
}

let dragDepth = 0;
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth++;
  body.classList.add('dragging');
  $('#newDrop').classList.toggle('over', !!(e.target.closest && e.target.closest('#newDrop')));
});
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

/** The edited photo at full resolution (scaled only if the GPU can't fit it). */
function drawEditedPhoto(ctx) {
  const iw = S.iw, ih = S.ih;
  if (GLR && !isIdentity()) {
    syncGLData();
    const sc = Math.min(1, GLR.maxView[0] / iw, GLR.maxView[1] / ih, 8192 / Math.max(iw, ih));
    const cw = Math.round(iw * sc), ch = Math.round(ih * sc);
    GLR.render({ ...glParams({ x: 0, y: 0, k: sc }, 1, cw, ch, 1), morph: !!S.warp.field, map: mapParams(true) });
    ctx.drawImage(glcv, 0, 0, cw, ch, 0, 0, iw, ih);
    imgKey = ''; S.glDirty = true;   // restore the on-screen render next frame
  } else ctx.drawImage(S.img, 0, 0);
}
/** The annotated export: the edited photo, every visible measurement and a legend → PNG blob. */
async function renderExport() {
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
  drawEditedPhoto(ctx);
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
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { blob, rows: rows.length };
}
const exportNote = n => n ? '' : ' — select layers or Show all to include measurements';
async function exportPNG() {
  if (!S.img) return;
  const { blob, rows } = await renderExport();
  if (!blob) { toast('Export failed — the image may be too large'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cranimeter-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Downloaded' + exportNote(rows));
}
function copyExport() {
  if (!S.img) return;
  if (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem) { toast('This browser can’t copy images — use Download instead'); return; }
  const job = renderExport();
  // Safari only allows the write if it starts during the click, so it gets a promise for the image
  navigator.clipboard.write([new ClipboardItem({ 'image/png': job.then(r => { if (!r.blob) throw new Error('no image'); return r.blob; }) })])
    .then(() => job.then(r => toast('Copied to the clipboard' + exportNote(r.rows))))
    .catch(() => toast('Copying was blocked — use Download instead'));
}
// Export menu (built here so an older index.html still gets it)
const exportPop = document.createElement('div');
exportPop.id = 'exportPop'; exportPop.className = 'popover newpop glass';
exportPop.setAttribute('role', 'dialog'); exportPop.setAttribute('aria-label', 'Export');
exportPop.innerHTML = `
  <div class="pop-title">Export</div>
  <p class="new-note" style="margin:0 0 10px">The photo as it is now, with every visible measurement and a legend.</p>
  <div class="pop-actions new-actions">
    <button type="button" class="btn ghost sm" id="expDownload">Download PNG</button>
    <button type="button" class="btn sm" id="expCopy">Copy to clipboard</button>
  </div>
  <p class="new-note"><kbd class="mod-key">${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}</kbd> <kbd>C</kbd> copies it too.</p>`;
document.body.appendChild(exportPop);
function openExportPop() {
  const r = $('#btnExport').getBoundingClientRect();
  exportPop.style.top = (r.bottom + 8) + 'px';
  exportPop.style.left = clamp(r.right - 280, 8, W - 288) + 'px';
  exportPop.classList.add('open');
}
const closeExportPop = () => exportPop.classList.remove('open');
$('#btnExport').addEventListener('click', e => { e.stopPropagation(); exportPop.classList.contains('open') ? closeExportPop() : openExportPop(); });
document.addEventListener('pointerdown', e => { if (exportPop.classList.contains('open') && !e.target.closest('#exportPop, #btnExport')) closeExportPop(); });
$('#expDownload').addEventListener('click', () => { closeExportPop(); exportPNG(); });
$('#expCopy').addEventListener('click', () => { closeExportPop(); copyExport(); });

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
  if (S.tstroke) endTone();
  if (S.mapDrag || S.mapBox) morphUp({});
  if (EDIT_TOOLS.has(t) && !GLR) toast(GL_MESSAGES[GL_REASON] || GL_MESSAGES.webgl, 7000);
  S.tool = t;
  S.qfit = null; S.mapHover = null; S.anatHover = null;
  if (t !== 'morph') S.mapSel.clear();
  if (t === 'morph' && GLR) ensureMap(true);
  if (t !== 'move' && !EDIT_TOOLS.has(t) && S.sel.length) { S.sel = []; S.active = null; }
  if (EDIT_TOOLS.has(t)) S.picked.clear();
  syncPts();               // the anatomy is hidden while mapping
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
    const sub = cfg.mSub;
    const levels = [
      ['bone', 'Bone', 'skeleton — shows through the soft tissue above it'],
      ['soft', 'Soft tissue', 'fat and muscle — scales with tissue depth'],
      ['shape', 'Proportions', 'lengths and positions'],
    ];
    const opRow = o => `<label class="srow arow" data-op="${o.key}"${o.help ? ` title="${esc(o.help)}"` : ''}><span><i class="lv" style="--c:${LEVEL_COLORS[o.level]}"></i>${esc(o.label)}</span><input class="rng bi" type="range" id="op_${o.key}" min="-100" max="100" step="1" style="--c:${LEVEL_COLORS[o.level]}"><b id="op_${o.key}V"></b></label>`;
    const mapPane = `
      <div class="seg full mview" id="mView">
        <button type="button" data-v="front">Front</button><button type="button" data-v="left" title="Face looking to the left">◀ Profile</button><button type="button" data-v="right" title="Face looking to the right">Profile ▶</button>
      </div>
      <p class="to-note" id="mMapStatus"></p>
      <div class="to-actions" style="margin:2px 0 10px">
        <button type="button" class="btn sm" id="mQuick">Quick fit · 4 clicks</button>
        <button type="button" class="btn ghost sm" id="mSnap" title="Pull the edge dots (face edge, hairline, hair, neck) onto the nearest edges in the photo">Snap to edges</button>
        <button type="button" class="btn ghost sm" id="mAuto" title="Re-place the scan from your measured landmarks">Fit to landmarks</button>
      </div>
      <div class="to-label">Dots <small>click to hide a group</small></div>
      <div class="chips" id="mGroups">${MAP_GROUPS.map(([g, label, c]) => `<button type="button" class="chip-dot" data-g="${g}" style="--c:${c}"><i></i>${label}</button>`).join('')}</div>
      <p class="to-note">Drag dots onto the face — the photo is shown unchanged here. Box-select or <kbd>Shift</kbd>-click to move several, arrow keys nudge. Hover a dot to see its tissue depth.</p>
      <label class="tg sm"><span>Show layers<small>Teal = the face layer (forehead and hairline included), blue = hair, ears, neck and background behind it</small></span><input type="checkbox" class="sw-toggle" id="mShowLayers"></label>`;
    const morphPane = `
      <div class="to-sec"><span>Structure</span><span class="lv-key">hover a slider to see where it acts</span></div>
      <div id="mNoMap" class="to-callout">
        <p class="to-note">The structure controls work on the face scan. Map the face first — four clicks.</p>
        <button type="button" class="btn sm" id="mGoMap">Map the face</button>
      </div>
      <div class="anat" id="mAnat">
        <div class="to-label">Looks <small>a starting point — then fine-tune below</small></div>
        <div class="chips looks" id="mLooks">${LOOKS.map(l => `<button type="button" class="chip-dot look" data-look="${l.id}" title="${esc(l.tip)}">${esc(l.label)}</button>`).join('')}</div>
        ${levels.map(([l, n, d]) => `
        <div class="anat-group" data-level="${l}">
          <button type="button" class="anat-head" data-open="${l}"><i class="lv" style="--c:${LEVEL_COLORS[l]}"></i><span>${n}<small>${d}</small></span><b class="anat-cnt" id="anatCnt_${l}"></b><svg class="ic chev" viewBox="0 0 20 20"><path d="m5.5 8 4.5 4.5L14.5 8"/></svg></button>
          <div class="anat-body">${FM.OPS.filter(o => o.level === l).map(opRow).join('')}</div>
        </div>`).join('')}
        ${sliderRow('mShade', 'Auto shading', 0, 100, 1, 'Soft dodge & burn that follows the structure: a projected cheekbone or brow catches light, a recessed rim or chin falls into shade')}
        <div class="to-actions" style="margin-top:4px"><button type="button" class="btn ghost sm" id="anatReset">Reset structure</button></div>
      </div>
      <div class="to-sec"><span>Brushes</span><span class="lv-key">paint on the photo</span></div>
      <div class="to-label">Liquify <small>moves the face</small></div>
      <div class="seg full mmode" id="mMode">
        <button type="button" data-v="push">Push</button><button type="button" data-v="bloat">Bloat</button>
        <button type="button" data-v="pinch">Pinch</button><button type="button" data-v="restore">Restore</button>
      </div>
      <div class="to-label">Light <small>dodge &amp; burn — changes depth without moving anything</small></div>
      <div class="seg full mmode" id="mTone">
        <button type="button" data-v="tDodge" title="Add light: makes a spot read as further forward (cheekbone top, brow ridge, chin, nose bridge)"><i class="lv" style="--c:${TONE_COLORS.tDodge}"></i>Dodge</button><button type="button" data-v="tBurn" title="Add shade: makes a spot read as set back (under the cheekbone, along the jaw, under the brow, eye sockets)"><i class="lv" style="--c:${TONE_COLORS.tBurn}"></i>Burn</button><button type="button" data-v="tErase" title="Take painted light and shade away">Erase</button>
      </div>
      ${sliderRow('mSize', 'Size', 1, 50, .1)}
      ${sliderRow('mStrength', 'Strength', 1, 100, 1)}
      ${sliderRow('mHard', 'Hardness', 0, 100, 1)}
      <label class="tg sm" id="mLimitRow"><span>Limit stretching<small>Liquify only: stops a push once any area would stretch or squash past ≈ 1.7×</small></span><input type="checkbox" class="sw-toggle" id="mLimit"></label>
      <p class="to-note">Tip: retouchers burn softly under the cheekbones and along the jaw, and dodge the cheekbone tops, nose bridge and chin. Keep strength low and build up.</p>
      <div class="to-actions" style="margin-top:4px"><button type="button" class="btn ghost sm" id="toneClear">Clear light &amp; shade</button></div>`;
    toolOptsBody.innerHTML = `
      <div class="to-head"><span class="to-title">Morph</span><span class="to-sub">landmarks follow the face</span></div>
      <div class="seg full msub" id="mSub">
        <button type="button" data-v="map" title="Fit the 3D face scan to the photo"><b>1</b>Map</button><button type="button" data-v="morph" title="Change the anatomy, or brush"><b>2</b>Morph</button>
      </div>
      ${sub === 'map' ? mapPane : morphPane}
      <div class="to-confirm" id="mPending">
        <span class="to-status" id="mStatus"></span>
        <div class="to-actions" style="margin-top:8px">
          <button type="button" class="btn sm" id="mConfirm">Confirm</button>
          <button type="button" class="btn ghost sm" id="mReset">Reset</button>
          <button type="button" class="btn ghost sm" id="mCompare">Hold to compare</button>
        </div>
      </div>
      <p class="to-note" style="margin-top:10px">${sub === 'map' ? 'Then switch to <b>Morph</b> to change the anatomy.' : '<kbd>[</kbd> <kbd>]</kbd> brush size · hold <kbd>B</kbd> to compare · double-click a slider name to reset it'}</p>`;
    $('#mSub').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setMorphSub(b.dataset.v); });
    if (sub === 'map') {
      $('#mView').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setMapView(b.dataset.v); });
      $('#mShowLayers').addEventListener('change', e => { cfg.mShowLayers = e.target.checked; saveCfg(); S.glDirty = true; wake(); });
      $('#mQuick').addEventListener('click', () => { if (S.qfit) { S.qfit = null; renderHint(); wake(); } else startQuickFit(); syncToolOpts(); });
      $('#mSnap').addEventListener('click', () => {
        if (!S.map) return;
        const snap = snapshot(), n = snapEdges();
        if (n) { pushUndo(snap); estimateLight(); syncPts(); syncUI(); }
        toast(n ? `Snapped ${n} edge dot${n === 1 ? '' : 's'} — check them` : 'No clear edges found near the dots — drag them instead', 4000);
      });
      $('#mAuto').addEventListener('click', () => {
        const snap = snapshot(), n = fitMap();
        pushUndo(snap); S.mapSel.clear(); syncPts(); syncUI();
        toast(n ? `Scan placed from ${n} of your landmarks` : 'No landmarks measured yet — use Quick fit instead', 4000);
      });
      $('#mGroups').addEventListener('click', e => {
        const b = e.target.closest('[data-g]');
        if (!b) return;
        const g = b.dataset.g;
        if (S.hideGroups.has(g)) S.hideGroups.delete(g); else S.hideGroups.add(g);
        S.mapSel = new Set([...S.mapSel].filter(i => !S.hideGroups.has(FM.POINTS[i].group)));
        syncToolOpts(); wake();
      });
    } else {
      $('#mGoMap').addEventListener('click', () => { setMorphSub('map'); startQuickFit(); });
      $('#mAnat').addEventListener('click', e => {
        const h = e.target.closest('[data-open]');
        if (!h) return;
        cfg.mOpen = cfg.mOpen === h.dataset.open ? '' : h.dataset.open; saveCfg(); syncToolOpts();
      });
      // one undo step per slider gesture
      const start = () => { if (!S.anatSnap) S.anatSnap = snapshot(); };
      const commit = () => { if (S.anatSnap) { pushUndo(S.anatSnap); S.anatSnap = null; syncUI(); } };
      const setOp = (key, v) => { S.anat[key] = v; if (S.map) mapTouched(false); syncPts(); syncToolOpts(); };
      for (const o of FM.OPS) {
        const el = $('#op_' + o.key), row = el.closest('.arow');
        el.addEventListener('pointerdown', start);
        el.addEventListener('keydown', start);
        el.addEventListener('input', () => { start(); setOp(o.key, +el.value / 100); });
        el.addEventListener('change', commit);
        row.querySelector('span').addEventListener('dblclick', () => { start(); setOp(o.key, 0); commit(); });
        row.addEventListener('pointerenter', () => { S.anatHover = o.key; wake(); });
        row.addEventListener('pointerleave', () => { if (S.anatHover === o.key) { S.anatHover = null; wake(); } });
      }
      $('#mShade').addEventListener('input', e => { cfg.mShade = +e.target.value / 100; saveCfg(); S.glDirty = true; syncToolOpts(); wake(); });
      $('#anatReset').addEventListener('click', () => {
        if (!anatOn()) return;
        pushUndo();
        S.anat = {}; if (S.map) mapTouched(false);
        syncPts(); syncUI();
      });
      const pickMode = e => { const b = e.target.closest('[data-v]'); if (b) { cfg.mMode = b.dataset.v; saveCfg(); syncToolOpts(); renderHint(); wake(); } };
      $('#mMode').addEventListener('click', pickMode);
      $('#mTone').addEventListener('click', pickMode);
      $('#mLooks').addEventListener('click', e => { const b = e.target.closest('[data-look]'); if (b) applyLook(b.dataset.look); });
      $('#mLimit').addEventListener('change', e => { cfg.mLimit = e.target.checked; saveCfg(); });
      $('#toneClear').addEventListener('click', () => {
        if (!toneOn()) return;
        pushUndo();
        S.tone = { ...S.tone, field: null }; S.toneRev++;
        S.glDirty = true; syncUI();
      });
      const bind = (id, key, f) => $('#' + id).addEventListener('input', e => { cfg[key] = f(+e.target.value); saveCfg(); syncToolOpts(); wake(); });
      bind('mSize', 'mSize', v => v / 100);
      bind('mStrength', 'mStrength', v => v / 100);
      bind('mHard', 'mHard', v => v / 100);
    }
    const cmp = $('#mCompare');
    cmp.addEventListener('pointerdown', () => setCompare(true));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => setCompare(false)));
    // Confirm bakes the current morph; Reset only discards changes made since the last confirm.
    $('#mConfirm').addEventListener('click', () => {
      if (!morphPending()) return;
      pushUndo();
      S.warp = { ...S.warp, base: S.warp.field };
      S.anatBase = { ...S.anat };
      S.tone = { ...S.tone, base: S.tone.field };
      syncUI();
      toast('Morph confirmed');
    });
    $('#mReset').addEventListener('click', () => {
      if (!morphPending()) return;
      pushUndo();
      S.warp = { ...S.warp, field: S.warp.base || null };
      S.fieldDirty = true;
      S.anat = { ...S.anatBase };
      S.tone = { ...S.tone, field: S.tone.base || null }; S.toneRev++;
      if (S.map) mapTouched(false);
      syncPts(); syncUI();
      toast('Unconfirmed changes discarded');
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
  if (el.classList.contains('bi')) {   // two-sided: the fill grows from the centre
    el.style.setProperty('--lo', Math.min(50, p).toFixed(1) + '%');
    el.style.setProperty('--hi', Math.max(50, p).toFixed(1) + '%');
  }
  setText($('#' + id + 'V'), text);
}
function syncToolOpts() {
  if (toolOptsFor === 'morph') {
    const pending = morphPending(), sub = cfg.mSub;
    $('#mConfirm').disabled = !pending;
    $('#mReset').disabled = !pending;
    $('#mPending').classList.toggle('pending', pending);
    setText($('#mStatus'), pending ? 'Unconfirmed changes' : (S.warp.field || anatOn() || toneOn()) ? 'All changes confirmed' : 'No morph yet');
    $$('#mSub [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === sub));
    if (sub === 'map') {
      $$('#mView [data-v]').forEach(b => b.classList.toggle('on', !!S.map && b.dataset.v === S.map.view));
      $('#mShowLayers').checked = !!cfg.mShowLayers;
      const qb = $('#mQuick');
      qb.textContent = S.qfit ? `Cancel quick fit (${S.qfit.step + 1}/4)` : 'Quick fit · 4 clicks';
      qb.classList.toggle('on', !!S.qfit);
      $('#mAuto').disabled = !S.map || !FM.POINTS.some(pt => { const l = lmLabel(pt, S.map.view); return l && landmarkS(l); });
      $('#mSnap').disabled = !S.map || !!S.qfit;
      $$('#mGroups [data-g]').forEach(b => b.classList.toggle('off', S.hideGroups.has(b.dataset.g)));
      const shown = S.map ? S.map.vis.reduce((a, v) => a + v, 0) : 0;
      setText($('#mMapStatus'), !S.map ? 'Not scanned yet.'
        : S.qfit ? qfitSteps()[S.qfit.step].label + '.'
        : S.map.snapped ? `Scanned — ${shown} dots in view, ${S.map.snapped} placed from your landmarks or clicks. Check the edges.`
        : `${shown} dots centred on a guess — use Quick fit, then drag the dots onto the face.`);
    } else {
      $('#mNoMap').hidden = !!S.map;
      $('#mAnat').classList.toggle('disabled', !S.map);
      for (const o of FM.OPS) {
        const v = Math.round((S.anat[o.key] || 0) * 100);
        setRange('op_' + o.key, v, v ? (v > 0 ? '+' : '') + v + '%' : '0');
        const el = $('#op_' + o.key);
        el.disabled = !S.map;
        el.closest('.arow').classList.toggle('set', !!v);
      }
      for (const g of $$('.anat-group')) {
        const l = g.dataset.level, n = FM.OPS.filter(o => o.level === l && Math.abs(S.anat[o.key] || 0) > 1e-3).length;
        g.classList.toggle('open', cfg.mOpen === l);
        setText($('#anatCnt_' + l), n ? String(n) : '');
      }
      setRange('mShade', Math.round(cfg.mShade * 100), Math.round(cfg.mShade * 100) + '%');
      $('#anatReset').disabled = !anatOn();
      $$('#mMode [data-v], #mTone [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === cfg.mMode));
      $$('#mLooks [data-look]').forEach(b => {
        const L = LOOKS.find(l => l.id === b.dataset.look);
        b.disabled = !S.map;
        b.classList.toggle('on', !!S.map && Object.entries(L.v).every(([k, v]) => Math.abs((S.anat[k] || 0) - v) < 1e-3));
      });
      $('#mLimitRow').classList.toggle('dim', isTone());
      $('#toneClear').disabled = !toneOn();
      setRange('mSize', +(cfg.mSize * 100).toFixed(1), Math.round(brushV()) + ' px');
      setRange('mStrength', Math.round(cfg.mStrength * 100), Math.round(cfg.mStrength * 100) + '%');
      setRange('mHard', Math.round(cfg.mHard * 100), Math.round(cfg.mHard * 100) + '%');
      $('#mLimit').checked = !!cfg.mLimit;
    }
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
    if (S.tool === 'morph' && S.qfit) {
      html = `<b>Quick fit · ${S.qfit.step + 1}/4</b><span class="h-desc">${qfitSteps()[S.qfit.step].label} · <kbd>Esc</kbd> cancels</span>`;
    } else if (S.tool === 'morph' && cfg.mSub === 'map') {
      html = `<b>Morph · Map</b><span class="h-desc">Drag the dots onto the face (shown unchanged) · box or <kbd>Shift</kbd> selects several · then <b>Morph</b></span>`;
    } else if (S.tool === 'morph') {
      const names = { push: 'push', bloat: 'bloat', pinch: 'pinch', restore: 'restore', tDodge: 'add light (dodge)', tBurn: 'add shade (burn)', tErase: 'erase light and shade' };
      const act = cfg.mMode === 'push' ? 'drag' : 'hold';
      html = `<b>Morph</b><span class="h-desc">Looks and sliders reshape the anatomy · ${act} on the photo to ${names[cfg.mMode] || 'brush'} · hold <kbd>B</kbd> to compare</span>`;
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
    if (S.tstroke) toneDab(dt);
    if (S.map && S.map.maskDirty && !S.mapDrag) { buildMask(); S.map.maskDirty = false; }
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
if (OLD_CODE.length) setTimeout(() => toast(GL_MESSAGES.stale, 9000), 600);

// tiny scripting hook (handy for debugging from the console)
window.cranimeter = { loadFile, state: S, build: BUILD, gpu: () => (GLR ? 'webgl2' : GL_REASON), mapSrc, mapInv, maskAt, fitMap, mapToScreen, screenToMap, syncPts, drawEditedPhoto };

})();
