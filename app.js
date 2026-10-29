/* ==========================================================================
   Cranimeter · app
   Plain JS, no build step. Everything runs locally in the browser.
   ========================================================================== */
(async () => {
'use strict';

/* ---------------------------------------------------------------- data -- */

const BUILD = '43';   // must match the build in presets.js, warp.js, facemap.js, surface.js and head.js
/*
 * Make sure the helper scripts belong to this release. Browsers and GitHub Pages cache files for
 * a while, so right after an upload a page can get the new app.js next to an old warp.js (or an
 * old index.html without the newer script tags). Anything missing or from another release is
 * fetched again, bypassing every cache — so stale files fix themselves instead of blocking the app.
 */
const MODULES = [['CRANI', 'presets.js'], ['CraniWarp', 'warp.js'], ['CraniMap', 'facemap.js'], ['CraniSurface', 'surface.js']];
const moduleOk = g => !!window[g] && window[g].build === BUILD;
const loadFresh = file => new Promise(res => {
  const s = document.createElement('script');
  s.src = `${file}?v=${BUILD}&fresh=${Date.now()}`;
  s.onload = s.onerror = () => res();
  document.head.appendChild(s);
});
for (const [g, file] of MODULES) if (!moduleOk(g)) await loadFresh(file);
// the measured head (head.js + ict-head.bin) is optional: without it the 3D falls back to the template
if (!moduleOk('CraniHead')) await loadFresh('head.js');
/** Files that are still missing or out of date on the server after a fresh fetch. */
const OLD_FILES = MODULES.filter(([g]) => !moduleOk(g)).map(([, f]) => f);
// The stylesheet heals the same way: style.css carries the build in --cm-build. If it's missing or
// old, fetch it again past every cache; if it still isn't right, say so plainly (a page without it is blank).
const cssOk = () => getComputedStyle(document.documentElement).getPropertyValue('--cm-build').trim() === BUILD;
if (!cssOk()) await new Promise(res => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `style.css?v=${BUILD}&fresh=${Date.now()}`; l.onload = l.onerror = () => res(); document.head.appendChild(l); });
if (!cssOk()) {
  const old = !!getComputedStyle(document.documentElement).getPropertyValue('--c1').trim();
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;z-index:99;left:12px;right:12px;bottom:16px;margin:0;padding:10px 14px;border-radius:10px;background:#2a1418;color:#f5c2c2;font:13px/1.45 system-ui,sans-serif;text-align:center">${old ? 'The site still has an older <b>style.css</b>' : '<b>style.css</b> didn’t load'} — upload the new style.css next to index.html, named exactly <b>style.css</b>.</p>`);
}if (!window.CRANI) { document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;inset:auto 0 24px;text-align:center;color:#f5a3a3;font:14px system-ui">presets.js didn’t load — upload it next to index.html.</p>'); return; }
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

const FONT = "Jost, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "Jost, ui-sans-serif, system-ui, sans-serif";
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
  mShowLayers: true, mShade: .6, mOpen: 'bone',
  surfView: 'contours', surfAlpha: .8, surfTrust: .5, surfBrush: '', surfSweep: .5, surfPca: 0, surfUse: true, surfV: 4, surfDetail: 0, surfMode: 'photo', lightView: 'shading',
  mapSoft: false, mapSoftR: .3, mapMirror: false, mapAutoDetail: true,
  motion: !matchMedia('(prefers-reduced-motion: reduce)').matches,
};
const SWATCHES = ['#7CCBF5', '#F2A7C6', '#F0CD6E', '#8FE0B4', '#BCAEF7', '#F5A3A3', '#6ED8CB', '#F2F2F3'];
const SKEY = 'cranimeter:settings';
let cfg = (() => {
  try {
    const st = JSON.parse(localStorage.getItem(SKEY) || '{}'), c = { ...DEFAULTS, ...st };
    for (const k of ['mSmooth', 'mLevels', 'mLevelStrict', 'mShowLevels', 'mProtect', 'mLevel', 'mSub']) delete c[k];
    if (/^s[A-Z]/.test(c.mMode)) c.mMode = 'push';   // the 3D sculpt brushes of build 13 are gone
    // build 26: free detail off by default — on real photos it read shine, stubble and side light as humps
    // (the stored version decides: saved settings without one are older)
    if ((st.surfV || 0) < 4) { c.surfTrust = .5; c.surfDetail = 0; c.surfV = 4; }
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
  // the face map is selected in the panel like a measurement (mapOpen): then its dots are edited
  map: null, mapOpen: false, mapStep: 'points', lightDir: null, rot3: { yaw: 0, pitch: 0 }, orbit: null, surf: null, surfBusy: null, surfAgain: null, zstroke: null, hints: null, hstroke: null, mapXf: null, mapSel: new Set(), mapHover: null, mapDrag: null, mapBox: null, qfit: null,
  anat: {}, anatBase: {}, anatHover: null, anatSnap: null, hideGroups: new Set(),
  // dodge & burn paint: log brightness per tone-grid node on the original photo; copy-on-write
  tone: { field: null, base: null }, toneRev: 0, tstroke: null,
  glDirty: true, fieldDirty: false,
};
// the photo tabs (Front · Side · 3D, set up with the image input below): which photo is shown, the other one put away
let imgSeqTop = 0, curSlot = 'front', back3D = null;
const slots = { front: null, side: null };
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
/** While the face map is selected the photo is shown unchanged, so you align the dots to the original. */
const mapping = () => !!(S.mapOpen && S.img);
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
  // (Interior feature lines — creases, rims, ridges — are dense enough in dots alone.)
  for (const c of m.contours) {
    if (c.line || c.idx.some(i => !m.vis[i])) continue;
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
    for (let k = 0; k < c.idx.length; k += 2) {
      const i = c.idx[k], f = .55, ax = cx + (m.p[2 * i] - cx) * f, ay = cy + (m.p[2 * i + 1] - cy) * f;
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
  // the layer behind the face only changes where the face edge pulls in, so reuse it when it hasn't
  const old = m.ctrl, Bs = Float32Array.from(B);
  const sameB = old && old.Bs && old.Bs.length === Bs.length && Bs.every((v, i) => Math.abs(v - old.Bs[i]) < 1e-3);
  m.ctrl = { ver: m.ver, Bs, front: FM.tpsFit(F, F.length / 4, s, TPS_SMOOTH), back: sameB ? old.back : FM.tpsFit(B, B.length / 4, s, TPS_SMOOTH) };
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
  return { view, yaw, p, vis, contours: FM.contours(yaw), ver: 1, pver: 1, snapped: snapped || 0, light: light || null, zo: null, zoRev: 0 };
}
/**
 * Fit the face scan to the photo: the template seen from this view, then pulled onto every
 * measured landmark it shares a name with (and any quick-fit clicks), so matched points land exactly.
 */
function fitMap(view = (S.map && S.map.view) || (curSlot === 'side' ? 'left' : 'front'), extraPairs = []) {
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
  // the brows (and the hair) are placed by everything, the rest without them: a brow sits on the skin
  // wherever it grows, and where it was clicked says nothing about the brow ridge or the eyelid under it
  const bone = pairs.filter(c => !COLOUR_ONLY(FM.POINTS[c.i]));
  const pos = pairs.length ? T.map((t, i) => simFit(bone.length && !COLOUR_ONLY(FM.POINTS[i]) ? bone : pairs, t.x, t.y)) : T;
  for (const c of pairs) pos[c.i] = { x: c.b.x, y: c.b.y };
  const p = new Float32Array(NMAP * 2);
  pos.forEach((v, i) => { p[2 * i] = v.x; p[2 * i + 1] = v.y; });
  const af = S.map && S.map.view === view ? S.map.af : null;   // the face's anatomy set by hand stays with the photo
  S.map = makeMap(view, p, pairs.length);
  if (af) S.map.af = af;
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
  const d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h), Rd = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { L[i] = .299 * d[4 * i] + .587 * d[4 * i + 1] + .114 * d[4 * i + 2]; Rd[i] = d[4 * i] - (d[4 * i + 1] + d[4 * i + 2]) / 2; }
  const at = (x, y) => {
    const fx = clamp(x * sc, 0, w - 1.001), fy = clamp(y * sc, 0, h - 1.001), i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * w + i;
    return (L[k] * (1 - tx) + L[k + 1] * tx) * (1 - ty) + (L[k + w] * (1 - tx) + L[k + w + 1] * tx) * ty;
  };
  at.step = 1 / sc;
  // redness (red minus the rest): lips stand out from skin by colour more than by brightness
  at.red = (x, y) => {
    const fx = clamp(x * sc, 0, w - 1.001), fy = clamp(y * sc, 0, h - 1.001), i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * w + i;
    return (Rd[k] * (1 - tx) + Rd[k + 1] * tx) * (1 - ty) + (Rd[k + w] * (1 - tx) + Rd[k + w + 1] * tx) * ty;
  };
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
function snapEdges(opt = {}) {
  const m = S.map, lum = photoLum(), sc = mapScale(), step = lum.step, moved = new Set(), pinned = opt.pinned || new Set();
  for (const c of m.contours) {
    if (!(c.snap || c.snapFine) || c.idx.some(i => !m.vis[i])) continue;
    if (opt.gentle && !c.snap) continue;     // after a quick fit: only the outer edges, and only a little
    if (opt.features && c.snap) continue;    // … or only the features (eyes, brows, lips)
    const fine = !c.snap, brow = c.id.startsWith('browShape'), lips = c.id === 'lips' || c.id === 'lip';
    const R = (fine ? (brow ? .06 : .045) : opt.gentle ? .07 : .15) * sc, e = (fine ? 1 : 1.5) * step;
    // eyes: the white is brighter than the lash line; brows: darker than the skin; lips: redder
    const sign = !fine ? 0 : c.id.startsWith('eye') ? 1 : lips ? 1 : -1;
    const val = lips ? lum.red : lum;
    const st = fine ? Math.max(.5, Math.min(step, R / 8)) : step;
    // two passes, so a dot that starts a little far from the edge can walk onto it
    for (let pass = 0; pass < 2; pass++) {
      const N = contourNormals(c, m.p, fine);
      const offs = N.map(([nx, ny], k) => {
        const i = c.idx[k], px = m.p[2 * i], py = m.p[2 * i + 1];
        let best = 0, bestT = 0;
        for (let t = -R; t <= R; t += st) {
          const x = px + nx * t, y = py + ny * t, d = val(x - nx * e, y - ny * e) - val(x + nx * e, y + ny * e);
          const gd = sign ? Math.max(0, sign * d) : Math.abs(d);
          const score = gd * (1 - .4 * (t / R) * (t / R));   // prefer edges close to where the dot is
          if (score > best) { best = score; bestT = t; }
        }
        return best > (fine ? 7 : 10) ? bestT : 0;
      });
      // an offset far from both neighbours' is probably a wrong catch (a shadow, a strand): use the median
      const n = offs.length, tol = (fine ? .03 : .12) * sc;
      let fixed = offs.map((v, k) => {
        const a = offs[c.closed ? (k + n - 1) % n : Math.max(0, k - 1)], b = offs[c.closed ? (k + 1) % n : Math.min(n - 1, k + 1)];
        return Math.abs(v - a) > tol && Math.abs(v - b) > tol ? [a, v, b].sort((x, y) => x - y)[1] : v;
      });
      // Dots you placed yourself stay where they are, and the moves are smoothed along the line
      // (so it can't wiggle): two passes of a [1 2 1] filter, re-pinning after each.
      const pin = c.idx.map(i => pinned.has(i));
      const nb = (k, d) => c.closed ? (k + d + n) % n : Math.min(n - 1, Math.max(0, k + d));
      for (let it = 0; it < 2; it++) {
        fixed = fixed.map((v, k) => pin[k] ? 0 : (fixed[nb(k, -1)] + 2 * v + fixed[nb(k, 1)]) / 4);
      }
      // and the dots right next to a placed one move less
      fixed = fixed.map((v, k) => pin[nb(k, -1)] || pin[nb(k, 1)] ? v * .35 : pin[nb(k, -2)] || pin[nb(k, 2)] ? v * .7 : v);
      N.forEach(([nx, ny], k) => {
        const i = c.idx[k], t = fixed[k];
        if (Math.abs(t) < .5) return;
        m.p[2 * i] += nx * t; m.p[2 * i + 1] += ny * t;
        moved.add(i);
      });
    }
    // an eye's lids and a brow's edges are smooth curves between their corners: no wiggles
    const s = FM.POINTS[c.idx[0]].id.slice(-1);
    if (c.id.startsWith('eye')) smoothArcs(c, 'en' + s, 'ex' + s, pinned, moved);
    else if (brow) smoothArcs(c, 'bi' + s, 'bt' + s, pinned, moved);
  }
  if (moved.size) { mapTouched(true); buildMask(); }
  return moved.size;
}
/**
 * Make a closed feature outline two smooth arcs between its corners (an eye's upper and lower lid,
 * a brow's upper and lower edge): across the line between the corners, each arc's dots are fitted
 * to v(u) = u(1 − u)(a + b·u) — a smooth curve through both corners with its peak anywhere along it.
 * Dots placed by hand stay put (and count ten times in the fit).
 */
function smoothArcs(c, ca, cb, pinned, moved) {
  const m = S.map, idx = c.idx, n = idx.length, ka = idx.indexOf(FM.INDEX[ca]), kb = idx.indexOf(FM.INDEX[cb]);
  if (ka < 0 || kb < 0) return;
  const A = mapPt(idx[ka]), B = mapPt(idx[kb]), L = Math.hypot(B.x - A.x, B.y - A.y);
  if (L < 2) return;
  const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L, nx = -uy, ny = ux;
  for (const [from, to] of [[ka, kb], [kb, ka]]) {
    const arc = [];
    for (let k = (from + 1) % n; k !== to; k = (k + 1) % n) arc.push(idx[k]);
    if (arc.length < 3) continue;
    const uv = arc.map(i => { const px = m.p[2 * i] - A.x, py = m.p[2 * i + 1] - A.y; return [(px * ux + py * uy) / L, (px * nx + py * ny) / L]; });
    let s11 = 0, s12 = 0, s22 = 0, r1 = 0, r2 = 0;
    uv.forEach(([u, v], q) => {
      const w = pinned.has(arc[q]) ? 10 : 1, f1 = u * (1 - u), f2 = f1 * u;
      s11 += w * f1 * f1; s12 += w * f1 * f2; s22 += w * f2 * f2; r1 += w * f1 * v; r2 += w * f2 * v;
    });
    const det = s11 * s22 - s12 * s12;
    if (!(Math.abs(det) > 1e-12)) continue;
    const a = (r1 * s22 - r2 * s12) / det, b = (s11 * r2 - s12 * r1) / det;
    uv.forEach(([u, v], q) => {
      if (pinned.has(arc[q]) || u <= 0 || u >= 1) return;
      const vf = u * (1 - u) * (a + b * u), i = arc[q];
      if (Math.abs(vf - v) * L < .3) return;
      m.p[2 * i] = A.x + (u * ux + vf * nx) * L; m.p[2 * i + 1] = A.y + (u * uy + vf * ny) * L;
      moved.add(i);
    });
  }
}
/**
 * The nasolabial folds onto the crease the photo shows. The fold isn't an edge between two brightnesses
 * but a narrow dark line between the cheek and the lip (whichever side the light comes from), so each
 * of its dots — not the top one, which stays at the nostril wing — slides along the fold's normal to the
 * darkest narrow line within ≈ 3 mm of where the template put it; the moves are then smoothed along the
 * fold. Where no line stands out (a smooth young face, flat light) the dots stay. Returns how many moved.
 */
function snapFolds(opt = {}) {
  const m = S.map, pinned = opt.pinned || new Set(), moved = new Set();
  if (!m || isProfile(m)) return 0;
  const lum = photoLum(), cm = mapFrame().scale, R = .3 * cm, e = .1 * cm, st = Math.max(.5, R / 12);
  for (const c of m.contours) {
    if (!c.fold || c.idx.some(i => !m.vis[i])) continue;
    const N = contourNormals(c, m.p, true), n = c.idx.length;
    let offs = N.map(([nx, ny], k) => {
      const i = c.idx[k];
      if (!k || pinned.has(i)) return 0;
      const px = m.p[2 * i], py = m.p[2 * i + 1];
      let best = 0, bestT = 0;
      for (let t = -R; t <= R; t += st) {
        const x = px + nx * t, y = py + ny * t, v = (lum(x - nx * e, y - ny * e) + lum(x + nx * e, y + ny * e)) / 2 - lum(x, y);
        const score = v * (1 - .5 * (t / R) * (t / R));
        if (score > best) { best = score; bestT = t; }
      }
      return best > 2.5 ? bestT : 0;
    });
    // a [1 2 1] pass along the fold (the top stays put), so the line can't zigzag
    offs = offs.map((v, k) => !k || pinned.has(c.idx[k]) ? 0 : (offs[k - 1] + 2 * v + offs[Math.min(n - 1, k + 1)]) / 4);
    N.forEach(([nx, ny], k) => {
      const i = c.idx[k], t = offs[k];
      if (Math.abs(t) < .5) return;
      m.p[2 * i] += nx * t; m.p[2 * i + 1] += ny * t;
      moved.add(i);
    });
  }
  if (moved.size) { placeDetail(moved); mapTouched(true); }
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
/* The template's depth as a smooth function of position on the template (cm, seen from this
   view). The face's starting depth reads it through a smooth photo → template map: a dot placed
   a little off then only shifts the depth sideways, instead of raising a bump (as interpolating
   each dot's own depth value would). */
// (the iris edges are shape: they're on the cornea, which bulges in front of the lids)
const COLOUR_ONLY = pt => (pt.group === 'brows' && pt.id !== 'gl') || pt.group === 'hair';
const tdCache = {}, SHARP_GROUPS = new Set(['nose', 'lips']), SHARP_IDS = new Set(['supra', 'so1', 'so3', 'so4', 'malar', 'zr1', 'chin', 'mental', 'cpl', 'ms']);
function templateDepth(yaw) {
  if (tdCache[yaw]) return tdCache[yaw];
  const t = yaw * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t), ctl = [], lam = [];
  FM.POINTS.forEach(pt => {
    if (pt.field === 'back' || !FM.visible(pt, yaw)) return;
    const p = FM.project(pt, yaw);
    ctl.push(p.x, p.y, p.x + pt.x * st + pt.z * ct, p.y);
    // The midline, nose, lips, brow ridge, cheekbone and chin keep their depth closely (so the nose,
    // brow and chin project as they should); the eyelids a little less, the rest is smoothed —
    // neighbouring template points don't always agree on depth, and an exact fit would ripple.
    // Dots that only outline a colour (brows, hairline, iris) lie on the skin and don't shape it:
    // the brow sits right on the brow ridge, and two depths there made a double fold.
    const base = pt.id.replace(/[LR]$/, '');
    lam.push(COLOUR_ONLY(pt) ? .3 : pt.mid ? 1.5e-2 : pt.group === 'eyes' ? 5e-3 : !pt.side || SHARP_GROUPS.has(pt.group) || SHARP_IDS.has(base) ? 1.5e-3 : pt.group === 'outline' ? 6e-3 : 1e-2);
  });
  tdCache[yaw] = FM.tpsFit(ctl, ctl.length / 4, 20, lam);
  return tdCache[yaw];
}
/** Photo → template position (cm, as seen from this view), smooth through the dots (cached per alignment). */
function photoToTemplate() {
  const m = S.map;
  if (m.p2t && m.p2t.pver === m.pver) return m.p2t;
  const f = mapFrame(), ctl = [], z2 = f.zr * f.zr + f.zi * f.zi;
  FM.POINTS.forEach((pt, i) => {
    // the brows and hair are on the skin, not the skull: where they are doesn't move the bone under them
    // (and the detail dots only follow the named ones)
    if (!m.vis[i] || pt.field === 'back' || COLOUR_ONLY(pt) || pt.mid) return;
    const tp = FM.project(pt, m.yaw);
    ctl.push(m.p[2 * i], m.p[2 * i + 1], f.zr * tp.x - f.zi * tp.y + f.tx, f.zi * tp.x + f.zr * tp.y + f.ty);
  });
  // smoother than the warp's own fit: dots placed a little off each other bend the depth less
  const T = FM.tpsFit(ctl, ctl.length / 4, Math.max(S.iw, S.ih), 6e-3);
  m.p2t = { pver: m.pver, at(x, y) { const [ax, ay] = FM.tpsEval(T, x, y), ux = ax - f.tx, uy = ay - f.ty; return [(ux * f.zr + uy * f.zi) / z2, (uy * f.zr - ux * f.zi) / z2]; } };
  return m.p2t;
}
/** The template's depth (cm) at a photo point. */
function priorDepth(x, y) {
  const [X, Y] = photoToTemplate().at(x, y);
  return FM.tpsEval(templateDepth(S.map.yaw), X, Y)[0] - X;
}
/**
 * Per alignment: the face nodes of the tone grid lifted onto the 3D template — each one's template
 * position (cm), depth toward the camera, soft-tissue depth and how much it belongs to each feature.
 */
function denseFace() {
  const m = S.map;
  const sk = surfUsable() ? surfKey() : '';
  if (m.dense && m.dense.pver === m.pver && m.dense.seq === S.imgSeq && m.dense.sk === sk) return m.dense;
  const { cell, gw, gh } = toneGrid(), nv = gw * gh, f = mapFrame();
  const yaw = m.yaw * Math.PI / 180, ct = Math.cos(yaw), st = Math.sin(yaw);
  const act = new Uint8Array(nv);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (maskAt(i * cell, j * cell) > .02) act[j * gw + i] = 1;
  // splines from the photo onto the template (as seen from this view), its depth and the tissue depth
  const ctl = [], gx = [], gy = [], dD = [], dT = [];
  FM.POINTS.forEach((pt, i) => {
    if (!m.vis[i] || pt.field === 'back' || COLOUR_ONLY(pt) || pt.mid) return;   // (as in photoToTemplate)
    const tp = FM.project(pt, m.yaw);
    ctl.push(m.p[2 * i], m.p[2 * i + 1], f.zr * tp.x - f.zi * tp.y + f.tx, f.zi * tp.x + f.zr * tp.y + f.ty);
    gx.push(m.p[2 * i]); gy.push(m.p[2 * i + 1]);
    dD.push(pt.x * st + pt.z * ct); dT.push(pt.t);
  });
  const s = Math.max(S.iw, S.ih);
  const toT = FM.tpsFit(ctl, gx.length, s, TPS_SMOOTH), TD = templateDepth(m.yaw), toTis = scalarFit(gx, gy, dT, s);
  const z2 = f.zr * f.zr + f.zi * f.zi;
  const actIdx = [];
  for (let v = 0; v < nv; v++) if (act[v]) actIdx.push(v);
  const d0 = new Float32Array(nv), pts = new Array(actIdx.length);
  actIdx.forEach((v, k) => {
    const sx = (v % gw) * cell, sy = ((v / gw) | 0) * cell;
    const [ax, ay] = FM.tpsEval(toT, sx, sy), ux = ax - f.tx, uy = ay - f.ty;
    // depth: this face's own surface where it was built (Face map → Surface), else the template's
    const sd = sk ? surfAt(sx, sy) : null;
    const X = (ux * f.zr + uy * f.zi) / z2, Y = (uy * f.zr - ux * f.zi) / z2, Dp = sd != null ? sd : FM.tpsEval(TD, X, Y)[0] - X;
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
  m.dense = { pver: m.pver, seq: S.imgSeq, sk, cell, gw, gh, nv, act, actIdx: Int32Array.from(actIdx), kOf, pts, d0, cm, grad, contrast, feather, eyes, auto: null };
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
  // with a built surface: the light measured from the photo (ambient + direction); else a rough guess
  const SL = surfUsable() ? S.surf.light : null;
  const lit = (g) => {
    const gX = clamp(g[0], -2.5, 2.5), gY = clamp(g[1], -2.5, 2.5);
    if (SL) return Math.max(.04, SF.shade(SL, gX, gY));
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

/* ----------------------------------------------- face surface (Face map → 2) --
   A depth map of this face on a grid over the photo, built by surface.js from the face-map dots
   (the template's depth, pulled onto this face) and the photo's own light and shade. It is shown
   as contour lines, relief, Haralick topography, a mesh or a turnable 3D view; the user can fix it
   with brushes; and Morph uses it (its depth for the anatomy, its light for the shading). */
const SF = window.CraniSurface || null;

/* ---- the measured head (ICT-FaceKit, head.js) ----
   A real head from light-stage scans, fitted to the front photo's dots (and the side photo's, once its
   map is placed): its depth is the face's starting shape — instead of the template's, which had to be
   guessed — and the head around the face in 3D. Loaded the first time a surface is built (≈ 3 MB). */
const HM = window.CraniHead && window.CraniHead.build === BUILD ? window.CraniHead : null;
/** Which dots the head is fitted to, and how much each counts: the skin's landmarks and lines — not
    the brows and hair (colour), the hairline or the neck (they vary or move); the ears and the detail
    dots between named ones less. On a side photo: its midline and named landmarks. */
const headWeight = (side, m) => i => {
  const pt = FM.POINTS[i], g = pt.group;
  // (the ears a little: they set where the model's ears sit, and the head's width and depth with them)
  // (in profile the ear is sharp and sets where the head's ear sits: weighted like the face's own dots)
  if (g === 'ears') return side ? (pt.lm ? .8 : .4) : pt.mid ? .2 : .4;
  if (g === 'brows' || g === 'hair' || g === 'neck' || g === 'ears' || pt.field === 'back' || /^(tri|hl)/.test(pt.id)) return 0;
  // (a side photo's jaw line — its lower border, the angle, the ramus's back edge — fits as an edge: firmly
  // where you placed the dot, lightly where it's still the template's guess, which would only pull the
  // model's jaw toward the template's)
  if (side) return pt.side === 0 ? (pt.mid ? .6 : 1) : /^(jaw2|go|ramus)[LR]$/.test(pt.id) ? (isUser(m, i) ? .9 : .25) : pt.lm ? .5 : 0;
  // (soft features — the temporal line, the cheekbone's ridge, the hollows — are placed less exactly)
  return /^(tem|tc|zr|sm|hcm|ss)/.test(pt.id) ? .3 : pt.mid ? .5 : 1;
};
const sideMapOf = () => { const sm = curSlot === 'front' && slots.side && slots.side.map; return sm && isProfile(sm) && sm.snapped ? sm : null; };
const headKey = () => { const m = S.map, sm = sideMapOf(); return m ? `${S.imgSeq}|${m.pver}|${m.view}|${sm ? `${slots.side.imgSeq}:${sm.pver}:${sm.view}` : '-'}` : ''; };
/** The head fitted to this face (cached on the map), or null (no model, a profile, or it failed). */
async function ensureHead() {
  const m = S.map;
  if (!HM || !m || isProfile(m) || curSlot !== 'front' || !m.snapped) return null;
  const key = headKey();
  if (m.head && m.head.key === key) return m.head;
  try { await HM.load(`ict-head.bin?v=${BUILD}`); } catch (e) { console.warn(e); if (!ensureHead.warned) { ensureHead.warned = true; toast('The head model (ict-head.bin) didn’t load — the 3D uses the template instead', 6000); } return null; }
  if (S.map !== m || headKey() !== key) return null;
  const sm = sideMapOf(), views = [{ view: 'front', p: m.p, vis: m.vis, weight: headWeight(false) }];
  if (sm) views.push({ view: sm.view, p: sm.p, vis: sm.vis, weight: headWeight(true, sm), outline: (sm.contours.find(c => c.boundary) || {}).idx });
  // the modes' fit, then bent to what the photos show beyond them (the side photo's whole profile and jaw line)
  const res = HM.deform(HM.fit(views), views), C = HM.correspond(), vertOf = new Int32Array(NMAP).map((_, i) => C[i] ? C[i].v : -1);
  for (const o of res.pairs[0]) vertOf[o.i] = o.vert;   // (the edge dots: the vertex on the fitted head's edge)
  // depths in the photo's centimetres (its scale from the face map): the fitted head's own size is traded
  // against its pose's scale, and only its depth for its width in the photo is the head's
  const P = HM.project(res, 0), kz = P.s / mapFrame().scale;
  for (let i = 0; i < P.z.length; i++) P.z[i] *= kz;
  m.head = { key, res, P, vertOf, side: !!sm, n: views.reduce((s, V) => s + FM.POINTS.reduce((c, _, i) => c + (V.vis[i] && V.weight(i) > 0 ? 1 : 0), 0), 0) };
  return m.head;
}
/** The fitted head, in numbers (for the console: cranimeter.headReport()): each photo's pose off its nominal
    view, how far the bend beyond the modes moved the chin and jaw, and the dots the photos still disagree on. */
function headReport() {
  const h = S.map && S.map.head;
  if (!h) return 'No head fitted yet — open the 3D tab first.';
  const res = h.res, deg = x => (x * 180 / Math.PI).toFixed(1), VR = { front: [[1, 0, 0], [0, -1, 0], [0, 0, -1]], left: [[0, 0, -1], [0, -1, 0], [-1, 0, 0]], right: [[0, 0, 1], [0, -1, 0], [1, 0, 0]] };
  const views = ['front', h.side ? sideMapOf().view : null].filter(Boolean), C = HM.correspond(), mm = v => res.dX ? (10 * Math.hypot(res.dX[3 * v], res.dX[3 * v + 1], res.dX[3 * v + 2])).toFixed(1) : '—';
  const L = views.map((vw, q) => { const V = VR[vw], R = res.poses[q].R, M = R.map(r => [0, 1, 2].map(j => r[0] * V[j][0] + r[1] * V[j][1] + r[2] * V[j][2])); return `${q ? 'side ' : 'front'}  pitch ${deg(Math.atan2(M[1][2], M[2][2]))}°  yaw ${deg(Math.asin(-M[0][2]))}°  roll ${deg(Math.atan2(M[0][1], M[0][0]))}°`; });
  L.push(`fit rms ${(10 * res.rms).toFixed(1)} mm · modes ±${Math.max(...res.c.map(Math.abs)).toFixed(1)}σ · bend ${(res.bendMs || 0) | 0} ms`);
  L.push('bend at ' + ['n', 'prn', 'ls', 'li', 'pog', 'me', 'goL', 'goR'].filter(id => FM.INDEX[id] != null && C[FM.INDEX[id]]).map(id => `${id} ${mm(C[FM.INDEX[id]].v)}`).join(' · ') + ' mm');
  const bad = (res.misfit || []).filter(o => o.mm > 2).slice(0, 12);
  L.push(bad.length ? 'still off (mm): ' + bad.map(o => `${o.q ? 'side' : 'front'} ${FM.POINTS[o.i].id} ${o.mm.toFixed(1)}`).join(' · ') : 'every dot within 2 mm');
  return L.join('\n');
}
/* The bone and soft-tissue lines — the orbit's rims, the brow ridge, the cheekbones, the hollows, the
   chin, the forehead, the lid creases, the nasolabial folds — aren't edges a photo shows sharply. After
   Auto-place or Quick fit they go where the measured head has them, fitted to the dots that are clear
   (eyes, nose, lips, the outline, the ears): a real head's anatomy, turned with the photo's own pose,
   instead of a flat warp of the template between the clicked points. */
const STRUCT = /^(so[134]|supra|gl|sg|ss\d|tc\d|lor|ior|tt\d|mor|malar|zr\d|sm\d|hcm|nl\d|mar|pjs|jowl|masse|mental|cpl|ms|bpt|temH|fh[CTU]?|cr\d|lc\d)[LR]?$/;
async function placeStructure(pinned = new Set()) {
  const m = S.map;
  if (!HM || !m || isProfile(m) || curSlot !== 'front') return 0;
  try { await HM.load(`ict-head.bin?v=${BUILD}`); } catch (e) { return 0; }
  if (S.map !== m) return 0;
  const w0 = headWeight(false), res = HM.fit([{ view: 'front', p: m.p, vis: m.vis, weight: i => STRUCT.test(FM.POINTS[i].id) ? 0 : w0(i) }]);
  const P = HM.project(res, 0), C = HM.correspond();
  let n = 0;
  FM.POINTS.forEach((pt, i) => {
    if (!m.vis[i] || pinned.has(i) || pt.mid || !STRUCT.test(pt.id) || !C[i] || C[i].v < 0) return;
    m.p[2 * i] = P.uv[2 * C[i].v]; m.p[2 * i + 1] = P.uv[2 * C[i].v + 1]; n++;
  });
  if (n) { placeDetail(null); mapTouched(true); buildMask(); }
  return n;
}
/** The fitted head's depth (cm, from the ear plane) on a grid over the photo — NaN where it isn't. */
const headDepth = (grid, opt) => { const h = S.map && S.map.head; return HM && h && h.key === headKey() ? HM.raster(h.P, grid, 'all', opt) : null; };
const SURF_DIV = 160;
let surfIds = 0, surfRev = 0;
const surfStep = () => mapping() && S.mapStep === 'surface';
const lightStep = () => mapping() && S.mapStep === 'light';
const paintStep = () => mapping() && S.mapStep !== 'points';
/** The Surface step's fix-it brush, if one is picked. */
const fixBrush = () => surfStep() && cfg.surfBrush && !/^h[A-Z]/.test(cfg.surfBrush) ? cfg.surfBrush : '';
const surfUsable = () => !!(SF && S.surf && S.map && S.surf.view === S.map.view && cfg.surfUse);
const surfKey = () => S.surf ? `${S.surf.id}:${S.surf.rev}` : '';
/** The surface's depth with the user's fixes (cm toward the camera), cached per edit. */
function surfZ(s = S.surf) {
  if (!s) return null;
  if (s._zt && s._zt.rev === s.rev) return s._zt.z;
  const z = s.edit ? s.z.map((v, k) => v + s.edit[k]) : s.z;
  s._zt = { rev: s.rev, z };
  return z;
}
/** Depth of the surface at a photo point (bilinear), or null outside it. */
function surfAt(x, y) {
  const s = S.surf, z = surfZ(s);
  const fx = (x - s.x0) / s.cell, fy = (y - s.y0) / s.cell, i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= s.gw - 1 || j >= s.gh - 1) return null;
  const k = j * s.gw + i;
  if (!s.act[k] || !s.act[k + 1] || !s.act[k + s.gw] || !s.act[k + s.gw + 1]) return null;
  const tx = fx - i, ty = fy - j;
  return (z[k] * (1 - tx) + z[k + 1] * tx) * (1 - ty) + (z[k + s.gw] * (1 - tx) + z[k + s.gw + 1] * tx) * ty;
}
/** Eye openings, brows, lips and nostrils on the surface grid (0…1): their colour isn't skin shading. */
function surfFeatureMask(x0, y0, cell, gw, gh, sc) {
  const m = S.map, c = document.createElement('canvas');
  c.width = gw; c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(1 / cell, 0, 0, 1 / cell, -x0 / cell + .5, -y0 / cell + .5);
  g.fillStyle = g.strokeStyle = '#fff';
  g.lineWidth = .15 * sc; g.lineJoin = 'round';
  for (const ct of m.contours) {
    if (!ct.closed || ct.boundary || !/^(eye|lips|browShape)/.test(ct.id) || ct.idx.some(i => !m.vis[i])) continue;
    const pts = FM.spline(ct.idx.map(i => ({ x: m.p[2 * i], y: m.p[2 * i + 1] })), true, 6);
    g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fill(); g.stroke();
  }
  for (const id of ['nosL', 'nosR', 'alL', 'alR', 'col']) {
    const i = FM.INDEX[id];
    if (i == null || !m.vis[i]) continue;
    g.beginPath(); g.arc(m.p[2 * i], m.p[2 * i + 1], .32 * sc, 0, TAU); g.fill();
  }
  const d = g.getImageData(0, 0, gw, gh).data, out = new Float32Array(gw * gh);
  for (let k = 0; k < gw * gh; k++) out[k] = d[4 * k + 3] / 255;
  return out;
}
/** Build (or rebuild) the surface from the dots and the photo. Undoable; keeps fixes if the grid is unchanged. */
/** Everything the Light and Surface steps read off the photo and the dots (cached per photo and alignment). */
function surfInputs() {
  const m = S.map, hk = m.head && m.head.key === headKey() ? m.head.key : '', key = `${S.imgSeq}|${m.pver}|${m.view}|${hk}`;
  if (m.sin && m.sin.key === key) return m.sin;
  const f = mapFrame();
  // the face's box on the photo
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of mapBoundary().idx) { x0 = Math.min(x0, m.p[2 * i]); y0 = Math.min(y0, m.p[2 * i + 1]); x1 = Math.max(x1, m.p[2 * i]); y1 = Math.max(y1, m.p[2 * i + 1]); }
  // resolution from the face; a wide margin around it (the 3D relief falls off to the photo plane there)
  const fw = Math.max(x1 - x0, y1 - y0), cell = fw / SURF_DIV, pad = .18 * fw;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(S.iw, x1 + pad); y1 = Math.min(S.ih, y1 + pad);
  const gw = Math.ceil((x1 - x0) / cell) + 1, gh = Math.ceil((y1 - y0) / cell) + 1, n = gw * gh;
  const h = cell / f.scale;
  const act = new Uint8Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (maskAt(x0 + i * cell, y0 + j * cell) > .5) act[j * gw + i] = 1;
  // prior: the measured head fitted to the dots (head.js) — else the template's depth (as seen from this
  // view), read through a smooth photo → template map
  const z0 = new Float32Array(n), hd = hk ? headDepth({ x0, y0, cell, gw, gh }) : null;
  for (let k = 0; k < n; k++) if (act[k]) z0[k] = hd && Number.isFinite(hd[k]) ? hd[k] : priorDepth(x0 + (k % gw) * cell, y0 + ((k / gw) | 0) * cell);
  // the photo: linear luminance and colour per node, and a crop for the 3D view and the analysis views
  const lc = document.createElement('canvas'); lc.width = gw; lc.height = gh;
  const lg = lc.getContext('2d', { willReadFrequently: true });
  lg.imageSmoothingQuality = 'high';
  lg.drawImage(S.img, x0 - cell / 2, y0 - cell / 2, gw * cell, gh * cell, 0, 0, gw, gh);
  const ld = lg.getImageData(0, 0, gw, gh).data, lum = new Float32Array(n), rgb = new Float32Array(3 * n);
  const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  for (let k = 0; k < n; k++) {
    rgb[3 * k] = lin(ld[4 * k]); rgb[3 * k + 1] = lin(ld[4 * k + 1]); rgb[3 * k + 2] = lin(ld[4 * k + 2]);
    lum[k] = .2126 * rgb[3 * k] + .7152 * rgb[3 * k + 1] + .0722 * rgb[3 * k + 2];
  }
  // texture: speckle finer than a node (stubble, pores, noise) — shading is smooth, so a speckled
  // spot says little about shape (stubble only darkens the skin, and was read as a hollow)
  const tc = document.createElement('canvas'); tc.width = 3 * gw; tc.height = 3 * gh;
  const tg = tc.getContext('2d', { willReadFrequently: true });
  tg.drawImage(S.img, x0 - cell / 2, y0 - cell / 2, gw * cell, gh * cell, 0, 0, 3 * gw, 3 * gh);
  const td = tg.getImageData(0, 0, 3 * gw, 3 * gh).data, W3 = 3 * gw, L3 = new Float32Array(W3 * 3 * gh);
  for (let q = 0; q < L3.length; q++) L3[q] = .299 * td[4 * q] + .587 * td[4 * q + 1] + .114 * td[4 * q + 2];
  const L3b = SF.blur(L3, W3, 3 * gh, 1, null, 1), tex = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i3 = 3 * (k % gw), j3 = 3 * ((k / gw) | 0);
    let s = 0, mu = 0;
    for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { const q = (j3 + b) * W3 + i3 + a; s += Math.abs(L3[q] - L3b[q]); mu += L3b[q]; }
    tex[k] = s / Math.max(8, mu / 9) / 9;
  }
  // where a beard grows: below the cheekbones down to the jaw, round the mouth and over the chin —
  // the fit gives it a skin colour of its own (0 change on a shaven face)
  const beard = (() => {
    const ids = ['jaw1L', 'goL', 'jaw2L', 'chinL', 'me', 'chinR', 'jaw2R', 'goR', 'jaw1R', 'masseR', 'hcmR', 'nl1R', 'sn', 'nl1L', 'hcmL', 'masseL'];
    if (isProfile(m) || ids.some(id => FM.INDEX[id] == null || !m.vis[FM.INDEX[id]])) return null;
    const c = document.createElement('canvas'); c.width = gw; c.height = gh;
    const bg = c.getContext('2d', { willReadFrequently: true });
    bg.setTransform(1 / cell, 0, 0, 1 / cell, -x0 / cell + .5, -y0 / cell + .5); bg.fillStyle = '#fff'; bg.beginPath();
    ids.forEach((id, q) => { const i = FM.INDEX[id]; q ? bg.lineTo(m.p[2 * i], m.p[2 * i + 1]) : bg.moveTo(m.p[2 * i], m.p[2 * i + 1]); });
    bg.closePath(); bg.fill();
    const d = bg.getImageData(0, 0, gw, gh).data, a = new Float32Array(n);
    for (let k = 0; k < n; k++) a[k] = d[4 * k + 3] / 255;
    return SF.blur(a, gw, gh, Math.max(1, Math.round(.4 / h)), null, 2);
  })();
  const csc = Math.min(1, 1024 / (Math.max(gw, gh) * cell)), crop = document.createElement('canvas');
  crop.width = Math.max(1, Math.round(gw * cell * csc)); crop.height = Math.max(1, Math.round(gh * cell * csc));
  const cg = crop.getContext('2d', { willReadFrequently: true });
  cg.imageSmoothingQuality = 'high';
  cg.drawImage(S.img, x0 - cell / 2, y0 - cell / 2, gw * cell, gh * cell, 0, 0, crop.width, crop.height);
  // data weights: skin, faded out near the face edge (the template is least sure there)
  const feat = surfFeatureMask(x0, y0, cell, gw, gh, f.scale);
  const fe = SF.blur(Float32Array.from(act), gw, gh, Math.max(1, Math.round(.4 / h)), null, 1), skin = new Float32Array(n);
  for (let k = 0; k < n; k++) if (act[k]) skin[k] = clamp((fe[k] - .55) / .35, 0, 1) * (1 - feat[k]);
  // how firmly the dots fix the shape (nose, eyes, mouth: dense, well-defined dots)
  const pri = new Float32Array(n), PRI = { nose: 1, eyes: .6, lips: .6 }, CHIN = new Set(['pog', 'gn', 'me', 'bpt', 'cpl', 'ms', 'mental', 'chin']);
  FM.POINTS.forEach((pt, i) => {
    const wgt = PRI[pt.group] || (CHIN.has(pt.id.replace(/[LR]$/, '')) ? .9 : 0);
    if (!wgt || !m.vis[i]) return;
    const gi = Math.round((m.p[2 * i] - x0) / cell), gj = Math.round((m.p[2 * i + 1] - y0) / cell);
    if (gi >= 0 && gj >= 0 && gi < gw && gj < gh) pri[gj * gw + gi] = Math.max(pri[gj * gw + gi], wgt);
  });
  const prB = SF.blur(pri, gw, gh, Math.max(1, Math.round(.4 / h)), null, 2);
  let pmax = 0;
  for (const v of prB) pmax = Math.max(pmax, v);
  const prior = prB.map(v => pmax ? Math.min(1, v / pmax * 1.5) : 0);
  m.sin = { key, x0, y0, cell, gw, gh, n, h, act, z0, lum, rgb, tex, regions: beard ? [beard] : [], crop, feat, skin, prior };
  return m.sin;
}
/* The anatomy the Surface step reads from the photo: the operations that move the face toward or
   away from the camera. How much of each this face has is fitted to the light and shade first — a
   dozen numbers, so the result is always a human face — and only then is a little free detail added. */
const FIT_OPS = ['browRidge', 'infraorbital', 'malarProj', 'midfaceProj', 'noseBridge', 'noseTip', 'chinProj', 'jawProj', 'buccal', 'underEye', 'temples', 'lips', 'fat'];
/** Is the measured head fitted to the side photo too (its profile and jaw line measured, not guessed)? */
const sideHead = () => { const h = S.map && S.map.head; return !!(h && h.side && h.key === headKey()); };
// what moves the profile and the jaw: with a side photo they're the photo's, not the light's
const PROFILE_OPS = ['browRidge', 'midfaceProj', 'noseBridge', 'noseTip', 'chinProj', 'jawProj', 'lips'];
/** The anatomy the surface fit holds: what you set by hand — and with a side photo, the profile's at 0 (the
    light read a shadow under the lip as a chin set back, and pulled the head's measured chin back with it). */
const surfFixed = () => ({ ...(sideHead() ? Object.fromEntries(PROFILE_OPS.map(k => [k, 0])) : {}), ...(S.map.af || {}) });
/**
 * Per surface grid: each face node lifted onto the 3D template (template position, depth, tissue
 * depth, normal, which features it belongs to — as for the Morph tone grid) and how far each of
 * FIT_OPS moves it toward the camera at full strength (cm).
 */
function surfBasis(I) {
  if (I.basis) return I.basis;
  const m = S.map, f = mapFrame(), yaw = m.yaw * Math.PI / 180, ct = Math.cos(yaw), st = Math.sin(yaw);
  const { gw, gh, cell, x0, y0, act, z0, n, h } = I, p2t = photoToTemplate();
  const gx = [], gy = [], dT = [], feat = [];
  FM.POINTS.forEach((pt, i) => {
    if (!m.vis[i] || pt.field === 'back') return;
    gx.push(m.p[2 * i]); gy.push(m.p[2 * i + 1]); dT.push(pt.t);
    if (MEMB_GROUPS.includes(pt.group)) feat.push([m.p[2 * i], m.p[2 * i + 1], pt.group]);
  });
  const toTis = scalarFit(gx, gy, dT, Math.max(S.iw, S.ih)), g = SF.gradient(z0, gw, gh, h, act);
  const mask = re => {
    const c = document.createElement('canvas'); c.width = gw; c.height = gh;
    const cg = c.getContext('2d', { willReadFrequently: true });
    cg.setTransform(1 / cell, 0, 0, 1 / cell, -x0 / cell + .5, -y0 / cell + .5); cg.fillStyle = '#fff';
    for (const ct2 of m.contours) {
      if (!ct2.closed || !re.test(ct2.id) || ct2.idx.some(i => !m.vis[i])) continue;
      const pts = FM.spline(ct2.idx.map(i => ({ x: m.p[2 * i], y: m.p[2 * i + 1] })), true, 6);
      cg.beginPath(); pts.forEach((p, k) => k ? cg.lineTo(p.x, p.y) : cg.moveTo(p.x, p.y)); cg.closePath(); cg.fill();
    }
    const d = cg.getImageData(0, 0, gw, gh).data, out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = d[4 * k + 3] / 255;
    return out;
  };
  const eyes = mask(/^eye/), lips = mask(/^lips?$/);
  const sig = .45 * f.scale, inv = 1 / (2 * sig * sig), reach = 9 * sig * sig;
  const idx = [], pts = [];
  for (let k = 0; k < n; k++) {
    if (!act[k]) continue;
    const x = x0 + (k % gw) * cell, y = y0 + ((k / gw) | 0) * cell, [X, Y] = p2t.at(x, y), D = z0[k];
    const N = Math.hypot(g.gx[k], g.gy[k], 1), nx = -g.gx[k] / N, ny = -g.gy[k] / N, nd = 1 / N;
    const w = { outline: 0, skin: .05, brows: 0, nose: 0, lips: 0 };
    for (const [px, py, gr] of feat) { const d2 = (px - x) ** 2 + (py - y) ** 2; if (d2 < reach) w[gr] += Math.exp(-d2 * inv); }
    w.lips = Math.max(w.lips, lips[k] * 4);
    let tot = 0;
    for (const gr in w) tot += w[gr];
    const mm = { eyes: eyes[k] };
    for (const gr in w) mm[gr] = w[gr] / tot * (1 - eyes[k]);
    idx.push(k);
    pts.push({ x: X * ct + D * st, y: Y, z: -X * st + D * ct, t: Math.max(0, scalarAt(toTis, x, y)), n: [nx * ct + nd * st, ny, -nx * st + nd * ct], m: mm });
  }
  const B = FIT_OPS.map(key => {
    const Dp = FM.anatomyAt({ [key]: 1 }, pts), b = new Float32Array(n);
    idx.forEach((k, q) => { b[k] = Dp[3 * q] * st + Dp[3 * q + 2] * ct; });
    return b;
  });
  I.basis = { keys: FIT_OPS.slice(), B };
  return I.basis;
}
/** The painted / detected marks, sampled onto the surface grid. */
function surfHints(I) {
  if (!S.hints) return { hint: null, ignore: null };
  const hint = new Float32Array(I.n), ignore = new Float32Array(I.n);
  for (let k = 0; k < I.n; k++) if (I.act[k]) { const x = I.x0 + (k % I.gw) * I.cell, y = I.y0 + ((k / I.gw) | 0) * I.cell; hint[k] = hintAt(S.hints.hl, x, y); ignore[k] = hintAt(S.hints.ig, x, y); }
  return { hint, ignore };
}
/**
 * Depths the surface must meet: set by dragging dots in 3D (or from a side map's file), and the Side
 * tab's profile — its line down the midline and its landmarks (a depth set by hand wins). The anatomy
 * is fitted to them, then the surface bends through them.
 */
function surfPins(I) {
  const m = S.map, pins = [], hand = new Set();
  const node = (x, y) => { const gi = Math.round((x - I.x0) / I.cell), gj = Math.round((y - I.y0) / I.cell), k = gj * I.gw + gi; return gi < 0 || gj < 0 || gi >= I.gw || gj >= I.gh || !I.act[k] ? -1 : k; };
  const use = pt => pt.field !== 'back' && !COLOUR_ONLY(pt);
  if (m.zo) FM.POINTS.forEach((pt, i) => {
    if (!Number.isFinite(m.zo[i]) || !m.vis[i] || !use(pt)) return;
    const x = m.p[2 * i], y = m.p[2 * i + 1], k = node(x, y);
    if (k < 0) return;
    pins.push({ k, z: m.zo[i], x, y }); hand.add(i);
  });
  // the side photo's landmarks and its profile line (every ≈ 8 mm) guide the anatomy fit — soft: the
  // surface isn't bent exactly through them (many close points made it ripple); the line itself is
  // laid on afterwards as a smooth correction (surfProfile)
  // (not when the measured head was fitted to the side photo too: its depth has the profile already, and
  // these pulled the anatomy to its limits over the small differences between the two)
  const sp = m.head && m.head.key === headKey() && m.head.side ? null : sideProfile();
  if (sp) {
    for (const [i, z] of sp.dots) {
      if (hand.has(i) || !m.vis[i] || !use(FM.POINTS[i])) continue;
      const x = m.p[2 * i], y = m.p[2 * i + 1], k = node(x, y);
      if (k >= 0) pins.push({ k, z, x, y, soft: true });
    }
    for (const q of sideLine(sp, .8)) { const k = node(q.x, q.y); if (k >= 0) pins.push({ k, z: q.z, x: q.x, y: q.y, soft: true }); }
  }
  return pins;
}
/** Points down this face's midline (photo px) with the side photo's profile depth (cm), every `step` cm. */
function sideLine(sp, step) {
  const m = S.map, sc = mapFrame().scale, out = [];
  const mid = FM.POINTS.map((pt, i) => pt.side === 0 && !pt.mid && m.vis[i] && pt.field !== 'back' ? { x: m.p[2 * i], y: m.p[2 * i + 1] } : null).filter(Boolean).sort((a, b) => a.y - b.y);
  const L = sp.line.filter(q => Number.isFinite(q.y)).sort((a, b) => a.y - b.y);
  if (mid.length < 2 || L.length < 2) return out;
  const lerp = (arr, y, key) => { if (y <= arr[0].y) return arr[0][key]; for (let q = 1; q < arr.length; q++) if (arr[q].y >= y) { const a = arr[q - 1], b = arr[q], t = (y - a.y) / ((b.y - a.y) || 1); return a[key] + (b[key] - a[key]) * t; } return arr[arr.length - 1][key]; };
  for (let y = Math.max(L[0].y, mid[0].y); y <= Math.min(L[L.length - 1].y, mid[mid.length - 1].y); y += step * sc) out.push({ x: lerp(mid, y, 'x'), y, z: lerp(L, y, 'z') });
  return out;
}
/**
 * The side photo's profile line for the surface: points down the midline every ≈ 1.5 mm, each with how
 * far sideways its correction reaches (≈ 1.8 cm, ≈ 0.9 cm along the nose, which is narrow). Null without
 * a side map.
 */
function surfProfile() {
  // (not when the measured head was fitted to the side photo: it's bent through that profile itself, and
  // this — read through a separate, older alignment of the two photos — only disagreed with it)
  if (sideHead()) return null;
  const sp = S.map && sideProfile();
  if (!sp) return null;
  const m = S.map, sc = mapFrame().scale, yOf = id => { const i = FM.INDEX[id]; return i != null && m.vis[i] ? m.p[2 * i + 1] : null; };
  const yn = yOf('n'), ysn = yOf('sn'), pts = sideLine(sp, .15);
  for (const q of pts) {
    const nose = yn != null && ysn != null ? smooth01(yn, yn + .6 * sc, q.y) * (1 - smooth01(ysn - .5 * sc, ysn + .2 * sc, q.y)) : 0;
    q.s = sc * (1.8 - .9 * nose);
  }
  return pts.length > 2 ? pts : null;
}
/* The face's own anatomy in the Surface panel: what the light suggested, corrected by hand while you
   look at the turned face. A value set here is held (m.af) — the fit works around it on every rebuild.
   (Full ↔ lean is one control over two: cheek hollows up and facial fat down, or the other way.) */
const SURF_ANAT = [
  ['chinProj', 'Chin projection'], ['jawProj', 'Lower jaw'], ['midfaceProj', 'Forward growth (maxilla)'], ['malarProj', 'Cheekbones'],
  ['infraorbital', 'Under-eye support'], ['browRidge', 'Brow ridge'], ['noseBridge', 'Nose bridge'], ['noseTip', 'Nose tip'],
  ['lips', 'Lips'], ['lean', 'Full ↔ lean'],
];
const leanOf = f => clamp(((f.buccal || 0) - (f.fat || 0) / .7) / 2, -2, 2);
/** Set anatomy values by hand and show the result at once (no refit: the build's pieces are reused). */
function setFaceAnat(upd) {
  const m = S.map, s = S.surf;
  if (!m || !s || s.pver !== m.pver || s.view !== m.view) return;
  const u = { ...upd };
  if ('lean' in u) { const L = u.lean; delete u.lean; u.buccal = clamp(L, -2, 2); u.fat = clamp(-.7 * L, -2, 2); }
  m.af = { ...(m.af || {}), ...u };
  const I = surfInputs(), values = { ...(s.fit || {}), ...m.af };
  const r = SF.compose({ ...I, basis: surfBasis(I), pins: surfPins(I), profile: surfProfile(), bendR: 3 * mapFrame().scale }, values, s.dz);
  // a new surface object (the undo snapshot keeps the old one)
  S.surf = { ...s, z: r.z, zfit: r.zfit, fit: values, _zt: null, rev: ++surfRev };
  S.glDirty = true; syncFaceMapPanel(); wake();
}
const ANAT_TIPS = {
  chinProj: 'How far the chin (pogonion) comes forward — hard to see from the front: check it on the turned face',
  jawProj: 'The lower jaw forward or back: chin, lower lip and the jaw body together',
  midfaceProj: 'Maxillary projection — the nose base, upper lip and inner cheeks forward ("forward growth")',
  infraorbital: 'The bone under the eyes: forward = support (no hollow), back = a shadowed under-eye',
  lean: '+ lean: hollow cheeks, less facial fat · − full: fuller cheeks and face',
};
function buildAnatPanel(an) {
  an.dataset.built = '1';
  an.innerHTML = '<div class="to-label">Anatomy <small>read from the light — turn the face and drag to correct</small></div>'
    + SURF_ANAT.map(([k, label]) => sliderRow('sfa_' + k, label, -150, 150, 1, ANAT_TIPS[k] || (FM.OP_INDEX[k] && FM.OP_INDEX[k].help) || '')).join('')
    + '<div class="to-actions" style="margin:2px 0 4px"><button type="button" class="btn ghost sm" id="sfaReset" title="Forget your values and read them from the light again">Back to the light’s reading</button></div><p class="to-note" id="sfaNote"></p>';
  an.querySelectorAll('input.rng').forEach(el => {
    el.classList.add('bi');
    const k = el.id.slice(4);
    el.addEventListener('input', () => { if (!S.sfaSnap) S.sfaSnap = snapshot(); setFaceAnat({ [k]: +el.value / 100 }); });
    el.addEventListener('change', () => { if (S.sfaSnap) { pushUndo(S.sfaSnap); S.sfaSnap = null; } });
  });
  $('#sfaReset').addEventListener('click', () => { if (!S.map) return; pushUndo(); S.map.af = {}; buildSurface({ auto: true }); });
}
/** What the surface depends on besides the dots: the light and the marks (a rebuild is due when it changes). */
const zoSig = zo => { if (!zo) return '0'; let n = 0, s = 0; zo.forEach((v, i) => { if (Number.isFinite(v)) { n++; s += v * (i % 97 + 1); } }); return `${n}:${s.toFixed(3)}`; };
const surfDeps = () => { const sp = S.map ? sideProfile() : null; return `${S.lightDir ? S.lightDir.map(v => v.toFixed(3)).join(',') : 'auto'}|${S.hints ? S.hints.rev : 0}|${S.map ? zoSig(S.map.zo) : 0}|${sp ? sp.key : '-'}`; };
async function buildSurface(opt = {}) {
  if (!SF || !S.map) return;
  if (S.surfBusy) { S.surfAgain = opt; return; }   // build again once this one is done
  // the measured head first (loaded the first time, then fitted to the dots): the surface starts from it
  if (HM && !isProfile(S.map) && !(S.map.head && S.map.head.key === headKey())) {
    S.surfBusy = { p: 0, head: true }; syncFaceMapPanel();
    await ensureHead();
    S.surfBusy = null;
    if (!S.map) return;
    if (S.surfAgain) { const again = S.surfAgain; S.surfAgain = null; opt = { ...opt, ...again }; }
  }
  // the light marks are part of the pipeline: detected automatically if step 2 was skipped
  if (!S.hints && lightInfo()) detectMarks(true);
  const m = S.map, seq = S.imgSeq, pver = m.pver, I = surfInputs(), { hint, ignore } = surfHints(I), deps = surfDeps();
  const pins = surfPins(I);
  const { gw, gh, x0, y0, cell, crop, feat } = I;
  S.surfBusy = { p: 0 };
  syncFaceMapPanel();
  let res;
  try {
    res = await SF.buildSurface({ ...I, basis: surfBasis(I), hint, ignore, pins, profile: surfProfile(), bendR: 3 * mapFrame().scale, fixed: surfFixed(), lightDir: S.lightDir, trust: cfg.surfTrust, detail: cfg.surfDetail }, p => { if (S.surfBusy) { S.surfBusy.p = p; syncFaceMapPanel(); } });
  } catch (err) { console.error(err); }
  S.surfBusy = null;
  const again = S.surfAgain;
  S.surfAgain = null;
  if (!res || seq !== S.imgSeq || S.map !== m || m.pver !== pver) { syncUI(); if (again) buildSurface(again); else if (res) toast('The face map changed while building — build again'); return; }
  const old = S.surf, keep = old && old.edit && old.gw === gw && old.gh === gh && Math.abs(old.x0 - x0) < 1e-6 && Math.abs(old.y0 - y0) < 1e-6 && Math.abs(old.cell - cell) < 1e-6;
  if (!opt.auto) pushUndo();
  let zs = 0, zn = 0;
  for (let k = 0; k < res.z.length; k++) if (res.act[k]) { zs += res.z[k]; zn++; }
  S.surf = { ...res, id: ++surfIds, rev: ++surfRev, view: m.view, pver, deps, x0, y0, cell, crop, feat, trust: cfg.surfTrust, edit: keep ? old.edit : null, pxcm: mapFrame().scale, zc: zn ? zs / zn : 0, head: !!(m.head && m.head.key === headKey()) };
  S.glDirty = true;
  syncPts(); syncUI();
  if (again) { buildSurface(again); return; }
  if (opt.auto) return;
  if (old && old.edit && !keep) toast('Surface rebuilt — your fixes were cleared because the face area changed', 5000);
  else toast(res.strength < .25 ? 'Surface built — the light in this photo is flat, so it stays close to the face map' : 'Surface built — check it in Contours, Relief or the 3D view', 4500);
}

/* surface views */
const SURF_VIEWS = [
  ['photo', 'Photo', 'Just the photo'],
  ['contours', 'Contours', 'Lines of equal depth, every 2.5 mm (bold every 1 cm) — like a topographic map'],
  ['relief', 'Relief', 'Depth as colour (blue = further back, warm = closer) with hill shading'],
  ['topo', 'Topography', 'Haralick’s topographic labels of the surface’s local relief: ridges, ravines, peaks, pits, convex and concave hills'],
  ['topoPhoto', 'Photo topography', 'The same labels read straight off the photo’s brightness (as in Yin et al.)'],
  ['mesh', 'Mesh', 'A grid draped over the surface, shaded by the photo’s light'],
  ['shading', 'Shading', 'How the surface would look in the photo’s light — compare it with the photo'],
  ['gradient', 'Luminance gradient', 'How brightness changes: red = left↔right, green = up↔down. Shows the shape the light reveals'],
  ['sweep', 'Level sweep', 'Magnifies one brightness level — sweep it to see bands of equal light'],
  ['pca', 'Colour PCA', 'Principal components of the colours — PC 1 is mostly light and shade, PC 2–3 skin colour'],
];
const RELIEF_STOPS = [[0, [38, 70, 160]], [.3, [40, 150, 170]], [.55, [90, 190, 110]], [.78, [235, 210, 90]], [1, [250, 245, 235]]];
function reliefColor(t) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < RELIEF_STOPS.length; i++) {
    const [b, cb] = RELIEF_STOPS[i], [a, ca] = RELIEF_STOPS[i - 1];
    if (t <= b) { const u = (t - a) / (b - a); return ca.map((v, c) => v + (cb[c] - v) * u); }
  }
  return RELIEF_STOPS[RELIEF_STOPS.length - 1][1];
}
let surfOv = { key: '' };
/** The current view as a raster over the surface box (cached per surface, edit and view). */
function surfOverlay() {
  const s = S.surf, v = cfg.surfView;
  const key = `${surfKey()}|${v}|${v === 'sweep' ? cfg.surfSweep : ''}|${v === 'pca' ? cfg.surfPca : ''}`;
  if (surfOv.key === key) return surfOv;
  surfOv = { key, v };
  if (v === 'photo') return surfOv;
  const { gw, gh, act, h } = s, z = surfZ(s), n = gw * gh;
  if (v === 'contours') { surfOv.lines = SF.contours(z, gw, gh, act, .25); return surfOv; }
  if (v === 'gradient' || v === 'sweep' || v === 'pca') {
    const c = s.crop, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const px = v === 'gradient' ? SF.lumGradient(d, c.width, c.height) : v === 'sweep' ? SF.levelSweep(d, c.width, c.height, cfg.surfSweep) : SF.pca(d, c.width, c.height, cfg.surfPca);
    const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    o.getContext('2d').putImageData(new ImageData(px, c.width, c.height), 0, 0);
    surfOv.canvas = o;
    return surfOv;
  }
  const o = document.createElement('canvas'), up = v === 'mesh' ? 4 : 1;
  o.width = gw * up; o.height = gh * up;
  const g = o.getContext('2d'), img = g.createImageData(gw, gh), px = img.data;
  const gr = SF.gradient(z, gw, gh, h, act), L = s.light;
  const shadeAt = k => Math.max(0, SF.shade(L, gr.gx[k], gr.gy[k]));
  if (v === 'relief') {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < n; k++) if (act[k]) { lo = Math.min(lo, z[k]); hi = Math.max(hi, z[k]); }
    for (let k = 0; k < n; k++) {
      if (!act[k]) continue;
      const col = reliefColor((z[k] - lo) / (hi - lo || 1));
      // classic map hill shading: light from the upper left
      const hs = clamp(.55 + .45 * ((gr.gx[k] * .6 + gr.gy[k] * .6 + 1) / Math.sqrt(1 + gr.gx[k] ** 2 + gr.gy[k] ** 2) - .45) * 1.6, .25, 1.15);
      px.set([col[0] * hs, col[1] * hs, col[2] * hs, 235], 4 * k);
    }
  } else if (v === 'topo' || v === 'topoPhoto') {
    const T = v === 'topo' ? SF.topography(z, gw, gh, h, act, { detrend: 1.4, smooth: 2, k: .9 }) : SF.topography(s.I, gw, gh, h, act, { smooth: 1 });
    for (let k = 0; k < n; k++) {
      const c = SF.LABELS[T.lab[k]][1];
      if (!c || !act[k]) continue;
      px.set([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 235], 4 * k);
    }
  } else if (v === 'shading') {
    let mx = 0;
    for (let k = 0; k < n; k++) if (act[k]) mx = Math.max(mx, s.rho[k] * shadeAt(k));
    for (let k = 0; k < n; k++) {
      if (!act[k]) continue;
      // back to display gamma, so it compares with the photo
      const L1 = Math.pow(clamp(s.rho[k] * shadeAt(k) / (mx || 1), 0, 1), 1 / 2.2) * 255;
      px.set([L1, L1 * .96, L1 * .93, 255], 4 * k);
    }
  }
  if (v === 'mesh') {
    // grid lines every ≈ 4 mm, brightness from the surface's shading
    const every = Math.max(2, Math.round(.4 / h));
    let lo = Infinity, hi = 0;
    for (let k = 0; k < n; k++) if (act[k]) { const v = shadeAt(k); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    g.lineWidth = 1.2;
    for (let pass = 0; pass < 2; pass++) for (let a = 0; a < (pass ? gw : gh); a += every) {
      const len = pass ? gh : gw;
      for (let b = 0; b < len - 1; b++) {
        const k0 = pass ? b * gw + a : a * gw + b, k1 = pass ? (b + 1) * gw + a : a * gw + b + 1;
        if (!act[k0] || !act[k1]) continue;
        // lit parts of the surface bright, shaded parts dark: the grid reads as a 3D shape
        const l = clamp((shadeAt(k0) - lo) / (hi - lo || 1), 0, 1);
        g.strokeStyle = `rgb(${Math.round(25 + 230 * l)},${Math.round(45 + 210 * l)},${Math.round(90 + 165 * l)})`;
        g.beginPath();
        if (pass) { g.moveTo((a + .5) * up, (b + .5) * up); g.lineTo((a + .5) * up, (b + 1.5) * up); }
        else { g.moveTo((b + .5) * up, (a + .5) * up); g.lineTo((b + 1.5) * up, (a + .5) * up); }
        g.stroke();
      }
    }
  } else g.putImageData(img, 0, 0);
  surfOv.canvas = o;
  return surfOv;
}
/** Surface step: the chosen view over the (unchanged) photo, plus the dots, faint. */
function drawSurfaceStep(ctx) {
  const s = S.surf, m = S.map;
  if (stageOn()) {   // the relief is drawn on the GPU; here: the dots and lines on it
    drawMap(ctx);
    if (fixBrush() && S.cursorIn && S.cursor && !S.pan) drawBrush(ctx, S.cursor);
    return;
  }
  if (s && cfg.surfView !== 'photo') {
    const o = surfOverlay();
    // photo → screen is affine here (the face map shows the photo unchanged)
    const ox = s.x0 - s.cell / 2, oy = s.y0 - s.cell / 2, W = s.gw * s.cell, H = s.gh * s.cell;
    const p0 = mapToScreen({ x: ox, y: oy }), px = mapToScreen({ x: ox + W, y: oy }), py = mapToScreen({ x: ox, y: oy + H });
    ctx.save();
    ctx.transform((px.x - p0.x) / s.gw, (px.y - p0.y) / s.gw, (py.x - p0.x) / s.gh, (py.y - p0.y) / s.gh, p0.x, p0.y);
    ctx.globalAlpha = cfg.surfAlpha;
    if (o.canvas) { ctx.imageSmoothingEnabled = true; ctx.drawImage(o.canvas, 0, 0, s.gw, s.gh); }
    if (o.lines) {
      const k = Math.hypot(px.x - p0.x, px.y - p0.y) / s.gw, L = o.lines;
      ctx.lineCap = 'round';
      for (const major of [0, 1]) {
        ctx.beginPath();
        for (let q = 0; q < L.major.length; q++) {
          if (L.major[q] !== major) continue;
          ctx.moveTo(L.segs[4 * q] + .5, L.segs[4 * q + 1] + .5); ctx.lineTo(L.segs[4 * q + 2] + .5, L.segs[4 * q + 3] + .5);
        }
        ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = (major ? 3.2 : 2.2) / k; ctx.stroke();
        ctx.strokeStyle = major ? 'rgba(255,236,170,.95)' : 'rgba(150,215,255,.8)'; ctx.lineWidth = (major ? 1.6 : 1) / k; ctx.stroke();
      }
    }
    ctx.restore();
  }
  // painted hints
  if (S.hints) {
    const H = S.hints, ox = -H.cell / 2;
    const p0 = mapToScreen({ x: ox, y: ox }), px = mapToScreen({ x: ox + H.gw * H.cell, y: ox }), py = mapToScreen({ x: ox, y: ox + H.gh * H.cell });
    ctx.save();
    ctx.transform((px.x - p0.x) / H.gw, (px.y - p0.y) / H.gw, (py.x - p0.x) / H.gh, (py.y - p0.y) / H.gh, p0.x, p0.y);
    ctx.globalAlpha = isHintBrush() ? 1 : .55; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(hintCanvas(), 0, 0, H.gw, H.gh);
    ctx.restore();
  }
  // the dots, small and faint, for orientation
  const P_ = mapScreenPts();
  ctx.save(); ctx.globalAlpha = .45;
  FM.POINTS.forEach((pt, i) => {
    if (!dotShown(i) || pt.detail) return;
    ctx.beginPath(); ctx.arc(P_[i].x, P_[i].y, 1.8, 0, TAU); ctx.fillStyle = MAP_COLORS[pt.group]; ctx.fill();
  });
  ctx.restore();
  if (fixBrush() && s && S.cursorIn && S.cursor && !S.pan) drawBrush(ctx, S.cursor);
}

/* fix-it brushes: Raise / Lower / Smooth / Restore paint a correction (cm) onto the surface */
const SURF_BRUSH_TEXT = { raise: 'raise the surface', lower: 'lower the surface', smooth: 'smooth the surface', restore: 'take fixes away', hHigh: 'mark a highlight (shape catching the light)', hShad: 'mark a shadow (shape turned away from the light)', hIgn: 'mark brightness that isn’t shape (stubble, make-up, a mole)', hErase: 'erase hints' };
const SURF_BRUSH_COLORS = { raise: '#F5C542', lower: '#7EA6FF', smooth: '#A8D88F', restore: '#F2F2F3', hHigh: '#FFCD46', hShad: '#466EFF', hIgn: '#AAAAB2', hErase: '#F2F2F3' };
function startSurfBrush(sx, sy) {
  const s = S.surf;
  if (!s) { toast('Build the surface first'); return; }
  const snap = snapshot();
  S.surf = { ...s, edit: s.edit ? s.edit.slice() : new Float32Array(s.gw * s.gh), rev: ++surfRev, _zt: null };
  S.zstroke = { sx, sy, snap, changed: false };
  surfDab(1 / 60);
}
function surfDab(dt) {
  const st0 = S.zstroke, s = S.surf, c = fwdMap(toI(st0.sx, st0.sy)), R = brushSrcR(st0.sx, st0.sy);
  const { gw, gh, cell, x0, y0, act } = s, e = s.edit, mode = cfg.surfBrush, hard = clamp(cfg.mHard, 0, 1) * .85;
  const i0 = Math.max(1, Math.floor((c.x - R - x0) / cell)), i1 = Math.min(gw - 2, Math.ceil((c.x + R - x0) / cell));
  const j0 = Math.max(1, Math.floor((c.y - R - y0) / cell)), j1 = Math.min(gh - 2, Math.ceil((c.y + R - y0) / cell));
  let any = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * gw + i;
    if (!act[k]) continue;
    const d = Math.hypot(x0 + i * cell - c.x, y0 + j * cell - c.y);
    if (d > R) continue;
    const w = (1 - smooth01(hard, 1, d / R)) * cfg.mStrength;
    if (w < 1e-4) continue;
    if (mode === 'raise' || mode === 'lower') e[k] = clamp(e[k] + (mode === 'raise' ? 1 : -1) * w * dt * .35, -2.5, 2.5);   // ≈ 3.5 mm per second
    else if (mode === 'restore') e[k] *= 1 - Math.min(1, w * dt * 4);
    else if (mode === 'smooth') {
      const t = k2 => s.z[k2] + e[k2], avg = (t(k - 1) + t(k + 1) + t(k - gw) + t(k + gw)) / 4;
      e[k] += (avg - t(k)) * Math.min(1, w * dt * 10);
    }
    any = true;
  }
  if (any) { st0.changed = true; s.rev = ++surfRev; s._zt = null; wake(); }
}
function endSurfBrush() {
  const z = S.zstroke;
  S.zstroke = null;
  if (!z) return;
  if (z.changed) pushUndo(z.snap); else S.surf = z.snap.surf;
  S.glDirty = true;
  syncPts(); syncUI();
}

/* hints: paint where the photo shows a highlight or a shadow caused by the shape, or where the
   brightness isn't shape at all (stubble, make-up, a mole, a reflection). They sit on the photo
   (a grid of their own, so they survive moving dots) and the surface rebuilds with them. */
const HINT_DIV = 220;
const isHintBrush = () => lightStep() && /^h[A-Z]/.test(cfg.surfBrush || '');
function hintGrid() {
  const cell = Math.max(S.iw, S.ih) / HINT_DIV;
  return { cell, gw: Math.ceil(S.iw / cell) + 1, gh: Math.ceil(S.ih / cell) + 1 };
}
function hintAt(arr, x, y) {
  const H = S.hints, fx = clamp(x / H.cell, 0, H.gw - 1.001), fy = clamp(y / H.cell, 0, H.gh - 1.001), i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * H.gw + i;
  return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - ty) + (arr[k + H.gw] * (1 - tx) + arr[k + H.gw + 1] * tx) * ty;
}
function startHintBrush(sx, sy) {
  const snap = snapshot(), G = hintGrid(), n = G.gw * G.gh, H = S.hints;
  S.hints = { ...G, hl: H ? H.hl.slice() : new Float32Array(n), ig: H ? H.ig.slice() : new Float32Array(n), rev: ++surfRev };
  S.hstroke = { sx, sy, snap, changed: false };
  hintDab(1 / 60);
}
function hintDab(dt) {
  const st0 = S.hstroke, H = S.hints, c = fwdMap(toI(st0.sx, st0.sy)), R = brushSrcR(st0.sx, st0.sy);
  const { cell, gw, gh, hl, ig } = H, mode = cfg.surfBrush, hard = clamp(cfg.mHard, 0, 1) * .85;
  const i0 = Math.max(0, Math.floor((c.x - R) / cell)), i1 = Math.min(gw - 1, Math.ceil((c.x + R) / cell));
  const j0 = Math.max(0, Math.floor((c.y - R) / cell)), j1 = Math.min(gh - 1, Math.ceil((c.y + R) / cell));
  let any = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i * cell - c.x, j * cell - c.y);
    if (d > R) continue;
    const w = (1 - smooth01(hard, 1, d / R)) * Math.max(.3, cfg.mStrength), k = j * gw + i, a = Math.min(1, w * dt * 5);
    if (mode === 'hHigh') hl[k] = Math.min(1, hl[k] + a);
    else if (mode === 'hShad') hl[k] = Math.max(-1, hl[k] - a);
    else if (mode === 'hIgn') ig[k] = Math.min(1, ig[k] + a);
    else { hl[k] *= 1 - a; ig[k] *= 1 - a; }
    any = true;
  }
  if (any) { st0.changed = true; H.rev = ++surfRev; wake(); }
}
function endHintBrush() {
  const s = S.hstroke;
  S.hstroke = null;
  if (!s) return;
  if (s.changed) {
    pushUndo(s.snap);
    // the surface follows the hints (no undo step of its own: undoing the stroke brings both back)
  } else S.hints = s.snap.hints;
  syncUI();
}
let hintCv = { rev: -1, canvas: null };
function hintCanvas() {
  const H = S.hints;
  if (hintCv.rev === H.rev) return hintCv.canvas;
  const c = document.createElement('canvas');
  c.width = H.gw; c.height = H.gh;
  const g = c.getContext('2d'), img = g.createImageData(H.gw, H.gh), px = img.data;
  for (let k = 0; k < H.gw * H.gh; k++) {
    const h = H.hl[k], i = H.ig[k];
    if (i > .02) px.set([170, 170, 178, Math.round(i * 150)], 4 * k);
    else if (h > .02) px.set([255, 205, 70, Math.round(h * 160)], 4 * k);
    else if (h < -.02) px.set([70, 110, 255, Math.round(-h * 160)], 4 * k);
  }
  g.putImageData(img, 0, 0);
  hintCv = { rev: H.rev, canvas: c };
  return c;
}

/* ------------------------------------------------ the Light step (Face map → 2) --
   Before the surface is built: where the light comes from (read from the photo against the dots'
   shape, or set with the ball), what the photo's shading looks like once skin colour is taken
   out, and which bright and dark spots are shape. "Not shape" (colours that aren't skin) is marked
   automatically; highlights, shadows, cast shadows and shine are painted where needed; the Surface
   step uses exactly this light and these marks. */
let lightCache = { key: '', a: null, I: null };
function lightInfo() {
  if (!SF || !S.map) return null;
  const I = surfInputs(), key = `${I.key}|${surfDeps()}`;
  if (lightCache.key === key) return lightCache.a;
  const { hint, ignore } = surfHints(I);
  lightCache = { key, a: SF.analyze({ ...I, hint, ignore, lightDir: S.lightDir }), I };
  return lightCache.a;
}
/** Fill the marks from the automatic detection (an undo step unless silent). */
function detectMarks(silent) {
  const a = lightInfo();
  if (!a) return;
  const I = lightCache.I, G = hintGrid(), n = G.gw * G.gh, H = S.hints && S.hints.gw === G.gw ? S.hints : null;
  if (!silent) pushUndo();
  const hl = H ? H.hl.slice() : new Float32Array(n), ig = H ? H.ig.slice() : new Float32Array(n);
  for (let j = 0; j < G.gh; j++) for (let i = 0; i < G.gw; i++) {
    const gi = Math.round((i * G.cell - I.x0) / I.cell), gj = Math.round((j * G.cell - I.y0) / I.cell);
    if (gi < 0 || gj < 0 || gi >= I.gw || gj >= I.gh) continue;
    const k = gj * I.gw + gi, c = j * G.gw + i;
    if (!I.act[k]) continue;
    // only "not shape" is marked by itself: automatic highlight / shadow marks just turned up the
    // photo's own bright and dark spots (shine, stubble, a crease) — on a rendered test face they made
    // the surface worse. Highlights and shadows are for painting where you know better.
    ig[c] = a.autoIG[k];
  }
  S.hints = { ...G, hl, ig, rev: ++surfRev };
  syncUI();
}
let lightOv = { key: '', canvas: null };
function lightCanvas(a, I) {
  const key = `${lightCache.key}|${cfg.lightView}`;
  if (lightOv.key === key) return lightOv.canvas;
  const c = document.createElement('canvas');
  c.width = I.gw; c.height = I.gh;
  const g = c.getContext('2d'), img = g.createImageData(I.gw, I.gh), px = img.data;
  const v = cfg.lightView === 'expected' ? a.expected : a.shading, vals = [];
  for (let k = 0; k < I.n; k++) if (I.act[k] && a.skin[k] > .3) vals.push(v[k]);
  vals.sort((p, q) => p - q);
  const lo = vals[Math.floor(vals.length * .02)] || 0, hi = vals[Math.floor(vals.length * .98)] || 1;
  for (let k = 0; k < I.n; k++) {
    if (!I.act[k]) continue;
    const t = clamp((v[k] - lo) / (hi - lo || 1), 0, 1), L = Math.round(30 + 215 * t);
    px.set([L, Math.round(L * .97), Math.round(L * .93), 255], 4 * k);
  }
  g.putImageData(img, 0, 0);
  lightOv = { key, canvas: c };
  return c;
}
/** A raster over a photo-space box (node (i, j) at x0 + i·cell), drawn onto the (unchanged) photo. */
function drawOnPhoto(ctx, x0, y0, cell, gw, gh, canvas, alpha) {
  const cx = x0 - cell / 2, cy = y0 - cell / 2;
  const p0 = mapToScreen({ x: cx, y: cy }), px = mapToScreen({ x: cx + gw * cell, y: cy }), py = mapToScreen({ x: cx, y: cy + gh * cell });
  ctx.save();
  ctx.transform((px.x - p0.x) / gw, (px.y - p0.y) / gw, (py.x - p0.x) / gh, (py.y - p0.y) / gh, p0.x, p0.y);
  ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, gw, gh);
  ctx.restore();
}
function drawLightStep(ctx) {
  const a = lightInfo();
  if (a && cfg.lightView !== 'photo') { const I = lightCache.I; drawOnPhoto(ctx, I.x0, I.y0, I.cell, I.gw, I.gh, lightCanvas(a, I), cfg.surfAlpha); }
  if (S.hints) drawOnPhoto(ctx, 0, 0, S.hints.cell, S.hints.gw, S.hints.gh, hintCanvas(), .9);
  const P_ = mapScreenPts();
  ctx.save(); ctx.globalAlpha = .4;
  FM.POINTS.forEach((pt, i) => {
    if (!dotShown(i) || pt.detail || P_[i].hid) return;
    ctx.beginPath(); ctx.arc(P_[i].x, P_[i].y, 1.6, 0, TAU); ctx.fillStyle = MAP_COLORS[pt.group]; ctx.fill();
  });
  ctx.restore();
  if (isHintBrush() && S.cursorIn && S.cursor && !S.pan) drawBrush(ctx, S.cursor);
}
/** The light ball: a lit sphere; drag on it to put the light where it is in the photo. */
function drawLightBall() {
  const c = $('#lgBall');
  if (!c) return;
  const a = lightInfo(), d = S.lightDir || (a ? a.dir : [0, -.3, .95]);
  const W = c.width, g = c.getContext('2d'), img = g.createImageData(W, W), r = W * .42, cx = W / 2;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = (x + .5 - cx) / r, v = (y + .5 - cx) / r, q = u * u + v * v;
    if (q > 1) continue;
    const nz = Math.sqrt(1 - q), l = Math.max(0, u * d[0] + v * d[1] + nz * d[2]), s = .16 + .84 * l, edge = Math.min(1, (1 - Math.sqrt(q)) * r);
    img.data.set([232 * s, 196 * s, 172 * s, 255 * edge], 4 * (y * W + x));
  }
  g.putImageData(img, 0, 0);
  // the light's position on the ball (dashed when it's behind)
  const lx = cx + d[0] * r, ly = cx + d[1] * r;
  g.beginPath(); g.arc(lx, ly, W * .04, 0, TAU);
  g.fillStyle = d[2] > 0 ? '#FFE27A' : 'rgba(255,226,122,.35)'; g.fill();
  g.lineWidth = W * .012; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
}
function bindLightBall() {
  const c = $('#lgBall');
  let drag = false;
  const set = e => {
    const r = c.getBoundingClientRect(), R = r.width * .42;
    let u = (e.clientX - r.left - r.width / 2) / R, v = (e.clientY - r.top - r.height / 2) / R;
    const q = Math.hypot(u, v);
    if (q > .97) { u *= .97 / q; v *= .97 / q; }
    const z = Math.sqrt(Math.max(.0009, 1 - u * u - v * v));
    S.lightDir = [u, v, z];
    syncFaceMapPanel(); wake();
  };
  c.addEventListener('pointerdown', e => { drag = true; pushUndo(); try { c.setPointerCapture(e.pointerId); } catch (err) { /* not a real pointer */ } set(e); });
  c.addEventListener('pointermove', e => { if (drag) set(e); });
  const end = () => { if (drag) { drag = false; syncUI(); } };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
}
function syncLightPane() {
  const a = lightInfo(), m = S.map;
  const d = S.lightDir || (a ? a.dir : null);
  setText($('#lgStatus'), !m ? 'Place the dots first (step 1).' : !a ? '' : `Light ${dirText(d)} — ${S.lightDir ? 'set by you' : 'read from the photo'}.`
    + (a.strength < .25 ? (S.lightDir ? ' The photo’s shading barely follows a light from there — it may be on the wrong side (Read from the photo resets it).' : ' It is very flat (front or flash light), so the surface will stay close to the dots.') : ''));
  $('#lgAuto').disabled = !S.lightDir;
  $$('#lgViews [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === cfg.lightView));
  setRange('lgAlpha', Math.round(cfg.surfAlpha * 100), Math.round(cfg.surfAlpha * 100) + '%');
  $$('#sfHint [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === cfg.surfBrush));
  $('#sfHintClear').disabled = !S.hints;
  setRange('lgSize', +(cfg.mSize * 100).toFixed(1), Math.round(brushV()) + ' px');
  setRange('lgStrength', Math.round(cfg.mStrength * 100), Math.round(cfg.mStrength * 100) + '%');
  drawLightBall();
}
/* Points step: pick a whole feature in one click (then drag it, or scale / rotate it with the box) */
const FEATURES = {
  front: [['Eye ◀', ['eyeL', 'irisL', 'creaseL', 'lowerCreaseL']], ['Eye ▶', ['eyeR', 'irisR', 'creaseR', 'lowerCreaseR']],
    ['Brow ◀', ['browShapeL', 'browL']], ['Brow ▶', ['browShapeR', 'browR']], ['Nose', ['ridge', 'nostrils', 'noseEdgeL', 'noseEdgeR', 'dorsumL', 'dorsumR', 'lobule']],
    ['Lips', ['lips', 'mouth', 'philtrumL', 'philtrumR', 'philMid', 'lipMid']], ['Cheek ◀', ['cheekboneL', 'hollowL', 'nasolabialL']], ['Cheek ▶', ['cheekboneR', 'hollowR', 'nasolabialR']], ['Face edge', ['outline']], ['Ear ◀', ['earL', 'antihelixL', 'lowerCrusL', 'conchaL']], ['Ear ▶', ['earR', 'antihelixR', 'lowerCrusR', 'conchaR']]],
  profile: [['Eye', ['eye', 'crease', 'lowerCrease']], ['Brow', ['browShape', 'brow']], ['Nose', ['nostril', 'noseEdge']], ['Lips', ['lip']], ['Cheek', ['cheekbone', 'hollow', 'nasolabial']],
    ['Profile', ['face']], ['Ear', ['ear', 'antihelix', 'lowerCrus', 'concha']]],
};
function selectFeature(ids) {
  const m = S.map, set = new Set();
  for (const c of m.contours) if (ids.includes(c.id)) c.idx.forEach(i => { if (dotShown(i) && !autoDot(i)) set.add(i); });
  S.mapSel = set;
  syncUI(); wake();
}

/* the 3D stage: in the Surface step the photo itself becomes a relief. Facing you it looks
   exactly like the 2D photo; drag to turn it and see its depth. The face map's dots sit on it
   (the "exoskeleton") and can be dragged: turned to the side, a dot moves in depth, and the
   surface is rebuilt around it. */
const stcv = document.createElement('canvas');
stcv.id = 'stcv'; stcv.setAttribute('aria-hidden', 'true'); stcv.style.display = 'none';
imgcv.after(stcv);
let stageMeshData = null, stage = null, stageTried = false, stagePhoto = null, stagePhoto2 = null, stageMeshKey = '', stageOvKey = '', stageKey = '', stageShown = false, stageZ = null;
const stageOn = () => !!(SF && surfStep() && S.surf && S.map && S.surf.view === S.map.view && !S.compare && stageGet());
const rotated = () => Math.abs(S.rot3.yaw) > 1e-3 || Math.abs(S.rot3.pitch) > 1e-3;
function stageGet() {
  if (!stage && !stageTried) { stageTried = true; try { stage = SF.createStage(stcv); } catch (e) { console.error(e); } }
  return stage;
}
/** Row-major 3×3 rotation: pitch (about the horizontal) after yaw (about the vertical). */
function rot3(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy];
}
/** Photo → screen (affine, while the face map shows the photo unchanged), the pivot and the rotation. */
function stageFrame() {
  const s = S.surf, p0 = mapToScreen({ x: 0, y: 0 }), px = mapToScreen({ x: S.iw, y: 0 }), py = mapToScreen({ x: 0, y: S.ih });
  return {
    L: [(px.x - p0.x) / S.iw, (py.x - p0.x) / S.ih, (px.y - p0.y) / S.iw, (py.y - p0.y) / S.ih], t: [p0.x, p0.y],
    c: [s.x0 + (s.gw - 1) * s.cell / 2, s.y0 + (s.gh - 1) * s.cell / 2, s.zc * s.pxcm],
    R: rot3(S.rot3.yaw, S.rot3.pitch),
  };
}
/** A point (photo px, depth px toward the camera) on the screen. */
function proj3(F, x, y, z) {
  const dx = x - F.c[0], dy = y - F.c[1], dz = z - F.c[2], R = F.R;
  const X = R[0] * dx + R[1] * dy + R[2] * dz + F.c[0], Y = R[3] * dx + R[4] * dy + R[5] * dz + F.c[1], Z = R[6] * dx + R[7] * dy + R[8] * dz + F.c[2];
  return { x: F.L[0] * X + F.L[1] * Y + F.t[0], y: F.L[2] * X + F.L[3] * Y + F.t[1], z: Z };
}
/** The same as a column-major 4×4 clip matrix for the GPU. */
function stageMatrix(F) {
  const R = F.R, c = F.c, D = Math.max(S.iw, S.ih) * 2;
  const b = [c[0] - (R[0] * c[0] + R[1] * c[1] + R[2] * c[2]), c[1] - (R[3] * c[0] + R[4] * c[1] + R[5] * c[2]), c[2] - (R[6] * c[0] + R[7] * c[1] + R[8] * c[2])];
  const rows = [
    [F.L[0] * R[0] + F.L[1] * R[3], F.L[0] * R[1] + F.L[1] * R[4], F.L[0] * R[2] + F.L[1] * R[5], F.L[0] * b[0] + F.L[1] * b[1] + F.t[0]],
    [F.L[2] * R[0] + F.L[3] * R[3], F.L[2] * R[1] + F.L[3] * R[4], F.L[2] * R[2] + F.L[3] * R[5], F.L[2] * b[0] + F.L[3] * b[1] + F.t[1]],
    [R[6], R[7], R[8], b[2] - c[2]],
  ];
  const sx = 2 / W, sy = -2 / H, sz = -1 / D, m = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    m[col * 4] = rows[0][col] * sx + (col === 3 ? -1 : 0);
    m[col * 4 + 1] = rows[1][col] * sy + (col === 3 ? 1 : 0);
    m[col * 4 + 2] = rows[2][col] * sz;
    m[col * 4 + 3] = col === 3 ? 1 : 0;
  }
  return m;
}
/** Depth (cm) of a face-map dot: set by hand in 3D, else on the relief (face or head), else the template's. */
function dotDepth(i) {
  const m = S.map;
  if (m.zo && Number.isFinite(m.zo[i])) return m.zo[i];
  // On the drawn head every dot sits on it, each by one rule for its kind, so the dots along a line agree:
  // a dot on the face's edge at the depth of the head's own rim nearest to it, every other dot on the surface
  // where it is in the photo. (Read from mixed sources — an edge dot from a fitted vertex, its neighbour from
  // the surface — the lines zigzagged in depth; eased along the lines instead, the jaw's dots were pulled up
  // to a centimetre off the head, the jaw's depth bending away between them.)
  const G = stageZ && stageZ.key === stageKeyOf() ? stageZ : null;
  if (!G || !G.hd) return dotDepthRaw(i);
  const key = `${m.pver}|${m.zoRev || 0}`;
  if (!G.dots || G.dots.key !== key) G.dots = { key, d: FM.POINTS.map((_, q) => m.vis[q] ? dotDepthRaw(q, G) : NaN) };
  const v = G.dots.d[i];
  return Number.isFinite(v) ? v : dotDepthRaw(i);
}
function dotDepthRaw(i, Gs) {
  const m = S.map;
  if (m.zo && Number.isFinite(m.zo[i])) return m.zo[i];
  // the face's edge (cheekbones down to the chin, the temples) and the ears: where the measured head has
  // them — on the relief they'd sit anywhere on its steep side, or off the head altogether
  // (with the head in 3D: the edge at the drawn head's rim nearest the dot; the ears at their own vertices)
  const h = m.head, pt = FM.POINTS[i], G = Gs || (stageZ && stageZ.key === stageKeyOf() ? stageZ : null);
  const edgeDot = pt.group === 'outline' && !/^(tri|hl\d)/.test(pt.id);
  // (the edge's dots as the fit has them — the cheekbones down to the chin, and the detail dots between:
  // not the hairline's, whose nearest rim would be the skull's top)
  const Ci = G && G.hd && HM.correspond()[i];
  if (Ci && Ci.cand) {
    // the jaw's border as the fit has it (its candidates: the skin at the dot's height, not the jaw's
    // underside or the neck): those drawn within ≈ 3 mm of the dot and within ≈ 1 mm of the furthest out,
    // at their median depth. (Not the furthest one alone: where the head's side is flat — the cheek, the
    // ramus — skin from in front to behind sits equally far out, and the dots down the jaw zigzagged in
    // depth by a centimetre or two as each took another.)
    const P = h.P, dz = G.hd.dz, x = m.p[2 * i], y = m.p[2 * i + 1], sc = mapScale(), r2 = (.3 * sc) ** 2, n = Ci.nrm, near = [];
    let bv = -Infinity, nv = -1, nd = Infinity;
    for (const v of Ci.cand) {
      const du = P.uv[2 * v] - x, dv = P.uv[2 * v + 1] - y, d = du * du + dv * dv, out = du * n[0] + dv * n[1];
      if (d < nd) { nd = d; nv = v; }
      if (d < r2) { near.push([out, v]); bv = Math.max(bv, out); }
    }
    const zs = near.filter(([o]) => o >= bv - .1 * sc).map(([, v]) => P.z[v] + dz[v]).sort((a, b) => a - b);
    if (zs.length) return zs[zs.length >> 1];
    if (nv >= 0) return P.z[nv] + dz[nv];
  }
  if (h && h.vertOf && h.key === headKey() && h.vertOf[i] >= 0 && (pt.group === 'ears' || edgeDot)) { const v = h.vertOf[i]; return h.P.z[v] + (G && G.hd ? G.hd.dz[v] : 0); }
  if (G) {
    const fx = (m.p[2 * i] - G.x0) / G.cell, fy = (m.p[2 * i + 1] - G.y0) / G.cell;
    if (fx >= 0 && fy >= 0 && fx < G.gw - 1 && fy < G.gh - 1) {
      // (on the drawn head where it is: the relief's own depth beside the face was a wall nobody sees)
      const zd = G.hd ? bilin(G.hd.zd, G.gw, fx, fy) : NaN;
      return Number.isFinite(zd) ? zd : bilin(G.z, G.gw, fx, fy);
    }
  }
  const t = m.yaw * Math.PI / 180;
  return pt.x * Math.sin(t) + pt.z * Math.cos(t);
}
const bilin = (a, gw, fx, fy) => { const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, k = j0 * gw + i0; return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + gw] * (1 - tx) + a[k + gw + 1] * tx) * ty; };
// (the head isn't rebuilt mid-drag: the dots keep moving over the relief as it was)
const stageKeyOf = () => S.mapDrag && stageZ && stageZ.key.startsWith(surfKey() + '|') ? stageZ.key : `${surfKey()}|${S.map ? S.map.pver : 0}`;
/**
 * The head and neck as seen in a front photo, on a grid: the hair's outline over the top, down past the
 * ears and along both sides of the neck, plus the face and the ears. Null when those dots aren't there
 * (a profile) — then the dots' convex hull stands in.
 */
function headMask(m, gw, gh, x0, y0, cell) {
  if (isProfile(m)) return null;
  const ring = ['hslL', 'hseL', 'hsuL', 'htsL', 'vertex', 'htsR', 'hsuR', 'hseR', 'hslR', 'lobR', 'ntR', 'nmR', 'nbR', 'nbL', 'nmL', 'ntL', 'lobL'].map(id => FM.INDEX[id]);
  if (ring.some(i => i == null || !m.vis[i])) return null;
  const c = document.createElement('canvas'); c.width = gw; c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true }), P = i => ({ x: m.p[2 * i], y: m.p[2 * i + 1] });
  g.setTransform(1 / cell, 0, 0, 1 / cell, -x0 / cell + .5, -y0 / cell + .5); g.fillStyle = '#fff';
  const poly = (pts, smooth) => { const q = smooth ? FM.spline(pts, true, 6) : pts; g.beginPath(); q.forEach((p, k) => k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fill(); };
  poly(ring.map(P), false);
  for (const ct of m.contours) if (ct.closed && (ct.boundary || /^ear/.test(ct.id)) && !ct.idx.some(i => !m.vis[i])) poly(ct.idx.map(P), true);
  const d = g.getImageData(0, 0, gw, gh).data, out = new Float32Array(gw * gh);
  for (let k = 0; k < out.length; k++) out[k] = d[4 * k + 3] / 255;
  return out;
}
/** The same for a profile map: down the face's profile to the neck, round the neck's foot and up the nape
    and the hair's outline. Null when those dots aren't all there. */
function sideHeadMask(m, gw, gh, x0, y0, cell) {
  const b = m.contours.find(c => c.boundary), a = b && b.idx.indexOf(FM.INDEX.tri), z = b && b.idx.indexOf(FM.INDEX.cerv);
  if (!b || a < 0 || z < a) return null;
  const ring = [...b.idx.slice(a, z + 1), ...['thy', 'neckF', 'neckB', 'nape', 'hairBack', 'occiput', 'vertex', 'hairFront'].map(id => FM.INDEX[id])];
  if (ring.some(i => i == null || !m.vis[i])) return null;
  const c = document.createElement('canvas'); c.width = gw; c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(1 / cell, 0, 0, 1 / cell, -x0 / cell + .5, -y0 / cell + .5); g.fillStyle = '#fff';
  g.beginPath(); ring.forEach((i, k) => k ? g.lineTo(m.p[2 * i], m.p[2 * i + 1]) : g.moveTo(m.p[2 * i], m.p[2 * i + 1])); g.closePath(); g.fill();
  const d = g.getImageData(0, 0, gw, gh).data, out = new Float32Array(gw * gh);
  for (let k = 0; k < out.length; k++) out[k] = d[4 * k + 3] / 255;
  return out;
}
/** Convex hull (Andrew's monotone chain) of [x, y] points, counter-clockwise. */
function convexHull(P) {
  const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/**
 * The 3D view's relief over the whole head: the face's surface in front; around it the head — hair,
 * ears and neck at their template depth, read through the face map's own dots — and the background
 * behind it all. Where the face's edge and the head disagree in depth, the difference is carried out
 * from the face's edge and fades with distance (a screened membrane: smooth, with no ripple and no
 * overshoot), so the forehead runs on into the scalp and the cheeks turn back toward the ears with no
 * step or ledge — the face doesn't sit on the head like a mask. It fades over ≈ 1.4 cm, but under the
 * chin and jaw over ≈ 4.5 mm: the jaw's underside, hidden in a front photo, turns back to the neck
 * quickly, so the neck hangs below the jaw instead of sloping out of the chin.
 */
function stageDepth() {
  const s = S.surf, m = S.map, key = stageKeyOf();
  if (stageZ && stageZ.key === key) return stageZ;
  const zs = surfZ(s), yaw = m.yaw * Math.PI / 180, ct = Math.cos(yaw), st = Math.sin(yaw), sc = s.pxcm;
  // the head's outline (all the dots) and the head's depth from the dots around the face
  const all = [], sx = [], sy = [], sv = [];
  FM.POINTS.forEach((pt, i) => {
    if (!m.vis[i]) return;
    const x = m.p[2 * i], y = m.p[2 * i + 1];
    all.push([x, y]);
    // the back layer (hair, ears, neck) and the hairline / temples, where the forehead runs on into the scalp
    if (pt.field === 'back' || /^(tri|hl|tem)/.test(pt.id)) { sx.push(x); sy.push(y); sv.push(pt.x * st + pt.z * ct); }
  });
  const hull = convexHull(all);
  let bx0 = s.x0, by0 = s.y0, bx1 = s.x0 + (s.gw - 1) * s.cell, by1 = s.y0 + (s.gh - 1) * s.cell;
  for (const [x, y] of hull) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  const mg = .04 * Math.max(bx1 - bx0, by1 - by0);
  bx0 = Math.max(0, bx0 - mg); by0 = Math.max(0, by0 - mg); bx1 = Math.min(S.iw, bx1 + mg); by1 = Math.min(S.ih, by1 + mg);
  const cell = Math.max(s.cell, Math.max(bx1 - bx0, by1 - by0) / 420), gw = Math.ceil((bx1 - bx0) / cell) + 1, gh = Math.ceil((by1 - by0) / cell) + 1, n = gw * gh, h = cell / sc;
  // inside the head: over the hair, down past the ears and along the sides of the neck (a convex hull
  // also took in the background beside the neck, which hung below the jaw like extra necks), feathered
  const head = headMask(m, gw, gh, bx0, by0, cell) || (() => {
    const inHull = (x, y) => { for (let q = 0; q < hull.length; q++) { const a = hull[q], b = hull[(q + 1) % hull.length]; if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return 0; } return 1; };
    const a = new Float32Array(n);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) a[j * gw + i] = hull.length > 2 ? inHull(bx0 + i * cell, by0 + j * cell) : 0;
    return a;
  })();
  const hm = SF.blur(head, gw, gh, Math.max(1, Math.round(.3 / h)), null, 2);
  // the face's depth on the photo (null where its surface isn't), and the same smoothed: near its edge
  // the grid's staircase (a cell in or out where the cheek falls steeply) would run out as stripes
  const { gw: fw, gh: fh, act } = s, zsB = SF.blur(zs, fw, fh, Math.max(1, Math.round(.25 / s.h)), Float32Array.from(act), 2);
  const headFace = !!(m.head && m.head.key === headKey() && s.head);
  // the measured head on this grid (its skin, the front-most) and how squarely it faces the camera
  const R = headFace ? HM.raster(m.head.P, { x0: bx0, y0: by0, cell, gw, gh }, 'skin') : null, nzR = R && facing(R, gw, gh, h);
  // (where the face is: its grid's mask read smoothly, not as the grid's staircase; near the edge the
  // smoothed depth, which reaches a little past the last node)
  const actF = Float32Array.from(act);
  const faceAt = (x, y, a = zs) => {
    const fx = (x - s.x0) / s.cell, fy = (y - s.y0) / s.cell, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= fw - 1 || j >= fh - 1) return null;
    const k = j * fw + i;
    if (a === zsB) return bilin(actF, fw, fx, fy) >= .5 ? bilin(a, fw, fx, fy) : null;
    return act[k] && act[k + 1] && act[k + fw] && act[k + fw + 1] ? bilin(a, fw, fx, fy) : null;
  };
  // the head on a coarse grid: a smooth spline through those dots …
  const T = sx.length >= 3 ? scalarFit(sx, sy, sv, Math.max(S.iw, S.ih)) : null, F = 3, cw = Math.ceil(gw / F) + 1, ch = Math.ceil(gh / F) + 1, nc = cw * ch, hc = F * h;
  let zb = 0;
  for (const v of sv) zb = Math.min(zb, v);
  // (behind the measured head too, when it's drawn: its back went through the photo behind it)
  if (headFace) for (let v = 0; v < HM.model.nSkin; v++) zb = Math.min(zb, m.head.P.z[v]);
  zb -= .5;
  const H0 = new Float32Array(nc), C = new Float32Array(nc), fix = new Uint8Array(nc), od = new Float32Array(nc).fill(1e9), oy = new Float32Array(nc);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) H0[j * cw + i] = T ? scalarAt(T, bx0 + i * F * cell, by0 + j * F * cell) : zb;
  // … where the measured head covers the photo (scalp, temples, ears) and faces the camera, it's that
  // head: held like the face's own nodes, so it too carries on smoothly into the hair's outline beyond
  // it (not where it turns away at its own edge: held there, the edge made a crease). Not below the
  // jaw: the model's neck is fixed in one posture, and on real photos it stood out under the chin.
  const hd = headDepth({ x0: bx0, y0: by0, cell: F * cell, gw: cw, gh: ch }, { noNeck: true });
  const steep = k => { const i = k % cw, j = (k / cw) | 0; if (i < 1 || j < 1 || i >= cw - 1 || j >= ch - 1) return true; const a = hd[k - 1], b = hd[k + 1], c = hd[k - cw], d = hd[k + cw]; return ![a, b, c, d].every(Number.isFinite) || Math.hypot(b - a, d - c) / (2 * hc) > 1.2; };
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const k = j * cw + i, x = bx0 + i * F * cell, y = by0 + j * F * cell, zf = (headFace ? faceAt(x, y) : null) ?? faceAt(x, y, zsB);
    if (zf != null) { fix[k] = 1; C[k] = zf - H0[k]; od[k] = 0; oy[k] = y; }
    else if (hd && Number.isFinite(hd[k]) && head[Math.min(n - 1, j * F * gw + i * F)] > .5 && !steep(k)) { fix[k] = 1; C[k] = hd[k] - H0[k]; }
  }
  // … how far each node is from the face, and how low on the face its nearest edge is …
  const rel = (k, q, w) => { if (od[q] + w < od[k]) { od[k] = od[q] + w; oy[k] = oy[q]; } };
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) { const k = j * cw + i; if (i > 0) rel(k, k - 1, 1); if (j > 0) { rel(k, k - cw, 1); if (i > 0) rel(k, k - cw - 1, 1.414); if (i < cw - 1) rel(k, k - cw + 1, 1.414); } }
  for (let j = ch - 1; j >= 0; j--) for (let i = cw - 1; i >= 0; i--) { const k = j * cw + i; if (i < cw - 1) rel(k, k + 1, 1); if (j < ch - 1) { rel(k, k + cw, 1); if (i < cw - 1) rel(k, k + cw + 1, 1.414); if (i > 0) rel(k, k + cw - 1, 1.414); } }
  const pY = id => { const i = FM.INDEX[id]; return i != null && m.vis[i] ? m.p[2 * i + 1] : null; };
  const yMouth = pY('sto'), yChin = pY('me'), jaw = !isProfile(m) && yMouth != null && yChin != null && yChin > yMouth;
  // … and the face's edge carried out into the head: c = (∑ neighbours) / (4 + (cell / reach)²), the
  // reach shorter under the jaw (SOR, coarse grid; the face's own nodes hold the edge)
  const scr = new Float32Array(nc);
  for (let k = 0; k < nc; k++) { const low = jaw ? smooth01(yMouth, yMouth + .6 * (yChin - yMouth), oy[k]) : 0, L = 1.4 - .95 * low; scr[k] = (hc / L) ** 2; }
  for (let it = 0; it < 220; it++) for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const k = j * cw + i;
    if (fix[k]) continue;
    let sum = 0, cnt = 0;
    if (i > 0) { sum += C[k - 1]; cnt++; } if (i < cw - 1) { sum += C[k + 1]; cnt++; }
    if (j > 0) { sum += C[k - cw]; cnt++; } if (j < ch - 1) { sum += C[k + cw]; cnt++; }
    C[k] += 1.7 * (sum / (cnt + scr[k]) - C[k]);
  }
  // the relief: the head (and the carried-out edge) inside the head's outline, the background outside;
  // the face itself over its surface, turning into the head over its first ≈ 5 mm
  const di = new Float32Array(n).fill(1e9);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (faceAt(bx0 + i * cell, by0 + j * cell, zsB) == null) di[j * gw + i] = 0;
  const relI = (k, q, w) => { if (di[q] + w < di[k]) di[k] = di[q] + w; };
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const k = j * gw + i; if (i > 0) relI(k, k - 1, 1); if (j > 0) { relI(k, k - gw, 1); if (i > 0) relI(k, k - gw - 1, 1.414); if (i < gw - 1) relI(k, k - gw + 1, 1.414); } }
  for (let j = gh - 1; j >= 0; j--) for (let i = gw - 1; i >= 0; i--) { const k = j * gw + i; if (i < gw - 1) relI(k, k + 1, 1); if (j < gh - 1) { relI(k, k + gw, 1); if (i < gw - 1) relI(k, k + gw + 1, 1.414); if (i > 0) relI(k, k + gw - 1, 1.414); } }
  const shell = new Float32Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i, fx = Math.min(cw - 1.001, i / F), fy = Math.min(ch - 1.001, j / F);
    shell[k] = zb + (Math.max(zb, bilin(H0, cw, fx, fy) + bilin(C, cw, fx, fy)) - zb) * Math.max(hm[k], di[k] ? 1 : 0);
  }
  // (smoothed at full resolution: the coarse grid's cells otherwise show as facets in the shading)
  const shellS = SF.blur(shell, gw, gh, Math.max(1, Math.round(.22 / h)), null, 3);
  const Z = new Float32Array(n), face = new Float32Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    if (!di[k]) { Z[k] = shellS[k]; continue; }
    const x = bx0 + i * cell, y = by0 + j * cell, d = di[k] * h, zB = faceAt(x, y, zsB);
    let zr = faceAt(x, y) ?? zB;
    // On the measured head the face keeps its own depth right to its edge (≈ 1.2 mm of blending): at the
    // outline the real surface turns away steeply — the jaw, the chin's underside, the cheek's side — and
    // smoothing it there, or blending in the head behind over 5 mm, set the chin back and put a wall at
    // the jaw's angle. (On the template, the edge is read smoothed: its grid's staircase made stripes.)
    // Where it turns away (within 1.5 cm of the edge) it is the head's: a photo's light says little about
    // a surface it sees edge-on, and the head is fitted to the outline (and, mapped, the side photo).
    if (R && d < 1.5 && Number.isFinite(R[k])) zr += (R[k] - zr) * (1 - smooth01(.35, .75, nzR[k])) * (1 - smooth01(.8, 1.5, d));
    // (with the head's mesh carrying on past the face's edge, the face just ends there: turned toward the
    // shell behind over its last mm, it left a ledge along the seam)
    const w = R ? 1 : smooth01(0, headFace ? .12 : .5, d);
    face[k] = w;
    Z[k] = shellS[k] + ((headFace ? zr : zB + (zr - zB) * smooth01(.2, .7, d)) - shellS[k]) * w;
  }
  // and the seam itself softened a little more
  const sm = SF.blur(Z, gw, gh, Math.max(1, Math.round(.12 / h)), null, 2);
  for (let k = 0; k < n; k++) { const b = face[k] > 0 && face[k] < 1 ? 1 - Math.abs(2 * face[k] - 1) : 0; if (b) Z[k] += (sm[k] - Z[k]) * b; }
  stageZ = { key, z: Z, gw, gh, x0: bx0, y0: by0, cell, h, face, zb };
  if (R) stageZ.hd = headOnStage(stageZ, R, nzR, di);
  return stageZ;
}
/** How squarely a depth grid (cm, nodes h cm apart) faces the camera at each node: its normal's depth
    part, 1 face on, 0 edge on (and 0 at its own edge). */
function facing(R, gw, gh, h) {
  const out = new Float32Array(gw * gh);
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    const k = j * gw + i, a = R[k - 1], b = R[k + 1], c = R[k - gw], d = R[k + gw];
    out[k] = Number.isFinite(a + b + c + d + R[k]) ? 1 / Math.hypot(1, (b - a) / (2 * h), (d - c) / (2 * h)) : 0;
  }
  return out;
}
/**
 * The 3D head with the measured head: the head's own mesh, all of it — face, jaw, ears, skull, neck — with
 * the face's surface laid onto it. Each vertex the front photo sees on the face moves in depth onto the
 * relief (the surface the anatomy fit, the side photo and your depth drags built); the rest of the head
 * follows that shift, fading over ≈ 2 cm across it (screened), so further back it keeps its own shape.
 * (Build 32 drew the relief and put the head's mesh only around it: where the two met there were seams,
 * ledges, a flap under the chin and staircase edges.) Returns dz (cm per vertex), cutY (the neck ends
 * at its foot in the photo) and zd (the drawn head's front-most depth on this grid, for the dots).
 */
function headOnStage(G, R, nzR, di) {
  const h = S.map.head, m = S.map, M = HM.model, N = M.N, nS = M.nSkin, P = h.P, X = h.res.X, { gw, gh, cell, x0, y0, z: Z } = G, T = HM.topology();
  // (only where the photo sees the skin squarely enough: at a grazing angle the relief's depth is its edge's,
  // and pinned there the chin's lower rim stepped back from the rest — a notch under the chin)
  const nrm = HM.normals(X), r2 = h.res.poses[0].R[2];
  const dz = new Float32Array(N), fixed = new Uint8Array(nS);
  for (let v = 0; v < nS; v++) {
    const fx = (P.uv[2 * v] - x0) / cell, fy = (P.uv[2 * v + 1] - y0) / cell;
    if (fx < 0 || fy < 0 || fx >= gw - 1 || fy >= gh - 1) continue;
    const kn = Math.round(fy) * gw + Math.round(fx), Rv = R[kn], nz = -(r2[0] * nrm[3 * v] + r2[1] * nrm[3 * v + 1] + r2[2] * nrm[3 * v + 2]);
    if (Number.isFinite(Rv) && P.z[v] >= Rv - .25 && di[kn] > 0 && nz > .35) { fixed[v] = 1; dz[v] = bilin(Z, gw, fx, fy) - P.z[v]; }
  }
  for (let it = 0; it < 200; it++) for (let v = 0; v < nS; v++) {
    if (fixed[v]) continue;
    const a = T.off[v], b = T.off[v + 1];
    if (b === a) continue;
    let s = 0;
    for (let q = a; q < b; q++) s += dz[T.nb[q]];
    dz[v] += 1.6 * (s / ((b - a) * (1 + (T.len[v] / 2) ** 2 / 4)) - dz[v]);
  }
  // … then the shift itself smoothed over ≈ 6 mm: the relief is built from the face map's lines and carries
  // their creases (sharp nose edges, a ridge along each line); the head has the skin's own fine shape, and
  // takes from the relief only what's broader — the profile, the anatomy, your depth drags
  const tmp = new Float32Array(nS);
  for (let it = 0; it < 12; it++) {
    for (let v = 0; v < nS; v++) {
      const a = T.off[v], b = T.off[v + 1];
      let s = 0;
      for (let q = a; q < b; q++) s += dz[T.nb[q]];
      tmp[v] = b > a ? .5 * dz[v] + .5 * s / (b - a) : dz[v];
    }
    dz.set(tmp);
  }
  // With the side photo the head's shape is measured — its profile down the midline, its jaw line — and the
  // relief, read from the front photo's light, only adds the skin's finer shape: nothing on the midline,
  // at most ≈ 3 mm beside it; in full only round a depth you set by hand (dragged in 3D)
  if (h.side) {
    const pins = [];
    if (m.zo) FM.POINTS.forEach((_, i) => { const v = h.vertOf[i]; if (Number.isFinite(m.zo[i]) && v >= 0) pins.push(X[3 * v], X[3 * v + 1], X[3 * v + 2]); });
    for (let v = 0; v < nS; v++) {
      let pin = 0;
      for (let q = 0; q < pins.length; q += 3) pin = Math.max(pin, Math.exp(-((X[3 * v] - pins[q]) ** 2 + (X[3 * v + 1] - pins[q + 1]) ** 2 + (X[3 * v + 2] - pins[q + 2]) ** 2) / 2));
      dz[v] = pin * dz[v] + (1 - pin) * smooth01(1, 2.5, Math.abs(X[3 * v])) * clamp(dz[v], -.3, .3);
    }
  }
  // the eyeballs move with the lids around them
  for (const sg of [-1, 1]) {
    const c = [0, 0, 0];
    let ne = 0, s = 0, ns = 0;
    for (let v = nS; v < N; v++) if (Math.sign(X[3 * v]) === sg) { c[0] += X[3 * v]; c[1] += X[3 * v + 1]; c[2] += X[3 * v + 2]; ne++; }
    if (!ne) continue;
    for (let q = 0; q < 3; q++) c[q] /= ne;
    for (let v = 0; v < nS; v++) if (fixed[v] && (X[3 * v] - c[0]) ** 2 + (X[3 * v + 1] - c[1]) ** 2 + (X[3 * v + 2] - c[2]) ** 2 < 4) { s += dz[v]; ns++; }
    for (let v = nS; v < N; v++) if (Math.sign(X[3 * v]) === sg) dz[v] = ns ? s / ns : 0;
  }
  // the neck ends at its foot in the photo (else ≈ two thirds of a face's height below the chin): the
  // model's neck flares into the shoulders, which were painted with the collar
  const yOf = id => { const i = FM.INDEX[id]; return i != null && m.vis[i] ? m.p[2 * i + 1] : null; };
  const feet = ['nbL', 'nbR'].map(yOf).filter(y => y != null), yMe = yOf('me'), yN = yOf('n');
  const yCut = feet.length ? Math.max(...feet) : yMe != null && yN != null ? yMe + .65 * (yMe - yN) : Infinity;
  // (cut along the model's own height, which its neck's rings of vertices follow: cut at a height on the
  // photo, the mesh's edge was a saw-tooth)
  const neck = HM.correspond().neck;
  let sy = 0, sn = 0;
  for (let v = 0; v < nS; v++) if (neck[v] && Math.abs(P.uv[2 * v + 1] - yCut) < .5 * P.s) { sy += X[3 * v + 1]; sn++; }
  const cutY = sn ? sy / sn : -Infinity;
  const zd = HM.raster({ uv: P.uv, z: P.z.map((z, v) => z + dz[v]), s: P.s }, { x0, y0, cell, gw, gh }, 'all', { smooth: 0 });
  return { dz, cutY, zd };
}
/** The measured head's mesh for the 3D view (headOnStage), coloured as headSkin has it, and the photo behind. */
function headMesh(G) {
  const s = S.surf, h = S.map.head, HMm = HM.model, N = HMm.N, P = h.P, { dz, cutY } = G.hd, k2 = s.pxcm, sk = headSkin(h), neck = HM.correspond().neck, nv = N + 4;
  const pos = new Float32Array(3 * nv), nrm = new Float32Array(3 * nv), uv = new Float32Array(2 * nv), ov = new Float32Array(2 * nv), uv2 = new Float32Array(2 * nv), w = new Float32Array(3 * nv), col = new Float32Array(3 * nv), fs = new Float32Array(nv);
  for (let v = 0; v < N; v++) {
    const x = P.uv[2 * v], y = P.uv[2 * v + 1], u = ((x - s.x0) / s.cell + .5) / s.gw, q = ((y - s.y0) / s.cell + .5) / s.gh;
    pos.set([x, y, (P.z[v] + dz[v]) * k2], 3 * v); uv.set([x / S.iw, y / S.ih], 2 * v);
    ov.set(u >= 0 && q >= 0 && u <= 1 && q <= 1 ? [u, q] : [-1, -1], 2 * v);
    uv2.set([sk.uv2[2 * v], sk.uv2[2 * v + 1]], 2 * v); w.set([sk.w[3 * v], sk.w[3 * v + 1], sk.w[3 * v + 2]], 3 * v); col.set([sk.col[3 * v], sk.col[3 * v + 1], sk.col[3 * v + 2]], 3 * v); fs[v] = sk.fs[v];
  }
  const X = h.res.X, cut = v => neck[v] && X[3 * v + 1] < cutY, tri = [], lines = [], Tp = HM.topology(), edge = new Uint8Array(N);
  // (the vertices just below the cut slide up their edge to the cut's height, so the neck ends in a clean
  // line, not the triangles' teeth)
  for (let v = 0; v < HMm.nSkin; v++) {
    if (!cut(v)) continue;
    let best = -1;
    for (let q = Tp.off[v]; q < Tp.off[v + 1]; q++) { const u = Tp.nb[q]; if (!cut(u) && (best < 0 || X[3 * u + 1] > X[3 * best + 1])) best = u; }
    if (best < 0) continue;
    const t = clamp((cutY - X[3 * best + 1]) / ((X[3 * v + 1] - X[3 * best + 1]) || -1e-6), 0, 1);
    for (let k = 0; k < 3; k++) pos[3 * v + k] = pos[3 * best + k] + (pos[3 * v + k] - pos[3 * best + k]) * t;
    uv.set([pos[3 * v] / S.iw, pos[3 * v + 1] / S.ih], 2 * v);
    edge[v] = 1;
  }
  for (let t = 0; t < HMm.nTri; t++) {
    const a = HMm.tri[3 * t], b = HMm.tri[3 * t + 1], c = HMm.tri[3 * t + 2];
    if ((cut(a) && !edge[a]) || (cut(b) && !edge[b]) || (cut(c) && !edge[c]) || (cut(a) && cut(b) && cut(c))) continue;
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2], vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[3 * v] += nx; nrm[3 * v + 1] += ny; nrm[3 * v + 2] += nz; }
    tri.push(a, b, c);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) if (p < q) lines.push(p, q);
  }
  // (pointing out of the head — the front-most vertex, the nose tip, faces the camera — so the shading
  // needn't light both sides of every triangle: lit from both, the ear's rim showed a bright second edge)
  let top = 0;
  for (let v = 1; v < HMm.nSkin; v++) if (pos[3 * v + 2] > pos[3 * top + 2]) top = v;
  const sg = nrm[3 * top + 2] < 0 ? -1 : 1;
  for (let v = 0; v < N; v++) {
    const L = sg / (Math.hypot(nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]) || 1); nrm[3 * v] *= L; nrm[3 * v + 1] *= L; nrm[3 * v + 2] *= L;
    // (the analysis views only where the head faces the camera: on its sides they smeared into stripes)
    if (Math.abs(nrm[3 * v + 2]) < .55 || !fs[v]) ov.set([-1, -1], 2 * v);
  }
  // the rest of the photo: a flat plane behind the head
  const zb = (G.zb - .05) * k2;
  [[0, 0], [S.iw, 0], [S.iw, S.ih], [0, S.ih]].forEach(([x, y], q) => {
    const v = N + q;
    pos.set([x, y, zb], 3 * v); nrm.set([0, 0, 1], 3 * v); uv.set([x / S.iw, y / S.ih], 2 * v); ov.set([-1, -1], 2 * v); w[3 * v] = 1; fs[v] = 1;
  });
  tri.push(N, N + 3, N + 1, N + 1, N + 3, N + 2);
  return { pos, nrm, uv, ov, uv2, w, col, fs, tri: Uint32Array.from(tri), lines: Uint32Array.from(lines) };
}
function stageMesh() {
  const s = S.surf, G = stageDepth(), { gw, gh, cell, x0, y0, h, z: Z, face } = G, n = gw * gh, k2 = s.pxcm;
  if (G.hd) return headMesh(G);
  const pos = new Float32Array(3 * (n + 4)), nrm = new Float32Array(3 * (n + 4)), uv = new Float32Array(2 * (n + 4)), ovc = new Float32Array(2 * (n + 4));
  const all = new Uint8Array(n).fill(1), g = SF.gradient(Z, gw, gh, h, all);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i, x = x0 + i * cell, y = y0 + j * cell, N = Math.sqrt(1 + g.gx[k] ** 2 + g.gy[k] ** 2);
    pos.set([x, y, Z[k] * k2], 3 * k); nrm.set([-g.gx[k] / N, -g.gy[k] / N, 1 / N], 3 * k);
    uv.set([x / S.iw, y / S.ih], 2 * k);
    // the analysis views are drawn over the surface's own box
    const u = ((x - s.x0) / s.cell + .5) / s.gw, v = ((y - s.y0) / s.cell + .5) / s.gh;
    ovc.set(u >= 0 && v >= 0 && u <= 1 && v <= 1 ? [u, v] : [-1, -1], 2 * k);
  }
  // the rest of the photo: a flat plane just behind the head
  const zb = (G.zb - .05) * k2;
  [[0, 0], [S.iw, 0], [S.iw, S.ih], [0, S.ih]].forEach(([x, y], q) => {
    const v = n + q;
    pos.set([x, y, zb], 3 * v); nrm.set([0, 0, 1], 3 * v); uv.set([x / S.iw, y / S.ih], 2 * v); ovc.set([-1, -1], 2 * v);
  });
  const tri = [], lines = [], every = Math.max(2, Math.round(.4 / h));
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
    tri.push(a, c, b, b, c, d);
    if (j % every === 0 && face[a] > .97 && face[b] > .97) lines.push(a, b);
    if (i % every === 0 && face[a] > .97 && face[c] > .97) lines.push(a, c);
  }
  tri.push(n, n + 3, n + 1, n + 1, n + 3, n + 2);
  return { pos, nrm, uv, ov: ovc, tri: Uint32Array.from(tri), lines: Uint32Array.from(lines) };
}
/** A photo's pixels, at most ≈ 1024 px across (cached per photo). */
const photoPx = new WeakMap();
function photoPixels(img, iw, ih) {
  if (photoPx.has(img)) return photoPx.get(img);
  const sc = Math.min(1, 1024 / Math.max(iw, ih)), w = Math.max(1, Math.round(iw * sc)), hh = Math.max(1, Math.round(ih * sc)), c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, hh);
  const o = { d: g.getImageData(0, 0, w, hh).data, w, h: hh, sc };
  photoPx.set(img, o);
  return o;
}
/**
 * How the head is coloured, per skin vertex: w, how much of the front photo, the side photo and a colour of
 * its own (col, 0…1); uv2, where it is on the side photo (0…1). The front photo where it sees the vertex
 * squarely enough; else the side photo where that sees it (for the far side of the head, its mirror
 * image's); and where neither does — the back of the head, under the chin — the colours around, carried
 * in across the head. gain: the side photo's colour matched to the front's on the skin both see.
 */
function headSkin(h) {
  const sd = h.side ? slots.side : null, key = `${S.imgSeq}|${sd ? sd.imgSeq : '-'}`;
  if (h.skin && h.skin.key === key) return h.skin;
  const nS = HM.model.nSkin, T = HM.topology(), nrm = HM.normals(h.res.X);
  // which vertices a view sees (in front, on a ≈ 2 mm grid) and how squarely (0 where it doesn't)
  const seen = (Q, pose) => {
    let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
    for (let v = 0; v < nS; v++) { const x = Q.uv[2 * v], y = Q.uv[2 * v + 1]; ux0 = Math.min(ux0, x); uy0 = Math.min(uy0, y); ux1 = Math.max(ux1, x); uy1 = Math.max(uy1, y); }
    const cell = Math.max(.5, .2 * Q.s), x0 = ux0 - cell, y0 = uy0 - cell, gw = Math.ceil((ux1 - x0) / cell) + 2, gh = Math.ceil((uy1 - y0) / cell) + 2;
    const Rz = HM.raster(Q, { x0, y0, cell, gw, gh }, 'skin', { smooth: 0 }), out = new Float32Array(nS), r = pose.R[2];
    out.vis = new Uint8Array(nS);
    for (let v = 0; v < nS; v++) {
      const k = Math.round((Q.uv[2 * v + 1] - y0) / cell) * gw + Math.round((Q.uv[2 * v] - x0) / cell), f = -(r[0] * nrm[3 * v] + r[1] * nrm[3 * v + 1] + r[2] * nrm[3 * v + 2]);
      out.vis[v] = Number.isFinite(Rz[k]) && Q.z[v] >= Rz[k] - .3 ? 1 : 0;
      out[v] = out.vis[v] && f > 0 ? f : 0;
    }
    return out;
  };
  const P = h.P, fF = seen(P, h.res.poses[0]), front = photoPixels(S.img, S.iw, S.ih);
  // (the front photo only inside the head's outline on it — hair, ears, the neck's sides: where the
  // model's head is wider than this one, its pixel there is the background — fading out over the last
  // ≈ 4 mm inside the outline, not stepping from grid cell to grid cell, which drew a zigzag on the scalp)
  // (… and the side photo inside its own: in front of the throat, its pixel was the background)
  const inside = (m, iw, ih, prof, Q, f, pxcm) => {
    const mc = Math.max(iw, ih) / 400, mw = Math.ceil(iw / mc) + 1, mh = Math.ceil(ih / mc) + 1, hm = (prof ? sideHeadMask : headMask)(m, mw, mh, 0, 0, mc);
    if (!hm) return;
    const hb = SF.blur(hm, mw, mh, Math.max(1, Math.round(.35 * pxcm / mc)), null, 2);
    for (let v = 0; v < nS; v++) {
      const fx = clamp(Q.uv[2 * v] / mc, 0, mw - 1.001), fy = clamp(Q.uv[2 * v + 1] / mc, 0, mh - 1.001);
      f[v] *= smooth01(.55, .95, bilin(hb, mw, fx, fy));
    }
  };
  inside(S.map, S.iw, S.ih, false, P, fF, mapFrame().scale);
  const px = (I, x, y) => { const i = Math.min(I.w - 1, Math.max(0, Math.round(x * I.sc))), j = Math.min(I.h - 1, Math.max(0, Math.round(y * I.sc))), o = 4 * (j * I.w + i); return [I.d[o] / 255, I.d[o + 1] / 255, I.d[o + 2] / 255]; };
  const N = HM.model.N, uv2 = new Float32Array(N * 2), w = new Float32Array(N * 3), col = new Float32Array(N * 3), fS = new Float32Array(nS), src = new Int32Array(nS).fill(-1);
  let side = null, gain = [1, 1, 1];
  if (sd && sd.img) {
    // (where the head is on the side photo: bent through all of its map's dots — the ears too — so its
    // colours land where the head has those features; bent only through the eyes, nose and lips, the
    // side photo's ear was painted on the skull beside the model's ear)
    const Ps = HM.project(h.res, 1, 'traL', { all: true }), s1 = seen(Ps, h.res.poses[1]);
    inside(sd.map, sd.iw, sd.ih, true, Ps, s1, h.res.poses[1].s);
    side = photoPixels(sd.img, sd.iw, sd.ih);
    for (let v = 0; v < nS; v++) { const u = s1[v] > 0 ? v : s1[T.mir[v]] > 0 ? T.mir[v] : -1; if (u < 0) continue; src[v] = u; fS[v] = s1[u]; uv2[2 * v] = Ps.uv[2 * u] / sd.iw; uv2[2 * v + 1] = Ps.uv[2 * u + 1] / sd.ih; }
    // (the side photo's light and white balance matched to the front's on the skin both see well)
    const a = [0, 0, 0], b = [0, 0, 0];
    let cnt = 0;
    for (let v = 0; v < nS; v++) if (fF[v] > .6 && src[v] === v && fS[v] > .6) { const p = px(front, P.uv[2 * v], P.uv[2 * v + 1]), q = px(side, uv2[2 * v] * sd.iw, uv2[2 * v + 1] * sd.ih); for (let c = 0; c < 3; c++) { a[c] += p[c]; b[c] += q[c]; } cnt++; }
    if (cnt > 20) gain = a.map((x, c) => clamp(x / Math.max(1e-3, b[c]), .6, 1.6));
  }
  // the weights, and the colour each vertex has where a photo sees it
  const known = new Uint8Array(nS), mean = [0, 0, 0];
  let nk = 0;
  for (let v = 0; v < nS; v++) {
    // (with a side photo, the front one only where it sees the skin fairly squarely: at a grazing angle its
    // pixel is stretched over the head's side — beside the ear, the photo's ear painted on the skull)
    const wf = side ? smooth01(.3, .6, fF[v]) : smooth01(.12, .45, fF[v]), sa = side ? smooth01(.05, .3, fS[v]) : 0;
    w[3 * v] = wf; w[3 * v + 1] = (1 - wf) * sa; w[3 * v + 2] = (1 - wf) * (1 - sa);
    // (the colours carried in come from skin a photo sees squarely: near its edge the photo's pixel may
    // be the background beside the head)
    if (!(fF[v] > .45 || (side && fS[v] > .45))) continue;
    const p = fF[v] > .12 ? px(front, P.uv[2 * v], P.uv[2 * v + 1]) : [0, 0, 0], q = side && fS[v] > .05 ? px(side, uv2[2 * v] * sd.iw, uv2[2 * v + 1] * sd.ih).map((x, c) => x * gain[c]) : [0, 0, 0], ws = w[3 * v + 1], tw = wf + ws;
    for (let c = 0; c < 3; c++) { col[3 * v + c] = (p[c] * wf + q[c] * ws) / tw; mean[c] += col[3 * v + c]; }
    known[v] = 1; nk++;
  }
  // … carried in where neither photo sees it (smoothly: a Laplace fill across the head)
  for (let v = 0; v < nS; v++) if (!known[v]) for (let c = 0; c < 3; c++) col[3 * v + c] = nk ? mean[c] / nk : .6;
  for (let it = 0; it < 300; it++) for (let v = 0; v < nS; v++) {
    if (known[v]) continue;
    const a = T.off[v], b = T.off[v + 1];
    if (b === a) continue;
    for (let c = 0; c < 3; c++) { let s = 0; for (let q = a; q < b; q++) s += col[3 * T.nb[q] + c]; col[3 * v + c] += 1.7 * (s / (b - a) - col[3 * v + c]); }
  }
  // (the eyeballs: the front photo; facing you, everything the front photo sees is the photo itself)
  const fs = new Uint8Array(N);
  fs.set(fF.vis);
  for (let v = nS; v < N; v++) { w[3 * v] = 1; fs[v] = 1; }
  h.skin = { key, uv2, w, col, gain, side: !!side, fs };
  return h.skin;
}
/** The chosen view as a texture over the relief (contour lines rasterised). */
function stageOverlay() {
  if (cfg.surfView === 'photo') return null;
  const o = surfOverlay(), s = S.surf;
  let src = o.canvas || null;
  if (o.lines) {
    const up = 4, c = document.createElement('canvas');
    c.width = s.gw * up; c.height = s.gh * up;
    const g = c.getContext('2d'), L = o.lines;
    g.lineCap = 'round';
    for (const major of [0, 1]) {
      g.beginPath();
      for (let q = 0; q < L.major.length; q++) {
        if (L.major[q] !== major) continue;
        g.moveTo((L.segs[4 * q] + .5) * up, (L.segs[4 * q + 1] + .5) * up); g.lineTo((L.segs[4 * q + 2] + .5) * up, (L.segs[4 * q + 3] + .5) * up);
      }
      g.strokeStyle = major ? 'rgba(255,236,170,1)' : 'rgba(150,215,255,.9)'; g.lineWidth = major ? 2.4 : 1.4; g.stroke();
    }
    src = c;
  }
  if (!src) return null;
  // kept a little inside the face's edge: on the steep side of the head it would smear into streaks
  const { gw, gh, act } = s, ins = SF.blur(Float32Array.from(act), gw, gh, 2, null, 1), mk = document.createElement('canvas');
  mk.width = gw; mk.height = gh;
  const mg = mk.getContext('2d'), md = mg.createImageData(gw, gh);
  for (let k = 0; k < gw * gh; k++) md.data[4 * k + 3] = ins[k] > .97 ? 255 : 0;
  mg.putImageData(md, 0, 0);
  const out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
  const og = out.getContext('2d');
  og.drawImage(src, 0, 0); og.globalCompositeOperation = 'destination-in'; og.imageSmoothingEnabled = true; og.drawImage(mk, 0, 0, out.width, out.height);
  return out;
}
/** Draw the stage when it's on (the flat photo canvases step aside). */
function drawStage() {
  const on = stageOn();
  if (on !== stageShown) {
    stageShown = on; stageKey = '';
    stcv.style.display = on ? '' : 'none';
    (GLR ? glcv : imgcv).style.visibility = on ? 'hidden' : '';
    if (!on) imgKey = '';
  }
  if (!on) return;
  if (stagePhoto !== S.imgRec) {
    const mx = Math.min(4096, stage.maxTex), sc = Math.min(1, mx / Math.max(S.iw, S.ih)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(S.iw * sc)); c.height = Math.max(1, Math.round(S.ih * sc));
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(S.img, 0, 0, c.width, c.height);
    stage.setPhoto(c); stagePhoto = S.imgRec; stageKey = '';
  }
  const mk = stageKeyOf();
  if (mk !== stageMeshKey) { stage.setMesh(stageMeshData = stageMesh()); stageMeshKey = mk; stageKey = ''; zbCache = { key: '' }; }
  // the side photo, for the head where the front one doesn't see it
  const sk = stageZ && stageZ.hd && S.map.head && S.map.head.skin, sd = sk && sk.side ? slots.side : null;
  if ((sd ? sd.imgRec : null) !== stagePhoto2) {
    let c = null;
    if (sd) {
      const sc = Math.min(1, Math.min(4096, stage.maxTex) / Math.max(sd.iw, sd.ih));
      c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sd.iw * sc)); c.height = Math.max(1, Math.round(sd.ih * sc));
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(sd.img, 0, 0, c.width, c.height);
    }
    stage.setPhoto2(c); stagePhoto2 = sd ? sd.imgRec : null; stageKey = '';
  }
  const ok = cfg.surfView === 'photo' ? 'none' : `${surfOverlay().key}`;
  if (ok !== stageOvKey) { stage.setOverlay(stageOverlay()); stageOvKey = ok; stageKey = ''; }
  const F = stageFrame(), key = [...F.L, ...F.t, S.rot3.yaw, S.rot3.pitch, cfg.surfMode, cfg.surfAlpha, W, H, dpr].join('|');
  if (key === stageKey) return;
  stageKey = key;
  const R = F.R;
  stage.render({ m: stageMatrix(F), r: new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]), light: S.surf.dir, mode: cfg.surfMode || 'photo', ovA: cfg.surfAlpha, w: Math.round(W * dpr), h: Math.round(H * dpr), gain2: sk ? sk.gain : null });
}
/**
 * Dragging a dot on the relief. Turned far enough to see depth, a drag moves the dots in depth only
 * (along the depth axis as it lies on the screen) — where they sit on the photo was set facing you
 * and stays put. Facing you (or nearly), it is the usual move on the photo.
 */
function stageDrag(sx, sy, e) {
  const d = S.mapDrag;
  if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 2) return;
  d.moved = true;
  const fine = e.altKey ? .25 : 1, F = stageFrame(), last = d.ls || { x: d.sx, y: d.sy };
  const ds = { x: (sx - last.x) * fine, y: (sy - last.y) * fine };
  d.ls = { x: sx, y: sy };
  const [a, b, c, dd] = F.L, det = a * dd - b * c || 1, R = F.R, m = S.map, set = d.set;
  const ez = { x: a * R[2] + b * R[5], y: c * R[2] + dd * R[5] }, el2 = ez.x * ez.x + ez.y * ez.y;
  if (rotated() && el2 > .04 * Math.abs(det)) {
    if (!m.zo) m.zo = new Float32Array(NMAP).fill(NaN);
    const dzc = (ds.x * ez.x + ds.y * ez.y) / el2 / S.surf.pxcm;
    // brows and hair lie on the skin: they have no depth of their own (the brow ridge dots set the bone)
    if (![...set.w.keys()].some(i => !COLOUR_ONLY(FM.POINTS[i])) && !d.cosNote) { d.cosNote = true; toast('Brows lie on the skin — drag the brow ridge dots (dashed line) to move the bone'); }
    const push = (i, w) => { if (COLOUR_ONLY(FM.POINTS[i])) return; const z0 = Number.isFinite(m.zo[i]) ? m.zo[i] : dotDepth(i); m.zo[i] = z0 + dzc * w; };
    for (const [i, w] of set.w) push(i, w);
    for (const [j, w] of set.mirror) push(j, w);   // the partner moves the same way in depth
    m.zoRev = (m.zoRev || 0) + 1;
  } else {
    const ux = (dd * ds.x - b * ds.y) / det, uy = (-c * ds.x + a * ds.y) / det;
    moveDrag(set, R[0] * ux + R[3] * uy, R[1] * ux + R[4] * uy);
  }
  wake();
}
/** After dots were moved in the Surface step: rebuild the surface around them (shortly). */
let surfTimer = 0;
function scheduleSurf() {
  clearTimeout(surfTimer);
  surfTimer = setTimeout(() => { if (surfStep() && S.map) buildSurface({ auto: true }); }, 120);
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
  if (meta) meta.content = t === 'dark' ? '#070606' : '#E8E6E3';
  grid.rgb = getComputedStyle(root).getPropertyValue('--dot-rgb').trim() || '178,186,184';
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
    map: S.map ? { view: S.map.view, p: S.map.p.slice(), snapped: S.map.snapped, light: S.map.light, zo: S.map.zo ? S.map.zo.slice() : null, af: S.map.af ? { ...S.map.af } : null } : null,
    anat: { ...S.anat }, anatBase: { ...S.anatBase },
    tone: S.tone,   // paint arrays are copy-on-write too
    surf: S.surf,   // so is the face surface (and its fixes)
    hints: S.hints, lightDir: S.lightDir,
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
    const zoSame = (a, b) => (!a && !b) || (a && b && a.every((v, i) => v === b[i] || (Number.isNaN(v) && Number.isNaN(b[i]))));
    const pSame = old && sm && old.view === sm.view && old.p.every((v, i) => v === sm.p[i]), same = pSame && zoSame(old.zo, sm.zo);
    if (old && sm && pSame) old.af = sm.af ? { ...sm.af } : null;   // the face's own anatomy set by hand
    if (same) {
      // only the anatomy changed — keep the scan (and its mask) as it is
      mapTouched(false);
    } else if (pSame) {
      // only depths set in 3D changed: the dots (and everything built on them) stay
      old.zo = sm.zo ? Float32Array.from(sm.zo) : null;
      old.zoRev = (old.zoRev || 0) + 1;
      mapTouched(false);
    } else {
      S.map = sm ? makeMap(sm.view, sm.p.slice(), sm.snapped, sm.light) : null;
      if (S.map) {
        // keep version numbers rising so cached GPU grids are never mistaken for current
        if (old) { S.map.ver = old.ver + 1; S.map.pver = old.pver + 1; S.map.maskVer = old.maskVer; S.map.zoRev = (old.zoRev || 0) + 1; }
        if (sm.zo) S.map.zo = Float32Array.from(sm.zo);
        if (sm.af) S.map.af = { ...sm.af };
        buildMask();
      } else S.mapSel.clear();
    }
  }
  if (s.anat) { S.anat = { ...s.anat }; S.anatBase = { ...(s.anatBase || {}) }; if (S.map) mapTouched(false); }
  if (s.tone) { S.tone = s.tone; S.toneRev++; }
  if ('surf' in s) S.surf = s.surf;
  if ('hints' in s) S.hints = s.hints;
  if ('lightDir' in s) S.lightDir = s.lightDir;
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
  if (mapping() && S.map) {   // the face map is open: select all its visible dots
    S.mapSel = new Set(FM.POINTS.map((_, i) => i).filter(dotShown));
    wake(); return;
  }
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
  roundRect(ctx, tx, ty, w, h, 2);
  ctx.fillStyle = 'rgba(13,12,11,.92)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.stroke();
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
  ['outline', 'Face edge', '#7EA6FF'], ['skin', 'Face lines', '#6FC3E8'], ['brows', 'Brows', '#A8D88F'],
  ['eyes', 'Eyes', '#F0CD6E'], ['nose', 'Nose', '#F2A7C6'], ['lips', 'Lips', '#BCAEF7'],
  ['ears', 'Ears', '#F5B27A'], ['hair', 'Hair', '#6ED8CB'], ['neck', 'Neck', '#D9A6E8'],
];
const MAP_COLORS = Object.fromEntries(MAP_GROUPS.map(([g, , c]) => [g, c]));
const LEVEL_COLORS = { bone: '#EDE3CF', soft: '#F5A3A3', shape: '#7EA6FF' };
const QFIT = {
  front: [
    { id: 'puL', label: 'Centre of the pupil — the eye on the left of the photo', refine: 'pupil' },
    { id: 'puR', label: 'Centre of the other pupil', refine: 'pupil' },
    { id: 'exL', label: 'Outer corner of the eye on the left' },
    { id: 'exR', label: 'Outer corner of the eye on the right' },
    { id: 'enL', label: 'Inner corner of the eye on the left (by the nose)' },
    { id: 'enR', label: 'Inner corner of the eye on the right' },
    { id: 'biL', label: 'Inner end of the brow on the left' },
    { id: 'biR', label: 'Inner end of the brow on the right' },
    { id: 'btL', label: 'Outer end (tail) of the brow on the left' },
    { id: 'btR', label: 'Outer end (tail) of the brow on the right' },
    { id: 'prn', label: 'Tip of the nose' },
    { id: 'alL', label: 'Outer edge of the nostril wing — left' },
    { id: 'alR', label: 'Outer edge of the nostril wing — right' },
    { id: 'chL', label: 'Mouth corner on the left of the photo' },
    { id: 'chR', label: 'Mouth corner on the right' },
    { id: 'me', label: 'Bottom of the chin' },
    { id: 'tri', label: 'Centre of the hairline (Shift Enter if it’s hidden)' },
    { id: 'hlcL', label: 'Hairline corner at the temple — left (Shift Enter if hidden)' },
    { id: 'hlcR', label: 'Hairline corner at the temple — right' },
    { id: 'zyL', label: 'Widest point of the face at the cheekbone — left' },
    { id: 'zyR', label: 'Widest point of the face at the cheekbone — right' },
    { id: 'goL', label: 'Jaw angle — left' },
    { id: 'goR', label: 'Jaw angle — right' },
    { id: 'saL', label: 'Top of the ear — left (Shift Enter if hidden)' },
    { id: 'saR', label: 'Top of the ear — right' },
    { id: 'eoL', label: 'Outermost point of the ear’s rim — left (how far the ear sticks out)' },
    { id: 'eoR', label: 'Outermost point of the ear’s rim — right' },
    { id: 'lobL', label: 'Bottom of the earlobe — left' },
    { id: 'lobR', label: 'Bottom of the earlobe — right' },
  ],
  profile: [
    { id: 'tri', label: 'The hairline (Shift Enter if it’s hidden)' },
    { id: 'hlc#', label: 'Hairline corner at the temple (Shift Enter if hidden)' },
    { id: 'gl', label: 'Brow between the eyes (glabella) — its most forward point' },
    { id: 'ba#', label: 'Brow — its highest point (the arch)' },
    { id: 'n', label: 'Nasion — the dip between forehead and nose' },
    { id: 'ex#', label: 'Outer corner of the eye' },
    { id: 'prn', label: 'Tip of the nose' },
    { id: 'al#', label: 'Back edge of the nostril wing' },
    { id: 'sn', label: 'Base of the nose, where it meets the upper lip' },
    { id: 'ls', label: 'Front of the upper lip' },
    { id: 'sto', label: 'Where the lips meet' },
    { id: 'pog', label: 'Front of the chin' },
    { id: 'me', label: 'Bottom of the chin' },
    // (the jaw in profile is its lower border and the ramus's back edge meeting at the angle: one dot on
    // each line besides the angle, so its shape is yours, not the template's)
    { id: 'jaw2#', label: 'Lower edge of the jaw — halfway from the chin to the angle' },
    { id: 'go#', label: 'Jaw angle' },
    { id: 'ramus#', label: 'Back edge of the jaw — halfway up from the angle to the ear' },
    { id: 'tra#', label: 'Ear opening (tragus)' },
    { id: 'sa#', label: 'Top of the ear' },
    { id: 'eo#', label: 'Back edge of the ear’s rim' },
    { id: 'lob#', label: 'Bottom of the earlobe' },
  ],
};
const qfitSteps = () => (S.qfit && S.qfit.steps) || QFIT[isProfile() ? 'profile' : 'front'];
const qfitId = st => st.id.replace('#', FM.nearSide(S.map ? S.map.yaw : 0));
/** Is this dot shown (and grabbable) in Map? */
const dotShown = i => S.map.vis[i] && !S.hideGroups.has(FM.POINTS[i].group);
/** Screen positions of every scan dot (on the photo as it was). */
const mapScreenPts = () => {
  if (stageOn()) {   // on the 3D relief; turned, dots behind it are marked hidden
    const F = stageFrame(), k = S.surf.pxcm, P = FM.POINTS.map((_, i) => proj3(F, S.map.p[2 * i], S.map.p[2 * i + 1], dotDepth(i) * k));
    if (rotated()) {
      const zb = stageZBuffer(F), tol = .35 * k;
      P.forEach(p => {
        const i = Math.floor(p.x / zb.cs), j = Math.floor(p.y / zb.cs);
        if (i < 0 || j < 0 || i >= zb.w || j >= zb.h) return;
        // the nearest surface in a small neighbourhood (the buffer has gaps on steep sides)
        let z = -Infinity;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < zb.w && jj < zb.h) z = Math.max(z, zb.z[jj * zb.w + ii]); }
        if (p.z < z - tol) p.hid = true;
      });
    }
    return P;
  }
  return FM.POINTS.map((_, i) => mapToScreen(mapPt(i)));
};
/** The relief's nearest depth per 4-px screen cell for the current turn (to hide the dots behind it). */
let zbCache = { key: '' };
function stageZBuffer(F) {
  const G = stageDepth(), key = [G.key, ...F.L, ...F.t, S.rot3.yaw, S.rot3.pitch, W, H].join('|');
  if (zbCache.key === key) return zbCache;
  const cs = 4, w = Math.ceil(W / cs), h = Math.ceil(H / cs), z = new Float32Array(w * h).fill(-Infinity), k = S.surf.pxcm;
  // the drawn head's own triangles (its sides and back aren't on the front-view grid)
  const M = G.hd && stageMeshData;
  if (M) {
    const nv = M.pos.length / 3, sx = new Float32Array(nv), sy = new Float32Array(nv), sz = new Float32Array(nv);
    for (let v = 0; v < nv; v++) { const p = proj3(F, M.pos[3 * v], M.pos[3 * v + 1], M.pos[3 * v + 2]); sx[v] = p.x / cs - .5; sy[v] = p.y / cs - .5; sz[v] = p.z; }
    for (let t = 0; t < M.tri.length; t += 3) {
      const a = M.tri[t], b = M.tri[t + 1], c = M.tri[t + 2], den = (sy[b] - sy[c]) * (sx[a] - sx[c]) + (sx[c] - sx[b]) * (sy[a] - sy[c]);
      if (Math.abs(den) < 1e-9) continue;
      const i0 = Math.max(0, Math.ceil(Math.min(sx[a], sx[b], sx[c]))), i1 = Math.min(w - 1, Math.floor(Math.max(sx[a], sx[b], sx[c])));
      const j0 = Math.max(0, Math.ceil(Math.min(sy[a], sy[b], sy[c]))), j1 = Math.min(h - 1, Math.floor(Math.max(sy[a], sy[b], sy[c])));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const l1 = ((sy[b] - sy[c]) * (i - sx[c]) + (sx[c] - sx[b]) * (j - sy[c])) / den, l2 = ((sy[c] - sy[a]) * (i - sx[c]) + (sx[a] - sx[c]) * (j - sy[c])) / den, l3 = 1 - l1 - l2;
        if (l1 < -.02 || l2 < -.02 || l3 < -.02) continue;
        const d = l1 * sz[a] + l2 * sz[b] + l3 * sz[c], q = j * w + i;
        if (d > z[q]) z[q] = d;
      }
    }
    zbCache = { key, cs, w, h, z };
    return zbCache;
  }
  for (let j = 0; j < G.gh; j++) for (let i = 0; i < G.gw; i++) {
    const p = proj3(F, G.x0 + i * G.cell, G.y0 + j * G.cell, G.z[j * G.gw + i] * k), ci = Math.floor(p.x / cs), cj = Math.floor(p.y / cs);
    if (ci >= 0 && cj >= 0 && ci < w && cj < h && p.z > z[cj * w + ci]) z[cj * w + ci] = p.z;
  }
  zbCache = { key, cs, w, h, z };
  return zbCache;
}
/**
 * The side photo's own outline — its profile line and jaw line as you traced them — in the 3D view, beside
 * the head: each traced point where the head's matching edge is drawn, moved by what the head still misses
 * it by. Shown once the head is turned toward profile; where the two lines part, the 3D and the side
 * photo disagree. [[{x, y, z} …] per line] in stage coordinates (photo px, depth px), or null.
 */
function sideOutline3() {
  const h = S.map.head, G = stageZ && stageZ.key === stageKeyOf() ? stageZ : null;
  if (!sideHead() || !G || !G.hd || !h.res.outline) return null;
  const res = h.res, X = res.X, P = h.P, p1 = res.poses[1], p0 = res.poses[0], R1 = p1.R, R0 = p0.R, kz = P.s / mapFrame().scale, k2 = S.surf.pxcm, lines = [];
  for (const o of res.outline) {
    if (o.q !== 1) continue;
    const v = o.v, x = X[3 * v];
    // the traced point back in the model's frame, at the matched vertex's distance from the midline
    const a = R1[0][1], b = R1[0][2], c = R1[1][1], d = R1[1][2], det = a * d - b * c;
    if (Math.abs(det) < 1e-6) continue;
    const ru = (o.x - p1.t[0]) / p1.s - R1[0][0] * x, rv = (o.y - p1.t[1]) / p1.s - R1[1][0] * x;
    const D = [0, (ru * d - b * rv) / det - X[3 * v + 1], (a * rv - c * ru) / det - X[3 * v + 2]];
    const L = lines[o.ch] || (lines[o.ch] = []);
    L.push({ x: P.uv[2 * v] + p0.s * (R0[0][1] * D[1] + R0[0][2] * D[2]), y: P.uv[2 * v + 1] + p0.s * (R0[1][1] * D[1] + R0[1][2] * D[2]), z: (P.z[v] + G.hd.dz[v] - (R0[2][1] * D[1] + R0[2][2] * D[2]) * kz) * k2 });
  }
  return lines.filter(L => L && L.length > 1);
}
function drawMap(ctx) {
  const P_ = mapScreenPts(), m = S.map, busy = !!S.mapDrag;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // turned toward profile: the side photo's outline beside the head (dashed)
  if (stageOn() && Math.abs(Math.sin(S.rot3.yaw)) > .5) {
    const SL = sideOutline3();
    if (SL) {
      const F = stageFrame();
      ctx.setLineDash([5, 4]);
      for (const L of SL) {
        ctx.beginPath(); L.forEach((q, k) => { const p = proj3(F, q.x, q.y, q.z); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = 'rgba(236,238,235,.9)'; ctx.lineWidth = 1.3; ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }
  // contours
  for (const c of m.contours) {
    if (c.draw === false) continue;
    const g = FM.POINTS[c.idx[0]].group;
    ctx.setLineDash(c.bone ? [4, 4] : []);   // bone lines (rims, ridges) dashed, soft features solid
    if (S.hideGroups.has(c.boundary ? 'outline' : g) || c.idx.some(i => !m.vis[i])) continue;
    const pts = FM.spline(c.idx.map(i => P_[i]), c.closed, 8), n = c.idx.length, segs = c.closed ? n : n - 1;
    ctx.beginPath();
    if (c.idx.some(i => P_[i].hid)) {
      // turned: the line breaks where it passes behind the head
      let pen = false;
      pts.forEach((p, q) => {
        const s = Math.min(segs - 1, Math.floor(q * segs / pts.length)), a = c.idx[s], b = c.idx[(s + 1) % n];
        if (P_[a].hid || P_[b].hid) { pen = false; return; }
        if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; }
      });
    } else { pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (c.closed) ctx.closePath(); }
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = rgba(MAP_COLORS[c.boundary ? 'outline' : g], busy ? .4 : .8); ctx.lineWidth = 1.2; ctx.stroke();
  }
  ctx.setLineDash([]);
  // dots
  FM.POINTS.forEach((pt, i) => {
    if (!dotShown(i) || P_[i].hid) return;
    const p = P_[i], sel = S.mapSel.has(i), hov = S.mapHover === i, col = MAP_COLORS[pt.group];
    // detail dots (between the named ones) are drawn smaller
    const auto = autoDot(i), r = sel || hov ? 4.6 : auto ? 1.6 : pt.detail ? 2.1 : 3.2;
    if (busy && !sel) ctx.globalAlpha = .55;
    if (auto) ctx.globalAlpha = .6;   // follows the named dots by itself
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
  // quick fit: the dot to click next (its current guess)
  if (S.qfit) {
    const st = qfitSteps()[S.qfit.step], ti = st && FM.INDEX[qfitId(st)];
    const g = ti != null && m.vis[ti] ? qfitGuess() : null;
    if (g) {
      const p = mapToScreen(g), r = 9 + 2.5 * Math.sin(now() / 160);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; ctx.stroke();
      wake(300);
    }
  }
  // soft move: how far the pull reaches
  if (cfg.mapSoft && !S.qfit) {
    const i = S.mapDrag ? [...S.mapSel][0] : S.mapHover;
    if (i != null) {
      const p = P_[i], q = mapToScreen({ x: m.p[2 * i] + cfg.mapSoftR * mapScale(), y: m.p[2 * i + 1] }), R = Math.hypot(q.x - p.x, q.y - p.y);
      ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // several dots selected: corners scale them, the knob rotates them
  const sb = !busy && selBox();
  if (sb) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(sb.x0 + .5, sb.y0 + .5, sb.x1 - sb.x0, sb.y1 - sb.y0);
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(sb.knob.x, sb.y0); ctx.lineTo(sb.knob.x, sb.knob.y + 5); ctx.stroke();
    for (const [x, y] of sb.corners) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.strokeRect(x - 4.5, y - 4.5, 9, 9); }
    ctx.beginPath(); ctx.arc(sb.knob.x, sb.knob.y, 5, 0, TAU); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke();
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
  ctx.strokeStyle = paintStep() ? rgba(SURF_BRUSH_COLORS[cfg.surfBrush] || '#FFFFFF', .95) : isTone() ? rgba(TONE_COLORS[cfg.mMode], .95) : 'rgba(255,255,255,.85)';
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

/**
 * The photo's frame: a hairline a little outside it, its corners marked, a ruler's ticks along the top
 * and its size and slot written above it — so the photo sits in the app rather than floating bare on
 * the grid. (Not while the 3D face is turned: the photo is no longer flat.)
 */
let frameInk = { theme: '' };
function drawPhotoFrame(ctx) {
  if (!S.img || (stageOn() && rotated())) return;
  if (frameInk.theme !== root.dataset.theme) {
    const cs = getComputedStyle(root);
    frameInk = { theme: root.dataset.theme, line: cs.getPropertyValue('--line-strong').trim(), warm: cs.getPropertyValue('--muted').trim(), faint: cs.getPropertyValue('--faint').trim() };
  }
  const P = [mapToScreen({ x: 0, y: 0 }), mapToScreen({ x: S.iw, y: 0 }), mapToScreen({ x: S.iw, y: S.ih }), mapToScreen({ x: 0, y: S.ih })];
  const x0 = Math.min(...P.map(p => p.x)) - 10, x1 = Math.max(...P.map(p => p.x)) + 10, y0 = Math.min(...P.map(p => p.y)) - 10, y1 = Math.max(...P.map(p => p.y)) + 10;
  const a = v => Math.round(v) + .5;
  ctx.save();
  ctx.lineWidth = 1; ctx.strokeStyle = frameInk.line;
  ctx.strokeRect(a(x0), a(y0), Math.round(x1 - x0), Math.round(y1 - y0));
  // the ruler along the top: a tick every tenth, longer at the middle
  ctx.beginPath();
  for (let q = 1; q < 10; q++) { const x = a(x0 + (x1 - x0) * q / 10), L = q === 5 ? 7 : 4; ctx.moveTo(x, a(y0)); ctx.lineTo(x, a(y0) + L); }
  for (let q = 1; q < 10; q++) { const y = a(y0 + (y1 - y0) * q / 10), L = q === 5 ? 7 : 4; ctx.moveTo(a(x0), y); ctx.lineTo(a(x0) + L, y); }
  ctx.stroke();
  // the corners
  ctx.lineWidth = 1.5; ctx.strokeStyle = frameInk.warm;
  const k = 14;
  ctx.beginPath();
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) { ctx.moveTo(a(x) + sx * k, a(y)); ctx.lineTo(a(x), a(y)); ctx.lineTo(a(x), a(y) + sy * k); }
  ctx.stroke();
  // what it is, above it
  if (y0 > 18) {
    ctx.font = `500 10px ${FONT}`; ctx.textBaseline = 'bottom';
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '1.5px';
    ctx.fillStyle = frameInk.warm; ctx.textAlign = 'left';
    ctx.fillText(curSlot === 'side' ? 'SIDE' : curTab() === '3d' ? '3D' : 'FRONT', x0, y0 - 6);
    ctx.fillStyle = frameInk.faint; ctx.textAlign = 'right';
    ctx.fillText(`${S.iw} × ${S.ih}`, x1, y0 - 6);
  }
  ctx.restore();
}
function drawOverlay(t, dt) {
  const ctx = octx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ov.width, ov.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPhotoFrame(ctx);
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
  // measurements lie flat on the photo: they step aside while the 3D face is turned
  const turned = stageOn() && rotated();
  for (const m of list) {
    const vis = isVisible(m) && !turned;
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
  if (S.map && !S.compare) { if (lightStep()) drawLightStep(ctx); else if (surfStep()) drawSurfaceStep(ctx); else if (mapping()) drawMap(ctx); else if (S.tool === 'morph') drawAnatomyFocus(ctx); }
  const brushOn = S.tool === 'morph' && !mapping() && !S.anatHover;
  if (brushOn && !S.qfit && S.cursorIn && S.cursor && !S.pan && !(S.rpress && S.rpress.moved)) drawBrush(ctx, S.cursor);
  if (S.qfit && S.cursorIn && S.cursor) tag(ctx, qfitSteps()[S.qfit.step].label + `  ${S.qfit.step + 1}/${qfitSteps().length}`, S.cursor.x, S.cursor.y);

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
  else if (S.orbit || S.drag || S.pan || S.hdrag || (S.mapDrag && S.mapDrag.moved) || (S.press && S.press.moved) || (S.mdrag && S.mdrag.moved) || (S.rpress && S.rpress.moved)) c = 'grabbing';
  else if (S.box || S.mapBox || S.qfit) c = 'crosshair';
  else if (S.space) c = 'grab';
  else if (S.selXfHover && mapping()) c = S.selXfHover === 'rotate' ? ROT_CURSOR : 'nwse-resize';
  else if (paintStep()) c = isHintBrush() || (fixBrush() && S.surf) ? 'none' : 'grab';
  else if (mapping()) c = S.mapHover != null ? 'grab' : 'crosshair';
  else if (S.tool === 'morph') c = 'none';
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
  const mh = mapping() && !S.mapDrag && !S.mapBox ? mapHitAt(sx, sy) : null;
  S.selXfHover = mapping() && !S.mapDrag && !S.mapXf ? selBoxHit(sx, sy) : null;
  if (mh !== S.mapHover && !S.mapDrag) { S.mapHover = mh; wake(); }
  const xz = hh ? null : xfZoneAt(sx, sy);
  if (JSON.stringify(xz) !== JSON.stringify(S.hoverXf || null)) { S.hoverXf = xz; wake(); }
  const h = S.draft || !S.img || EDIT_TOOLS.has(S.tool) || mapping() ? null : hitTest(sx, sy);
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
    if (S.zstroke) endSurfBrush();
    if (S.hstroke) endHintBrush();
    if (S.mapDrag || S.mapBox || S.mapXf) morphUp(e);
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
  if (mapping()) { mapDown(sx, sy, e); return; }
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
  if (S.orbit) {
    S.rot3 = { yaw: clamp(S.orbit.yaw + (sx - S.orbit.x) * .008, -1.4, 1.4), pitch: clamp(S.orbit.pitch - (sy - S.orbit.y) * .008, -1.2, 1.2) };
    wake(); return;
  }
  if (S.mapDrag || S.mapBox || S.mapXf) { morphMove(sx, sy, e); return; }
  if (S.tstroke) { S.tstroke.sx = sx; S.tstroke.sy = sy; return; }
  if (S.zstroke) { S.zstroke.sx = sx; S.zstroke.sy = sy; return; }
  if (S.hstroke) { S.hstroke.sx = sx; S.hstroke.sy = sy; return; }
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

/* ---- face map interaction (the Face map layer is selected) ---- */
function mapHitAt(sx, sy) {
  if (!S.map || !mapping() || S.qfit || lightStep() || (surfStep() && (fixBrush() || !S.surf))) return null;
  const P_ = mapScreenPts();
  let best = null, bd = 9;
  P_.forEach((p, i) => { if (!dotShown(i) || autoDot(i) || p.hid) return; const d = Math.hypot(p.x - sx, p.y - sy); if (d < bd) { bd = d; best = i; } });
  return best;
}
/** A new scan changes nothing on the photo, so it isn't an undo step. */
function ensureMap(quiet) {
  if (S.map || !FM || !S.img) return;
  const n = fitMap();
  syncPts();
  if (!quiet) toast(n ? `Face map placed from ${n} of your landmarks — check the dots` : 'Face map placed on a guess — use Quick fit to place it', 5000);
}
/**
 * Select the face map in the panel (like a measurement layer) or close it. While it is selected,
 * its dots show on the unchanged photo and clicks on the canvas edit them.
 */
function openFaceMap(on) {
  on = !!on && !!FM && !!S.img;
  if (on === S.mapOpen) return;
  if (on) {
    if (S.tool !== 'move') setTool('move');
    if (S.draft) { S.draft = null; S.draftM = null; }
    S.sel = []; S.active = null; S.showAll = false; S.picked.clear();
    S.mapOpen = true;
    ensureMap(true);
  } else {
    if (S.mapDrag || S.mapBox || S.mapXf) morphUp({});
    S.mapOpen = false;
    S.qfit = null; S.mapSel.clear(); S.mapHover = null;
  }
  S.glDirty = true;
  syncPts();               // the anatomy is hidden while mapping, so points move
  syncUI();
}
const dirText = d => {
  const v = d[1] < -.25 ? 'above' : d[1] > .25 ? 'below' : '', hz = d[0] < -.25 ? 'the left' : d[0] > .25 ? 'the right' : '';
  return v && hz ? `${v}, from ${hz}` : v ? v : hz ? `from ${hz}` : 'the front';
};
function syncSurfacePane() {
  const s = S.surf, m = S.map, busy = S.surfBusy;
  const stale = s && m && (s.view !== m.view || s.pver !== m.pver);
  setText($('#sfStatus'), !m ? 'Place the dots first (step 1).'
    : busy ? (busy.head ? (HM && HM.model ? 'Fitting the measured head to the dots…' : 'Loading the measured head (≈ 3 MB, once)…') : `Building the surface… ${Math.round(busy.p * 100)}%`)
    : !s ? 'Build a 3D surface of this face from your dots and the photo’s own light and shade.'
    : (s.view !== m.view ? 'Built for another view — build again. '
      : `Light ${dirText(s.dir)}${S.lightDir ? ' (set in step 2)' : ''}. The surface explains ${Math.round(Math.max(0, s.fit1) * 100)}% of the photo’s shading (the dots alone: ${Math.round(Math.max(0, s.fit0) * 100)}%).`
        + (s.strength < .25 ? ' The light is flat here, so the surface stays close to the dots.' : '')
        + (m.head && m.head.key === headKey() ? ` Shape from a measured head (ICT-FaceKit) fitted to ${m.head.n} dots${m.head.side ? ' on both photos' : ''} — they sit within ${(m.head.res.rms * 10).toFixed(1)} mm of it.` : '')
        + (stale ? ' Dots moved since — build again to update.' : s.deps !== surfDeps() ? ' The light or the marks changed — build again to use them.' : '')));
  const bb = $('#sfBuild');
  setText(bb, busy ? 'Building…' : s ? 'Rebuild' : 'Build surface');
  bb.disabled = !m || !!busy;
  $('#sfFront').disabled = !s || !rotated();
  // the face's anatomy: read from the light, corrected by hand (held values marked •)
  const an = $('#sfAnat'), fit = s && m && s.view === m.view ? s.fit : null;
  an.hidden = !fit;
  if (fit) {
    if (!an.dataset.built) buildAnatPanel(an);
    const stale = s.pver !== m.pver, af = m.af || {};
    SURF_ANAT.forEach(([k]) => {
      const v = k === 'lean' ? leanOf(fit) : (fit[k] || 0), held = k === 'lean' ? 'buccal' in af || 'fat' in af : k in af, pc = Math.round(v * 100);
      setRange('sfa_' + k, pc, `${pc > 0 ? '+' : pc < 0 ? '−' : ''}${Math.abs(pc)}%${held ? ' •' : ''}`);
      $('#sfa_' + k).disabled = stale || !!busy;
    });
    const pins = m.zo ? m.zo.reduce((c, v) => c + (Number.isFinite(v) ? 1 : 0), 0) : 0, nh = Object.keys(af).length;
    $('#sfaReset').disabled = !nh || !!busy;
    setText($('#sfaNote'), (stale ? 'The dots moved — rebuild before changing these. ' : '')
      + (nh ? 'Values marked • are yours and are kept on rebuilds. ' : 'Compared with the average face. ')
      + (sideProfile() ? 'The profile is the side photo’s (Side tab). ' : '')
      + (pins ? `${pins} dot depth${pins === 1 ? '' : 's'} set by hand or from a side map file.` : ''));
  }
  $$('#sfMode [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === (cfg.surfMode || 'photo')));
  setRange('sfTrust', Math.round(cfg.surfTrust * 100), Math.round(cfg.surfTrust * 100) + '%');
  $$('#sfViews [data-v]').forEach(b => { b.classList.toggle('on', b.dataset.v === cfg.surfView); b.disabled = !s; });
  $('#sfSweepRow').hidden = cfg.surfView !== 'sweep';
  setRange('sfSweep', Math.round(cfg.surfSweep * 100), Math.round(cfg.surfSweep * 100) + '%');
  $('#sfPca').hidden = cfg.surfView !== 'pca';
  $$('#sfPca [data-v]').forEach(b => b.classList.toggle('on', +b.dataset.v === cfg.surfPca));
  setRange('sfAlpha', Math.round(cfg.surfAlpha * 100), Math.round(cfg.surfAlpha * 100) + '%');
  const lg = $('#sfLegend'), v = cfg.surfView;
  const html = v === 'topo' || v === 'topoPhoto' ? SF.LABELS.filter(l => l[1]).map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')
    : v === 'contours' ? '<span><i style="background:rgba(150,215,255,.9)"></i>every 2.5 mm</span><span><i style="background:#FFECAA"></i>every 1 cm</span>'
    : v === 'relief' ? '<span class="sf-ramp"></span><span>back</span><span style="margin-left:auto">closer</span>' : '';
  if (lg._h !== html) { lg._h = html; lg.innerHTML = html; }
  $$('#sfBrush [data-v]').forEach(b => { b.classList.toggle('on', b.dataset.v === (fixBrush() || '')); b.disabled = !s && !!b.dataset.v; });
  setRange('sfDetail', Math.round(cfg.surfDetail * 100), Math.round(cfg.surfDetail * 100) + '%');
  setRange('sfSize', +(cfg.mSize * 100).toFixed(1), Math.round(brushV()) + ' px');
  setRange('sfStrength', Math.round(cfg.mStrength * 100), Math.round(cfg.mStrength * 100) + '%');
  $('#sfClear').disabled = !(s && s.edit);
  $('#sfUse').checked = !!cfg.surfUse;
}
/** Remove the face map (and the anatomy changes that need it) — an undo step. */
function clearFaceMap() {
  if (!S.map) return;
  pushUndo();
  S.map = null; S.mapSel.clear(); S.qfit = null; S.surf = null;
  S.anat = {}; S.anatBase = {};
  S.glDirty = true;
  syncPts(); syncUI();
  toast('Face map removed');
}/** Switch the scan to another view (front or a profile): re-placed from scratch for that view. */
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
/** Move dots on the photo: a list of [index, dx, dy]. */
function shiftDots(list) {
  const m = S.map, bound = new Set(mapBoundary().idx);
  let edge = false;
  for (const [i, dx, dy] of list) { m.p[2 * i] += dx; m.p[2 * i + 1] += dy; if (bound.has(i)) edge = true; }
  if (cfg.mapAutoDetail) placeDetail(new Set(list.map(l => l[0])));
  mapTouched(true);
  if (edge) {
    m.maskDirty = true;
    if (now() - (m.maskT || 0) > 120) { buildMask(); m.maskT = now(); m.maskDirty = false; }
  }
  wake();
}
/**
 * What a drag moves, and how much: the selection; with Soft move, the dots around it too (fading
 * with distance); with Mirror, the partners on the other side of the face (moved mirrored).
 */
function dragSet() {
  const m = S.map, w = new Map();
  S.mapSel.forEach(i => w.set(i, 1));
  if (cfg.mapSoft && S.mapSel.size) {
    const R = cfg.mapSoftR * mapScale(), R2 = R * R, sel = [...S.mapSel];
    // a brow (or the hair) drags only brows: the skin and the bone under it stay where they are
    const cos = sel.every(i => COLOUR_ONLY(FM.POINTS[i]));
    FM.POINTS.forEach((pt, j) => {
      if (w.has(j) || !dotShown(j) || (cos && !COLOUR_ONLY(pt))) return;
      let d2 = Infinity;
      for (const i of sel) d2 = Math.min(d2, (m.p[2 * i] - m.p[2 * j]) ** 2 + (m.p[2 * i + 1] - m.p[2 * j + 1]) ** 2);
      if (d2 < R2) { const t = 1 - d2 / R2; w.set(j, t * t); }
    });
  }
  const mirror = new Map();
  if (cfg.mapMirror && !isProfile(m)) for (const [i, wi] of w) {
    const j = FM.MIRROR[i];
    if (j !== i && !w.has(j) && m.vis[j]) mirror.set(j, Math.max(mirror.get(j) || 0, wi));
  }
  return { w, mirror };
}
/** Mark a dot as placed by you (a click, a drag, accepted in Quick fit) — not a guess of the template's or
    the face finder's. The head is fitted to these more firmly, and constructions won't override them. */
function markUser(m, i) { (m.user || (m.user = new Uint8Array(NMAP)))[i] = 1; }
const isUser = (m, i) => !!(m && m.user && m.user[i]);
function moveDrag(set, dx, dy) {
  const list = [], m = S.map;
  for (const [i, wi] of set.w) { list.push([i, dx * wi, dy * wi]); if (wi > .999) markUser(m, i); }
  if (set.mirror.size) {
    // reflect the move across the face's vertical axis
    const f = mapFrame(), L = Math.hypot(f.zr, f.zi) || 1, ux = -f.zi / L, uy = f.zr / L, d = dx * ux + dy * uy;
    const mx = 2 * d * ux - dx, my = 2 * d * uy - dy;
    for (const [j, wj] of set.mirror) { list.push([j, mx * wj, my * wj]); if (wj > .999) markUser(m, j); }
  }
  shiftDots(list);
}
const moveMapPoints = (dx, dy) => moveDrag(dragSet(), dx, dy);
/** With several dots selected: a box around them with corners to scale and a knob to rotate. */
function selBox() {
  if (!S.map || S.mapSel.size < 2 || S.qfit || lightStep() || (surfStep() && (fixBrush() || rotated()))) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const P_ = mapScreenPts();
  S.mapSel.forEach(i => { const p = P_[i]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  x0 -= 12; y0 -= 12; x1 += 12; y1 += 12;
  return { x0, y0, x1, y1, knob: { x: (x0 + x1) / 2, y: y0 - 22 }, corners: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
}
function selBoxHit(sx, sy) {
  const b = selBox();
  if (!b) return null;
  if (Math.hypot(b.knob.x - sx, b.knob.y - sy) <= 9) return 'rotate';
  if (b.corners.some(([x, y]) => Math.hypot(x - sx, y - sy) <= 8)) return 'scale';
  return null;
}
function startSelXf(type, sx, sy) {
  const m = S.map, p0 = new Map();
  let cx = 0, cy = 0;
  S.mapSel.forEach(i => { p0.set(i, [m.p[2 * i], m.p[2 * i + 1]]); cx += m.p[2 * i]; cy += m.p[2 * i + 1]; });
  cx /= S.mapSel.size; cy /= S.mapSel.size;
  const x = screenToMap(sx, sy);
  S.mapXf = { type, cx, cy, p0, a0: Math.atan2(x.y - cy, x.x - cx), d0: Math.hypot(x.x - cx, x.y - cy) || 1, snap: snapshot(), moved: false };
}
function moveSelXf(sx, sy, e) {
  const X = S.mapXf, m = S.map, x = screenToMap(sx, sy);
  let a = 0, s = 1;
  if (X.type === 'rotate') { a = Math.atan2(x.y - X.cy, x.x - X.cx) - X.a0; if (e.shiftKey) a = Math.round(a / (Math.PI / 36)) * Math.PI / 36; }
  else s = Math.max(.05, Math.hypot(x.x - X.cx, x.y - X.cy) / X.d0);
  const c = Math.cos(a) * s, sn = Math.sin(a) * s, list = [];
  X.p0.forEach(([px, py], i) => {
    const vx = px - X.cx, vy = py - X.cy;
    list.push([i, X.cx + c * vx - sn * vy - m.p[2 * i], X.cy + sn * vx + c * vy - m.p[2 * i + 1]]);
  });
  X.moved = true;
  shiftDots(list);
}
function mapDown(sx, sy, e) {
  if (lightStep()) {   // Light: a marking brush, otherwise drag to pan
    if (isHintBrush()) startHintBrush(sx, sy);
    else { S.pan = { x: sx, y: sy, vx: S.view.x, vy: S.view.y }; refreshCursor(); }
    return;
  }
  if (surfStep()) {
    // a fix-it brush paints on the relief facing you; otherwise drag a dot to fix it, or drag to turn
    if (fixBrush() && S.surf) { if (rotated()) S.rot3 = { yaw: 0, pitch: 0 }; startSurfBrush(sx, sy); return; }
    if (!S.surf) { S.pan = { x: sx, y: sy, vx: S.view.x, vy: S.view.y }; refreshCursor(); return; }
    if (!e.shiftKey && mapHitAt(sx, sy) == null && !selBoxHit(sx, sy)) {
      S.orbit = { x: sx, y: sy, yaw: S.rot3.yaw, pitch: S.rot3.pitch };
      refreshCursor();
      return;
    }
  }
  if (S.qfit) { quickFitClick(sx, sy); return; }
  ensureMap();
  const xh = selBoxHit(sx, sy);
  if (xh) { startSelXf(xh, sx, sy); return; }
  const hit = mapHitAt(sx, sy), x = screenToMap(sx, sy);
  if (hit != null) {
    if (e.shiftKey) { if (S.mapSel.has(hit)) S.mapSel.delete(hit); else S.mapSel.add(hit); }
    else if (!S.mapSel.has(hit)) S.mapSel = new Set([hit]);
    S.mapDrag = { last: x, sx, sy, snap: snapshot(), moved: false, set: dragSet() };
    S.glDirty = true; wake(); refreshCursor();
    return;
  }
  S.mapBox = { x0: sx, y0: sy, x1: sx, y1: sy, moved: false, base: new Set(e.shiftKey ? S.mapSel : []) };
}
function morphMove(sx, sy, e) {
  if (S.mapDrag && stageOn()) { stageDrag(sx, sy, e); return; }
  if (S.mapXf) { moveSelXf(sx, sy, e); return; }
  const x = screenToMap(sx, sy);
  if (S.mapDrag) {
    const d = S.mapDrag;
    if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 2) return;
    d.moved = true;
    const fine = e.altKey ? .25 : 1;
    moveDrag(d.set, (x.x - d.last.x) * fine, (x.y - d.last.y) * fine);
    d.last = x;
  } else if (S.mapBox) {
    const b = S.mapBox;
    b.x1 = sx; b.y1 = sy;
    if (!b.moved && Math.hypot(sx - b.x0, sy - b.y0) > 4) b.moved = true;
    if (b.moved) {
      const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
      S.mapSel = new Set(b.base);
      mapScreenPts().forEach((p, i) => { if (dotShown(i) && !autoDot(i) && !p.hid && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) S.mapSel.add(i); });
    }
  }
  wake();
}
function morphUp(e) {
  if (S.mapXf) {
    const X = S.mapXf;
    S.mapXf = null;
    if (X.moved) { buildMask(); S.map.maskDirty = false; pushUndo(X.snap); if (surfStep()) scheduleSurf(); }
  } else if (S.mapDrag) {
    const d = S.mapDrag;
    S.mapDrag = null;
    if (d.moved) { buildMask(); S.map.maskDirty = false; pushUndo(d.snap); if (surfStep()) scheduleSurf(); }
  } else if (S.mapBox) {
    const b = S.mapBox;
    S.mapBox = null;
    if (!b.moved && !e.shiftKey) S.mapSel.clear();
  }
  S.glDirty = true;
  syncUI();
}
/* quick fit: a guided series of clicks. After each one the whole map is refitted (similarity MLS
   through every click so far), so the next dot is already close; Enter skips a point you can't
   see, Backspace goes back one. Pupil clicks snap to the darkest round spot nearby. */
function startQuickFit() {
  openFaceMap(true);
  if (S.mapStep !== 'points') S.mapStep = 'points';
  ensureMap(true);
  S.qfit = { step: 0, hist: [], snap: snapshot() };
  S.mapSel.clear();
  syncUI(); refreshCursor(); wake();
}

/* ---- Auto-place: Google's MediaPipe Face Landmarker (open source, Apache-2.0) finds 478 points on the
   face, in the browser — the photo never leaves the device. The library and model (≈ 6 MB) are fetched
   the first time it's used and then cached by the browser.
   MP_TEMPLATE says where each of those 478 points sits on our template (cm, front view). It was measured
   once by running MediaPipe on faces rendered from the template (8 renders: four lights, with and
   without stubble; the median, made left-right symmetric). So the 478 points pull the whole template —
   every dot, face lines and edges included — onto this face through a smooth warp.
   (Its depth isn't used: tested on rendered faces, it didn't follow changes in chin, brow or cheekbone
   projection — like any single front photo, it can't see them.) */
const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MP_TEMPLATE = '0,1.27;0,-1.2;0,-0.45;-0.53,-3.24;0,-1.89;0,-2.68;0,-4.71;-4.25,-5.32;0,-6.36;0,-7.24;0,-10.88;0,1.47;0,1.71;0,1.93;0,1.99;0,2.29;0,2.64;0,2.95;0,3.58;0,-0.8;-0.73,-0.8;-6.8,-7.06;-2.6,-4.65;-3.21,-4.59;-3.79,-4.62;-4.49,-5.09;-2.08,-4.8;-3.68,-6.59;-2.82,-6.54;-4.39,-6.41;-4.75,-6.15;-4.97,-4.62;-2.1,4.58;-4.47,-5.55;-6.7,-5.09;-5.66,-5.12;-3.13,-1.65;-0.79,1.15;-0.71,1.72;-1.48,1.36;-1.92,1.57;-1.27,1.78;-1.68,1.82;-2.8,2.5;-0.61,-1.18;-0.66,-1.85;-5.59,-6.41;-1.82,-3.44;-1.95,-1.3;-1.93,-1.65;-4.85,-1.51;-0.57,-2.61;-4.25,-7.05;-5.1,-6.8;-6.34,-7.81;-1.26,-6.57;-2.12,-6.21;-3.27,1.91;-6.2,2.28;-1.52,-0.95;-1.05,-0.75;-2.43,1.91;-2.31,1.87;-5.44,-7.09;-1.98,-1;-2.95,-7.08;-3.11,-7.58;-3.91,-9.63;-5.86,-7.51;-3.42,-8.66;-5.94,-6.61;-6.38,-6.82;-0.77,1.43;-1.37,1.57;-1.8,1.68;-1.39,-0.82;-2.36,1.88;-2.13,2.09;-2.24,1.92;-1.3,-1.19;-1.61,1.98;-1.18,1.94;-0.65,1.92;-0.81,3.54;-0.75,2.88;-0.74,2.58;-0.71,2.25;-0.73,1.99;-1.63,2.01;-1.73,2.16;-1.81,2.32;-1.9,2.44;-2.66,0.75;-6.89,-1.94;-0.15,-0.62;-1.91,1.97;-2.04,2.03;-0.91,-0.53;-1.81,-0.61;-1,-0.61;-2.46,-3.04;-3.48,-2.53;-2.06,-1.38;-5.46,-8.5;-4.93,-8.09;-4.52,-7.46;-2.26,2.95;-1.47,-7.42;-1.76,-8.97;-2.02,-10.6;-4.24,-4.78;-5.5,-4.18;-1.74,-4.94;-5.23,-5.81;-1.41,-3.85;-1.65,-1.56;-6.14,-3.8;-5.12,-3.58;-4.42,-3.22;-3.34,-3.38;-2.48,-3.69;-1.85,-3.98;-0.61,-4.58;-6.22,-1.8;-5.69,-5.84;-0.51,-0.85;-1.73,-2.74;-6.94,-5.16;-1.39,-4.29;-2.1,-1.34;-4.79,-5.5;-1.58,-1.99;-6.78,0.44;-1.73,-5.18;-1.12,-2.38;-4.65,3.61;-4.63,4.34;-6.71,-1.94;-5.46,2.86;-6.57,-6.02;-2.2,5.21;-0.42,-0.65;-2.33,-2.23;-6.11,-5.08;-3.72,-5.02;-3.23,-4.97;-2.19,2.18;-6.16,0.03;-1.15,5.78;-2.95,5.41;-3.75,5.06;0,-9.04;0,5.8;-2.72,-5.03;-2.23,-5.1;-1.89,-5.13;-6.09,-5.94;-2.32,-5.82;-2.86,-6.05;-3.45,-6.09;-3.95,-5.98;-4.23,-5.83;-6.94,-6.2;-4.04,-5.16;0,0.15;-2.08,0.36;-1.53,-1.06;-0.93,0.14;0,-5.57;-3.84,4.34;-3.1,4.86;-1.18,5.37;-5.41,3.47;-1.94,-5.44;-0.99,-3.56;0,5.4;-2.06,5.64;-6.58,0.24;-1.22,2.07;-1.33,2.22;-1.35,2.43;-1.39,2.69;-1.62,3.33;-2,1.85;-2.15,1.84;-2.22,1.8;-3.07,1.3;-5.34,0.27;-1.02,-4.27;-1.29,-5.63;-1.67,-5.63;-1.93,1.96;-5.25,1.9;-0.76,-5.52;-1.91,3.96;0,-3.33;-0.58,-3.86;0,-3.97;-1.36,-2.57;0,4.83;0,4.17;-0.96,4.15;-3.29,2.89;-2.7,-0.77;-2.65,3.55;-4.05,-0.66;-3.24,-0.03;-4.5,0.56;-1.11,4.8;-1.71,-2.2;-3.68,3.52;-2.94,4.17;-3.79,2.14;-5.9,1.22;-4.47,2.43;-6.22,1.78;-3.65,0.91;-1.33,-3.18;-1.48,-1.29;-1.79,-1.1;-1.21,-1.74;-1.73,-6.27;-2.86,-6.71;-3.9,-6.73;-4.68,-6.54;-5.11,-6.25;-5.18,-5.28;-6.69,-3.83;-4.63,-4.28;-4.06,-4.02;-3.28,-4.04;-2.52,-4.21;-1.94,-4.42;-1.53,-4.59;-6.86,-3.89;-1.77,-0.91;-0.98,-2.98;-1.08,-1.28;-0.79,-0.94;-1.07,-1.16;-1.63,-0.7;-0.7,-0.9;-0.62,-0.74;-1.52,-5.13;-1.21,-4.93;-1.04,-4.76;-4.36,-5.69;-4.89,-5.85;0.53,-3.24;4.25,-5.32;0.62,-0.74;6.8,-7.06;2.6,-4.65;3.21,-4.59;3.79,-4.62;4.49,-5.09;2.08,-4.8;3.68,-6.59;2.82,-6.54;4.39,-6.41;4.75,-6.15;4.97,-4.62;2.1,4.58;4.47,-5.55;6.7,-5.09;5.66,-5.12;3.13,-1.65;0.79,1.15;0.71,1.72;1.48,1.36;1.92,1.57;1.27,1.78;1.68,1.82;2.8,2.5;0.61,-1.18;0.66,-1.85;5.59,-6.41;1.82,-3.44;1.95,-1.3;1.93,-1.65;4.85,-1.51;0.57,-2.61;4.25,-7.05;5.1,-6.8;6.34,-7.81;1.26,-6.57;2.12,-6.21;3.27,1.91;6.2,2.28;1.52,-0.95;1.05,-0.75;2.36,1.88;2.22,1.8;5.44,-7.09;1.98,-1;2.95,-7.08;3.11,-7.58;3.91,-9.63;5.86,-7.51;3.42,-8.66;5.94,-6.61;6.38,-6.82;0.77,1.43;1.37,1.57;1.8,1.68;1.39,-0.82;2.31,1.87;2.04,2.03;2.15,1.84;1.3,-1.19;1.54,1.87;1.16,1.87;0.65,1.92;0.81,3.54;0.75,2.88;0.74,2.58;0.71,2.25;0.56,1.94;1.53,1.89;1.63,2.01;1.73,2.16;1.81,2.32;2.66,0.75;7.11,-1.53;1.86,1.88;1.93,1.96;0.81,-0.47;1.81,-0.61;0.91,-0.53;2.46,-3.04;3.48,-2.53;2.1,-1.34;5.46,-8.5;4.93,-8.09;4.52,-7.46;2.26,2.95;1.47,-7.42;1.76,-8.97;2.02,-10.6;4.24,-4.78;5.5,-4.18;1.74,-4.94;5.23,-5.81;1.41,-3.85;1.65,-1.56;6.14,-3.8;5.12,-3.58;4.42,-3.22;3.34,-3.38;2.48,-3.69;1.85,-3.98;0.61,-4.58;6.22,-1.8;5.69,-5.84;0.31,-0.83;1.73,-2.74;6.94,-5.16;1.39,-4.29;2.14,-1.31;4.79,-5.5;1.58,-1.99;6.98,0.68;1.73,-5.18;1.12,-2.38;4.65,3.61;4.63,4.34;6.94,-1.58;5.46,2.86;6.57,-6.02;2.2,5.21;0.15,-0.62;2.33,-2.23;6.11,-5.08;3.72,-5.02;3.23,-4.97;2.13,2.09;6.16,0.03;1.15,5.78;2.95,5.41;3.75,5.06;2.72,-5.03;2.23,-5.1;1.89,-5.13;6.09,-5.94;2.32,-5.82;2.86,-6.05;3.45,-6.09;3.95,-5.98;4.23,-5.83;6.94,-6.2;4.04,-5.16;2.08,0.36;1.53,-1.06;0.93,0.14;3.84,4.34;3.1,4.86;1.18,5.37;5.41,3.47;1.94,-5.44;0.99,-3.56;2.06,5.64;6.78,0.44;1.18,1.94;1.22,2.07;1.35,2.43;1.39,2.69;1.62,3.33;2,1.85;2.08,1.74;2.18,1.69;3.07,1.3;5.34,0.27;1.02,-4.27;1.29,-5.63;1.67,-5.63;1.85,1.86;5.25,1.9;0.76,-5.52;1.91,3.96;0.58,-3.86;1.36,-2.57;0.96,4.15;3.29,2.89;2.7,-0.77;2.65,3.55;4.05,-0.66;3.24,-0.03;4.5,0.56;1.11,4.8;1.71,-2.2;3.68,3.52;2.94,4.17;3.79,2.14;5.9,1.22;4.47,2.43;6.22,1.78;3.65,0.91;1.33,-3.18;1.48,-1.29;1.79,-1.1;1.21,-1.74;1.73,-6.27;2.86,-6.71;3.9,-6.73;4.68,-6.54;5.11,-6.25;5.18,-5.28;6.69,-3.83;4.63,-4.28;4.06,-4.02;3.28,-4.04;2.52,-4.21;1.94,-4.42;1.53,-4.59;6.86,-3.89;1.77,-0.91;0.98,-2.98;1.08,-1.28;0.7,-0.9;1.07,-1.16;1.63,-0.7;0.51,-0.85;0.42,-0.65;1.52,-5.13;1.21,-4.93;1.04,-4.76;4.36,-5.69;4.89,-5.85;-3.2,-5.53;-2.6,-5.5;-3.19,-6.03;-3.8,-5.52;-3.16,-4.94;3.2,-5.53;3.8,-5.52;3.19,-6.03;2.6,-5.5;3.16,-4.94';
let mpTab = null, mpTask = null, mpMod = null;
const mpTable = () => mpTab || (mpTab = MP_TEMPLATE.split(';').map(s => s.split(',').map(Number)));
/* MediaPipe points that mean exactly one of our dots (checked against the table: within ≈ 3 mm on the
   template) — the warp goes through our template's own position for them */
const MP_SAME = { 4: 'prn', 5: 'dor', 195: 'rhi', 168: 'n', 2: 'sn', 0: 'ls', 17: 'li', 18: 'bpt', 199: 'pog', 152: 'me', 10: 'fhT',
  33: 'exL', 133: 'enL', 263: 'exR', 362: 'enR', 61: 'chL', 291: 'chR', 468: 'puL', 473: 'puR', 64: 'alL', 294: 'alR',
  172: 'goL', 397: 'goR', 234: 'zyL', 454: 'zyR' };
/** A set of MediaPipe connections as ordered chains (or loops) of point numbers. */
function mpChains(edges) {
  const adj = new Map(), add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const e of edges) { add(e.start, e.end); add(e.end, e.start); }
  const seen = new Set(), out = [];
  for (const s of adj.keys()) {
    if (seen.has(s)) continue;
    const comp = [], st = [s];
    seen.add(s);
    while (st.length) { const u = st.pop(); comp.push(u); for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); st.push(v); } }
    const ends = comp.filter(u => adj.get(u).length === 1), path = [ends.length ? ends[0] : comp[0]], used = new Set(path);
    for (let cur = path[0]; ;) { const nx = adj.get(cur).find(v => !used.has(v)); if (nx == null) break; path.push(nx); used.add(nx); cur = nx; }
    out.push({ path, closed: !ends.length });
  }
  return out;
}
/** Point at relative arc length t (0…1) along a polyline of {x, y}. */
function alongAt(P, t) {
  const L = [0];
  for (let k = 1; k < P.length; k++) L.push(L[k - 1] + Math.hypot(P[k].x - P[k - 1].x, P[k].y - P[k - 1].y));
  const s = Math.max(0, Math.min(1, t)) * L[L.length - 1];
  for (let k = 1; k < P.length; k++) if (L[k] >= s) { const u = (s - L[k - 1]) / ((L[k] - L[k - 1]) || 1); return { x: P[k - 1].x + (P[k].x - P[k - 1].x) * u, y: P[k - 1].y + (P[k].y - P[k - 1].y) * u }; }
  return { ...P[P.length - 1] };
}
/**
 * The jaw angle on a front jaw outline (photo points from the cheekbone down to the chin): where the outline
 * turns most — the corner between the ramus's edge and the jaw's lower border, which is what the gonion is
 * — looked for near f0 (the template's place for it, as a fraction of the outline's length; a turn far from
 * it, at the chin, counts less). Returns that fraction; f0 when there's no clear corner (a soft, round jaw).
 */
function jawCorner(poly, f0) {
  const N = 80, R = Array.from({ length: N + 1 }, (_, k) => alongAt(poly, k / N)), w = 6;
  let best = f0, bs = 0, bt = 0;
  for (let k = w; k <= N - w; k++) {
    const f = k / N;
    if (f < .25 || f > .85) continue;
    const a = Math.atan2(R[k].y - R[k - w].y, R[k].x - R[k - w].x), b = Math.atan2(R[k + w].y - R[k].y, R[k + w].x - R[k].x);
    let t = Math.abs(b - a);
    if (t > Math.PI) t = 2 * Math.PI - t;
    const s = t * Math.exp(-((f - f0) ** 2) / (2 * .2 * .2));
    if (s > bs) { bs = s; best = f; bt = t; }
  }
  return bt > .12 ? best : f0;   // (under ≈ 7° of turn there isn't a corner)
}
/** Where two lines (point, direction) cross, or null if they're near parallel. */
function lineCross(p, u, q, v) {
  const d = u.x * v.y - u.y * v.x;
  if (Math.abs(d) < 1e-6) return null;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / d;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}
/** Where a ray (from o along d) first crosses a polyline, or null. */
function rayHit(o, d, poly) {
  let best = null, bt = Infinity;
  for (let k = 1; k < poly.length; k++) {
    const a = poly[k - 1], e = { x: poly[k].x - a.x, y: poly[k].y - a.y }, den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - o.x) * e.y - (a.y - o.y) * e.x) / den, s = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (t > 0 && s >= 0 && s <= 1 && t < bt) { bt = t; best = { x: o.x + d.x * t, y: o.y + d.y * t }; }
  }
  return best;
}
const unit = (a, b) => { const x = b.x - a.x, y = b.y - a.y, L = Math.hypot(x, y) || 1; return { x: x / L, y: y / L }; };
/**
 * The jaw in profile by its anatomical construction, as cephalometry defines it: the mandibular plane (the
 * line along the jaw's lower border through the chin's bottom, menton) and the ramus line (along its back
 * edge, up toward the ear lobe's attachment) meet at the gonial angle; the gonion is where that angle's
 * bisector meets the jaw's outline. The gnathion is where the bisector of the facial line (nasion →
 * pogonion) and the mandibular plane meets the chin. A jaw angle you placed moves onto the construction
 * only if it's within ≈ 1 cm of it (your dot says where the angle is roughly, the construction exactly);
 * the gnathion, never a click, is always placed. Returns how many dots moved.
 */
function refineProfileJaw() {
  const m = S.map;
  if (!m || !isProfile(m)) return 0;
  const s = FM.nearSide(m.yaw), at = id => { const i = FM.INDEX[id.replace('#', s)]; return i != null && m.vis[i] ? i : null; };
  const [me, gn, pog, nas, go, jaw2, ramus, obi] = ['me', 'gn', 'pog', 'n', 'go#', 'jaw2#', 'ramus#', 'obi#'].map(at);
  const b = m.contours.find(c => c.boundary);
  if ([me, go, jaw2, ramus, obi].some(v => v == null) || !b) return 0;
  const P = mapPt, sc = mapScale(), idx = b.idx;
  // the outline between two dots of it (either way round)
  const between = (a, z, skip) => { const ia = idx.indexOf(a), iz = idx.indexOf(z); if (ia < 0 || iz < 0) return null; const r = (ia <= iz ? idx.slice(ia, iz + 1) : idx.slice(iz, ia + 1).reverse()).filter(i => i !== skip); return r.length > 1 ? FM.spline(r.map(P), false, 6) : null; };
  let n = 0;
  // the mandibular plane and the ramus line, and where they meet
  const M0 = P(me), um = unit(P(me), P(jaw2)), R0 = P(ramus), ur = unit(P(ramus), P(obi));
  const X = lineCross(M0, um, R0, ur);
  if (X) {
    const a = unit(X, M0), r = unit(X, R0), ang = Math.acos(clamp(a.x * r.x + a.y * r.y, -1, 1)) * 180 / Math.PI;
    const bis = unit({ x: 0, y: 0 }, { x: a.x + r.x, y: a.y + r.y }), jaw = between(jaw2, ramus);
    const hit = ang > 95 && ang < 155 && jaw && rayHit(X, bis, jaw);
    if (hit && (!isUser(m, go) || Math.hypot(hit.x - P(go).x, hit.y - P(go).y) < sc)) {
      m.p[2 * go] = hit.x; m.p[2 * go + 1] = hit.y; n++;
    }
  }
  // the gnathion: on the chin, half way round from the facial line to the mandibular plane
  if (gn != null && pog != null && nas != null && !isUser(m, gn)) {
    // (the chin's outline without the gnathion itself: it's what's being placed)
    const uf = unit(P(nas), P(pog)), Y = lineCross(P(nas), uf, M0, um), chin = between(pog, me, gn);
    if (Y && chin) {
      const f = unit(Y, P(nas)), g = unit(Y, P(jaw2)), bis = unit({ x: 0, y: 0 }, { x: f.x + g.x, y: f.y + g.y });
      const hit = rayHit(Y, bis, chin);
      if (hit) { m.p[2 * gn] = hit.x; m.p[2 * gn + 1] = hit.y; n++; }
    }
  }
  if (n) { if (cfg.mapAutoDetail) placeDetail(null); mapTouched(true); buildMask(); }
  return n;
}
/** Relative arc-length positions (0…1) of template dots along a run of them (template cm). */
function tplParams(ids) {
  const L = [0];
  for (let k = 1; k < ids.length; k++) { const a = FM.POINTS[ids[k - 1]], b = FM.POINTS[ids[k]]; L.push(L[k - 1] + Math.hypot(b.x - a.x, b.y - a.y)); }
  const T = L[L.length - 1] || 1;
  return L.map(v => v / T);
}
function mpLoad() {
  if (!mpTask) mpTask = (async () => {
    const mp = await import(`${MP_BASE}/vision_bundle.mjs`);
    mpMod = mp;
    const fs = await mp.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = d => mp.FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MP_MODEL, delegate: d }, runningMode: 'IMAGE', numFaces: 1, outputFacialTransformationMatrixes: true });
    try { return await make('GPU'); } catch (e) { return await make('CPU'); }
  })().catch(e => { mpTask = null; throw e; });
  return mpTask;
}
let autoBusy = false;
async function autoPlace() {
  if (!S.img || !FM || autoBusy) return;
  if (S.map && isProfile()) { toast('Auto-place works on front photos — use Quick fit for a profile', 5000); return; }
  autoBusy = true; syncUI();
  toast(mpTask ? 'Finding the face…' : 'Loading the face finder (the first time ≈ 6 MB, then it’s cached)…', 8000);
  let L = null, pose = null;
  try {
    const fl = await mpLoad();
    // a copy of the photo no larger than 2048 px (the finder crops the face itself)
    const sc = Math.min(1, 2048 / Math.max(S.iw, S.ih)), c = document.createElement('canvas');
    c.width = Math.round(S.iw * sc); c.height = Math.round(S.ih * sc);
    c.getContext('2d').drawImage(S.img, 0, 0, c.width, c.height);
    const r = fl.detect(c);
    L = r.faceLandmarks && r.faceLandmarks[0];
    const M = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0];
    if (M && M.data) { const d = M.data; pose = { yaw: Math.atan2(d[8], d[10]) * 180 / Math.PI, pitch: Math.atan2(-d[9], Math.hypot(d[8], d[10])) * 180 / Math.PI }; }
  } catch (e) { console.error(e); autoBusy = false; syncUI(); toast('Couldn’t load the face finder — check the internet connection (Quick fit works offline)', 7000); return; }
  autoBusy = false;
  if (!L) { syncUI(); toast('No face found in this photo — try Quick fit', 5000); return; }
  const FLM = mpMod.FaceLandmarker, P = i => ({ x: L[i].x * S.iw, y: L[i].y * S.ih });
  // a mirrored selfie has the subject's right eye on the right: our L/R are by side of the photo
  const flip = L[33].x > L[263].x, sid = id => flip ? id.replace(/[LR]$/, s => s === 'L' ? 'R' : 'L') : id, ix = id => FM.INDEX[sid(id)];
  // 1 · a smooth template → photo warp through the finder's points (not the brows or the iris rims —
  //     the brows are hair and vary), going exactly through our own dot where a point means one
  const tab = mpTable(), skip = new Set();
  for (const k of ['FACE_LANDMARKS_LEFT_EYEBROW', 'FACE_LANDMARKS_RIGHT_EYEBROW', 'FACE_LANDMARKS_LEFT_IRIS', 'FACE_LANDMARKS_RIGHT_IRIS']) for (const e of FLM[k]) { skip.add(e.start); skip.add(e.end); }
  const ctl = [];
  L.forEach((p, i) => {
    if (i >= tab.length || (skip.has(i) && MP_SAME[i] == null)) return;
    // (in a mirrored selfie the template is mirrored too: its left on the photo's right)
    const same = MP_SAME[i] != null ? FM.POINTS[ix(MP_SAME[i])] : null, t = same ? [same.x, same.y] : tab[i] && [flip ? -tab[i][0] : tab[i][0], tab[i][1]];
    if (t && Number.isFinite(t[0])) ctl.push(t[0], t[1], p.x * S.iw, p.y * S.ih);
  });
  const W2 = FM.tpsFit(ctl, ctl.length / 4, 20, 2e-3), pos = new Map();
  FM.POINTS.forEach((pt, i) => { const [x, y] = FM.tpsEval(W2, pt.x, pt.y); pos.set(i, { x, y }); });
  // 2 · the outlines straight from the finder's own: lids, lips, brows and jawline, each of our dots at
  //     the same relative distance along it as on the template
  const put = (ids, poly) => { const t = tplParams(ids); ids.forEach((i, k) => pos.set(i, alongAt(poly, t[k]))); };
  const run = (c, a, b) => { const idx = c.idx, ia = idx.indexOf(a), ib = idx.indexOf(b), out = []; if (ia < 0 || ib < 0) return null; for (let k = ia; ; k = (k + 1) % idx.length) { out.push(idx[k]); if (k === ib) break; } return out; };
  // the two arcs of a loop from a to b (both start at a); none if either isn't on it
  const arcs = (loop, a, b) => { const n = loop.length, ia = loop.indexOf(a), ib = loop.indexOf(b), A = [], B = []; if (ia < 0 || ib < 0) return null; for (let k = ia; ; k = (k + 1) % n) { A.push(loop[k]); if (k === ib) break; } for (let k = ia; ; k = (k - 1 + n) % n) { B.push(loop[k]); if (k === ib) break; } return [A, B]; };
  const meanY = ps => ps.reduce((s, i) => s + L[i].y, 0) / ps.length, meanX = ps => ps.reduce((s, i) => s + L[i].x, 0) / ps.length;
  const tpl = FM.contours(0), cont = id => tpl.find(c => c.id === id);
  const before = snapshot();
  openFaceMap(true);
  S.mapStep = 'points'; S.qfit = null;
  const loopOf = k => { const ch = mpChains(FLM[k]); return (ch.find(c => c.closed) || ch[0]).path; };
  const midX = (P(133).x + P(362).x) / 2;
  // the eyes: our upper lid (inner → outer corner) and lower lid along the finder's, by side of the photo
  for (const [k, ca, cb] of [['FACE_LANDMARKS_RIGHT_EYE', 33, 133], ['FACE_LANDMARKS_LEFT_EYE', 263, 362]]) {
    const loop = loopOf(k), s = meanX(loop) * S.iw < midX ? 'L' : 'R', c = cont('eye' + s);
    const inner = Math.abs(P(ca).x - midX) < Math.abs(P(cb).x - midX) ? ca : cb, outer = inner === ca ? cb : ca, ab = arcs(loop, inner, outer);
    if (!c || !ab) continue;
    const up = meanY(ab[0]) < meanY(ab[1]) ? ab[0] : ab[1], lo = up === ab[0] ? ab[1] : ab[0];
    const upper = run(c, FM.INDEX['en' + s], FM.INDEX['ex' + s]), lower = run(c, FM.INDEX['ex' + s], FM.INDEX['en' + s]);
    if (upper) put(upper, up.map(P));
    if (lower) put(lower, lo.slice().reverse().map(P));
  }
  {
    // the lips: from the left corner of the photo to the right, upper lip through 0, lower through 17
    const lipLoop = mpChains(FLM.FACE_LANDMARKS_LIPS).find(ch => ch.closed && ch.path.includes(0)), c = cont('lips');
    const lc = L[61].x < L[291].x ? 61 : 291, rc = lc === 61 ? 291 : 61, ab = lipLoop && arcs(lipLoop.path, lc, rc);
    if (c && ab) {
      const up = ab[0].includes(0) ? ab[0] : ab[1], lo = up === ab[0] ? ab[1] : ab[0];
      const upper = run(c, FM.INDEX.chL, FM.INDEX.chR), lower = run(c, FM.INDEX.chR, FM.INDEX.chL);
      if (upper) put(upper, up.map(P));
      if (lower) put(lower, lo.slice().reverse().map(P));
    }
    pos.set(FM.INDEX.sto, { x: (P(13).x + P(14).x) / 2, y: (P(13).y + P(14).y) / 2 });
    // each lip's fullness: halfway across it on the midline (its border → the lip line)
    pos.set(FM.INDEX.ulf, { x: (P(0).x + P(13).x) / 2, y: (P(0).y + P(13).y) / 2 });
    pos.set(FM.INDEX.llf, { x: (P(14).x + P(17).x) / 2, y: (P(14).y + P(17).y) / 2 });
  }
  for (const k of ['FACE_LANDMARKS_RIGHT_EYEBROW', 'FACE_LANDMARKS_LEFT_EYEBROW']) {
    const chains = mpChains(FLM[k]).filter(ch => !ch.closed && ch.path.length >= 3);
    if (chains.length < 2) continue;
    const s = L[chains[0].path[0]].x * S.iw < midX ? 'L' : 'R', c = cont('browShape' + s);
    if (!c) continue;
    const orient = p => Math.abs(L[p[0]].x * S.iw - midX) < Math.abs(L[p[p.length - 1]].x * S.iw - midX) ? p : p.slice().reverse();   // inner → outer
    const [ua, ub] = chains.slice(0, 2).map(ch => orient(ch.path)), up = meanY(ua) < meanY(ub) ? ua : ub, lo = up === ua ? ub : ua;
    const inn = { x: (P(up[0]).x + P(lo[0]).x) / 2, y: (P(up[0]).y + P(lo[0]).y) / 2 }, out = { x: (P(up[up.length - 1]).x + P(lo[lo.length - 1]).x) / 2, y: (P(up[up.length - 1]).y + P(lo[lo.length - 1]).y) / 2 };
    const upper = run(c, FM.INDEX['bi' + s], FM.INDEX['bt' + s]), lower = run(c, FM.INDEX['bt' + s], FM.INDEX['bi' + s]);
    if (upper) put(upper, [inn, ...up.slice(1, -1).map(P), out]);
    if (lower) put(lower, [out, ...lo.slice(1, -1).reverse().map(P), inn]);
  }
  {
    // the jawline: zygion → jaw angle → menton on each side, along the face oval (sides by the photo).
    // The jaw angle (gonion) is where that outline turns most — the corner between the ramus's edge and the
    // jaw's lower border, which is what the gonion is — not one fixed point of the finder's oval (which sat
    // above or below the corner depending on the face); the dots either side keep their template spacing
    // between the cheekbone and the corner, and between the corner and the chin.
    const oval = loopOf('FACE_LANDMARKS_FACE_OVAL'), c = tpl.find(ct => ct.boundary);
    const side = (a, b) => L[a].x > L[b].x ? [a, b] : [b, a], [zyR, zyL] = side(454, 234);
    const ab = arcs(oval, zyR, zyL), low = ab && (ab[0].includes(152) ? ab[0] : ab[1]);   // right zygion → … → 152 → … → left
    if (c && low) for (const [s, zy] of [['R', zyR], ['L', zyL]]) {
      const i0 = low.indexOf(zy), i1 = low.indexOf(152);
      if (i0 < 0 || i1 < 0) continue;
      const poly = FM.spline((i0 <= i1 ? low.slice(i0, i1 + 1) : low.slice(i1, i0 + 1).reverse()).map(P), false, 6);   // zygion → menton
      const ids = s === 'R' ? run(c, FM.INDEX.zyR, FM.INDEX.me) : (run(c, FM.INDEX.me, FM.INDEX.zyL) || []).slice().reverse();
      const kg = ids ? ids.indexOf(FM.INDEX['go' + s]) : -1;
      if (kg <= 0) continue;
      const t = tplParams(ids), fg = jawCorner(poly, t[kg]);
      ids.forEach((i, k) => pos.set(i, alongAt(poly, k <= kg ? t[k] / t[kg] * fg : fg + (t[k] - t[kg]) / ((1 - t[kg]) || 1) * (1 - fg))));
    }
  }
  // the pupils at the iris centres
  pos.set(ix('puL'), P(468)); pos.set(ix('puR'), P(473));
  const pairs = [...pos].map(([i, b]) => ({ i, b }));
  fitMap('front', pairs);
  // the bone and soft-tissue lines where the measured head has them; then the nasolabial folds slid onto
  // the crease the photo shows (and both kept there)
  const nStruct = await placeStructure();
  if (snapFolds() + nStruct) for (const c of pairs) c.b = mapPt(c.i);
  S.mapSel.clear();
  // 3 · the hairline and the ears aren't among the finder's points: a short guided fit for them
  //     (each ring starts at the guess — Enter accepts it), everything else stays where the finder put it
  const loose = pt => /^(tri|hl|tem)/.test(pt.id) || ['ears', 'hair', 'neck'].includes(pt.group) || (pt.mid && pt.group === 'outline' && pt.y < -8);
  const base = pairs.filter(c => !loose(FM.POINTS[c.i]));
  S.qfit = { step: 0, hist: [], base, steps: QFIT.front.filter(st => /^(tri|hlc|sa|eo|lob)/.test(st.id)), snap: before, auto: true };
  syncPts(); syncUI(); refreshCursor(); wake();
  const turned = pose && (Math.abs(pose.yaw) > 12 || Math.abs(pose.pitch) > 15);
  toast(`Face found${turned ? ` (the head is turned about ${Math.round(Math.abs(pose.yaw))}° — a straight-on photo gives the best 3D)` : ''}. Now the hairline and ears: click each, or press Enter where the ring is already right (Esc stops)`, 8000);
}
/** The darkness-weighted centre of the pupil near a click (photo coords). */
function refinePupil(b) {
  const r = Math.max(4, .45 * mapFrame().scale);
  const x0 = Math.max(0, Math.floor(b.x - r)), y0 = Math.max(0, Math.floor(b.y - r));
  const w = Math.min(S.iw, Math.ceil(b.x + r)) - x0, h = Math.min(S.ih, Math.ceil(b.y + r)) - y0;
  if (w < 4 || h < 4) return b;
  const sc = Math.min(1, 96 / Math.max(w, h)), cw = Math.max(4, Math.round(w * sc)), ch = Math.max(4, Math.round(h * sc));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(S.img, x0, y0, w, h, 0, 0, cw, ch);
  const d = g.getImageData(0, 0, cw, ch).data, L = [], P = [];
  const bx = (b.x - x0) * sc, by = (b.y - y0) * sc, rr = r * sc;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const dd = Math.hypot(i + .5 - bx, j + .5 - by);
    if (dd > rr) continue;
    const k = 4 * (j * cw + i);
    L.push(.299 * d[k] + .587 * d[k + 1] + .114 * d[k + 2]); P.push([i + .5, j + .5, dd]);
  }
  if (L.length < 9) return b;
  const thr = [...L].sort((a, b2) => a - b2)[Math.floor(L.length * .2)];
  let sw = 0, sx = 0, sy = 0;
  L.forEach((l, q) => { if (l > thr) return; const wt = (thr - l + 1) * (1 - P[q][2] / rr * .5); sw += wt; sx += wt * P[q][0]; sy += wt * P[q][1]; });
  if (!sw) return b;
  const nx = x0 + sx / sw / sc, ny = y0 + sy / sw / sc;
  return Math.hypot(nx - b.x, ny - b.y) <= r * .8 ? { x: nx, y: ny } : b;
}

/* ---- export / import: the face map and the measurements as a text file (JSON) ----
   Everything is stored in the photo's own pixels, with the photo's size, so a map can be placed
   again on the same photo (or the same photo at another size). */
const enc8 = a => {
  const b = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) b[i] = Math.round(clamp(a[i], -1, 1) * 127) + 128;
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return btoa(s);
};
const dec8 = (str, n) => {
  const s = atob(str), a = new Float32Array(n);
  for (let i = 0; i < n && i < s.length; i++) a[i] = (s.charCodeAt(i) - 128) / 127;
  return a;
};
function exportFaceMap() {
  if (!S.img) return;
  const m = S.map, r2 = v => Math.round(v * 100) / 100;
  const points = {}, depth = {};
  if (m) FM.POINTS.forEach((pt, i) => {
    points[pt.id] = [r2(m.p[2 * i]), r2(m.p[2 * i + 1])];
    if (m.zo && Number.isFinite(m.zo[i])) depth[pt.id] = Math.round(m.zo[i] * 1000) / 1000;
  });
  const measurements = [...S.meas.values()].map(mm => ({
    id: mm.id, preset: mm.preset || null, kind: mm.kind, name: mm.name || null,
    points: (mm.src || mm.pts.map(fwdMap)).map(p => [r2(p.x), r2(p.y)]),
  }));
  const doc = {
    app: 'cranimeter', kind: 'face-map', version: 1, build: BUILD, saved: new Date().toISOString(),
    image: { width: S.iw, height: S.ih },
    // (mids: each detail dot's two named neighbours — its number may differ in another build)
    map: m ? { view: m.view, snapped: m.snapped, points, depth, anatomy: m.af || null, user: m.user ? FM.POINTS.filter((_, i) => m.user[i]).map(pt => pt.id) : [], mids: FM.MID_KEY } : null,
    measurements, reference: S.refId || null, calibration: S.calibId ? { id: S.calibId, mm: S.calibMM } : null,
    light: S.lightDir, marks: S.hints ? { gw: S.hints.gw, gh: S.hints.gh, highlight: enc8(S.hints.hl), notShape: enc8(S.hints.ig) } : null,
    surface: { trust: cfg.surfTrust, detail: cfg.surfDetail }, morph: { ...S.anat },
  };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cranimeter-face-map-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Face map saved${measurements.length ? ` with ${measurements.length} measurement${measurements.length === 1 ? '' : 's'}` : ''}`);
}
async function importFaceMap(file) {
  if (!S.img || !file) return;
  let doc;
  try { doc = JSON.parse(await file.text()); } catch (e) { toast('That file isn’t a Cranimeter face map (it doesn’t read as JSON)', 5000); return; }
  if (!doc || doc.app !== 'cranimeter' || !doc.image) { toast('That file isn’t a Cranimeter face map', 5000); return; }
  const sx = S.iw / (doc.image.width || S.iw), sy = S.ih / (doc.image.height || S.ih);
  if (Math.abs(sx / sy - 1) > .02) toast('This photo has a different shape than the one the map was made on — check the dots', 6000);
  const before = snapshot();
  // the face map: every saved dot exactly where it was; dots this version has but the file doesn't, fitted around them.
  // The small detail dots are numbered, and the numbers change when the template does: they're matched by
  // the two named dots they lie between (saved with the map since build 43). In an older file from another
  // build, a detail dot is taken where its number still lies between the same two dots (near their
  // midpoint); the others are placed between their neighbours again. (Every detail dot used to be re-placed
  // from another build: dots you'd moved off the curve — and Auto-place's, on the photo's own edges — went
  // back onto it, up to 4 cm away on the long hairline and jaw segments, and the lines zigzagged.)
  if (doc.map && doc.map.points && FM) {
    const pts = doc.map.points, same = String(doc.build) === BUILD, mids = doc.map.mids;
    const named = id => { const i = FM.INDEX[id]; return i != null && !FM.POINTS[i].mid ? i : null; };
    const take = id => {
      const i = FM.INDEX[id];
      if (i == null) return null;
      if (same || !FM.POINTS[i].mid) return i;
      const key = FM.MID_KEY[id], [a, b] = key ? key.split('|') : [];
      if (!key || !pts[a] || !pts[b] || !pts[id]) return null;
      const L = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
      return Math.hypot(pts[id][0] - (pts[a][0] + pts[b][0]) / 2, pts[id][1] - (pts[a][1] + pts[b][1]) / 2) <= .35 * L + 1 ? i : null;
    };
    // (a saved dot's index here: by its neighbours when the file names them, else by its number)
    const resolve = id => mids && mids[id] ? (FM.MID_BY_KEY[mids[id]] != null ? FM.INDEX[FM.MID_BY_KEY[mids[id]]] : null) : (mids ? named(id) : take(id));
    const pairs = [], got = new Set();
    for (const [id, xy] of Object.entries(pts)) {
      if (!xy) continue;
      const i = resolve(id);
      if (i == null || got.has(i)) continue;
      got.add(i); pairs.push({ i, b: { x: xy[0] * sx, y: xy[1] * sy } });
    }
    fitMap(FM.VIEWS[doc.map.view] != null ? doc.map.view : 'front', pairs);
    const missing = new Set(FM.POINTS.map((pt, i) => pt.mid && !got.has(i) ? i : -1).filter(i => i >= 0));
    if (missing.size) placeDetail(null, missing);
    S.map.snapped = doc.map.snapped || pairs.length;
    S.map.af = doc.map.anatomy && typeof doc.map.anatomy === 'object' ? { ...doc.map.anatomy } : null;
    // (which dots you placed yourself; a map from before build 41 doesn't say: its landmarks count as placed)
    S.map.user = null;
    if (Array.isArray(doc.map.user)) for (const id of doc.map.user) { const i = resolve(id); if (i != null) markUser(S.map, i); }
    else for (const { i } of pairs) if (FM.POINTS[i].lm) markUser(S.map, i);
    if (doc.map.depth && Object.keys(doc.map.depth).length) {
      S.map.zo = new Float32Array(NMAP).fill(NaN);
      for (const [id, z] of Object.entries(doc.map.depth)) { const i = resolve(id); if (i != null) S.map.zo[i] = z; }
      S.map.zoRev = (S.map.zoRev || 0) + 1;
    }
  }
  const s = snapshot();
  s.list = (doc.measurements || []).filter(o => o && o.kind && o.points).map(o => {
    const pts = o.points.map(([x, y]) => ({ x: x * sx, y: y * sy }));
    return { id: o.id, preset: o.preset && P[o.preset] ? o.preset : null, kind: o.kind, name: o.name, pts: pts.map(p => ({ ...p })), src: pts };
  });
  const nums = s.list.map(o => +String(o.id).replace(/\D/g, '') || 0);
  s.seq = Math.max(S.seq, ...nums);
  s.refId = doc.reference || null;
  s.calibId = doc.calibration ? doc.calibration.id : null; s.calibMM = doc.calibration ? doc.calibration.mm : S.calibMM;
  if (doc.morph) { s.anat = { ...doc.morph }; s.anatBase = { ...doc.morph }; }
  s.lightDir = Array.isArray(doc.light) ? doc.light : null;
  const G = hintGrid();
  s.hints = doc.marks && doc.marks.gw === G.gw && doc.marks.gh === G.gh ? { ...G, hl: dec8(doc.marks.highlight, G.gw * G.gh), ig: dec8(doc.marks.notShape, G.gw * G.gh), rev: ++surfRev } : null;
  s.surf = null;
  // (a map saved before build 26 carries the old Fine detail default, which raised humps: not taken)
  if (doc.surface) { cfg.surfTrust = doc.surface.trust ?? cfg.surfTrust; if ((+doc.build || 0) >= 26) cfg.surfDetail = doc.surface.detail ?? cfg.surfDetail; saveCfg(); }
  pushUndo(before);
  restore(s);
  S.mapSel.clear();
  if (doc.map && doc.map.points) openFaceMap(true);   // show the dots that were just placed
  syncPts(); syncUI();
  if (surfStep()) scheduleSurf();   // already on the Surface step: build it for the new map
  toast(`Face map placed${s.list.length ? ` with ${s.list.length} measurement${s.list.length === 1 ? '' : 's'}` : ''} — Ctrl+Z undoes it`, 4500);
}

/* ---- depth from a side photo ----
   A front photo can't show how far the chin, lips, nose or brow come forward. The face map of a side
   (profile) photo of the same person can: its dots' horizontal positions are those depths. The two
   maps are lined up on the dots they share (a similarity fit of the profile's (depth, height) onto
   this face's (depth, height), so the scale, a slightly different head tilt and the position drop
   out); then the profile's depths are set on the midline and on the named landmarks — the dots a side
   photo shows reliably. The partner on the far side gets the same depth. */
const SIDE_ROLE = pt => pt.field !== 'back' && (pt.side === 0 || !!pt.lm) && !pt.mid && !/^(zy|tem)/.test(pt.id);   // (the widest points of the face don't show on a profile)
/**
 * Line a profile map up with this (front) face map. pointsOf(id) → the profile photo's [x, y] of a dot
 * (or null), yawP its view, depthOf(i) this face's depth of dot i (cm) to line up against.
 * Returns { n, use (the dots that fit), fitS (profile { u, v } → this photo's { z (px), y }), sP, pxcm }.
 */
function sideFit(m, pointsOf, yawP, depthOf) {
  const sP = Math.sin(yawP * Math.PI / 180), pxcm = mapFrame().scale, pairs = [];
  FM.POINTS.forEach((pt, i) => {
    const xy = pointsOf(pt.id);
    if (!xy || !m.vis[i] || !SIDE_ROLE(pt) || !FM.visible(pt, yawP)) return;
    // profile photo: forward is −x for a face looking left (yaw +90), +x looking right
    pairs.push({ i, u: -sP * xy[0], v: xy[1], z: depthOf(i) * pxcm, y: m.p[2 * i + 1] });
  });
  if (pairs.length < 6) return { n: pairs.length };
  // similarity (scale, rotation, shift) from the profile's (depth, height) onto this face's — three
  // times, each with the depths the last one found, and without dots that don't fit
  let use = pairs, fitS = null;
  for (let pass = 0; pass < 3; pass++) {
    const n = use.length;
    let mu = 0, mv = 0, mz = 0, my = 0;
    for (const p of use) { mu += p.u; mv += p.v; mz += p.z; my += p.y; }
    mu /= n; mv /= n; mz /= n; my /= n;
    let sxx = 0, sxy = 0, ss = 0;
    for (const p of use) { const a = p.u - mu, b = p.v - mv, c = p.z - mz, d = p.y - my; sxx += a * c + b * d; sxy += a * d - b * c; ss += a * a + b * b; }
    const sc = Math.hypot(sxx, sxy) / ss, th = Math.atan2(sxy, sxx), cs = Math.cos(th) * sc, sn = Math.sin(th) * sc;
    fitS = p => ({ z: cs * (p.u - mu) - sn * (p.v - mv) + mz, y: sn * (p.u - mu) + cs * (p.v - mv) + my });
    // heights must agree (they're on both photos); a dot that's far off is a misplaced one
    const err = pairs.map(p => Math.abs(fitS(p).y - p.y)), med = err.slice().sort((a, b) => a - b)[err.length >> 1];
    pairs.forEach(p => { p.z = fitS(p).z; });
    use = pairs.filter((p, q) => err[q] <= Math.max(3 * med, .25 * pxcm));
    if (use.length < 6) use = pairs;
  }
  return { n: pairs.length, use, fitS, sP, pxcm };
}
async function importSideMap(file) {
  const m = S.map;
  if (!m || !file) return;
  if (isProfile(m)) { toast('This photo is a profile already — load a side photo’s map onto a front photo', 5000); return; }
  let doc;
  try { doc = JSON.parse(await file.text()); } catch (e) { toast('That file isn’t a Cranimeter face map', 5000); return; }
  const yawP = doc && doc.map ? FM.VIEWS[doc.map.view] : null;
  if (!doc || doc.app !== 'cranimeter' || !doc.map || !doc.map.points) { toast('That file isn’t a Cranimeter face map', 5000); return; }
  if (yawP == null || Math.abs(yawP) < 45) { toast('That map is of a front photo — map a side (profile) photo, export it, and load that here', 6000); return; }
  const f = sideFit(m, id => doc.map.points[id] || null, yawP, dotDepth);
  if (!f.fitS) { toast(`Only ${f.n} dots match between the two maps — check that the side photo’s map is placed`, 6000); return; }
  const before = snapshot();
  if (!m.zo) m.zo = new Float32Array(NMAP).fill(NaN);
  let set = 0;
  for (const p of f.use) {
    const z = f.fitS(p).z / f.pxcm;
    m.zo[p.i] = z; set++;
    const j = FM.MIRROR[p.i];
    if (j != null && j !== p.i && m.vis[j]) m.zo[j] = z;
  }
  m.zoRev = (m.zoRev || 0) + 1;
  pushUndo(before);
  syncUI();
  toast(`Side photo: depths set on ${set} dots (and their partners) — the surface is rebuilt to fit them. Ctrl+Z undoes it`, 5000);
  if (surfStep()) buildSurface({ auto: true });
}
/**
 * The Side tab's face map, read onto the front one (the 3D tab builds from both): the named landmarks a
 * profile shows (and their partners), and the profile line itself — every few millimetres down the
 * midline, not only at the named dots, so the forehead, nose, lips and chin follow the side photo's
 * outline. Lined up as a side map's file is (above), but against the template's depths, so the result
 * never feeds back into itself. Null when there's no placed side map (or this isn't the front tab).
 * { dots: [[i, z cm]], line: [{ y (front photo px), z (cm) }] top to bottom, n, key }
 */
let sideCache = null;
function sideProfile() {
  const sd = slots.side, sm = sd && sd.map, m = S.map;
  if (curSlot !== 'front' || !m || isProfile(m) || !sm || !isProfile(sm) || !sm.snapped) return null;
  // lined up against the measured head's depths when it's fitted (with this side photo already in it:
  // what's left is what the model can't express), else the template's
  const h = m.head && m.head.key === headKey() && m.head.side ? m.head : null;
  const key = `${sd.imgSeq}|${sm.pver}|${sm.view}|${m.pver}|${h ? h.key : '-'}`;
  if (sideCache && sideCache.key === key) return sideCache.r;
  const t = m.yaw * Math.PI / 180, refZ = h ? (i => h.vertOf[i] >= 0 ? h.P.z[h.vertOf[i]] : FM.POINTS[i].z) : (i => FM.POINTS[i].x * Math.sin(t) + FM.POINTS[i].z * Math.cos(t));
  const f = sideFit(m, id => { const i = FM.INDEX[id]; return i != null && sm.vis[i] ? [sm.p[2 * i], sm.p[2 * i + 1]] : null; }, sm.yaw, refZ);
  let r = null;
  if (f.fitS) {
    const { fitS, sP, pxcm } = f, dots = [];
    for (const p of f.use) {
      if (!FM.POINTS[p.i].side) continue;   // (the midline comes from the line below)
      const z = fitS(p).z / pxcm, j = FM.MIRROR[p.i];
      dots.push([p.i, z]);
      if (j != null && j !== p.i && m.vis[j]) dots.push([j, z]);
    }
    // Heights by anatomy, not by the photo: between two midline landmarks both maps have (nasion, nose
    // tip, lips, chin …) the side's line is laid onto the same stretch of this face, so a face a little
    // longer or shorter in one photo (or a slightly different head tilt) doesn't put the chin's depth
    // at the jaw's underside.
    const knots = [];
    for (const id of ['tri', 'fhT', 'fhC', 'sg', 'gl', 'rx', 'n', 'rhi', 'dor', 'prn', 'col', 'sn', 'phil', 'phL', 'ls', 'ulf', 'sto', 'llf', 'li', 'bpt', 'pog', 'gn', 'me']) {
      const i = FM.INDEX[id];
      if (i == null || !sm.vis[i] || !m.vis[i]) continue;
      const ys = fitS({ u: -sP * sm.p[2 * i], v: sm.p[2 * i + 1] }).y, yf = m.p[2 * i + 1];
      if (!knots.length || (ys > knots[knots.length - 1].ys && yf > knots[knots.length - 1].yf)) knots.push({ ys, yf });
    }
    const remap = y => {
      if (knots.length < 2) return y;
      let a = knots[0], b = knots[1];
      for (let q = 1; q < knots.length && knots[q - 1].ys < y; q++) { a = knots[q - 1]; b = knots[q]; }
      if (y < a.ys) return y - a.ys + a.yf;   // (beyond the end ones: shifted with them)
      if (y > b.ys) return y - b.ys + b.yf;
      return a.yf + (y - a.ys) / ((b.ys - a.ys) || 1) * (b.yf - a.yf);
    };
    const pc = sm.contours.find(c => c.id === 'profile'), line = [];
    if (pc) {
      const pts = pc.idx.filter(i => sm.vis[i]).map(i => ({ x: sm.p[2 * i], y: sm.p[2 * i + 1] }));
      for (const q of FM.spline(pts, false, 6)) { const o = fitS({ u: -sP * q.x, v: q.y }); line.push({ y: remap(o.y), z: o.z / pxcm }); }
    }
    r = { dots, line, n: f.n, key };
  }
  sideCache = { key, r };
  return r;
}

/* ---- symmetry and the detail dots ---- */
/** Is this a detail dot that follows the named dots by itself (and so isn't grabbed)? */
const autoDot = i => !!cfg.mapAutoDetail && !!FM.POINTS[i].mid;
/**
 * Re-place the detail dots (the small ones halfway between named dots) on the curve through their
 * neighbours — only those next to a moved dot, or all of them with no set given.
 */
function placeDetail(moved, only) {
  const m = S.map;
  if (!m || (!cfg.mapAutoDetail && !only)) return;
  for (const c of m.contours) {
    const idx = c.idx, n = idx.length;
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      if (!FM.POINTS[i].mid || !m.vis[i] || (only && !only.has(i))) continue;
      const at = d => c.closed ? idx[(k + d + n) % n] : idx[Math.min(n - 1, Math.max(0, k + d))];
      const p1 = at(-1), p2 = at(1);
      if (p1 === i || p2 === i) continue;
      // the named dots before p1 and after p2 (next to a stretch without detail dots — the profile's jaw
      // line — that's the very next dot, not the one after it)
      const p0 = !c.closed && k - 2 < 0 ? p1 : FM.POINTS[at(-2)].mid ? (c.closed || k - 3 >= 0 ? at(-3) : p1) : at(-2);
      const p3 = !c.closed && k + 2 >= n ? p2 : FM.POINTS[at(2)].mid ? (c.closed || k + 3 < n ? at(3) : p2) : at(2);
      if (moved && !moved.has(p0) && !moved.has(p1) && !moved.has(p2) && !moved.has(p3)) continue;
      // halfway between p1 and p2 on the line as it's drawn (the centripetal spline; the uniform one's midpoint
      // overshot where a short segment met a long one — the hairline, the jaw — and kinked the line)
      const P4 = [p0, p1, p2, p3].map(j => ({ x: m.p[2 * j], y: m.p[2 * j + 1] })), q = FM.spline(P4, false, 2)[3];
      m.p[2 * i] = q.x; m.p[2 * i + 1] = q.y;
    }
  }
}
/** The face's midline on the photo from points on it: { c (a point), u (unit direction) } by total least squares. */
function lineFit(pts) {
  if (pts.length < 2) return null;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const a = .5 * Math.atan2(2 * sxy, sxx - syy);
  let u = { x: Math.cos(a), y: Math.sin(a) };
  if (u.y < 0) u = { x: -u.x, y: -u.y };
  return { c: { x: cx, y: cy }, u };
}
/** The midline from the map's own midline dots. */
function mapMidline() {
  const m = S.map, pts = [];
  FM.POINTS.forEach((pt, i) => { if (m.vis[i] && !pt.side && pt.field !== 'back' && pt.group !== 'hair' && pt.group !== 'neck') pts.push(mapPt(i)); });
  return lineFit(pts);
}
const reflectPt = (p, ax) => {
  const dx = p.x - ax.c.x, dy = p.y - ax.c.y, t = dx * ax.u.x + dy * ax.u.y;
  return { x: ax.c.x + 2 * t * ax.u.x - dx, y: ax.c.y + 2 * t * ax.u.y - dy };
};
/** Copy one side of the face onto the other, mirrored about the midline (front view). */
function copySide(from) {
  const m = S.map;
  if (!m || isProfile(m)) return;
  const ax = mapMidline();
  if (!ax) return;
  pushUndo();
  const moved = new Set();
  FM.POINTS.forEach((pt, i) => {
    if (pt.side !== (from === 'L' ? 1 : -1) || !m.vis[i]) return;
    const j = FM.MIRROR[i];
    if (j === i || !m.vis[j]) return;
    const r = reflectPt(mapPt(j), ax);
    m.p[2 * i] = r.x; m.p[2 * i + 1] = r.y; moved.add(i);
  });
  mapTouched(true); buildMask();
  syncPts(); syncUI();
  toast(`${from === 'L' ? 'Left' : 'Right'} side copied to the ${from === 'L' ? 'right' : 'left'}, mirrored — now touch up what differs`, 4500);
}
function toggleMirror() {
  cfg.mapMirror = !cfg.mapMirror; saveCfg();
  syncUI(); wake();
  toast(cfg.mapMirror ? 'Symmetry on — both sides move together (X turns it off)' : 'Symmetry off — touch up each side on its own', 3000);
}
/* quick fit with symmetry: the right-side point starts as the mirror of its clicked left partner */
function qfitAxis() {
  const q = S.qfit, by = id => { const c = q.hist.find(h => h && FM.POINTS[h.i].id === id); return c && c.b; };
  const mids = ['tri', 'gl', 'n', 'prn', 'sn', 'sto', 'me'].map(by).filter(Boolean);
  const pl = by('puL'), pr = by('puR');
  if (pl && pr) {
    // the pupils' perpendicular bisector, nudged through any midline points clicked so far
    const c = { x: (pl.x + pr.x) / 2, y: (pl.y + pr.y) / 2 }, L = Math.hypot(pr.x - pl.x, pr.y - pl.y) || 1;
    let u = { x: -(pr.y - pl.y) / L, y: (pr.x - pl.x) / L };
    if (u.y < 0) u = { x: -u.x, y: -u.y };
    if (mids.length >= 2) return lineFit([c, ...mids]);
    if (mids.length === 1) { const d = { x: mids[0].x - c.x, y: mids[0].y - c.y }, dl = Math.hypot(d.x, d.y); if (dl > L * .3) u = d.y < 0 ? { x: -d.x / dl, y: -d.y / dl } : { x: d.x / dl, y: d.y / dl }; }
    return { c, u };
  }
  return mids.length >= 2 ? lineFit(mids) : mapMidline();
}
/** Where the ring for this quick-fit step is (and what Enter accepts). */
function qfitGuess() {
  const q = S.qfit, st = qfitSteps()[q.step], i = st && FM.INDEX[qfitId(st)];
  if (i == null) return null;
  if (cfg.mapMirror && !isProfile()) {
    const j = FM.MIRROR[i], pj = q.hist.find(c => c && c.i === j), ax = j !== i && pj && qfitAxis();
    if (ax) return reflectPt(pj.b, ax);
  }
  return mapPt(i);
}
function qfitAccept() {
  const q = S.qfit, st = qfitSteps()[q.step], g = qfitGuess();
  if (!g) { qfitSkip(); return; }
  q.hist.push({ i: FM.INDEX[qfitId(st)], b: { x: g.x, y: g.y }, g: true });
  qfitNext();
}
// (after Auto-place, base holds the finder's dots: the clicks only add the hairline and ears)
function qfitRefit() { fitMap(S.map.view, [...(S.qfit.base || []), ...S.qfit.hist.filter(Boolean)]); placeDetail(null); }
function quickFitClick(sx, sy) {
  const q = S.qfit, st = qfitSteps()[q.step];
  let b = fwdMap(toI(sx, sy));   // position on the original photo
  if (st.refine === 'pupil') b = refinePupil(b);
  q.hist.push({ i: FM.INDEX[qfitId(st)], b });
  qfitNext();
}
/** Inner and outer ends clicked the wrong way round (a brow, an eye's corners): put them back. */
const QFIT_ENDS = [['biL', 'btL', 'brow'], ['biR', 'btR', 'brow'], ['enL', 'exL', 'eye corners'], ['enR', 'exR', 'eye corners']];
function qfitOrder() {
  const q = S.qfit, ax = qfitAxis();
  if (!ax || isProfile()) return;
  const off = b => Math.abs(ax.u.x * (b.y - ax.c.y) - ax.u.y * (b.x - ax.c.x));
  const at = id => q.hist.find(h => h && FM.POINTS[h.i].id === id);
  for (const [a, b, what] of QFIT_ENDS) {
    const ha = at(a), hb = at(b);
    if (!ha || !hb || off(ha.b) <= off(hb.b)) continue;
    const t = ha.b; ha.b = hb.b; hb.b = t;
    // other-side points that were accepted as mirror guesses of these follow them
    for (const h of [ha, hb]) {
      const p = q.hist.find(c => c && c.g && c.i === FM.MIRROR[h.i]);
      if (p) p.b = reflectPt(h.b, ax);
    }
    toast(`The ${what} looked the wrong way round — swapped (the inner end is the one nearer the nose)`, 4000);
  }
}
function qfitNext() {
  const q = S.qfit;
  q.step++;
  qfitOrder();
  if (q.hist.some(Boolean)) qfitRefit();
  if (q.step >= qfitSteps().length) { qfitFinish(); return; }
  syncUI(); wake();
}
function qfitSkip() { if (S.qfit) { S.qfit.hist.push(null); qfitNext(); } }
function qfitBack() {
  const q = S.qfit;
  if (!q || !q.step) return;
  q.step--; q.hist.pop();
  qfitRefit();
  syncUI(); wake();
}
async function qfitFinish() {
  const q = S.qfit;
  S.qfit = null;
  pushUndo(q.snap);
  // then pull the edge contours (and the eyes and lips) onto the photo's edges — its own undo step
  const snap2 = snapshot(), clicked = new Set([...(q.base || []), ...q.hist.filter(Boolean)].map(c => c.i));
  // (the dots you clicked or accepted are yours; the face finder's aren't)
  for (const c of q.hist) if (c) markUser(S.map, c.i);
  // the outer edge gently, then the eyes, brows and lips — never the points you clicked (after Auto-place
  // the finder already traced the eyes, brows and lips: only the hairline is left to find its edge);
  // then the bone and soft-tissue lines from the measured head, and the folds onto their crease; in
  // profile, the jaw's angle and the gnathion by their construction
  const n1 = snapEdges({ pinned: clicked, gentle: true }), n2 = q.auto ? 0 : snapEdges({ pinned: clicked, features: true });
  const n3 = q.auto ? 0 : await placeStructure(clicked) + snapFolds({ pinned: clicked }) + refineProfileJaw();
  if (n1 + n2 + n3) { pushUndo(snap2); estimateLight(); }
  syncPts(); syncUI();
  toast(q.auto ? 'Face map placed — check it, and drag anything that’s off (Ctrl+Z undoes it).'
    : 'Face map placed — the outer edge, eyes, brows and lips were fitted to the photo (Ctrl+Z undoes that). Pick a feature below to move it as a whole.', 6000);
}
function qfitCancel() {
  const q = S.qfit;
  S.qfit = null;
  if (q && (q.base || q.hist.some(Boolean))) pushUndo(q.snap);   // keep what was placed (Ctrl+Z takes it back)
  syncPts(); syncUI(); refreshCursor();
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
  if (S.orbit) { S.orbit = null; refreshCursor(); syncFaceMapPanel(); return; }
  if (S.mapDrag || S.mapBox || S.mapXf) morphUp(e);
  else if (S.zstroke) endSurfBrush();
  else if (S.hstroke) endHintBrush();
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
    if (!r.moved && !EDIT_TOOLS.has(S.tool) && !mapping()) onRightClick(e.clientX, e.clientY);
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
  if (surfStep() && S.surf && mapHitAt(e.clientX, e.clientY) == null) { S.rot3 = { yaw: 0, pitch: 0 }; wake(); return; }   // face it again
  if (mapping() && !lightStep() && S.map) {
    // double-click a dot: select its whole line (the shortest one it's on)
    const hit = mapHitAt(e.clientX, e.clientY);
    if (hit == null) return;
    let best = null;
    for (const c of S.map.contours) if (c.draw !== false && c.idx.includes(hit) && (!best || c.idx.length < best.idx.length)) best = c;
    if (best) { S.mapSel = new Set(best.idx.filter(i => dotShown(i) && !autoDot(i))); syncUI(); wake(); }
    return;
  }
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
  if (k === 'x' && mapping() && !e.repeat) { toggleMirror(); return; }
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
      else if (S.qfit) qfitCancel();
      else if (mapping() && S.mapSel.size) { S.mapSel.clear(); wake(); }
      else if (S.mapOpen) openFaceMap(false);
      else if (S.draft) cancelDraft(true);
      else if (S.tool !== 'move') setTool('move');
      else if (S.picked.size) { S.picked.clear(); syncUI(); }
      else if (S.sel.length || S.showAll) deselectAll();
      break;
    case 'Enter':
      if (S.qfit) { if (e.shiftKey) qfitSkip(); else qfitAccept(); break; }
      if (S.draft && S.draft.kind === 'segments' && !S.draft.need && S.draft.pts.length >= 3) commitDraft();
      break;
    case 'Backspace':
      e.preventDefault();
      if (S.qfit) { qfitBack(); break; }
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
addEventListener('blur', () => { S.space = false; S.shift = false; setCompare(false); if (S.stroke) endStroke(); if (S.tstroke) endTone(); if (S.zstroke) endSurfBrush(); if (S.hstroke) endHintBrush(); if (S.mapDrag || S.mapBox || S.mapXf) morphUp({}); });
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
  Object.assign(S, { map: null, mapSel: new Set(), mapHover: null, mapDrag: null, mapBox: null, qfit: null, anat: {}, anatBase: {}, anatHover: null, lum: null, tone: { field: null, base: null }, tstroke: null, mapOpen: false, surf: null, zstroke: null, hints: null, hstroke: null, mapXf: null, lightDir: null });
  S.toneRev++;
  glMaskVer = -1; glMapKey = '';
  customSig = null;
  S.imgRec = rec || null;
  S.imgSeq = ++imgSeqTop;   // (unique across the tabs: caches are keyed on it)
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
  toolOptsFor = null;
  renderToolOpts();
}

/* ---- the tabs at the bottom: Front · Side · 3D ----
   The front and the side photo each keep their own image, face map, measurements, view and undo
   history: switching tabs puts one away and brings the other back exactly as it was. The side tab maps
   a profile and lists the profile measurements; the front tab the rest. 3D is the front photo's face
   map as a 3D head (the Surface step, turned) — built from both maps when the side one is placed too. */
const SLOT_STATE = ['img', 'imgRec', 'iw', 'ih', 'imgSeq', 'imgA', 'view', 'viewT', 'fitK', 'meas', 'sel', 'active', 'showAll', 'refId', 'calibId', 'calibMM',
  'undo', 'redo', 'adj', 'warp', 'map', 'mapOpen', 'mapStep', 'lightDir', 'rot3', 'surf', 'hints', 'anat', 'anatBase', 'tone'];
function blankSlot() {
  return {
    img: null, imgRec: null, iw: 0, ih: 0, imgSeq: ++imgSeqTop, imgA: 1, view: { x: 0, y: 0, k: 1 }, viewT: { x: 0, y: 0, k: 1 }, fitK: 1,
    meas: new Map(), sel: [], active: null, showAll: false, refId: null, calibId: null, calibMM: 11.7, undo: [], redo: [],
    adj: DEFAULT_ADJ(), warp: { field: null, gw: 1, gh: 1, cs: 1 }, map: null, mapOpen: false, mapStep: 'points', lightDir: null,
    rot3: { yaw: 0, pitch: 0 }, surf: null, hints: null, anat: {}, anatBase: {}, tone: { field: null, base: null },
  };
}
slots.side = blankSlot();
/** Which tab is showing: the side photo, the front photo's 3D head, or the front photo. */
function curTab() { return curSlot === 'side' ? 'side' : mapping() && S.mapStep === 'surface' ? '3d' : 'front'; }
/** Groups of measurement presets each photo lists (a profile's angles only on the side photo). */
function slotHasGroup(g) { return curSlot === 'side' ? g === 'Profile' : g !== 'Profile'; }
function slotPresets() { return PRESET_IDS.filter(id => slotHasGroup(P[id].group)); }
function useSlot(name) {
  if (name === curSlot) return;
  // finish what's in progress here (a quick fit keeps what was placed), then put this photo away
  if (S.qfit) qfitCancel();
  if (S.mapDrag || S.mapBox || S.mapXf) morphUp({});
  if (S.stroke) endStroke();
  if (S.tstroke) endTone();
  if (S.zstroke) endSurfBrush();
  if (S.hstroke) endHintBrush();
  const away = { vw: W, vh: H };
  for (const k of SLOT_STATE) away[k] = S[k];
  slots[curSlot] = away;
  const o = slots[name] || blankSlot();
  slots[name] = null;
  curSlot = name;
  for (const k of SLOT_STATE) S[k] = o[k];
  Object.assign(S, { draft: null, draftM: null, drag: null, mdrag: null, press: null, pan: null, rpress: null, box: null, hover: null, listHover: null, leaving: [],
    mapHover: null, mapDrag: null, mapBox: null, mapXf: null, qfit: null, orbit: null, stroke: null, tstroke: null, zstroke: null, hstroke: null, hdrag: null, compare: false, sfaSnap: null });
  S.picked = new Set(); S.mapSel = new Set();
  // nothing cached for the other photo is reused
  S.toneRev++; glMaskVer = -1; glMapKey = ''; customSig = null;
  stageZ = null; stageMeshKey = ''; stageOvKey = ''; stageKey = '';
  S.glDirty = true; S.fieldDirty = true;
  body.classList.toggle('has-img', !!S.img);
  if (!S.img) { octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height); loupe._on = false; loupe.classList.remove('on'); }
  else if (o.vw !== W || o.vh !== H) fitView(true);
  toolOptsFor = null; renderToolOpts();
  applyFilter();
  syncPts(); syncUI();
}
function enter3D() {
  if (!S.img) { syncUI(); toast('Add the front photo first — the 3D head is built from its face map', 5000); return; }
  if (!S.map || !S.map.snapped) { openFaceMap(true); syncUI(); toast('Place the front face map first (Auto-place or Quick fit) — the 3D head is built from it', 6000); return; }
  back3D = { open: S.mapOpen, step: S.mapStep === 'surface' ? 'points' : S.mapStep };
  openFaceMap(true);
  S.mapStep = 'surface'; S.qfit = null; S.mapSel.clear(); S.mapHover = null;
  if (/^h[A-Z]/.test(cfg.surfBrush || '')) cfg.surfBrush = '';
  if (!S.surf || S.surf.view !== S.map.view || S.surf.pver !== S.map.pver || S.surf.deps !== surfDeps()) buildSurface({ auto: true });
  S.rot3 = { yaw: .55, pitch: .1 };
  S.glDirty = true; syncUI();
  if (!sideProfile()) toast(slots.side && slots.side.map && slots.side.map.snapped ? 'The side map didn’t line up with the front one — check its dots' : 'Built from the front photo alone — map the side photo too for the true profile', 5000);
}
function leave3D() {
  if (curSlot !== 'front' || curTab() !== '3d') return;
  S.mapStep = back3D ? back3D.step : 'points';
  if (back3D && !back3D.open) openFaceMap(false);
  S.rot3 = { yaw: 0, pitch: 0 }; back3D = null;
  S.glDirty = true;
}
function goTab(t) {
  if (t === curTab()) return;
  // mapping one photo and switching to the other: that one opens for mapping too
  const wasMapping = mapping();
  if (t === 'side') { leave3D(); useSlot('side'); }
  else if (t === 'front') { useSlot('front'); leave3D(); }
  else { useSlot('front'); enter3D(); }
  if (t !== '3d' && wasMapping && S.img && !S.mapOpen) { if (S.mapStep === 'surface' || curSlot === 'side') S.mapStep = 'points'; openFaceMap(true); }
  syncUI();
}
function syncSlotBar() {
  const t = curTab(), has = n => n === curSlot ? S : slots[n === '3d' ? 'front' : n];
  $$('#slots [data-slot]').forEach(b => {
    const n = b.dataset.slot, d = n === '3d' ? has('front') : has(n);
    b.classList.toggle('on', n === t);
    b.classList.toggle('done', !!(d && d.map && d.map.snapped && (n !== '3d' || (d.surf && d.surf.view === d.map.view))));
    b.classList.toggle('has', !!(d && d.img));
  });
  // the landing card names the photo it wants
  const side = curSlot === 'side';
  setText($('#drop h1'), side ? 'Add the side photo' : 'Add the front photo');
  setText($('#drop .drop-zone p'), side ? 'A true side profile of the same person — drop it here, paste it, or browse your files.' : 'Drop a photo here, paste it, or browse your files.');
}

$('#slots').addEventListener('click', e => { const b = e.target.closest('[data-slot]'); if (b) goTab(b.dataset.slot); });
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
  try { await Promise.all([document.fonts.load('500 12px Jost'), document.fonts.load('600 12px Jost')]); } catch (e) { /* system fonts */ }
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
  if (S.mapOpen) openFaceMap(false);   // a measurement and the face map aren't selected together
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
  if (S.mapOpen) { openFaceMap(false); return; }
  if (!S.sel.length && !S.showAll) return;
  S.sel = []; S.active = null; S.showAll = false;
  if (S.draft && S.draft.preset) { S.draft = null; S.draftM = null; }
  syncUI();
}
function toggleShowAll() {
  if (S.mapOpen) openFaceMap(false);
  S.showAll = !S.showAll;
  S.sel = []; S.active = null;
  if (S.draft && S.draft.preset) { S.draft = null; S.draftM = null; }
  syncUI();
}
/** Select keeps the open layers; a drawing tool returns to free mode. */
/** Select, Morph and Adjust keep the open layers (so ratios stay in view); drawing tools return to free mode. */
function setTool(t) {
  if (S.zstroke) endSurfBrush();
  if (S.hstroke) endHintBrush();
  if (t !== 'move' && S.mapOpen) openFaceMap(false);   // editing the face map is part of Select
  if (S.draft) { S.draft = null; S.draftM = null; }
  if (S.stroke) endStroke();
  if (S.tstroke) endTone();
  if (S.mapDrag || S.mapBox || S.mapXf) morphUp({});
  if (EDIT_TOOLS.has(t) && !GLR) toast(GL_MESSAGES[GL_REASON] || GL_MESSAGES.webgl, 7000);
  S.tool = t;
  S.qfit = null; S.mapHover = null; S.anatHover = null;
  if (!S.mapOpen) S.mapSel.clear();
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
    const levels = [
      ['bone', 'Bone', 'skeleton — shows through the soft tissue above it'],
      ['soft', 'Soft tissue', 'fat and muscle — scales with tissue depth'],
      ['shape', 'Proportions', 'lengths and positions'],
    ];
    const opRow = o => `<label class="srow arow" data-op="${o.key}"${o.help ? ` title="${esc(o.help)}"` : ''}><span><i class="lv" style="--c:${LEVEL_COLORS[o.level]}"></i>${esc(o.label)}</span><input class="rng bi" type="range" id="op_${o.key}" min="-100" max="100" step="1" style="--c:${LEVEL_COLORS[o.level]}"><b id="op_${o.key}V"></b></label>`;
    const morphPane = `
      <div class="to-sec"><span>Structure</span><span class="lv-key">hover a slider to see where it acts</span></div>
      <div id="mNoMap" class="to-callout">
        <p class="to-note">The structure controls work on the face map. Place it first — four clicks (it's in the right panel, above the measurements).</p>
        <button type="button" class="btn sm" id="mGoMap">Place face map</button>
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
      ${morphPane}
      <div class="to-confirm" id="mPending">
        <span class="to-status" id="mStatus"></span>
        <div class="to-actions" style="margin-top:8px">
          <button type="button" class="btn sm" id="mConfirm">Confirm</button>
          <button type="button" class="btn ghost sm" id="mReset">Reset</button>
          <button type="button" class="btn ghost sm" id="mCompare">Hold to compare</button>
        </div>
      </div>
      <p class="to-note" style="margin-top:10px"><kbd>[</kbd> <kbd>]</kbd> brush size · hold <kbd>B</kbd> to compare · double-click a slider name to reset it</p>`;
    {
      $('#mGoMap').addEventListener('click', startQuickFit);
      $('#mAnat').addEventListener('click', e => {
        const h = e.target.closest('[data-open]');
        if (!h) return;
        cfg.mOpen = cfg.mOpen === h.dataset.open ? '' : h.dataset.open; saveCfg(); syncToolOpts();
      });
      // one undo step per slider gesture
      const start = () => { if (!S.anatSnap) S.anatSnap = snapshot(); };
      // while a slider is dragged, the landmarks catch up once per frame (the warp fit is the slow part)
      let ptsRaf = 0;
      const flushPts = () => { if (ptsRaf) { cancelAnimationFrame(ptsRaf); ptsRaf = 0; } syncPts(); };
      const commit = () => { flushPts(); if (S.anatSnap) { pushUndo(S.anatSnap); S.anatSnap = null; syncUI(); } };
      const setOp = (key, v) => {
        S.anat[key] = v; if (S.map) mapTouched(false);
        S.glDirty = true; wake(); syncToolOpts();
        if (!ptsRaf) ptsRaf = requestAnimationFrame(() => { ptsRaf = 0; syncPts(); });
      };
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
    const pending = morphPending();
    $('#mConfirm').disabled = !pending;
    $('#mReset').disabled = !pending;
    $('#mPending').classList.toggle('pending', pending);
    setText($('#mStatus'), pending ? 'Unconfirmed changes' : (S.warp.field || anatOn() || toneOn()) ? 'All changes confirmed' : 'No morph yet');
    {
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
      // (each photo lists its own presets: the profile's on the side photo, the rest on the front one)
      const hit = slotHasGroup(it.group) && (!q || (it.name + ' ' + (it.full || '') + ' ' + it.group).toLowerCase().includes(q));
      itemEls.get(id).classList.toggle('hidden', !hit);
      any = any || hit;
    }
    G.sec.classList.toggle('hidden', !any);
  }
}
$('#filter').addEventListener('input', applyFilter);
$('#filter').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; applyFilter(); e.target.blur(); } });

panel.addEventListener('click', e => {
  if (e.target.closest('.item, .grp-head, button, input, label, .readout, .search, .fmap')) return;
  deselectAll();
});
$('#btnShowAll').addEventListener('click', toggleShowAll);
// the panel's two pages: the face map (opens it) or the measurements (closes it; from 3D, back to the photo)
$('#ptabs').addEventListener('click', e => {
  const b = e.target.closest('[data-pt]');
  if (!b) return;
  if (b.dataset.pt === 'map') { if (!mapping()) openFaceMap(true); }
  else if (mapping()) { if (curTab() === '3d') goTab('front'); openFaceMap(false); }
});
function syncPanelPage() {
  const onMap = mapping(), sp = slotPresets(), n = sp.filter(id => S.meas.has(id)).length;
  panel.classList.toggle('pt-map', onMap);
  panel.classList.toggle('pt-meas', !onMap);
  const [tm, tz] = $$('#ptabs [data-pt]');
  tm.classList.toggle('on', onMap); tz.classList.toggle('on', !onMap);
  tm.classList.toggle('has', !!S.map); tz.classList.toggle('has', n > 0 || customs().length > 0);
  setText($('#ptCount'), n ? `${n}/${sp.length}` : '');
}
$('#btnPanel').addEventListener('click', () => panel.classList.toggle('open'));

/* ------------------------------------------------------- face map panel --
   The face map is a layer of its own, above the measurements: click it to select it (its dots
   show on the photo, unchanged, and can be dragged), click it again or press Esc to close it. */
const fmapEl = $('#fmap'), fmapItem = $('#fmapItem');
const VIEW_LABEL = { front: 'Front', left: '◀ Profile', right: 'Profile ▶' };
function buildFaceMapPanel() {
  if (!FM) { fmapEl.hidden = true; return; }
  $('#fmapBody').innerHTML = `
    <div class="seg full msub" id="fmStep">
      <button type="button" data-v="points" title="Place the dots on the face"><b>1</b>Points</button><button type="button" data-v="light" title="Check the light, and mark which bright and dark spots are shape"${SF ? '' : ' disabled'}><b>2</b>Light</button><button type="button" data-v="surface" title="A 3D surface of the face from the dots, the light and the marks"${SF ? '' : ' disabled'}><b>3</b>Surface</button>
    </div>
    <div id="fmPoints">
    <div class="seg full mview" id="mView">
      <button type="button" data-v="front">Front</button><button type="button" data-v="left" title="Face looking to the left">◀ Profile</button><button type="button" data-v="right" title="Face looking to the right">Profile ▶</button>
    </div>
    <p class="to-note" id="mMapStatus"></p>
    <div class="to-actions" style="margin:2px 0 10px">
      <button type="button" class="btn sm" id="mFind" title="Find the face and place every dot automatically (Google’s MediaPipe face finder, run in your browser — the photo isn’t uploaded; the first time it loads ≈ 6 MB)">Auto-place</button>
      <button type="button" class="btn ghost sm" id="mQuick">Quick fit · guided</button>
      <button type="button" class="btn ghost sm" id="mSnap" title="Pull the edge dots (face edge, hairline, hair, neck) and the eye and lip outlines onto the edges in the photo">Snap to edges</button>
      <button type="button" class="btn ghost sm" id="mAuto" title="Re-place the map from your measured landmarks">Fit to landmarks</button>
    </div>
    <div class="to-actions" style="margin:-4px 0 10px"><button type="button" class="btn ghost sm" id="mExport" title="Save every dot, depth fix and measurement as a text file (JSON)">Export map</button><button type="button" class="btn ghost sm" id="mImport" title="Place a saved face map (and its measurements) on this photo">Import map</button></div>
    <div class="sym-box">
      <label class="tg sm"><span>Symmetry <kbd>X</kbd><small>Both sides move together, mirrored. In Quick fit the right-side ring starts as the mirror of your left click — Enter accepts it. Turn it off for touch-ups.</small></span><input type="checkbox" class="sw-toggle" id="mMirror"></label>
      <div class="to-actions" style="margin:0 0 4px"><button type="button" class="btn ghost sm" id="mCopyL" title="Make the right side a mirror image of the left">Copy left → right</button><button type="button" class="btn ghost sm" id="mCopyR" title="Make the left side a mirror image of the right">Copy right → left</button></div>
    </div>
    <label class="tg sm"><span>Auto detail dots<small>The small dots between the named ones follow them by themselves — about half as many dots to place. Off: place them by hand.</small></span><input type="checkbox" class="sw-toggle" id="mAutoDet"></label>
    <div class="to-label">Dots <small>click to hide a group</small></div>
    <div class="chips" id="mGroups">${MAP_GROUPS.map(([g, label, c]) => `<button type="button" class="chip-dot" data-g="${g}" style="--c:${c}"><i></i>${label}</button>`).join('')}</div>
    <div class="to-label">Select a feature <small>then drag it, or scale and rotate it with the box</small></div>
    <div class="chips looks" id="mFeat"></div>
    <div class="to-label">Editing</div>
    <label class="tg sm"><span>Soft move<small>Dragging a dot pulls the dots around it along, fading with distance</small></span><input type="checkbox" class="sw-toggle" id="mSoft"></label>
    <div id="mSoftRow">${sliderRow('mSoftR', 'Reach', 5, 100, 1, 'How far the pull reaches')}</div>
    <p class="to-note">Double-click a dot to select its whole line. With several selected, drag a corner of the box to scale them or the knob to rotate them.</p>
    <label class="tg sm"><span>Show layers<small>Teal = the face layer, blue = hair, ears, neck and background behind it</small></span><input type="checkbox" class="sw-toggle" id="mShowLayers"></label>
    <p class="to-note">Drag dots onto the face — the photo is shown unchanged here. Box-select or <kbd>Shift</kbd>-click to move several, arrow keys nudge, <kbd>Ctrl</kbd> <kbd>A</kbd> selects all. Hover a dot to see its name and tissue depth. Then go to <b>Light</b>.</p>
    </div>
    <div id="fmLight" hidden>
      <p class="to-note"><b>Optional</b> — everything here is read from the photo automatically, so you can go straight to Surface. Check it when the 3D looks wrong: where the light comes from, and which bright and dark spots come from the shape. The surface (step 3) uses exactly this.</p>
      <div class="lg-row"><canvas id="lgBall" width="240" height="240" title="Drag to put the light where it is in the photo"></canvas><div class="lg-side"><p class="to-note" id="lgStatus"></p><button type="button" class="btn ghost sm" id="lgAuto">Read from the photo</button></div></div>
      <div class="to-label">View</div>
      <div class="chips looks" id="lgViews"><button type="button" class="chip-dot look" data-v="shading" title="The photo's light and shade with the skin colour taken out — this is what the surface has to explain">Shading</button><button type="button" class="chip-dot look" data-v="expected" title="How the dots' shape would look in this light — compare it with Shading">Dots' shape lit</button><button type="button" class="chip-dot look" data-v="photo">Photo</button></div>
      ${sliderRow('lgAlpha', 'Overlay', 0, 100, 1)}
      <div class="to-label">Marks <small>yellow = highlight, blue = shadow, grey = not shape</small></div>
      <div class="seg full mmode" id="sfHint"><button type="button" data-v="hHigh" title="A bright spot caused by the shape catching the light">Highlight</button><button type="button" data-v="hShad" title="A dark spot caused by the shape turning away from the light">Shadow</button><button type="button" data-v="hIgn" title="Brightness that isn't shape: stubble, make-up, a mole, shine, a cast shadow">Not shape</button><button type="button" data-v="hErase">Erase</button></div>
      ${sliderRow('lgSize', 'Size', 1, 50, .1)}
      ${sliderRow('lgStrength', 'Strength', 1, 100, 1)}
      <div class="to-actions" style="margin:2px 0 6px"><button type="button" class="btn ghost sm" id="lgDetect" title="Mark the colours that aren't skin (stubble, make-up, lips' edge) as Not shape again">Detect again</button><button type="button" class="btn ghost sm" id="sfHintClear">Clear marks</button></div>
      <p class="to-note"><b>Not shape</b> is marked automatically where the colour isn't skin. Add it over <b>cast shadows</b> (under the nose, from hair) and <b>shine</b> — they don't come from the skin facing away from or toward the light. Paint <b>Highlight</b> / <b>Shadow</b> only where you know the shape makes them; the surface then follows them more closely.</p>
      <div class="to-actions"><button type="button" class="btn sm" id="lgNext">Build the surface →</button></div>
    </div>
    <div id="fmSurface" hidden>
      <p class="to-note" id="sfStatus"></p>
      <div class="to-actions" style="margin:2px 0 10px">
        <button type="button" class="btn sm" id="sfBuild">Build surface</button>
        <button type="button" class="btn ghost sm" id="sfFront" title="Face the photo again (or double-click it)">Front view</button>
        <button type="button" class="btn ghost sm" id="sfSide" title="Load a saved face map file of a side (profile) photo of the same person: its profile sets the depths a front photo can't show. (Or map the side photo in the Side tab — it's used here by itself.)">Side map file…</button>
      </div>
      <div id="sfAnat" class="sf-anat" hidden></div>
      ${sliderRow('sfTrust', 'Follow the photo', 0, 100, 1, 'How far the photo’s light and shade may change the anatomy from the average face (right) or keep it (left). Rebuild to apply.')}
      <p class="to-note">The photo is now 3D: <b>drag it to turn</b> the face, double-click to face it again. <b>Turned, drag a dot</b> to set its depth (the chin forward, a cheek back): it stays where it is on the photo and the surface bends to it. Facing you, dots move on the photo as usual.</p>
      <div class="to-label">Look</div>
      <div class="seg full" id="sfMode" style="margin-bottom:10px"><button type="button" data-v="photo">Photo</button><button type="button" data-v="clay">Clay</button><button type="button" data-v="wire">Wire</button></div>
      ${sliderRow('sfDetail', 'Fine detail', 0, 100, 1, 'Free relief read straight from the photo’s brightness, on top of the anatomy. Off (0) by default: on real photos shine, stubble and side light come out as humps. Raise it a little for more texture. Rebuild to apply.')}
      <div class="to-label">View</div>
      <div class="chips looks" id="sfViews">${SURF_VIEWS.map(([v, n, tip]) => `<button type="button" class="chip-dot look" data-v="${v}" title="${esc(tip)}">${n}</button>`).join('')}</div>
      <div id="sfSweepRow">${sliderRow('sfSweep', 'Level', 0, 100, 1, 'The brightness level to magnify')}</div>
      <div class="seg full" id="sfPca"><button type="button" data-v="0">PC 1</button><button type="button" data-v="1">PC 2</button><button type="button" data-v="2">PC 3</button></div>
      ${sliderRow('sfAlpha', 'Overlay', 0, 100, 1)}
      <div class="sf-legend" id="sfLegend"></div>
      <div class="to-label">Fix the surface <small>hold on the photo</small></div>
      <div class="seg full mmode" id="sfBrush"><button type="button" data-v="">Look</button><button type="button" data-v="raise">Raise</button><button type="button" data-v="lower">Lower</button><button type="button" data-v="smooth">Smooth</button><button type="button" data-v="restore">Restore</button></div>
      ${sliderRow('sfSize', 'Size', 1, 50, .1)}
      ${sliderRow('sfStrength', 'Strength', 1, 100, 1)}
      <div class="to-actions" style="margin:2px 0 6px"><button type="button" class="btn ghost sm" id="sfClear">Clear fixes</button></div>
      <label class="tg sm"><span>Use for morphing<small>Morph works on this surface: its depth for the anatomy, the photo’s measured light for the shading</small></span><input type="checkbox" class="sw-toggle" id="sfUse"></label>
    </div>`;
  fmapItem.addEventListener('click', e => {
    if (e.target.closest('.it-x')) { clearFaceMap(); return; }
    openFaceMap(!S.mapOpen);
  });
  $('#fmStep').addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b || b.disabled || S.mapStep === b.dataset.v) return;
    // (the front photo's Surface step is the 3D tab)
    if (b.dataset.v === 'surface' && curSlot === 'front') { goTab('3d'); return; }
    if (curTab() === '3d') { S.rot3 = { yaw: 0, pitch: 0 }; back3D = null; }   // (back to the front tab, at that step)
    S.mapStep = b.dataset.v; S.qfit = null; S.mapSel.clear(); S.mapHover = null;
    // keep the brush that belongs to the step
    if (S.mapStep === 'light' && !/^h[A-Z]/.test(cfg.surfBrush || '')) cfg.surfBrush = '';
    if (S.mapStep === 'surface' && /^h[A-Z]/.test(cfg.surfBrush || '')) cfg.surfBrush = '';
    if (S.mapStep === 'light' && S.map && !S.hints) detectMarks(true);
    if (S.mapStep === 'surface' && S.map && (!S.surf || S.surf.view !== S.map.view || S.surf.pver !== S.map.pver || S.surf.deps !== surfDeps())) buildSurface();
    S.glDirty = true; syncUI();
  });
  $('#sfBuild').addEventListener('click', () => buildSurface());
  $('#sfFront').addEventListener('click', () => { S.rot3 = { yaw: 0, pitch: 0 }; syncFaceMapPanel(); wake(); });
  $('#sfMode').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { cfg.surfMode = b.dataset.v; saveCfg(); syncFaceMapPanel(); wake(); } });
  $('#mExport').addEventListener('click', exportFaceMap);
  $('#mImport').addEventListener('click', () => $('#mapFile').click());
  $('#mapFile').addEventListener('change', e => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) importFaceMap(file); });
  $('#sfSide').addEventListener('click', () => $('#sideFile').click());
  $('#sideFile').addEventListener('change', e => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) importSideMap(file); });
  $('#sfViews').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { cfg.surfView = b.dataset.v; saveCfg(); syncFaceMapPanel(); wake(); } });
  $('#sfPca').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { cfg.surfPca = +b.dataset.v; saveCfg(); syncFaceMapPanel(); wake(); } });
  const pickSurfBrush = e => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) { cfg.surfBrush = cfg.surfBrush === b.dataset.v && b.dataset.v ? '' : b.dataset.v; saveCfg(); syncFaceMapPanel(); renderHint(); refreshCursor(); wake(); } };
  $('#sfBrush').addEventListener('click', pickSurfBrush);
  $('#sfHint').addEventListener('click', pickSurfBrush);
  $('#sfHintClear').addEventListener('click', () => {
    if (!S.hints) return;
    pushUndo();
    S.hints = null;
    syncUI();
  });
  bindLightBall();
  $('#lgAuto').addEventListener('click', () => { if (!S.lightDir) return; pushUndo(); S.lightDir = null; syncUI(); wake(); });
  $('#lgViews').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { cfg.lightView = b.dataset.v; saveCfg(); syncFaceMapPanel(); wake(); } });
  $('#lgDetect').addEventListener('click', () => detectMarks(false));
  $('#lgNext').addEventListener('click', () => $('#fmStep [data-v="surface"]').click());
  $('#mFeat').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b && S.map) selectFeature(FEATURES[isProfile() ? 'profile' : 'front'][+b.dataset.f][1]); });
  const sbind = (id, key, f) => $('#' + id).addEventListener('input', e => { cfg[key] = f(+e.target.value); saveCfg(); syncFaceMapPanel(); wake(); });
  sbind('sfTrust', 'surfTrust', v => v / 100);
  sbind('sfDetail', 'surfDetail', v => v / 100);
  sbind('lgAlpha', 'surfAlpha', v => v / 100);
  sbind('lgSize', 'mSize', v => v / 100);
  sbind('lgStrength', 'mStrength', v => v / 100);
  sbind('sfSweep', 'surfSweep', v => v / 100);
  sbind('sfAlpha', 'surfAlpha', v => v / 100);
  sbind('sfSize', 'mSize', v => v / 100);
  sbind('sfStrength', 'mStrength', v => v / 100);
  $('#sfClear').addEventListener('click', () => {
    if (!S.surf || !S.surf.edit) return;
    pushUndo();
    S.surf = { ...S.surf, edit: null, rev: ++surfRev, _zt: null };
    S.glDirty = true; syncPts(); syncUI();
  });
  $('#sfUse').addEventListener('change', e => { cfg.surfUse = e.target.checked; saveCfg(); S.glDirty = true; syncPts(); syncUI(); });
  $('#mView').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setMapView(b.dataset.v); });
  $('#mShowLayers').addEventListener('change', e => { cfg.mShowLayers = e.target.checked; saveCfg(); S.glDirty = true; wake(); });
  $('#mSoft').addEventListener('change', e => { cfg.mapSoft = e.target.checked; saveCfg(); syncFaceMapPanel(); wake(); });
  $('#mSoftR').addEventListener('input', e => { cfg.mapSoftR = +e.target.value / 100; saveCfg(); syncFaceMapPanel(); wake(); });
  $('#mMirror').addEventListener('change', e => { if (!!cfg.mapMirror !== e.target.checked) toggleMirror(); });
  $('#mCopyL').addEventListener('click', () => copySide('L'));
  $('#mCopyR').addEventListener('click', () => copySide('R'));
  $('#mAutoDet').addEventListener('change', e => {
    cfg.mapAutoDetail = e.target.checked; saveCfg();
    if (cfg.mapAutoDetail && S.map) { pushUndo(); placeDetail(null); mapTouched(true); buildMask(); syncPts(); }
    S.mapSel = new Set([...S.mapSel].filter(i => !autoDot(i)));
    syncUI(); wake();
  });
  $('#mQuick').addEventListener('click', () => { if (S.qfit) qfitCancel(); else startQuickFit(); });
  $('#mFind').addEventListener('click', autoPlace);
  $('#mSnap').addEventListener('click', () => {
    if (!S.map) return;
    const snap = snapshot(), n = snapEdges() + snapFolds() + refineProfileJaw();
    if (n) { pushUndo(snap); estimateLight(); syncPts(); syncUI(); }
    toast(n ? `Snapped ${n} dot${n === 1 ? '' : 's'} to edges — check them` : 'No clear edges found near the dots — drag them instead', 4000);
  });
  $('#mAuto').addEventListener('click', () => {
    const snap = snapshot(), n = fitMap();
    pushUndo(snap); S.mapSel.clear(); syncPts(); syncUI();
    toast(n ? `Face map placed from ${n} of your landmarks` : 'No landmarks measured yet — use Quick fit instead', 4000);
  });
  $('#mGroups').addEventListener('click', e => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    const g = b.dataset.g;
    if (S.hideGroups.has(g)) S.hideGroups.delete(g); else S.hideGroups.add(g);
    S.mapSel = new Set([...S.mapSel].filter(i => !S.hideGroups.has(FM.POINTS[i].group)));
    syncFaceMapPanel(); wake();
  });
}
function syncFaceMapPanel() {
  if (!FM) return;
  const m = S.map, open = mapping(), shown = m ? m.vis.reduce((a, v) => a + v, 0) : 0;
  fmapEl.classList.toggle('open', open);
  fmapItem.classList.toggle('sel', open);
  fmapItem.classList.toggle('measured', !!m);
  setText(fmapItem.querySelector('.it-sub'), m ? `${VIEW_LABEL[m.view]} · ${shown} dots${S.surf && S.surf.view === m.view ? ' · surface' : ''}` : 'Not placed — click to start');
  setText(fmapItem.querySelector('.it-val'), m ? (m.snapped ? 'fitted' : 'guess') : '');
  if (!open) return;
  const st = S.mapStep, side = curSlot === 'side';
  $$('#fmStep [data-v]').forEach(b => {
    b.classList.toggle('on', b.dataset.v === st);
    // the side photo is mapped for its profile: its light and 3D are the front photo's (3D tab)
    if (b.dataset.v !== 'points') {
      if (b.dataset.t0 == null) b.dataset.t0 = b.title;
      b.disabled = side || !SF; b.title = side ? 'The 3D head is built on the front photo, with this profile — open the 3D tab' : b.dataset.t0;
    }
  });
  $('#fmPoints').hidden = st !== 'points';
  $('#fmLight').hidden = st !== 'light';
  $('#fmSurface').hidden = st !== 'surface';
  if (st === 'light') { syncLightPane(); return; }
  if (st === 'surface') { syncSurfacePane(); return; }
  // feature buttons for this view
  const fk = m && isProfile(m) ? 'profile' : 'front', fe = $('#mFeat');
  if (fe._k !== fk) { fe._k = fk; fe.innerHTML = FEATURES[fk].map(([n], q) => `<button type="button" class="chip-dot look" data-f="${q}">${n}</button>`).join(''); }
  $$('#mFeat [data-f]').forEach(b => { b.disabled = !m; });
  $$('#mView [data-v]').forEach(b => { b.classList.toggle('on', !!m && b.dataset.v === m.view); b.hidden = side === (b.dataset.v === 'front'); });
  $('#mView').hidden = !side;   // (the front photo is mapped from the front; the side one faces left or right)
  $('#mShowLayers').checked = !!cfg.mShowLayers;
  $('#mSoft').checked = !!cfg.mapSoft; $('#mSoftRow').hidden = !cfg.mapSoft;
  setRange('mSoftR', Math.round(cfg.mapSoftR * 100), Math.round(cfg.mapSoftR * 100) + '%');
  $('#mMirror').checked = !!cfg.mapMirror;
  $('#mCopyL').disabled = $('#mCopyR').disabled = !m || isProfile(m);
  $('#mAutoDet').checked = !!cfg.mapAutoDetail;
  $('#mExport').disabled = !m && !S.meas.size;
  const qb = $('#mQuick');
  setText(qb, S.qfit ? `Stop quick fit (${S.qfit.step + 1}/${qfitSteps().length})` : 'Quick fit · guided');
  qb.classList.toggle('on', !!S.qfit);
  const fb = $('#mFind');
  setText(fb, autoBusy ? 'Finding the face…' : 'Auto-place');
  fb.disabled = autoBusy || !!S.qfit || (!!m && isProfile(m));
  $('#mAuto').disabled = !m || !FM.POINTS.some(pt => { const l = lmLabel(pt, m.view); return l && landmarkS(l); });
  $('#mSnap').disabled = !m || !!S.qfit;
  $$('#mGroups [data-g]').forEach(b => b.classList.toggle('off', S.hideGroups.has(b.dataset.g)));
  setText($('#mMapStatus'), !m ? 'Not placed yet — use Auto-place (or Quick fit).'
    : S.qfit ? `Step ${S.qfit.step + 1} of ${qfitSteps().length}: ${qfitSteps()[S.qfit.step].label}. The ring shows the current guess.`
    : S.mapSel.size ? `${S.mapSel.size} dot${S.mapSel.size === 1 ? '' : 's'} selected of ${shown}.`
    : m.snapped ? `${shown} dots in view, ${m.snapped} placed from your landmarks or clicks. Check the edges.`
    : `${shown} dots centred on a guess — use Quick fit, then drag the dots onto the face.`);
}
/* -------------------------------------------------------------- readout -- */

let RO = null, roKey = '';

function freeReadout() {
  const t = TOOLS[S.tool], cal = S.meas.get(S.calibId);
  const ids = slotPresets(), done = ids.filter(id => S.meas.has(id)).length;
  return `
    <div class="ro-kicker">${S.showAll ? 'All layers' : 'Free measure'}</div>
    <div class="ro-title">${S.showAll ? 'Showing everything' : t.title}</div>
    <p class="ro-desc">${S.showAll ? 'Every measurement is overlaid. Export saves exactly what you see as an annotated image.' : t.help}</p>
    <div class="ro-meta"><span>Scale</span><button class="link" type="button" data-act="calib">${cal ? fmtNum(S.calibMM) + ' mm reference' : 'Not calibrated'}</button></div>
    <div class="ro-meta"><span>Measured</span><span>${done} / ${ids.length} presets · ${customs().length} custom</span></div>`;
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
    if (mapping() && S.qfit) {
      html = `<b>Quick fit · ${S.qfit.step + 1}/${qfitSteps().length}</b><span class="h-desc">${qfitSteps()[S.qfit.step].label} · <kbd>Enter</kbd> use the ring · <kbd>Shift</kbd> <kbd>Enter</kbd> skip · <kbd>Backspace</kbd> back · <kbd>Esc</kbd> stop</span>`;
    } else if (lightStep()) {
      html = `<b>Face light</b><span class="h-desc">${isHintBrush() ? 'Hold on the photo to ' + SURF_BRUSH_TEXT[cfg.surfBrush] : 'Drag the ball to move the light · pick a brush to correct the marks · drag to pan'} · <kbd>Esc</kbd> closes</span>`;
    } else if (surfStep()) {
      html = `<b>Face surface · 3D</b><span class="h-desc">${S.surf ? (fixBrush() ? 'Hold on the photo to ' + SURF_BRUSH_TEXT[cfg.surfBrush] : 'Drag to turn the face · turned, drag a dot to set its depth · double-click to face it') : 'Building the surface from your dots and the photo’s light…'} · <kbd>Esc</kbd> closes</span>`;
    } else if (mapping()) {
      html = `<b>Face map${cfg.mapMirror ? ' · symmetry on' : ''}</b><span class="h-desc">Drag the dots onto the face (shown unchanged) · box or <kbd>Shift</kbd> selects several · <kbd>X</kbd> symmetry · <kbd>Esc</kbd> closes</span>`;
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
  const sp = slotPresets();
  $('#progress').textContent = `${sp.filter(id => S.meas.has(id)).length}/${sp.length}`;
  syncSlotBar();
  $('#btnShowAll').classList.toggle('on', S.showAll);
  const placingPreset = !!(tgt && tgt.preset);
  const shown = placingPreset ? (tgt.kind === 'ratio' ? 'ruler' : tgt.kind) : S.tool;
  $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === shown));
  toolbar.classList.toggle('locked', placingPreset);
  $('#btnUndo').disabled = !S.undo.length;
  $('#btnRedo').disabled = !S.redo.length;
  body.classList.toggle('has-hist', !!(S.img || S.undo.length || S.redo.length));
  syncFaceMapPanel();
  syncPanelPage();
  renderReadout();
  renderHint();
  refreshCursor();
  if (toolOptsFor) syncToolOpts();
  // (a switch's description shows as its tooltip: the panels show only the controls)
  $$('.tg:not([title]) small').forEach(s => { s.closest('.tg').title = s.textContent; });
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
  paint(t, dt);
}
function paint(t, dt) {
  try {
    stepView(dt);
    if (S.stroke && cfg.mMode !== 'push') dabHere(dt);
    if (S.tstroke) toneDab(dt);
    if (S.zstroke) surfDab(dt);
    if (S.hstroke) hintDab(dt);
    if (S.map && S.map.maskDirty && !S.mapDrag) { buildMask(); S.map.maskDirty = false; }
    drawImageLayer(dt);
    drawStage();
    drawGrid(dt);
    if (S.img && t < S.awakeUntil) { drawOverlay(t, dt); updateValues(); }
    else if (!S.img && S.leaving.length) S.leaving = [];
  } catch (err) {
    if (!paint.warned) { paint.warned = true; console.error(err); }
  }
}

/* ---------------------------------------------------------------- init -- */

resize();
applyCfg();
buildList();
applyFilter();   // (the front photo's presets)
buildFaceMapPanel();
buildSettings();
syncSettingsUI();
syncUI();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { wake(); if (settingsEl.classList.contains('open')) drawPreview(); });
requestAnimationFrame(frame);
if (OLD_CODE.length) setTimeout(() => toast(GL_MESSAGES.stale, 9000), 600);

// tiny scripting hook (handy for debugging from the console)
window.cranimeter = { loadFile, state: S, build: BUILD, goTab, curTab, slots, sideProfile, refineProfileJaw, jawCorner, markUser, headReport, stageGrid: () => stageDepth(), dotDepth, placeStructure, surfOverlay, surfZ, buildSurface, drawSurfaceStep, drawLightStep, lightInfo, gpu: () => (GLR ? 'webgl2' : GL_REASON), mapSrc, mapInv, maskAt, fitMap, mapToScreen, screenToMap, syncPts, drawEditedPhoto, surfInputs, surfHints, surfBasis, photoToTemplate,
  paint: () => { wake(); paint(performance.now(), 0); } };

})();
