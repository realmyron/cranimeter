/* ==========================================================================
   Cranimeter · face scan (structure-aware morph)

   A 3D head template of about 420 points (named points plus detail dots between them), in centimetres:
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
pair('hl0', 'Hairline', 1.5, -11.95, 7.6, 'outline', 'both', 5);
pair('hl1', 'Hairline', 3.0, -11.7, 7.4, 'outline', 'both', 5);
pair('hl3', 'Hairline', 4.35, -11.2, 6.75, 'outline', 'both', 5);
pair('hl2', 'Hairline', 5.5, -10.5, 5.8, 'outline', 'both', 5);
pair('hlc', 'Hairline · temple corner', 6.2, -9.4, 5.0, 'outline', 'both', 6);
pair('tem', 'Temple', 6.6, -8.1, 4.6, 'outline', 'both', 8, 'Frontotemporale');
pair('zy', 'Cheekbone edge (zygion)', 6.75, -3.9, 3.2, 'outline', 'both', 6, 'Zygion');
pair('chk', 'Cheek edge', 6.55, -1.2, 2.8, 'outline', 'both', 14);
pair('jaw1', 'Jawline', 6.1, 1.2, 2.0, 'outline', 'both', 16);
pair('go', 'Jaw angle (gonion)', 5.4, 3.3, 0.8, 'outline', 'both', 14, 'Gonion');
pair('jaw2', 'Jawline', 4.05, 5.1, 4.6, 'outline', 'both', 9);
pair('chin', 'Chin', 2.0, 6.0, 7.4, 'outline', 'both', 8);
mid('me', 'Chin bottom (menton)', 0, 6.3, 7.8, 'outline', 'both', 7.5, 'Menton', { n: [0, .7, .7] });

// ---- forehead, brows ----
mid('fhC', 'Forehead · centre', 0, -9.4, 9.2, 'skin', 'face', 5);
mid('fhT', 'Upper forehead · centre', 0, -10.85, 8.75, 'skin', 'face', 5);
pair('fh', 'Forehead', 3.7, -9.6, 8.2, 'skin', 'face', 5);
// (the brow ridge on its crest as measured on a scanned head — ICT-FaceKit's, by curvature: the most
// convex line above the eyes, ≈ 3.5 mm lower than it was, about at the brows' upper edge)
pair('supra', 'Supraorbital rim (brow ridge)', 3.0, -7.75, 9.3, 'skin', 'face', 6);
pair('temH', 'Temple hollow', 5.4, -6.4, 5.8, 'skin', 'face', 9);
mid('gl', 'Glabella', 0, -7.15, 9.85, 'skin', 'face', 5.5, 'Glabella');   // bone (between the brow ridges), not a brow dot
pair('bi', 'Brow · inner', 1.2, -6.7, 9.0, 'brows', 'face', 6);
pair('bm', 'Brow · centre', 2.1, -7.15, 8.8, 'brows', 'face', 6, null, { detail: true });
pair('ba', 'Brow · arch (centre)', 3.0, -7.4, 8.6, 'brows', 'face', 6, null, { detail: true });
pair('bt', 'Brow · tail', 5.1, -6.7, 7.1, 'brows', 'face', 6);

// ---- eyes ----
pair('en', 'Inner eye corner (endocanthion)', 1.8, -5.5, 8.0, 'eyes', 'face', 0, 'Endocanthion');
pair('eu1', 'Upper lid', 2.4, -5.95, 8.4, 'eyes', 'face');
pair('eu2', 'Upper lid', 3.25, -6.05, 8.3, 'eyes', 'face');
pair('eu3', 'Upper lid', 4.05, -5.9, 7.75, 'eyes', 'face');
pair('ex', 'Outer eye corner (exocanthion)', 4.65, -5.5, 7.2, 'eyes', 'face', 0, 'Exocanthion');
pair('el3', 'Lower lid', 4.05, -5.2, 7.7, 'eyes', 'face');
pair('el2', 'Lower lid', 3.25, -5.1, 8.2, 'eyes', 'face');
pair('el1', 'Lower lid', 2.4, -5.15, 8.3, 'eyes', 'face');
pair('pu', 'Pupil', 3.25, -5.6, 8.6, 'eyes', 'face', 0, 'Pupil');

// ---- nose ----
mid('n', 'Nasion', 0, -5.7, 9.2, 'nose', 'face', 6.5, 'Nasion');
mid('rhi', 'Nose bridge (rhinion)', 0, -3.6, 10.6, 'nose', 'face', 2.5, 'Nasal dorsum');
mid('dor', 'Nose bridge · lower', 0, -2.6, 11.5, 'nose', 'face', 2.5);
mid('prn', 'Nose tip (pronasale)', 0, -1.7, 12.05, 'nose', 'face', 3, 'Pronasale');
mid('col', 'Columella', 0, -1.05, 11.3, 'nose', 'face', 3, 'Columella', { n: [0, .6, .8] });
mid('sn', 'Nose base (subnasale)', 0, -0.6, 10.3, 'nose', 'face', 14, 'Subnasale', { n: [0, .4, .9] });
pair('nsd', 'Nose side', 1.0, -3.6, 9.9, 'nose', 'face', 3);
pair('al', 'Nostril wing (alare)', 1.7, -1.0, 9.6, 'nose', 'face', 11, 'Alare');
pair('ac', 'Alar crease', 1.45, -0.7, 9.0, 'nose', 'face', 12, 'Alar crease');
pair('nos', 'Nostril', 0.75, -0.75, 10.6, 'nose', 'face', 4);

// ---- cheeks, chin (interior skin) ----
pair('malar', 'Cheekbone (malar)', 4.5, -2.8, 7.65, 'skin', 'face', 7);
pair('nl1', 'Nasolabial fold', 2.0, -0.4, 9.3, 'skin', 'face', 13);
pair('nl2', 'Nasolabial fold · lower', 2.9, 1.3, 8.6, 'skin', 'face', 13);
pair('jowl', 'Jowl', 3.9, 3.2, 7.3, 'skin', 'face', 12);
pair('masse', 'Masseter', 5.6, 1.4, 4.6, 'skin', 'face', 18);
pair('ramus', 'Jaw ramus', 6.2, -0.3, 0.6, 'skin', 'face', 16, 'Ramus', { views: 'profile' });
pair('mental', 'Chin · side', 1.5, 4.5, 9.1, 'skin', 'face', 11);
mid('bpt', 'Chin crease (B point)', 0, 3.7, 9.38, 'skin', 'face', 10.5, 'Soft-tissue B point');
mid('pog', 'Chin front (pogonion)', 0, 4.9, 9.6, 'skin', 'face', 11, 'Pogonion');
mid('gn', 'Gnathion', 0, 5.8, 8.8, 'skin', 'face', 8.5, 'Gnathion', { n: [0, .5, .85] });

// ---- lips ----
mid('phil', 'Philtrum', 0, 0.4, 10.12, 'lips', 'face', 12);
mid('ls', 'Upper lip · centre', 0, 1.45, 10.45, 'lips', 'face', 12, 'Labrale superius');
mid('sto', 'Lip line (stomion)', 0, 2.0, 9.8, 'lips', 'face', 12, 'Stomion');
mid('li', 'Lower lip · centre', 0, 2.75, 10.0, 'lips', 'face', 13, 'Labrale inferius');
// the lips' fullness on the midline: the upper lip's tubercle (its vermilion is fairly flat) and the middle of the lower lip
mid('ulf', 'Upper lip · fullness (tubercle)', 0, 1.73, 10.38, 'lips', 'face', 12);
mid('llf', 'Lower lip · fullness', 0, 2.4, 10.22, 'lips', 'face', 13);
pair('ch', 'Mouth corner (cheilion)', 2.56, 1.95, 8.5, 'lips', 'face', 12, 'Cheilion');
pair('ul', 'Upper lip', 1.25, 1.55, 9.72, 'lips', 'face', 12);
pair('cph', 'Cupid’s bow', 0.5, 1.38, 10.4, 'lips', 'face', 12);
pair('ll', 'Lower lip', 1.25, 2.6, 9.62, 'lips', 'face', 13);

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

// ---- the lines retouchers and surgeons read a face by ----
// upper eyelid crease (where the brow fold sits; hooding covers it)
pair('cr1', 'Eyelid crease', 2.2, -6.35, 8.15, 'skin', 'face', 4);
pair('cr2', 'Eyelid crease', 2.9, -6.5, 8.05, 'skin', 'face', 4);
pair('cr3', 'Eyelid crease', 3.6, -6.48, 8.0, 'skin', 'face', 4);
pair('cr4', 'Eyelid crease', 4.35, -6.2, 7.5, 'skin', 'face', 4);
// the lower half of the eye socket's rim: tear trough (inner) → infraorbital rim (under the eye)
pair('tt1', 'Tear trough', 1.95, -4.6, 8.1, 'skin', 'face', 5);
pair('tt2', 'Infraorbital rim (under the eye)', 2.9, -4.4, 8.0, 'skin', 'face', 6);
pair('tt3', 'Infraorbital rim', 3.9, -4.45, 7.5, 'skin', 'face', 6);
// cheekbone ridge (malar body → zygomatic arch); below it, the cheekbone's underside (where its
// shadow starts: from beside the nostril out and up toward the arch) and the cheek hollow (the
// shadow line of a lean face: from under the cheekbone's high point, down to the end of the smile
// line by the mouth corner, bowing in toward the nose)
pair('zr1', 'Cheekbone ridge', 5.35, -3.2, 6.6, 'skin', 'face', 6.5);
pair('zr2', 'Cheekbone ridge', 6.1, -3.6, 5.1, 'skin', 'face', 6.5);
// The cheek hollow as one line: it starts under the outer cheekbone, runs in under it, curves down
// and in to the end of the smile line beside the mouth, and goes on down the marionette line to the
// jaw beside the chin (where the hollow of a lean face ends). Its dots sit a little below the
// surface around them — a hollow, not a ridge.
pair('sm3', 'Under the cheekbone · outer (the hollow starts)', 5.8, -2.2, 5.3, 'skin', 'face', 8);
pair('sm2', 'Under the cheekbone', 4.6, -1.65, 7.5, 'skin', 'face', 10);
pair('hcm', 'Cheek hollow', 3.6, 0.35, 8.2, 'skin', 'face', 14);
// nasolabial fold (alar base → past the mouth corner) and marionette line
pair('nl0', 'Nasolabial fold · top', 1.85, -0.85, 9.3, 'skin', 'face', 12);
pair('nl3', 'Nasolabial fold · end', 3.15, 2.15, 8.2, 'skin', 'face', 13);
pair('mar', 'Marionette line', 2.95, 3.55, 7.85, 'skin', 'face', 11);
pair('pjs', 'Marionette line · at the jaw (pre-jowl)', 3.05, 5.2, 7.2, 'skin', 'face', 9);
// forehead and chin pad
pair('fhU', 'Upper forehead', 2.0, -10.8, 8.6, 'skin', 'face', 5);
pair('cpl', 'Chin pad · lower', 0.9, 5.45, 8.95, 'skin', 'face', 9);
// nose: dorsal lines (the light stripe down the bridge) and the side walls
pair('dl1', 'Dorsal line', 0.55, -4.6, 10.0, 'nose', 'face', 3);
pair('dl2', 'Dorsal line', 0.6, -2.9, 10.9, 'nose', 'face', 2.5);
pair('tdp', 'Tip-defining point', 0.45, -1.85, 11.8, 'nose', 'face', 3);
pair('nsw', 'Nose side wall', 1.35, -2.2, 10.0, 'nose', 'face', 4);

// lower eyelid: more of the lid margin
pair('el0', 'Lower lid · inner', 2.05, -5.27, 8.2, 'eyes', 'face');
pair('el4', 'Lower lid · outer', 4.4, -5.3, 7.45, 'eyes', 'face');
// lower eyelid crease: the fold a few mm under the lid margin. With the lid above it and the rim below, the eye's
// lower half stands nearly upright in profile (it doesn't slope back into the socket)
pair('lc1', 'Lower lid crease', 2.25, -4.9, 8.2, 'skin', 'face', 4);
pair('lc2', 'Lower lid crease', 3.0, -4.78, 8.15, 'skin', 'face', 4);
pair('lc3', 'Lower lid crease', 3.8, -4.85, 7.7, 'skin', 'face', 4);
pair('lc4', 'Lower lid crease', 4.45, -5.0, 7.35, 'skin', 'face', 4.5);
// orbit: the bony rim around the eye — supraorbital (above), lateral, infraorbital (below), medial
pair('so1', 'Supraorbital rim · inner', 1.45, -7.62, 9.48, 'skin', 'face', 6);
pair('so3', 'Supraorbital rim · outer', 4.33, -7.72, 8.47, 'skin', 'face', 6);
pair('lor', 'Lateral orbital rim', 5.25, -5.5, 6.6, 'skin', 'face', 6.5);
pair('ior', 'Infraorbital rim · outer', 4.55, -4.55, 7.15, 'skin', 'face', 6.5);
pair('mor', 'Medial orbital rim', 1.25, -5.05, 8.7, 'skin', 'face', 6);
// philtrum: the two ridges (philtral columns) from the nose base down to the peaks of the Cupid's bow
pair('pc1', 'Philtral column · top', 0.42, -0.3, 10.3, 'lips', 'face', 12);
pair('pc2', 'Philtral column', 0.48, 0.55, 10.32, 'lips', 'face', 12);
mid('phL', 'Philtrum · lower', 0, 1.0, 10.3, 'lips', 'face', 12);
// nose edges: the outline of the nose from the bridge down around the nostril wing, and the tip lobule
pair('ne1', 'Nose edge · upper', 0.85, -4.7, 9.6, 'nose', 'face', 3);
pair('ne2', 'Nose edge', 1.15, -2.85, 9.95, 'nose', 'face', 3.5);
pair('ar1', 'Alar rim · top', 1.6, -1.65, 10.1, 'nose', 'face', 8);
pair('tl', 'Tip lobule · side', 0.85, -1.35, 11.4, 'nose', 'face', 3);
// inside the ear (profile): helix root, concha (the bowl), antihelix, antitragus
// (seen in front photos too: there the ear is narrow, but the bowl and the antihelix still show)
pair('cru', 'Helix root (crus)', 7.2, -3.9, 0.1, 'ears', 'back');
pair('cym', 'Concha · upper (cymba)', 7.35, -4.1, -0.75, 'ears', 'back');
pair('con', 'Concha · bowl (cavum)', 7.3, -2.6, -0.6, 'ears', 'back');
pair('itn', 'Intertragic notch', 7.15, -2.0, 0.05, 'ears', 'back');
pair('tfo', 'Triangular fossa', 7.5, -5.0, -1.0, 'ears', 'back');
pair('crS', 'Antihelix · upper crus', 7.7, -5.4, -1.55, 'ears', 'back');
pair('crI', 'Antihelix · lower crus', 7.4, -4.75, -0.5, 'ears', 'back');
pair('ah1', 'Antihelix · fork', 7.6, -4.4, -1.35, 'ears', 'back');
pair('ah2', 'Antihelix · lower', 7.65, -3.0, -1.6, 'ears', 'back');
pair('atr', 'Antitragus', 7.35, -1.55, -0.65, 'ears', 'back');
pair('sca', 'Scapha (groove inside the rim)', 7.9, -3.9, -2.05, 'ears', 'back');
pair('hxU', 'Helix · upper back', 7.95, -5.2, -1.6, 'ears', 'back');
pair('hx3', 'Helix · lower back', 7.75, -0.9, -1.9, 'ears', 'back');
// brow ridge and forehead: the ridge above the eyes, the slight hollow above it (supratoral
// sulcus), and the temporal line where the front of the forehead turns sharply into the temple
mid('sg', 'Supraglabella (above the brow ridge)', 0, -7.95, 9.65, 'skin', 'face', 5.5);
mid('rx', 'Radix (between glabella and nasion)', 0, -6.25, 9.45, 'nose', 'face', 6);
pair('so4', 'Brow ridge · lateral end', 5.47, -7.16, 6.93, 'skin', 'face', 5.5);
pair('ss1', 'Above the brow ridge', 1.5, -8.65, 9.35, 'skin', 'face', 5);
pair('ss2', 'Above the brow ridge', 3.0, -8.6, 8.88, 'skin', 'face', 5);
pair('ss3', 'Above the brow ridge', 4.45, -8.65, 7.8, 'skin', 'face', 5);
pair('tc1', 'Temporal line (forehead edge)', 5.65, -8.1, 6.2, 'skin', 'face', 5);
pair('tc2', 'Temporal line (forehead edge)', 5.6, -9.1, 6.0, 'skin', 'face', 5);
pair('tc3', 'Temporal line (forehead edge)', 5.4, -9.95, 5.7, 'skin', 'face', 5);
pair('ns', 'Nasion · side', 0.7, -5.75, 9.1, 'nose', 'face', 6);
// eyebrow shape: upper and lower edges around the centre line
pair('bu1', 'Brow · upper edge', 1.3, -7.05, 9.05, 'brows', 'face', 6);
pair('bu2', 'Brow · upper edge', 2.2, -7.5, 8.8, 'brows', 'face', 6);
pair('bu3', 'Brow · upper edge', 3.4, -7.65, 8.45, 'brows', 'face', 6);
pair('bl1', 'Brow · lower edge', 1.75, -6.55, 8.85, 'brows', 'face', 6);
pair('bl2', 'Brow · lower edge', 2.7, -6.85, 8.6, 'brows', 'face', 6);
pair('bl3', 'Brow · lower edge', 3.8, -6.95, 8.15, 'brows', 'face', 6);
// iris edges (its width, ≈ 11.7 mm, is a handy scale)
pair('irI', 'Iris · inner edge', 2.67, -5.6, 8.55, 'eyes', 'face');
pair('irO', 'Iris · outer edge', 3.83, -5.6, 8.4, 'eyes', 'face');
// chin crease, zygomatic arch (profile) and the Adam's apple
pair('ms', 'Chin crease (mentolabial sulcus)', 1.3, 3.6, 9.1, 'skin', 'face', 10.5);
pair('za', 'Zygomatic arch', 6.65, -3.35, 1.6, 'skin', 'face', 6, null, { views: 'profile' });
mid('thy', 'Adam’s apple (thyroid prominence)', 0, 8.7, 4.4, 'neck', 'back', 8);

const INDEX0 = Object.fromEntries(POINTS.map(p => [p.id, p]));

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
  { id: 'outline', closed: true, boundary: true, snap: true, ids: ['tri', 'hl0R', 'hl1R', 'hl3R', 'hl2R', 'hlcR', 'temR', 'zyR', 'chkR', 'jaw1R', 'goR', 'jaw2R', 'chinR', 'me', 'chinL', 'jaw2L', 'goL', 'jaw1L', 'chkL', 'zyL', 'temL', 'hlcL', 'hl2L', 'hl3L', 'hl1L', 'hl0L'] },
  { id: 'browL', line: true, draw: false, ids: ['biL', 'bmL', 'baL', 'btL'] },
  { id: 'browR', line: true, draw: false, ids: ['biR', 'bmR', 'baR', 'btR'] },
  { id: 'eyeL', closed: true, snapFine: true, ids: ['enL', 'eu1L', 'eu2L', 'eu3L', 'exL', 'el4L', 'el3L', 'el2L', 'el1L', 'el0L'] },
  { id: 'eyeR', closed: true, snapFine: true, ids: ['enR', 'eu1R', 'eu2R', 'eu3R', 'exR', 'el4R', 'el3R', 'el2R', 'el1R', 'el0R'] },
  { id: 'ridge', ids: ['n', 'rhi', 'dor', 'prn', 'col', 'sn'] },
  // the nostril sills: alar base → nostril → nose base (the wing itself is the end of noseEdge, ar1 → al → ac)
  { id: 'nostrils', ids: ['acL', 'nosL', 'sn', 'nosR', 'acR'] },
  { id: 'lips', closed: true, snapFine: true, ids: ['chL', 'ulL', 'cphL', 'ls', 'cphR', 'ulR', 'chR', 'llR', 'li', 'llL'] },
  { id: 'mouth', ids: ['chL', 'sto', 'chR'] },
  { id: 'earL', closed: true, ids: ['obsL', 'saL', 'hxUL', 'eoL', 'hbL', 'hx3L', 'lobL', 'obiL', 'traL'] },
  { id: 'earR', closed: true, ids: ['obsR', 'saR', 'hxUR', 'eoR', 'hbR', 'hx3R', 'lobR', 'obiR', 'traR'] },
  { id: 'hair', snap: true, ids: ['hslL', 'hseL', 'hsuL', 'htsL', 'vertex', 'htsR', 'hsuR', 'hseR', 'hslR'] },
  { id: 'neckL', snap: true, ids: ['ntL', 'nmL', 'nbL'] },
  { id: 'neckR', snap: true, ids: ['ntR', 'nmR', 'nbR'] },
  ...['L', 'R'].flatMap(s => [
    { id: 'crease' + s, line: true, ids: ['cr1', 'cr2', 'cr3', 'cr4'].map(i => i + s) },
    { id: 'lowerCrease' + s, line: true, ids: ['lc1', 'lc2', 'lc3', 'lc4'].map(i => i + s) },
    { id: 'cheekbone' + s, line: true, bone: true, ids: ['malar', 'zr1', 'zr2', 'zy'].map(i => i + s) },
    { id: 'hollow' + s, line: true, ids: ['sm3', 'sm2', 'hcm', 'nl3', 'mar', 'pjs'].map(i => i + s) },
    // (fold: Auto-place and Quick fit slide it onto the crease the photo shows)
    { id: 'nasolabial' + s, line: true, fold: true, ids: ['nl0', 'nl1', 'nl2', 'nl3'].map(i => i + s) },
    { id: 'dorsum' + s, line: true, ids: ['dl1', 'dl2', 'tdp'].map(i => i + s) },
    { id: 'noseEdge' + s, line: true, ids: ['ne1', 'nsd', 'ne2', 'nsw', 'ar1', 'al', 'ac'].map(i => i + s) },
    // the whole orbital ring: lateral → infraorbital → medial rim and up to the inner supraorbital rim (the
    // brow ridge line closes it over the top, so4 … so1)
    { id: 'orbit' + s, line: true, bone: true, ids: ['so4', 'lor', 'ior', 'tt3', 'tt2', 'tt1', 'mor', 'so1'].map(i => i + s) },
    { id: 'philtrum' + s, line: true, ids: ['pc1', 'pc2', 'cph'].map(i => i + s) },
    { id: 'browShape' + s, closed: true, line: true, snapFine: true, ids: ['bi', 'bu1', 'bu2', 'bu3', 'bt', 'bl3', 'bl2', 'bl1'].map(i => i + s) },
    { id: 'supratoral' + s, line: true, bone: true, ids: ['sg', ...['ss1', 'ss2', 'ss3', 'tc1'].map(i => i + s)] },
    { id: 'temporal' + s, line: true, bone: true, ids: ['so4', 'tc1', 'tc2', 'tc3'].map(i => i + s) },
    // the side of the nasal root, from the inner brow ridge (bone — not from the brow, which is hair)
    { id: 'radixSide' + s, line: true, ids: ['so1', 'ns', 'ne1'].map(i => i + s) },
    { id: 'iris' + s, line: true, ids: ['irI', 'pu', 'irO'].map(i => i + s) },
    { id: 'antihelix' + s, line: true, ids: ['crS', 'ah1', 'ah2', 'atr'].map(i => i + s) },
    { id: 'lowerCrus' + s, line: true, ids: ['crI', 'ah1'].map(i => i + s) },
    { id: 'concha' + s, line: true, ids: ['cru', 'cym', 'con', 'itn'].map(i => i + s) },
  ]),
  { id: 'browRidge', line: true, bone: true, ids: ['so4L', 'so3L', 'supraL', 'so1L', 'gl', 'so1R', 'supraR', 'so3R', 'so4R'] },
  { id: 'glabella', line: true, ids: ['sg', 'gl', 'rx', 'n'] },
  { id: 'chinCrease', line: true, ids: ['msL', 'bpt', 'msR'] },
  { id: 'lobule', line: true, ids: ['ar1L', 'tlL', 'tdpL', 'prn', 'tdpR', 'tlR', 'ar1R'] },
  { id: 'philMid', line: true, ids: ['sn', 'phil', 'phL', 'ls'] },
  // the lips' midline: border, fullness, lip line, fullness, border (dots only)
  { id: 'lipMid', line: true, draw: false, ids: ['ls', 'ulf', 'sto', 'llf', 'li'] },
];
const PROFILE_CONTOURS = [
  // the face region: the profile line from hairline to under the chin, back along the jaw, up in front of the ear
  { id: 'face', closed: true, boundary: true, ids: ['tri', 'fhC', 'sg', 'gl', 'rx', 'n', 'rhi', 'dor', 'prn', 'col', 'sn', 'phil', 'phL', 'ls', 'ulf', 'sto', 'llf', 'li', 'bpt', 'pog', 'gn', 'me', 'cerv', 'jaw2#', 'go#', 'ramus#', 'obs#', 'tem#', 'hlc#', 'hl2#', 'hl3#', 'hl1#', 'hl0#'] },
  { id: 'profile', snap: true, draw: false, ids: ['tri', 'fhC', 'sg', 'gl', 'rx', 'n', 'rhi', 'dor', 'prn', 'col', 'sn', 'phil', 'phL', 'ls', 'ulf', 'sto', 'llf', 'li', 'bpt', 'pog', 'gn', 'me', 'cerv', 'thy', 'neckF'] },
  { id: 'brow', line: true, draw: false, ids: ['bi#', 'bm#', 'ba#', 'bt#'] },
  { id: 'eye', closed: true, snapFine: true, ids: ['en#', 'eu1#', 'eu2#', 'eu3#', 'ex#', 'el4#', 'el3#', 'el2#', 'el1#', 'el0#'] },
  { id: 'nostril', ids: ['nos#', 'al#', 'ac#'] },
  { id: 'lip', ids: ['ls', 'cph#', 'ul#', 'ch#', 'll#', 'li'] },
  { id: 'ear', closed: true, ids: ['obs#', 'sa#', 'hxU#', 'eo#', 'hb#', 'hx3#', 'lob#', 'obi#', 'tra#'] },
  { id: 'hair', snap: true, ids: ['hairFront', 'vertex', 'occiput', 'hairBack'] },
  { id: 'neckFront', ids: ['cerv', 'thy', 'neckF'] },
  { id: 'neckBack', snap: true, ids: ['nape', 'neckB'] },
  { id: 'crease', line: true, ids: ['cr1#', 'cr2#', 'cr3#', 'cr4#'] },
  { id: 'lowerCrease', line: true, ids: ['lc1#', 'lc2#', 'lc3#', 'lc4#'] },
  { id: 'cheekbone', line: true, bone: true, ids: ['malar#', 'zr1#', 'zr2#', 'za#'] },
  { id: 'hollow', line: true, ids: ['sm3#', 'sm2#', 'hcm#', 'nl3#', 'mar#', 'pjs#'] },
  { id: 'nasolabial', line: true, fold: true, ids: ['nl0#', 'nl1#', 'nl2#', 'nl3#'] },
  { id: 'browRidge', line: true, bone: true, ids: ['so1#', 'supra#', 'so3#', 'so4#'] },
  { id: 'orbit', line: true, bone: true, ids: ['so4#', 'lor#', 'ior#', 'tt3#', 'tt2#'] },
  { id: 'supratoral', line: true, bone: true, ids: ['ss1#', 'ss2#', 'ss3#', 'tc1#'] },
  { id: 'temporal', line: true, bone: true, ids: ['so4#', 'tc1#', 'tc2#', 'tc3#'] },
  { id: 'browShape', closed: true, line: true, snapFine: true, ids: ['bi#', 'bu1#', 'bu2#', 'bu3#', 'bt#', 'bl3#', 'bl2#', 'bl1#'] },
  { id: 'noseEdge', line: true, ids: ['ne1#', 'nsd#', 'ne2#', 'nsw#', 'ar1#', 'al#'] },
  { id: 'antihelix', line: true, ids: ['crS#', 'ah1#', 'ah2#', 'atr#'] },
  { id: 'lowerCrus', line: true, ids: ['crI#', 'ah1#'] },
  { id: 'concha', line: true, ids: ['cru#', 'cym#', 'con#', 'itn#'] },
];

/* Denser contours: a dot halfway along every segment of the main contours, so the outline, eyes,
   lips, brows, nose and hair are traced closely (≈ 420 dots in all). Midpoints are averaged in 3D
   and marked as detail dots (drawn smaller). */
const MIDS = new Map();
let midCount = 0;
function midpoint(a, b, profileOnly) {
  const key = a < b ? a + '|' + b : b + '|' + a;
  if (MIDS.has(key)) {
    const p = INDEX0[MIDS.get(key)];
    if (!profileOnly && p.views === 'profile' && !p.ownViews) delete p.views;
    return p.id;
  }
  const A = INDEX0[a], B = INDEX0[b], x = (A.x + B.x) / 2;
  const p = {
    // named after the plainer neighbour (a landmark's name belongs to the landmark alone)
    id: 'd' + (++midCount), name: A.lm && !B.lm ? B.name : A.name,
    x, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2, group: A.group, field: A.field === 'both' || B.field === 'both' ? 'both' : A.field,
    t: (A.t + B.t) / 2, lm: null, side: Math.abs(x) < 1e-6 ? 0 : Math.sign(x), detail: true, mid: true,
  };
  if (A.views === 'all' || B.views === 'all') p.views = 'all';
  else if (profileOnly || A.views === 'profile' || B.views === 'profile') { p.views = 'profile'; p.ownViews = A.views === 'profile' || B.views === 'profile'; }
  if (A.n && B.n) p.n = A.n.map((v, i) => v + B.n[i]);
  POINTS.push(p); INDEX0[p.id] = p; MIDS.set(key, p.id);
  return p.id;
}
function densify(list, profileOnly) {
  for (const c of list) {
    if (c.line || c.id.startsWith('ear')) continue;
    const ids = c.ids, n = ids.length, segs = c.closed ? n : n - 1, out = [];
    for (let k = 0; k < n; k++) {
      out.push(ids[k]);
      if (k >= segs) continue;
      const a = ids[k], b = ids[(k + 1) % n];
      if (a.includes('#') || b.includes('#')) continue;
      out.push(midpoint(a, b, profileOnly));
    }
    c.ids = out;
  }
}
densify(FRONT_CONTOURS, false);
densify(PROFILE_CONTOURS, true);

const INDEX = Object.fromEntries(POINTS.map((p, i) => [p.id, i]));
/* Each detail dot by the two named dots it lies between ('a|b', sorted) and back: their numbers change
   when the template does, their neighbours don't (a saved map keeps its detail dots in any build). */
const MID_KEY = {}, MID_BY_KEY = {};
for (const [key, id] of MIDS) { MID_KEY[id] = key; MID_BY_KEY[key] = id; }
/** Each point's mirror image across the face's midline (itself for midline points). */
const MIRROR = POINTS.map((p, i) => {
  if (Math.abs(p.x) < 1e-6) return i;
  const j = POINTS.findIndex(q => Math.abs(q.x + p.x) < 1e-4 && Math.abs(q.y - p.y) < 1e-4 && Math.abs(q.z - p.z) < 1e-4);
  return j < 0 ? i : j;
});
/** Outward surface normal: a head-shaped ellipsoid, unless a point says otherwise. */
for (const p of POINTS) {
  if (p.n) { const L = Math.hypot(...p.n); p.n = p.n.map(v => v / L); continue; }
  const nx = p.x / (8.2 * 8.2), nz = (p.z + .3) / (10.6 * 10.6), L = Math.hypot(nx, nz) || 1;
  p.n = [nx / L, 0, nz / L];
}
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
   mirrored. Ops act on the scan dots and on every node of the dense face grid
   (used for the automatic shading) alike, so the dots and the shading always agree. */
const FACE = ['outline', 'skin', 'brows', 'eyes', 'nose', 'lips'];
const SOFT_GROUPS = ['outline', 'skin', 'nose', 'lips'];
const SKIN = ['outline', 'skin', 'brows', 'nose', 'lips'];   // everything on the face except the eye openings
// pivots (y, z in cm) for rotations
const JAW_PIVOT = [-3.2, 1.0];     // the jaw joint (condyle), just in front of the ear canal
const NOSE_PIVOT = [-0.6, 10.0];   // the nose base
const OPS = [
  // ---- bone ----
  { key: 'zygWidth', label: 'Cheekbone width', level: 'bone', mag: .7, dir: 'out', regions: [[6.6, -3.6, 3.8, 1.7], [5.3, -3.0, 6.5, 1.4]], affects: SKIN,
    help: 'Lateral projection of the zygomatic arch — wider cheekbones from the front' },
  { key: 'malarProj', label: 'Cheekbone projection', level: 'bone', mag: .6, dir: 'fwd', regions: [[4.4, -2.8, 7.65, 1.5]], affects: SKIN,
    help: 'The malar body toward / away from the camera — moves the highlight and the shadow below it' },
  { key: 'infraorbital', label: 'Infraorbital rim', level: 'bone', mag: .45, dir: 'fwd', regions: [[2.6, -4.1, 8.0, 1.0], [3.9, -3.7, 7.55, 1.0]], affects: SKIN,
    help: 'Support under the eyes — negative recesses the rim (shadowed, hollow under-eyes)' },
  { key: 'browRidge', label: 'Brow ridge projection', level: 'bone', mag: .45, dir: 'fwd', regions: [[0, -7.0, 9.8, 1.4], [3.0, -7.4, 9.2, 1.4]], affects: SKIN,
    help: 'Supraorbital and glabellar projection — a stronger ridge throws the eyes into shadow' },
  { key: 'browDrop', label: 'Brow ridge height', level: 'bone', mag: .5, dir: 'browDrop', regions: [[2.9, -7.2, 9.1, 1.25], [4.8, -6.8, 7.6, 1.15], [1.4, -6.9, 9.2, .8]], affects: ['outline', 'skin', 'brows'],
    help: 'Lowers the supraorbital rim and brows: the brow fold drops over the upper lid (hooded, deep-set look) while the eye opening stays' },
  { key: 'jawWidth', label: 'Jaw width', level: 'bone', mag: .9, dir: 'out', regions: [[5.3, 3.0, .9, 2.2]],
    help: 'Bigonial width — the mandibular angles' },
  { key: 'jawAngle', label: 'Jaw angle', level: 'bone', mag: .6, dir: 'jawAngle', regions: [[5.4, 3.6, .7, 1.6]],
    help: 'A sharper, lower gonial angle (or a softer, rounder one)' },
  // the band starts above the lips so they stay sealed (the soft tissue follows the jaw, the mouth doesn't open)
  { key: 'mandible', label: 'Mandible rotation', level: 'bone', mag: .075, dir: 'rotJaw', band: [-.2, 3.4], affects: SKIN.concat(['neck']),
    help: 'Rotates the lower jaw about the jaw joint: + sets the chin back and down (retrusion), − brings it forward and up' },
  // (centred low on the chin and tight: the lower lip doesn't come along, so the lip–chin crease deepens as it does on a real face)
  { key: 'chinProj', label: 'Chin projection', level: 'bone', mag: 1.35, dir: 'fwd', regions: [[0, 5.2, 9.3, 1.0]],
    help: 'Pogonion forward / back — from the front it changes the chin’s shadow and the lip–chin crease' },
  { key: 'chinHeight', label: 'Chin height', level: 'bone', mag: .7, dir: 'down', regions: [[0, 5.6, 8.6, 1.9]],
    help: 'Vertical chin length' },
  { key: 'chinWidth', label: 'Chin width', level: 'bone', mag: .5, dir: 'out', regions: [[1.9, 5.3, 8.4, 1.3]] },
  { key: 'midfaceProj', label: 'Midface projection', level: 'bone', mag: .6, dir: 'fwd', regions: [[0, -.4, 10.3, 2.2], [2.3, -.9, 9.1, 1.9]],
    help: 'Maxillary projection — nose base, upper lip, inner cheeks' },
  { key: 'jawProj', label: 'Lower jaw projection', level: 'bone', mag: .8, dir: 'fwd', regions: [[0, 4.0, 9.4, 2.5], [3.0, 4.6, 7.2, 2.2]],
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
  // along the cheek-hollow line: under the cheekbone, down beside the mouth and the marionette line to the jaw by the chin
  { key: 'buccal', label: 'Cheek hollows', level: 'soft', mag: -.42, dir: 'normal', regions: [[4.7, .2, 6.9, 1.5], [3.9, 2.0, 7.6, 1.25], [3.25, 3.9, 7.6, 1.05]], affects: ['outline', 'skin'],
    help: 'Buccal fat — positive hollows the cheeks: under the cheekbones and down beside the mouth along the marionette lines to the jaw' },
  { key: 'underEye', label: 'Under-eye hollows', level: 'soft', mag: -.25, dir: 'normal', regions: [[2.6, -3.9, 8.1, .8]], affects: ['skin', 'outline'] },
  { key: 'hooding', label: 'Upper lid fold', level: 'soft', mag: .32, dir: 'browDrop', regions: [[3.1, -6.25, 8.3, .7], [4.2, -6.0, 7.65, .7], [2.0, -6.2, 8.6, .6]], affects: ['skin', 'brows'],
    help: 'The skin and fat between brow and lid crease hang over the upper lid — the lid itself stays where it is' },
  { key: 'masseter', label: 'Masseter', level: 'soft', mag: .42, dir: 'out', regions: [[5.6, 1.4, 3.2, 1.6]],
    help: 'Jaw muscle bulk at the angle of the jaw' },
  { key: 'lips', label: 'Lip fullness', level: 'soft', mag: .3, dir: 'lips', regions: [[0, 1.6, 10.4, .9], [0, 2.5, 10.15, .9], [1.3, 2.0, 9.65, .9]], affects: ['lips', 'skin'] },
  { key: 'submental', label: 'Under the chin', level: 'soft', mag: .8, dir: 'normal', regions: [[0, 7.0, 4.2, 1.8], [3.2, 6.4, 3.0, 1.6]], affects: ['outline', 'skin', 'neck'],
    help: 'Submental fat — the neck–chin angle' },
  { key: 'temples', label: 'Temples', level: 'soft', mag: .4, dir: 'normal', regions: [[5.6, -6.8, 5.6, 1.4]] },
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

/** How much a point belongs to any of these groups: scan dots have one group, dense grid nodes a blend. */
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
 * default, or dense grid nodes: { x, y, z, t (mm), n: [3], m: { group: weight } }).
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
/** The anatomy for the scan dots. */
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
  // lambda: one smoothing for every control, or an array (per control: small = follow it closely)
  // one flat matrix (rows reached through perm, so pivoting swaps offsets, not data); each row
  // carries the two right-hand sides in its last two columns
  const m = n + 3, W = m + 2, A = new Float64Array(m * W), perm = new Int32Array(m);
  const c = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { c[2 * i] = ctrl[4 * i] / s; c[2 * i + 1] = ctrl[4 * i + 1] / s; }
  for (let i = 0; i < n; i++) {
    const xi = c[2 * i], yi = c[2 * i + 1], oi = i * W;
    for (let j = i + 1; j < n; j++) {
      const dx = xi - c[2 * j], dy = yi - c[2 * j + 1], r2 = dx * dx + dy * dy;
      const u = r2 > 1e-14 ? .5 * r2 * Math.log(r2) : 0;
      A[oi + j] = u; A[j * W + i] = u;
    }
    A[oi + i] = typeof lambda === 'number' ? lambda : lambda[i]; A[oi + n] = 1; A[oi + n + 1] = xi; A[oi + n + 2] = yi;
    A[n * W + i] = 1; A[(n + 1) * W + i] = xi; A[(n + 2) * W + i] = yi;
    A[oi + m] = (ctrl[4 * i + 2] - ctrl[4 * i]) / s; A[oi + m + 1] = (ctrl[4 * i + 3] - ctrl[4 * i + 1]) / s;
  }
  for (let i = 0; i < m; i++) perm[i] = i * W;
  // Gaussian elimination with partial pivoting
  for (let k = 0; k < m; k++) {
    let piv = k, best = Math.abs(A[perm[k] + k]);
    for (let r = k + 1; r < m; r++) { const v = Math.abs(A[perm[r] + k]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-14) continue;
    if (piv !== k) { const t = perm[k]; perm[k] = perm[piv]; perm[piv] = t; }
    const ok = perm[k], inv = 1 / A[ok + k];
    for (let r = k + 1; r < m; r++) {
      const or = perm[r], f = A[or + k] * inv;
      if (f === 0) continue;
      for (let col = k + 1; col < W; col++) A[or + col] -= f * A[ok + col];
      A[or + k] = 0;
    }
  }
  const sx = new Float64Array(m), sy = new Float64Array(m);
  for (let k = m - 1; k >= 0; k--) {
    const ok = perm[k];
    let tx = A[ok + m], ty = A[ok + m + 1];
    for (let col = k + 1; col < m; col++) { tx -= A[ok + col] * sx[col]; ty -= A[ok + col] * sy[col]; }
    const d = A[ok + k];
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
  POINTS, INDEX, MIRROR, VIEWS, OPS, OP_INDEX, MID_KEY, MID_BY_KEY,
  visible, project, contours, nearSide, anatomy, anatomyAt,
  mls, tpsFit, tpsEval, spline, build: '54',
};
})();
