/* ==========================================================================
   Cranimeter · face scan (structure-aware morph)

   A 3D head template of 137 points, in centimetres:
     x  lateral (+ = image right in a front photo), y  down,
     z  forward from the ear plane (tragion = 0).
   The same template is projected for a front photo or either profile, so one
   model serves both. Each point carries:
     · group   which kind of dot it is (outline, skin, brows, eyes, nose, lips,
               ears, hair, neck)
     · field   which deformation layer it drives: face, back, or both
     · t       soft-tissue depth in mm, from forensic facial-reconstruction
               tables (pooled adult means, Stephan & Simpson 2008; De Greef
               et al. 2006)
     · lm      the measurement-preset landmark it matches

   Anatomy operations ("levels") move the template in 3D:
     · bone   a skeletal change, filtered through the soft tissue above it:
              thicker tissue damps it and spreads it wider, as it does on a
              real face
     · soft   a change in fat or muscle volume, proportional to how much
              tissue lies at each point
     · shape  proportions (lengths, positions)
   The moved points are projected back into the photo. The in-plane part
   warps the image; the part toward the camera relights it (shading), so a
   hollowed cheek or a projected chin reads as volume.

   Image warping: two thin-plate splines (Bookstein, "Principal Warps", IEEE
   PAMI 1989), face layer over back layer (hair, ears, neck, background).
   The template fit uses similarity moving least squares (Schaefer, McPhail &
   Warren 2006).
   ========================================================================== */
(() => {
'use strict';

const POINTS = [];
/** Midline point. */
const mid = (id, name, x, y, z, group, field, t, lm, o) => POINTS.push({ id, name, x, y, z, group, field, t: t || 0, lm: lm || null, side: 0, ...(o || {}) });
/** Bilateral point, given for the image-right side (x > 0); the left is mirrored. */
const pair = (id, name, x, y, z, group, field, t, lm, o) => {
  POINTS.push({ id: id + 'L', name, x: -x, y, z, group, field, t: t || 0, lm: lm || null, side: -1, ...(o || {}) });
  POINTS.push({ id: id + 'R', name, x, y, z, group, field, t: t || 0, lm: lm || null, side: 1, ...(o || {}) });
};

// ---- head & hair (back layer) ----
mid('vertex', 'Top of the hair', 0, -18.3, -1.0, 'hair', 'back');
mid('hairFront', 'Hair · front', 0, -15.4, 6.0, 'hair', 'back');
mid('occiput', 'Back of the head', 0, -9.5, -10.6, 'hair', 'back', 0, null, { views: 'profile' });
mid('hairBack', 'Hair · back', 0, -1.5, -10.3, 'hair', 'back', 0, null, { views: 'profile' });
pair('hts', 'Hair · top', 5.4, -16.6, -1.2, 'hair', 'back');
pair('hsu', 'Hair · side', 8.5, -12.3, -1.5, 'hair', 'back');
pair('hse', 'Hair · temple', 8.7, -8.0, -2.4, 'hair', 'back');
pair('hsl', 'Hair · lower', 8.4, -2.4, -5.0, 'hair', 'back', 0, null, { views: 'all' });

// ---- face outline (front silhouette; drives both layers) ----
mid('tri', 'Hairline · centre (trichion)', 0, -12.0, 7.7, 'outline', 'both', 5, 'Trichion');
pair('hl1', 'Hairline', 3.0, -11.7, 7.4, 'outline', 'both', 5);
pair('hl2', 'Hairline', 5.5, -10.5, 5.8, 'outline', 'both', 5);
pair('tem', 'Temple', 6.6, -8.1, 4.6, 'outline', 'both', 8, 'Frontotemporale');
pair('zy', 'Cheekbone edge (zygion)', 6.75, -3.9, 3.2, 'outline', 'both', 6, 'Zygion');
pair('chk', 'Cheek edge', 6.55, -1.2, 2.8, 'outline', 'both', 14);
pair('jaw1', 'Jawline', 6.1, 1.2, 2.0, 'outline', 'both', 16);
pair('go', 'Jaw angle (gonion)', 5.4, 3.3, 0.8, 'outline', 'both', 14, 'Gonion');
pair('jaw2', 'Jawline', 4.05, 5.1, 4.6, 'outline', 'both', 9);
pair('chin', 'Chin', 2.0, 6.0, 7.6, 'outline', 'both', 8);
mid('me', 'Chin bottom (menton)', 0, 6.3, 7.8, 'outline', 'both', 7.5, 'Menton', { n: [0, .7, .7] });

// ---- forehead, brows ----
mid('fhC', 'Forehead · centre', 0, -9.4, 9.2, 'skin', 'face', 5);
pair('fh', 'Forehead', 3.7, -9.3, 8.3, 'skin', 'face', 5);
pair('supra', 'Brow ridge', 3.0, -7.9, 8.7, 'skin', 'face', 6);
pair('temH', 'Temple hollow', 5.4, -6.4, 5.4, 'skin', 'face', 9);
mid('gl', 'Glabella', 0, -6.9, 9.8, 'brows', 'face', 5.5, 'Glabella');
pair('bi', 'Brow · inner', 1.2, -6.7, 9.0, 'brows', 'face', 6);
pair('bm', 'Brow', 2.1, -7.15, 8.8, 'brows', 'face', 6);
pair('ba', 'Brow · arch', 3.0, -7.4, 8.4, 'brows', 'face', 6);
pair('bt', 'Brow · tail', 5.1, -6.7, 6.6, 'brows', 'face', 6);

// ---- eyes ----
pair('en', 'Inner eye corner (endocanthion)', 1.8, -5.5, 8.0, 'eyes', 'face', 0, 'Endocanthion');
pair('eu1', 'Upper lid', 2.4, -5.95, 8.4, 'eyes', 'face');
pair('eu2', 'Upper lid', 3.25, -6.05, 8.3, 'eyes', 'face');
pair('eu3', 'Upper lid', 4.05, -5.9, 7.6, 'eyes', 'face');
pair('ex', 'Outer eye corner (exocanthion)', 4.65, -5.5, 6.8, 'eyes', 'face', 0, 'Exocanthion');
pair('el3', 'Lower lid', 4.05, -5.2, 7.6, 'eyes', 'face');
pair('el2', 'Lower lid', 3.25, -5.1, 8.2, 'eyes', 'face');
pair('el1', 'Lower lid', 2.4, -5.15, 8.3, 'eyes', 'face');
pair('pu', 'Pupil', 3.25, -5.6, 8.6, 'eyes', 'face', 0, 'Pupil');

// ---- nose ----
mid('n', 'Nasion', 0, -5.7, 9.2, 'nose', 'face', 6.5, 'Nasion');
mid('rhi', 'Nose bridge (rhinion)', 0, -3.6, 10.6, 'nose', 'face', 2.5, 'Nasal dorsum');
mid('dor', 'Nose bridge · lower', 0, -2.6, 11.5, 'nose', 'face', 2.5);
mid('prn', 'Nose tip (pronasale)', 0, -1.7, 12.2, 'nose', 'face', 3, 'Pronasale');
mid('col', 'Columella', 0, -1.05, 11.3, 'nose', 'face', 3, 'Columella', { n: [0, .6, .8] });
mid('sn', 'Nose base (subnasale)', 0, -0.6, 10.3, 'nose', 'face', 14, 'Subnasale', { n: [0, .4, .9] });
pair('nsd', 'Nose side', 1.0, -3.6, 9.9, 'nose', 'face', 3);
pair('al', 'Nostril wing (alare)', 1.7, -1.0, 9.6, 'nose', 'face', 11, 'Alare');
pair('ac', 'Alar crease', 1.45, -0.7, 9.0, 'nose', 'face', 12, 'Alar crease');
pair('nos', 'Nostril', 0.75, -0.75, 10.6, 'nose', 'face', 4);

// ---- cheeks, chin (interior skin) ----
pair('infra', 'Under-eye', 2.6, -4.0, 8.2, 'skin', 'face', 7);
pair('malar', 'Cheekbone (malar)', 4.5, -2.8, 7.3, 'skin', 'face', 7);
pair('buc', 'Cheek hollow (buccal)', 4.7, 0.5, 6.1, 'skin', 'face', 22);
pair('nl1', 'Nasolabial fold', 2.0, -0.4, 9.3, 'skin', 'face', 13);
pair('nl2', 'Nasolabial fold · lower', 2.9, 1.3, 8.8, 'skin', 'face', 13);
pair('jowl', 'Jowl', 3.9, 3.2, 6.9, 'skin', 'face', 12);
pair('masse', 'Masseter', 5.6, 1.4, 2.6, 'skin', 'face', 18);
pair('ramus', 'Jaw ramus', 6.2, -0.3, 0.6, 'skin', 'face', 16, 'Ramus', { views: 'profile' });
pair('mental', 'Chin · side', 1.5, 4.5, 9.3, 'skin', 'face', 11);
mid('bpt', 'Chin crease (B point)', 0, 3.7, 9.4, 'skin', 'face', 10.5, 'Soft-tissue B point');
mid('pog', 'Chin front (pogonion)', 0, 4.9, 9.9, 'skin', 'face', 11, 'Pogonion');
mid('gn', 'Gnathion', 0, 5.8, 9.0, 'skin', 'face', 8.5, 'Gnathion', { n: [0, .5, .85] });

// ---- lips ----
mid('phil', 'Philtrum', 0, 0.4, 10.4, 'lips', 'face', 12);
mid('ls', 'Upper lip · centre', 0, 1.45, 10.7, 'lips', 'face', 12, 'Labrale superius');
mid('sto', 'Lip line (stomion)', 0, 2.0, 10.2, 'lips', 'face', 12, 'Stomion');
mid('li', 'Lower lip · centre', 0, 2.75, 10.4, 'lips', 'face', 13, 'Labrale inferius');
pair('ch', 'Mouth corner (cheilion)', 2.56, 1.95, 8.7, 'lips', 'face', 12, 'Cheilion');
pair('ul', 'Upper lip', 1.25, 1.55, 10.0, 'lips', 'face', 12);
pair('cph', 'Cupid’s bow', 0.5, 1.38, 10.6, 'lips', 'face', 12);
pair('ll', 'Lower lip', 1.25, 2.6, 9.9, 'lips', 'face', 13);

// ---- ears (back layer) ----
pair('sa', 'Ear · top', 7.6, -5.9, -0.8, 'ears', 'back', 0, 'Superaurale');
pair('eo', 'Ear · outer rim', 8.1, -3.5, -1.8, 'ears', 'back');
pair('hb', 'Ear · back', 7.8, -2.0, -2.6, 'ears', 'back');
pair('lob', 'Ear lobe', 7.35, 0.2, -0.3, 'ears', 'back', 0, 'Subaurale');
pair('obi', 'Ear lobe · attachment', 6.95, -0.5, 0.5, 'ears', 'back');
pair('tra', 'Tragus', 7.05, -3.0, 0.65, 'ears', 'back', 0, 'Tragion');
pair('obs', 'Ear · front top', 7.1, -5.4, 0.3, 'ears', 'back');

// ---- neck ----
mid('cerv', 'Neck–chin angle (cervical point)', 0, 7.0, 3.6, 'neck', 'both', 12, 'Cervical point', { views: 'profile', n: [0, .9, .4] });
mid('neckF', 'Neck · front', 0, 10.0, 3.3, 'neck', 'back', 12, 'Neck');
mid('nape', 'Nape', 0, 5.0, -7.6, 'neck', 'back', 0, null, { views: 'profile' });
mid('neckB', 'Back of the neck', 0, 11.0, -6.6, 'neck', 'back', 0, null, { views: 'profile' });
pair('nt', 'Neck · side', 5.2, 7.3, -0.4, 'neck', 'back', 15);
pair('nm', 'Neck · side', 5.4, 10.0, -0.8, 'neck', 'back', 15);
pair('nb', 'Neck · base', 5.9, 13.0, -1.0, 'neck', 'back', 15);

const INDEX = Object.fromEntries(POINTS.map((p, i) => [p.id, i]));

/** Outward surface normal: a head-shaped ellipsoid, unless a point says otherwise. */
for (const p of POINTS) {
  if (p.n) { const L = Math.hypot(...p.n); p.n = p.n.map(v => v / L); continue; }
  const nx = p.x / (8.2 * 8.2), nz = (p.z + .3) / (10.6 * 10.6), L = Math.hypot(nx, nz) || 1;
  p.n = [nx / L, 0, nz / L];
}

/* ------------------------------------------------------------- views --
   yaw 0 = front photo; +90 = profile with the face looking to the image left;
   −90 = profile looking right. '#' in a contour stands for the near side. */
const VIEWS = { front: 0, left: 90, right: -90 };
const nearSide = yaw => (yaw > 0 ? 'R' : 'L');
function visible(p, yaw) {
  const prof = Math.abs(yaw) > 45;
  if (p.views === 'all') return true;
  if (p.views === 'profile' && !prof) return false;
  if (p.views === 'front' && prof) return false;
  const t = yaw * Math.PI / 180;
  return p.n[0] * Math.sin(t) + p.n[2] * Math.cos(t) > -.22;
}
/** Template position (cm) of point p seen from yaw, in image axes. */
function project(p, yaw) {
  const t = yaw * Math.PI / 180;
  return { x: p.x * Math.cos(t) - p.z * Math.sin(t), y: p.y };
}

const FRONT_CONTOURS = [
  { id: 'outline', closed: true, boundary: true, snap: true, ids: ['tri', 'hl1R', 'hl2R', 'temR', 'zyR', 'chkR', 'jaw1R', 'goR', 'jaw2R', 'chinR', 'me', 'chinL', 'jaw2L', 'goL', 'jaw1L', 'chkL', 'zyL', 'temL', 'hl2L', 'hl1L'] },
  { id: 'browL', ids: ['biL', 'bmL', 'baL', 'btL'] },
  { id: 'browR', ids: ['biR', 'bmR', 'baR', 'btR'] },
  { id: 'eyeL', closed: true, ids: ['enL', 'eu1L', 'eu2L', 'eu3L', 'exL', 'el3L', 'el2L', 'el1L'] },
  { id: 'eyeR', closed: true, ids: ['enR', 'eu1R', 'eu2R', 'eu3R', 'exR', 'el3R', 'el2R', 'el1R'] },
  { id: 'ridge', ids: ['n', 'rhi', 'dor', 'prn', 'col', 'sn'] },
  { id: 'nostrils', ids: ['acL', 'alL', 'nosL', 'sn', 'nosR', 'alR', 'acR'] },
  { id: 'lips', closed: true, ids: ['chL', 'ulL', 'cphL', 'ls', 'cphR', 'ulR', 'chR', 'llR', 'li', 'llL'] },
  { id: 'mouth', ids: ['chL', 'sto', 'chR'] },
  { id: 'earL', closed: true, ids: ['obsL', 'saL', 'eoL', 'hbL', 'lobL', 'obiL', 'traL'] },
  { id: 'earR', closed: true, ids: ['obsR', 'saR', 'eoR', 'hbR', 'lobR', 'obiR', 'traR'] },
  { id: 'hair', snap: true, ids: ['hslL', 'hseL', 'hsuL', 'htsL', 'vertex', 'htsR', 'hsuR', 'hseR', 'hslR'] },
  { id: 'neckL', snap: true, ids: ['ntL', 'nmL', 'nbL'] },
  { id: 'neckR', snap: true, ids: ['ntR', 'nmR', 'nbR'] },
];
const PROFILE_CONTOURS = [
  // the face region: the profile line from hairline to under the chin, back along the jaw, up in front of the ear
  { id: 'face', closed: true, boundary: true, ids: ['tri', 'fhC', 'gl', 'n', 'rhi', 'dor', 'prn', 'col', 'sn', 'phil', 'ls', 'sto', 'li', 'bpt', 'pog', 'gn', 'me', 'cerv', 'jaw2#', 'go#', 'ramus#', 'obs#', 'tem#', 'hl2#', 'hl1#'] },
  { id: 'profile', snap: true, draw: false, ids: ['tri', 'fhC', 'gl', 'n', 'rhi', 'dor', 'prn', 'col', 'sn', 'phil', 'ls', 'sto', 'li', 'bpt', 'pog', 'gn', 'me', 'cerv', 'neckF'] },
  { id: 'brow', ids: ['bi#', 'bm#', 'ba#', 'bt#'] },
  { id: 'eye', closed: true, ids: ['en#', 'eu1#', 'eu2#', 'eu3#', 'ex#', 'el3#', 'el2#', 'el1#'] },
  { id: 'nostril', ids: ['nos#', 'al#', 'ac#'] },
  { id: 'lip', ids: ['ls', 'cph#', 'ul#', 'ch#', 'll#', 'li'] },
  { id: 'ear', closed: true, ids: ['obs#', 'sa#', 'eo#', 'hb#', 'lob#', 'obi#', 'tra#'] },
  { id: 'hair', snap: true, ids: ['hairFront', 'vertex', 'occiput', 'hairBack'] },
  { id: 'neckFront', ids: ['cerv', 'neckF'] },
  { id: 'neckBack', snap: true, ids: ['nape', 'neckB'] },
];
/** Contours for a view, with '#' resolved to the near side and ids turned into indices. */
function contours(yaw) {
  const prof = Math.abs(yaw) > 45, ns = nearSide(yaw);
  return (prof ? PROFILE_CONTOURS : FRONT_CONTOURS).map(c => {
    const idx = c.ids.map(id => INDEX[id.replace('#', ns)]);
    const f = POINTS[idx[0]].field;
    return { ...c, idx, field: c.boundary ? 'both' : (idx.some(i => POINTS[i].field === 'both') ? 'both' : f) };
  });
}

/* ------------------------------------------------------- anatomy ops --
   Each op moves template points in 3D (cm at 100 %, radians for rotations).
   Regions are 3D Gaussians (centre, sigma) given for the right side and
   mirrored. Ops act on the 137 scan dots and on every vertex of the dense
   face mesh alike, so the dots and the rendered skin always agree. */
const FACE = ['outline', 'skin', 'brows', 'eyes', 'nose', 'lips'];
const SOFT_GROUPS = ['outline', 'skin', 'nose', 'lips'];
const SKIN = ['outline', 'skin', 'brows', 'nose', 'lips'];   // everything on the face except the eye openings
// pivots (y, z in cm) for rotations
const JAW_PIVOT = [-3.2, 1.0];     // the jaw joint (condyle), just in front of the ear canal
const NOSE_PIVOT = [-0.6, 10.0];   // the nose base
const OPS = [
  // ---- bone ----
  { key: 'zygWidth', label: 'Cheekbone width', level: 'bone', mag: .7, dir: 'out', regions: [[6.6, -3.6, 3.8, 1.7], [5.3, -3.0, 6.0, 1.4]], affects: SKIN,
    help: 'Lateral projection of the zygomatic arch — wider cheekbones from the front' },
  { key: 'malarProj', label: 'Cheekbone projection', level: 'bone', mag: .6, dir: 'fwd', regions: [[4.4, -2.8, 7.3, 1.5]], affects: SKIN,
    help: 'The malar body toward / away from the camera — moves the highlight and the shadow below it' },
  { key: 'infraorbital', label: 'Infraorbital rim', level: 'bone', mag: .45, dir: 'fwd', regions: [[2.6, -4.1, 8.0, 1.0], [3.9, -3.7, 7.3, 1.0]], affects: SKIN,
    help: 'Support under the eyes — negative recesses the rim (shadowed, hollow under-eyes)' },
  { key: 'browRidge', label: 'Brow ridge projection', level: 'bone', mag: .45, dir: 'fwd', regions: [[0, -7.0, 9.8, 1.4], [3.0, -7.4, 8.8, 1.4]], affects: SKIN,
    help: 'Supraorbital and glabellar projection — a stronger ridge throws the eyes into shadow' },
  { key: 'browDrop', label: 'Brow ridge height', level: 'bone', mag: .5, dir: 'browDrop', regions: [[2.9, -7.2, 8.7, 1.25], [4.8, -6.8, 7.0, 1.15], [1.4, -6.9, 9.2, .8]], affects: ['outline', 'skin', 'brows'],
    help: 'Lowers the supraorbital rim and brows: the brow fold drops over the upper lid (hooded, deep-set look) while the eye opening stays' },
  { key: 'jawWidth', label: 'Jaw width', level: 'bone', mag: .9, dir: 'out', regions: [[5.3, 3.0, .9, 2.2]],
    help: 'Bigonial width — the mandibular angles' },
  { key: 'jawAngle', label: 'Jaw angle', level: 'bone', mag: .6, dir: 'jawAngle', regions: [[5.4, 3.6, .7, 1.6]],
    help: 'A sharper, lower gonial angle (or a softer, rounder one)' },
  // the band starts above the lips so they stay sealed (the soft tissue follows the jaw, the mouth doesn't open)
  { key: 'mandible', label: 'Mandible rotation', level: 'bone', mag: .075, dir: 'rotJaw', band: [-.2, 3.4], affects: SKIN.concat(['neck']),
    help: 'Rotates the lower jaw about the jaw joint: + sets the chin back and down (retrusion), − brings it forward and up' },
  { key: 'chinProj', label: 'Chin projection', level: 'bone', mag: .9, dir: 'fwd', regions: [[0, 4.9, 9.6, 1.7]],
    help: 'Pogonion forward / back — from the front it changes the chin’s shadow and the lip–chin crease' },
  { key: 'chinHeight', label: 'Chin height', level: 'bone', mag: .7, dir: 'down', regions: [[0, 5.6, 8.6, 1.9]],
    help: 'Vertical chin length' },
  { key: 'chinWidth', label: 'Chin width', level: 'bone', mag: .5, dir: 'out', regions: [[1.9, 5.3, 8.4, 1.3]] },
  { key: 'midfaceProj', label: 'Midface projection', level: 'bone', mag: .6, dir: 'fwd', regions: [[0, -.4, 10.3, 2.2], [2.3, -.9, 9.1, 1.9]],
    help: 'Maxillary projection — nose base, upper lip, inner cheeks' },
  { key: 'jawProj', label: 'Lower jaw projection', level: 'bone', mag: .8, dir: 'fwd', regions: [[0, 4.0, 9.4, 2.5], [3.0, 4.6, 6.5, 2.2]],
    help: 'Mandibular advancement — chin and lower lip forward' },
  { key: 'noseBridge', label: 'Nose bridge', level: 'bone', mag: .35, dir: 'fwd', regions: [[0, -3.4, 10.8, 1.0]], affects: ['nose', 'skin'],
    help: 'Dorsal height — lower it to remove a hump' },
  { key: 'noseTip', label: 'Nose tip projection', level: 'bone', mag: .45, dir: 'fwd', regions: [[0, -1.6, 12.0, .9]], affects: ['nose', 'lips', 'skin'] },
  { key: 'noseWidth', label: 'Nose width', level: 'bone', mag: .35, dir: 'out', regions: [[1.6, -.9, 9.4, .8]], affects: ['nose', 'skin'] },
  { key: 'noseRot', label: 'Nose tip rotation', level: 'bone', mag: -.32, dir: 'rotNose', regions: [[0, -1.5, 11.8, 1.0]], affects: ['nose', 'skin'],
    help: 'Rotates the tip about the nose base — + turns it up (more nostril shows from the front), − droops it' },
  // ---- soft tissue ----
  { key: 'fat', label: 'Facial fat', level: 'soft', mag: .35, dir: 'normal', all: true, affects: SOFT_GROUPS.concat(['neck']),
    help: 'Overall soft-tissue volume — moves most where the tissue is thickest (cheeks, jowls, under the chin)' },
  { key: 'buccal', label: 'Cheek hollows', level: 'soft', mag: -.42, dir: 'normal', regions: [[4.7, .6, 6.0, 1.6]], affects: SKIN,
    help: 'Buccal fat — positive hollows the cheeks below the cheekbones' },
  { key: 'underEye', label: 'Under-eye hollows', level: 'soft', mag: -.25, dir: 'normal', regions: [[2.6, -3.9, 8.1, .8]], affects: ['skin', 'outline'] },
  { key: 'hooding', label: 'Upper lid fold', level: 'soft', mag: .32, dir: 'browDrop', regions: [[3.1, -6.25, 8.3, .7], [4.2, -6.0, 7.4, .7], [2.0, -6.2, 8.6, .6]], affects: ['skin', 'brows'],
    help: 'The skin and fat between brow and lid crease hang over the upper lid — the lid itself stays where it is' },
  { key: 'masseter', label: 'Masseter', level: 'soft', mag: .42, dir: 'out', regions: [[5.6, 1.4, 2.4, 1.6]],
    help: 'Jaw muscle bulk at the angle of the jaw' },
  { key: 'lips', label: 'Lip fullness', level: 'soft', mag: .3, dir: 'lips', regions: [[0, 1.5, 10.6, .9], [0, 2.7, 10.3, .9], [1.3, 2.0, 9.9, .9]], affects: ['lips', 'skin'] },
  { key: 'submental', label: 'Under the chin', level: 'soft', mag: .8, dir: 'normal', regions: [[0, 7.0, 4.2, 1.8], [3.2, 6.4, 3.0, 1.6]], affects: ['outline', 'skin', 'neck'],
    help: 'Submental fat — the neck–chin angle' },
  { key: 'temples', label: 'Temples', level: 'soft', mag: .4, dir: 'normal', regions: [[5.6, -6.8, 5.2, 1.4]] },
  { key: 'browLift', label: 'Brow position', level: 'soft', mag: .5, dir: 'up', regions: [[2.8, -6.9, 8.6, 1.7]], affects: ['brows', 'skin'] },
  { key: 'neck', label: 'Neck width', level: 'soft', mag: .8, dir: 'out', regions: [[5.5, 10.0, -.8, 3.0]], affects: ['neck'] },
  // ---- shape & proportions ----
  { key: 'hairline', label: 'Hairline height', level: 'shape', mag: 1.2, dir: 'up', regions: [[0, -12.0, 7.7, 2.4], [4.5, -11.0, 6.4, 2.2]], affects: ['outline', 'skin', 'hair'],
    help: 'Moves the hairline and the forehead top together' },
  { key: 'midface', label: 'Midface length', level: 'shape', mag: .7, dir: 'down', band: [-2.4, 0], affects: FACE.concat(['neck']),
    help: 'Nasion to subnasale — everything below moves down' },
  { key: 'lowerFace', label: 'Lower face length', level: 'shape', mag: .8, dir: 'down', band: [2.2, 4.8], affects: FACE.concat(['neck']),
    help: 'Stomion to menton' },
  { key: 'tilt', label: 'Canthal tilt', level: 'shape', mag: .22, dir: 'tilt', regions: [[3.25, -5.6, 7.8, 1.2]], affects: ['eyes', 'skin'],
    help: 'Positive tilt lifts the outer eye corners' },
  { key: 'ears', label: 'Ear protrusion', level: 'shape', mag: .6, dir: 'out', regions: [[7.6, -3.0, -1.2, 2.2]], affects: ['ears'] },
];
const OP_INDEX = Object.fromEntries(OPS.map(o => [o.key, o]));

/** How much a point belongs to any of these groups: scan dots have one group, mesh vertices a blend. */
const member = (p, groups) => {
  if (!p.m) return groups.includes(p.group) ? 1 : 0;
  let s = 0;
  for (const g of groups) s += p.m[g] || 0;
  return Math.min(1, s);
};
/** Rotation of (y, z) about a pivot by angle a: the resulting offset. */
function rotYZ(p, pivot, a) {
  const dy = p.y - pivot[0], dz = p.z - pivot[1], c = Math.cos(a), s = Math.sin(a);
  return [0, dy * c + dz * s - dy, -dy * s + dz * c - dz];
}
/**
 * 3D displacement (cm) for a set of op values (−1…1), for template points P (the scan dots by
 * default, or mesh vertices: { x, y, z, t (mm), n: [3], m: { group: weight } }).
 * With weightsFor = an op key, also returns how strongly that op acts on each point.
 */
function anatomyAt(values, P, weightsFor) {
  const n = P.length, D = new Float32Array(n * 3), W = weightsFor ? new Float32Array(n) : null;
  for (const op of OPS) {
    const v = values[op.key] || 0;
    if (!v && op.key !== weightsFor) continue;
    const groups = op.affects || FACE;
    for (let i = 0; i < n; i++) {
      const p = P[i], mem = member(p, groups);
      if (mem <= 0) continue;
      const t = p.t / 10;   // cm
      let w;
      if (op.all) w = 1;
      else if (op.band) w = smooth(op.band[0], op.band[1], p.y);
      else {
        w = 0;
        for (const [cx, cy, cz, s] of op.regions) {
          let sig2 = s * s, amp = 1;
          if (op.level === 'bone') {
            // filtered through the soft tissue above: wider and weaker where the tissue is thick
            const k = .9 * t; sig2 = s * s + k * k; amp = (s * s) / sig2;
          }
          const dx = Math.abs(p.x) - cx, dy = p.y - cy, dz = p.z - cz;
          const dx2 = cx === 0 ? p.x * p.x : dx * dx;
          w = Math.max(w, amp * Math.exp(-(dx2 + dy * dy + dz * dz) / (2 * sig2)));
        }
      }
      if (op.level === 'soft') w *= Math.min(2, t / 1.2);   // fat and muscle change in proportion to their depth
      w *= mem;
      if (W && op.key === weightsFor) W[i] = w;
      if (!v || w < 1e-4) continue;
      const sx = Math.sign(p.x), a = v * op.mag * w;
      let d;
      switch (op.dir) {
        case 'out': d = [sx, 0, 0]; break;
        case 'fwd': d = [0, 0, 1]; break;
        case 'up': d = [0, -1, 0]; break;
        case 'down': d = [0, 1, 0]; break;
        case 'normal': d = p.n; break;
        case 'browDrop': d = [0, .85, .5]; break;   // down and slightly forward, over what lies below
        case 'jawAngle': d = [sx * .3, .8, -.5]; break;
        case 'lips': { const s = p.y < 2.0 ? -1 : 1; d = [0, s * .75, .65]; break; }
        case 'tilt': d = [0, -(Math.abs(p.x) - 3.25) / 1.4, 0]; break;
        case 'rotJaw': { const r = rotYZ(p, JAW_PIVOT, a); D[3 * i + 1] += r[1]; D[3 * i + 2] += r[2]; continue; }
        case 'rotNose': { const r = rotYZ(p, NOSE_PIVOT, a); D[3 * i + 1] += r[1]; D[3 * i + 2] += r[2]; continue; }
        default: d = [0, 0, 0];
      }
      D[3 * i] += d[0] * a; D[3 * i + 1] += d[1] * a; D[3 * i + 2] += d[2] * a;
    }
  }
  return W ? { D, W } : D;
}
/** The anatomy for the 137 scan dots. */
const anatomy = (values, weightsFor) => anatomyAt(values, POINTS, weightsFor);
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/**
 * Rigid MLS.  ctrl is a flat array of [qx, qy, px, py] per control point: q = where the point is
 * now (output), p = where it came from (source). Returns the source position for output (x, y).
 * With inverse = true the roles swap (source → output).
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

window.CraniMap = {
  POINTS, INDEX, VIEWS, OPS, OP_INDEX,
  visible, project, contours, nearSide, anatomy, anatomyAt,
  mls, tpsFit, tpsEval, spline, build: '13',
};
})();
