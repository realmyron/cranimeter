/* ==========================================================================
   Cranimeter · app
   Plain JS, no build step. Everything runs locally in the browser.
   ========================================================================== */
(() => {
'use strict';

/* ---------------------------------------------------------------- data -- */

const { GROUPS, LANDMARKS } = window.CRANI;
const P = {};
GROUPS.forEach(g => g.items.forEach(it => { it.group = g.name; P[it.id] = it; }));
const PRESET_IDS = Object.keys(P);

const KIND_N = { ruler: 2, ratio: 4, angle: 3, tilt: 2, segments: 0, calib: 2 };
const KIND_LABEL = { ruler: 'Ruler', ratio: 'Ratio', angle: 'Angle', tilt: 'Tilt', segments: 'Proportions', calib: 'Scale' };
const TOOLS = {
  move:     { title: 'Select',      help: 'Click a line to select it and drag it to move. Drag points to fine-tune, drag empty space to pan. Shift-click adds to the selection, Ctrl A selects everything visible.' },
  ruler:    { title: 'Ruler',       help: 'Click two points to draw a line. With two or more rulers, each one shows its length as a multiple of the reference line (1.00x).' },
  angle:    { title: 'Angle',       help: 'Click three points — the middle one is the vertex.' },
  tilt:     { title: 'Tilt',        help: 'Click two points. The angle is read against the horizontal; positive means the second point sits higher.' },
  segments: { title: 'Proportions', help: 'Click points along a feature, then press Enter, double-click or right-click to finish. Each segment is shown relative to the first.' },
  calib:    { title: 'Scale',       help: 'Draw across something of known size — the iris is about 11.7 mm — so rulers can also show millimetres.' },
};
const TOOL_KEYS = { v: 'move', r: 'ruler', a: 'angle', t: 'tilt', s: 'segments', c: 'calib' };

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const TAU = Math.PI * 2, DEG = 180 / Math.PI;
const LOUPE = 132, LOUPE_ZOOM = 3;
const LEAVE_MS = 560, PAINT_MS = 680;

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
  width: 1.5, label: 11,
  loupe: false, names: true, gridFx: true,
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
const ov = $('#overlay'), octx = ov.getContext('2d');
const bg = $('#bg'), bctx = bg.getContext('2d');
const loupe = $('#loupe'), lctx = loupe.getContext('2d');
const glow = $('#glow');
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
  drag: null, mdrag: null, press: null, pan: null,
  space: false, shift: false,
  refId: null, calibId: null, calibMM: 11.7,
  seq: 0,
  undo: [], redo: [],
  leaving: [], motes: [],
  awakeUntil: 0,
};
const wake = (ms = 1200) => { S.awakeUntil = Math.max(S.awakeUntil, now() + ms); };

const toS = p => ({ x: p.x * S.view.k + S.view.x, y: p.y * S.view.k + S.view.y });
const toI = (sx, sy) => ({ x: (sx - S.view.x) / S.view.k, y: (sy - S.view.y) / S.view.k });

/* ---------------------------------------------------------------- theme -- */

const mqDark = matchMedia('(prefers-color-scheme: dark)');
const grid = { dirty: true, base: null, x: 0, y: 0, tx: 0, ty: 0, inf: 0, infT: 0, rgb: '255,255,255', a0: .075, a1: .2, ox: 0, oy: 0, needs: true };

function applyTheme() {
  const t = cfg.theme === 'system' ? (mqDark.matches ? 'dark' : 'light') : cfg.theme;
  root.dataset.theme = t;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#0A0B0D' : '#F2F2F0';
  grid.rgb = getComputedStyle(root).getPropertyValue('--dot-rgb').trim() || '255,255,255';
  grid.a0 = t === 'dark' ? .075 : .12;
  grid.a1 = t === 'dark' ? .2 : .22;
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
  return {
    img: S.imgRec,
    list: [...S.meas.values()].map(m => ({ id: m.id, preset: m.preset, kind: m.kind, name: m.name, pts: m.pts.map(p => ({ x: p.x, y: p.y })) })),
    refId: S.refId, calibId: S.calibId, calibMM: S.calibMM, seq: S.seq,
  };
}
function pushUndo(s = snapshot()) {
  S.undo.push(s);
  if (S.undo.length > 150) S.undo.shift();
  S.redo = [];
}
function restore(s) {
  const imgChanged = s.img !== S.imgRec;
  if (imgChanged) setImageState(s.img);
  const old = S.meas;
  S.meas = new Map();
  for (const o of s.list) {
    const m = mkMeas(o), prev = imgChanged ? null : old.get(o.id);
    if (prev) Object.assign(m, { disp: prev.disp, alpha: prev.alpha, wasVis: prev.wasVis, shown: prev.shown, times: prev.times });
    S.meas.set(o.id, m);
  }
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
  if (!S.img) return null;
  if (S.sel.length) {
    const pick = [S.active, ...S.sel].find(id => id && P[id] && S.sel.includes(id) && !S.meas.has(id));
    return pick ? { kind: P[pick].kind, preset: pick } : null;
  }
  if (S.tool === 'move') return null;
  return { kind: S.tool, preset: null };
}
const canPlace = () => !!S.img && (!!S.draft || !!placeTarget());
/** With nothing to place, the canvas behaves like the Select tool. */
const selectMode = () => !!S.img && !S.draft && !placeTarget();

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
/** Removal: the shape retracts toward its centre and fades, shedding a few soft motes. */
function startLeave(m) {
  if (!cfg.motion || !S.img || m.alpha < .05) return;
  const ghost = { ...m, pts: m.pts.map(p => ({ ...p })), disp: { ...m.disp }, painted: 0 };
  S.leaving.push({ m: ghost, t0: now(), alpha: m.alpha });
  if (S.motes.length < 400) {
    for (const [a, b, c] of screenSegs(m)) {
      const len = dist(a, b), n = Math.min(10, Math.floor(len / 22));
      for (let i = 1; i < n; i++) {
        const f = (i + (Math.random() - .5) * .6) / n;
        S.motes.push({
          x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, c,
          delay: 2 * Math.min(f, 1 - f) * LEAVE_MS * .75,
          age: 0, life: 900 + Math.random() * 700,
          r: .8 + Math.random() * .9,
          vx: (Math.random() - .5) * 12, vy: -(10 + Math.random() * 18),
        });
      }
    }
  }
  wake(2400);
}
function drawMotes(ctx, dt) {
  const ms = S.motes;
  let w = 0;
  for (let i = 0; i < ms.length; i++) {
    const p = ms[i];
    p.age += dt * 1000;
    const k = (p.age - p.delay) / p.life;
    if (k >= 1) continue;
    ms[w++] = p;
    if (k < 0) continue;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 1 - dt * .8;
    const a = (k < .15 ? k / .15 : 1 - (k - .15) / .85) * .6;
    ctx.globalAlpha = a * .18;
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ms.length = w;
  ctx.globalAlpha = 1;
}

/* -------------------------------------------------------------- drawing -- */

/**
 * Stroke a → b between fractions f0..f1.
 * fx: { halo, gh (paint-gleam head fraction or null), ga (gleam alpha), head }
 */
function seg(ctx, a, b, col, lw, u, f0, f1, fx) {
  if (f1 - f0 <= 0.0005) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const x0 = a.x + dx * f0, y0 = a.y + dy * f0, x1 = a.x + dx * f1, y1 = a.y + dy * f1;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  if (fx && fx.halo) { ctx.strokeStyle = rgba(col, .2); ctx.lineWidth = lw + 7 * u; ctx.stroke(); }
  ctx.strokeStyle = 'rgba(0,0,0,.34)'; ctx.lineWidth = lw + 1.8 * u; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
  if (!fx) return;
  const L = Math.hypot(dx, dy);
  if (fx.gh != null && L > 2) {
    const span = Math.min(.5, 80 * u / L);
    const h = clamp(fx.gh, f0, f1), tl = clamp(fx.gh - span, f0, f1);
    if (h - tl > .002) {
      const hx = a.x + dx * h, hy = a.y + dy * h, tx = a.x + dx * tl, ty = a.y + dy * tl;
      const gr = ctx.createLinearGradient(tx, ty, hx, hy);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(1, `rgba(255,255,255,${fx.ga.toFixed(3)})`);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy);
      ctx.strokeStyle = gr; ctx.lineWidth = lw + .5 * u; ctx.stroke();
    }
  }
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
/** Value tag. Candidates are tried in order until one does not collide with an earlier label. */
function label(ctx, text, cands, col, o, alpha, blur, muted) {
  if (alpha <= 0.01) return;
  const u = o.u, fs = cfg.label * u;
  ctx.font = `500 ${fs}px ${MONO}`;
  const tw = ctx.measureText(text).width;
  const w = tw + 19 * u, h = fs + 9 * u;
  let r = null;
  for (const c of cands) {
    const cx = c.x + (c.ax || 0) * w / 2, cy = c.y + (c.ay || 0) * h / 2;
    const rr = { x: cx - w / 2, y: cy - h / 2, w, h };
    if (!r) r = rr;
    const hit = o.labels.some(q => rr.x < q.x + q.w + 3 && rr.x + rr.w + 3 > q.x && rr.y < q.y + q.h + 3 && rr.y + rr.h + 3 > q.y);
    if (!hit) { r = rr; break; }
  }
  o.labels.push(r);
  const y = r.y + (1 - alpha) * 3 * u;
  ctx.save();
  ctx.globalAlpha *= alpha;
  roundRect(ctx, r.x, y, w, h, 4 * u);
  ctx.fillStyle = 'rgba(13,14,17,.84)'; ctx.fill();
  ctx.lineWidth = u; ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.stroke();
  roundRect(ctx, r.x + 5 * u, y + 4 * u, 2 * u, h - 8 * u, u);
  ctx.fillStyle = muted ? rgba(col, .5) : col; ctx.fill();
  ctx.fillStyle = muted ? 'rgba(255,255,255,.58)' : 'rgba(255,255,255,.96)';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const tx = r.x + 12 * u, ty = y + h / 2 + .5 * u;
  if (blur > 0.05) {
    ctx.save(); ctx.globalAlpha *= 0.2 * blur;
    ctx.fillText(text, tx, ty - 1.2 * u); ctx.fillText(text, tx, ty + 1.2 * u);
    ctx.restore();
  }
  ctx.fillText(text, tx, ty);
  ctx.restore();
}
function lineLabel(ctx, a, b, text, col, o, alpha, blur, muted) {
  const cands = [.5, .34, .66, .2, .8].map(f => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }));
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
  const prog = fin || lv >= 0 ? 1 : easeInOut(age / 480);
  const f0 = lv >= 0 ? lv / 2 : 0, f1 = lv >= 0 ? 1 - lv / 2 : prog;
  const sweep = lv >= 0 ? 1 - lv : prog;
  const la = fin ? 1 : lv >= 0 ? clamp(1 - lv * 2, 0, 1) : ease((age - 200) / 320);
  const pg = fin || lv >= 0 || !m.painted ? -1 : (t - m.painted) / PAINT_MS;
  const gh = pg >= 0 && pg < 1 ? -0.1 + 1.3 * easeInOut(pg) : null;
  const fx = { halo: !fin && !!o.picked, gh, ga: .85 * (1 - Math.max(0, pg) * .4), head: !fin && lv < 0 && prog < 1 };
  const lw = cfg.width * u * (o.hl && !fin ? 1.25 : 1);
  const blur = fin ? 0 : (d._b || 0);
  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (m.kind === 'segments') {
    if (n >= 2) drawSegments(ctx, m, pts, d, o, { f0, f1, prog, lv, la, lw, blur, fx, pg });
  } else {
    for (const [i, j, ci] of topo(m.kind)) if (j < n) seg(ctx, pts[i], pts[j], colorIdx(m, ci), lw, u, f0, f1, fx);

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
  const leaveScale = lv >= 0 ? 1 - easeIn(clamp(lv * 1.3, 0, 1)) : null;
  for (let i = 0; i < n; i++) {
    let s = 1;
    if (!fin) {
      if (leaveScale != null) s = leaveScale;
      else {
        const base = Math.max(m.times && m.times[i] != null ? m.times[i] : -1e9, m.shown + i * 40);
        s = ease((t - base) / 260);
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
  const gHead = s.fx.gh;
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    const col = i % 2 ? cfg.c2 : cfg.c1, len = lens[i] || 1e-6;
    const fx = { ...s.fx, gh: gHead == null ? null : (gHead * T - acc) / len };
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
    const mx = (q[i].x + q[i + 1].x) / 2, my = (q[i].y + q[i + 1].y) / 2, off = 16 * u;
    label(ctx, v.toFixed(2) + 'x', [
      { x: mx, y: my },
      { x: mx + nx * off, y: my + ny * off, ax: nx, ay: ny },
      { x: mx - nx * off, y: my - ny * off, ax: -nx, ay: -ny },
    ], i % 2 ? cfg.c2 : cfg.c1, o, s.la, s.blur, i === segBase(m));
  }
}

/* ------------------------------------------------------------ image layer -- */

let imgKey = '';
function drawImageLayer(dt) {
  if (S.img && S.imgA < 1) S.imgA = Math.min(1, S.imgA + dt * 2.4);
  const v = S.view;
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

  if (S.motes.length) { busy = true; drawMotes(ctx, dt); }

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
  drawClipped(c, S.img, S.iw, S.ih, ip.x - is / 2, ip.y - is / 2, is, D);
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
  for (let x = grid.ox; x <= W; x += SP) for (let y = grid.oy; y <= H; y += SP) g.fillRect(x - .65, y - .65, 1.3, 1.3);
  grid.dirty = false; grid.needs = true;
}
function drawGrid(dt) {
  if (grid.dirty) buildGridBase();
  const k = 1 - Math.exp(-dt * 8);
  const dx = grid.tx - grid.x, dy = grid.ty - grid.y;
  grid.x += dx * k; grid.y += dy * k;
  const di = grid.infT - grid.inf;
  grid.inf += di * (1 - Math.exp(-dt * 4));
  const moving = Math.abs(dx) > .3 || Math.abs(dy) > .3 || Math.abs(di) > .003;
  if (!moving && !grid.needs) return;
  grid.needs = false;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, bg.width, bg.height);
  bctx.drawImage(grid.base, 0, 0);
  if (!cfg.gridFx || grid.inf < .004) return;
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = 68, E = R * 2.6;
  const i0 = Math.max(0, Math.ceil((grid.x - E - grid.ox) / SP)), i1 = Math.floor((grid.x + E - grid.ox) / SP);
  const j0 = Math.max(0, Math.ceil((grid.y - E - grid.oy) / SP)), j1 = Math.floor((grid.y + E - grid.oy) / SP);
  if (i1 < i0 || j1 < j0) return;
  bctx.clearRect(grid.ox + i0 * SP - SP / 2, grid.oy + j0 * SP - SP / 2, (i1 - i0 + 1) * SP, (j1 - j0 + 1) * SP);
  for (let i = i0; i <= i1; i++) {
    const px = grid.ox + i * SP;
    if (px > W) break;
    for (let j = j0; j <= j1; j++) {
      const py = grid.oy + j * SP;
      if (py > H) break;
      const ddx = px - grid.x, ddy = py - grid.y, d2 = ddx * ddx + ddy * ddy;
      const f = Math.exp(-d2 / (2 * R * R)) * grid.inf;
      const d = Math.sqrt(d2) || 1, push = f * 2.5;
      const x = px + ddx / d * push, y = py + ddy / d * push, s = 1.3 + f * .6;
      bctx.fillStyle = `rgba(${grid.rgb},${(grid.a0 + f * grid.a1).toFixed(3)})`;
      bctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
}

const gl = { x: 0, y: 0, tx: 0, ty: 0, on: false };
function stepGlow(dt) {
  if (!gl.on) return;
  const k = 1 - Math.exp(-dt * 10);
  const dx = gl.tx - gl.x, dy = gl.ty - gl.y;
  if (Math.abs(dx) < .2 && Math.abs(dy) < .2) return;
  gl.x += dx * k; gl.y += dy * k;
  glow.style.transform = `translate3d(${gl.x.toFixed(1)}px,${gl.y.toFixed(1)}px,0)`;
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
function setViewNow(v) { S.view = { ...v }; S.viewT = { ...v }; wake(); }
function safeRect() {
  const mob = W <= 860;
  const l = mob ? 12 : 76, r = mob ? 12 : 352, t = mob ? 120 : 80, b = mob ? 60 : 68;
  return { x: l, y: t, w: Math.max(120, W - l - r), h: Math.max(120, H - t - b) };
}
function fitView(intro) {
  if (!S.img) return;
  const r = safeRect();
  const k = Math.min(r.w / S.iw, r.h / S.ih) * .96;
  const v = { k, x: r.x + (r.w - S.iw * k) / 2, y: r.y + (r.h - S.ih * k) / 2 };
  S.fitK = k; S.viewT = v;
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
  wake();
}
const zoomCenter = f => { const r = safeRect(); zoomAt(r.x + r.w / 2, r.y + r.h / 2, f); };

/* -------------------------------------------------------------- pointer -- */

function hitTest(sx, sy) {
  const arr = [...S.meas.values()].filter(m => isVisible(m) && m.alpha > .4);
  let best = null, bd = 10;
  for (const m of arr) m.pts.forEach((pt, i) => {
    const p = toS(pt), d = Math.hypot(p.x - sx, p.y - sy);
    if (d <= bd) { bd = d; best = { id: m.id, node: i }; }
  });
  if (best) return best;
  for (let j = arr.length - 1; j >= 0; j--) {
    for (const [a, b] of screenSegs(arr[j])) if (segDist(sx, sy, a, b) <= 6) return { id: arr[j].id, node: -1 };
  }
  return null;
}
function refreshCursor() {
  let c;
  if (S.drag || S.pan || (S.press && S.press.moved) || (S.mdrag && S.mdrag.moved)) c = 'grabbing';
  else if (S.space) c = 'grab';
  else if (S.hover && S.hover.node >= 0) c = 'grab';
  else if (S.hover && selectMode()) c = 'move';
  else if (canPlace()) c = 'crosshair';
  else c = 'default';
  if (ov._c !== c) { ov._c = c; ov.style.cursor = c; }
}
function updateHover(sx, sy) {
  const h = S.draft || !S.img ? null : hitTest(sx, sy);
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
    S.press = null; S.pan = null; S.mdrag = null;
    if (S.drag) endDrag();
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
  if (e.button === 2) { onRightClick(sx, sy); return; }
  if (e.button !== 0) return;
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
  if (S.press) {
    if (!S.press.moved && Math.hypot(sx - S.press.x, sy - S.press.y) > 4) { S.press.moved = true; refreshCursor(); }
    if (S.press.moved) { setViewNow({ k: S.view.k, x: S.press.vx + sx - S.press.x, y: S.press.vy + sy - S.press.y }); return; }
  }
  updateHover(sx, sy);
});

function endDrag() {
  const d = S.drag;
  S.drag = null;
  if (d && d.moved) { pushUndo(d.snap); syncUI(); }
}
function pointerUp(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; S.press = null; return; }
  if (S.drag) endDrag();
  else if (S.mdrag) {
    const md = S.mdrag;
    S.mdrag = null;
    if (md.moved) pushUndo(md.snap);
    else if (md.toggle) S.picked.delete(md.toggle);
    syncUI();
  }
  else if (S.pan) S.pan = null;
  else if (S.press) {
    const p = S.press;
    S.press = null;
    if (!p.moved && e.button === 0 && e.type === 'pointerup') onClick(e.clientX, e.clientY, e);
  }
  updateHover(e.clientX, e.clientY);
}
ov.addEventListener('pointerup', pointerUp);
ov.addEventListener('pointercancel', pointerUp);
ov.addEventListener('pointerleave', () => { if (!S.drag && !S.pan && !S.mdrag) { S.cursorIn = false; S.hover = null; wake(); } });
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
  grid.tx = e.clientX; grid.ty = e.clientY;
  if (grid.inf < .01) { grid.x = grid.tx; grid.y = grid.ty; }
  grid.infT = 1;
  gl.tx = e.clientX; gl.ty = e.clientY;
  if (!gl.on) { gl.on = true; gl.x = gl.tx; gl.y = gl.ty; glow.style.transform = `translate3d(${gl.x}px,${gl.y}px,0)`; glow.classList.add('on'); }
}, { passive: true });
document.addEventListener('pointerout', e => {
  if (!e.relatedTarget) { grid.infT = 0; gl.on = false; glow.classList.remove('on'); }
});

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
  if (e.key === 'Shift') { S.shift = false; wake(); }
});
addEventListener('blur', () => { S.space = false; S.shift = false; });
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
    drag: null, mdrag: null, press: null, leaving: [], motes: [],
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
  Object.assign(S, { img: rec.img, iw: rec.iw, ih: rec.ih, imgA: 0 });
  body.classList.add('has-img');
  fitView(true);
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
  ctx.drawImage(S.img, 0, 0);
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
function setTool(t) {
  if (S.draft) { S.draft = null; S.draftM = null; }
  S.tool = t;
  if (t !== 'move' && S.sel.length) { S.sel = []; S.active = null; }
  syncUI();
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
    if (tgt && tgt.preset) {
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
      html = `<b>Select</b><span class="h-desc">Click a line to select · drag to move · <kbd>Ctrl</kbd> <kbd>A</kbd> all</span>`;
    }
  }
  hintEl.classList.toggle('show', !!html);
  if (hintIn._h === html) return;
  hintIn._h = html;
  hintIn.innerHTML = html;
  if (cfg.motion && hintIn.animate) hintIn.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
}

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
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
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  stepView(dt);
  drawImageLayer(dt);
  drawGrid(dt);
  stepGlow(dt);
  if (S.img && t < S.awakeUntil) { drawOverlay(t, dt); updateValues(); }
  else if (!S.img && (S.leaving.length || S.motes.length)) { S.leaving = []; S.motes = []; }
  requestAnimationFrame(frame);
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

// tiny scripting hook (handy for debugging from the console)
window.cranimeter = { loadFile, state: S };

})();
