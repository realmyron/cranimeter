/* ==========================================================================
   Cranimeter · measurement presets & landmark glossary
   --------------------------------------------------------------------------
   Reference ranges are approximate norms gathered from the facial
   anthropometry / aesthetics literature (Farkas, Martin–Saller facial index,
   neoclassical canons, soft-tissue profile analysis). They vary with sex,
   age and ancestry — treat them as orientation, not diagnosis.

   kinds
     ratio     4 points → line 1 (p0–p1) ÷ line 2 (p2–p3)
     angle     3 points → angle at the middle point
     tilt      2 points → angle of p0→p1 against the horizontal
     segments  n points → lengths along the p0→pn axis, relative to `base`
   ========================================================================== */

window.CRANI = {
  build: '40',
  LANDMARKS: {
    'Trichion': 'Midpoint of the hairline at the top of the forehead.',
    'Glabella': 'Most prominent midline point between the eyebrows.',
    'Nasion': 'Deepest point of the nasal root, where the nose meets the forehead.',
    'Pupil': 'Centre of the pupil, with the eyes looking straight ahead.',
    'Mid-pupil': 'Midline point on the line joining the two pupils.',
    'Endocanthion': 'Inner corner of the eye, where the upper and lower lids meet.',
    'Exocanthion': 'Outer corner of the eye, where the upper and lower lids meet.',
    'Upper lid': 'Highest point of the upper eyelid margin.',
    'Lower lid': 'Lowest point of the lower eyelid margin.',
    'Frontotemporale': 'Narrowest point of the forehead at the temples, just above the brow tail.',
    'Zygion': 'Most lateral point of the cheekbone (zygomatic arch) — the widest point of the face.',
    'Face edge': 'Outer soft-tissue edge of the face at eye level.',
    'Alare': 'Most lateral point of the nostril wing.',
    'Alar crease': 'Deepest point of the crease where the nostril wing joins the cheek.',
    'Subnasale': 'Point where the base of the columella meets the upper lip.',
    'Pronasale': 'Most projecting point of the nasal tip.',
    'Columella': 'A point on the underside of the nose (columella), setting its tangent.',
    'Nasal dorsum': 'A point on the nasal bridge below nasion, setting the dorsum tangent.',
    'Labrale superius': 'Upper border of the upper lip at the midline (centre of the cupid’s bow).',
    'Stomion': 'Midpoint of the line where the lips meet.',
    'Labrale inferius': 'Lower border of the lower lip at the midline.',
    'Cheilion': 'Corner of the mouth.',
    'Soft-tissue B point': 'Deepest point of the curve between the lower lip and the chin.',
    'Pogonion': 'Most forward-projecting point of the soft-tissue chin.',
    'Gnathion': 'Lowest, most forward point of the chin at the midline.',
    'Menton': 'Lowest point of the chin.',
    'Gonion': 'Corner of the jaw — where the jawline turns upward toward the ear.',
    'Ramus': 'A point high on the back border of the jaw (ramus), setting its tangent.',
    'Cervical point': 'Deepest point where the underside of the chin meets the neck.',
    'Neck': 'A point lower on the front of the neck, setting the neck tangent.',
  },

  GROUPS: [
    {
      name: 'Proportions',
      items: [
        {
          id: 'fwhr', name: 'FWHR', full: 'Facial width-to-height ratio', kind: 'ratio',
          lines: ['Bizygomatic width', 'Upper face height'],
          pts: ['Zygion · left', 'Zygion · right', 'Nasion', 'Labrale superius'],
          ref: [1.8, 2.0], dom: [1.4, 2.4],
          desc: 'Cheekbone width divided by the height from the nasal root to the upper lip. Higher values read broader and more robust. Some studies measure height from the brow line instead — stay consistent.',
        },
        {
          id: 'facial-index', name: 'Facial index', full: 'Morphological face height ÷ bizygomatic width', kind: 'ratio',
          lines: ['Face height (n–me)', 'Bizygomatic width'],
          pts: ['Nasion', 'Menton', 'Zygion · left', 'Zygion · right'],
          ref: [0.81, 0.88], dom: [0.70, 1.00],
          desc: 'The classic facial index (×100). Male: euryprosopic 0.79–0.84, mesoprosopic 0.84–0.88, leptoprosopic 0.88–0.93. Female: euryprosopic 0.77–0.81, mesoprosopic 0.81–0.85, leptoprosopic 0.85–0.90.',
          classify(v) {
            const m = v < 0.79 ? 'hyper-eury' : v < 0.84 ? 'euryprosopic' : v < 0.88 ? 'mesoprosopic' : v < 0.93 ? 'leptoprosopic' : 'hyper-lepto';
            const f = v < 0.77 ? 'hyper-eury' : v < 0.81 ? 'euryprosopic' : v < 0.85 ? 'mesoprosopic' : v < 0.90 ? 'leptoprosopic' : 'hyper-lepto';
            return m === f ? m[0].toUpperCase() + m.slice(1) : `♂ ${m} · ♀ ${f}`;
          },
        },
        {
          id: 'width-height', name: 'Face width / height', full: 'Bizygomatic ÷ trichion–menton', kind: 'ratio',
          lines: ['Bizygomatic width', 'Physiognomic face height'],
          pts: ['Zygion · left', 'Zygion · right', 'Trichion', 'Menton'],
          ref: [0.70, 0.75], dom: [0.58, 0.88],
          desc: 'Face width as a share of the full face height from hairline to chin. Around 70–75% is typical; lower values read longer and more oval.',
        },
        {
          id: 'midface', name: 'Midface ratio', full: 'Interpupillary distance ÷ midface height', kind: 'ratio',
          lines: ['Interpupillary distance', 'Midface height'],
          pts: ['Pupil · left', 'Pupil · right', 'Mid-pupil', 'Labrale superius'],
          ref: [0.95, 1.05], dom: [0.75, 1.25],
          desc: 'Pupil-to-pupil distance divided by the vertical drop from the pupil line to the upper lip. Values near 1.0 give a compact midface; lower values read as a longer midface.',
        },
        {
          id: 'esr', name: 'Eye separation', full: 'Interpupillary ÷ bizygomatic width', kind: 'ratio',
          lines: ['Interpupillary distance', 'Bizygomatic width'],
          pts: ['Pupil · left', 'Pupil · right', 'Zygion · left', 'Zygion · right'],
          ref: [0.45, 0.47], dom: [0.38, 0.54],
          desc: 'How far apart the eyes sit relative to face width. Around 0.45–0.47 is commonly cited as balanced.',
        },
        {
          id: 'eye-spacing', name: 'Eye spacing', full: 'Intercanthal width ÷ eye width', kind: 'ratio',
          lines: ['Intercanthal width', 'Eye width'],
          pts: ['Endocanthion · left', 'Endocanthion · right', 'Exocanthion · one eye', 'Endocanthion · same eye'],
          ref: [0.95, 1.05], dom: [0.70, 1.30],
          desc: 'Rule of fifths: the gap between the eyes ideally equals one eye width. Higher reads wide-set, lower close-set.',
        },
        {
          id: 'eye-ar', name: 'Eye aspect ratio', full: 'Palpebral width ÷ height', kind: 'ratio',
          lines: ['Eye width', 'Eye height'],
          pts: ['Exocanthion', 'Endocanthion', 'Upper lid', 'Lower lid'],
          ref: [3.0, 3.5], dom: [2.2, 4.3],
          desc: 'Width of the eye opening divided by its height. Higher values read narrower and more almond-shaped; lower values rounder.',
        },
        {
          id: 'temple-cheek', name: 'Temple / cheek width', full: 'Bitemporal ÷ bizygomatic width', kind: 'ratio',
          lines: ['Bitemporal width', 'Bizygomatic width'],
          pts: ['Frontotemporale · left', 'Frontotemporale · right', 'Zygion · left', 'Zygion · right'],
          ref: [0.80, 0.85], dom: [0.68, 0.98],
          desc: 'Upper-face width at the temples relative to cheekbone width. Typically 80–85%.',
        },
        {
          id: 'jaw-cheek', name: 'Jaw / cheek width', full: 'Bigonial ÷ bizygomatic width', kind: 'ratio',
          lines: ['Bigonial width', 'Bizygomatic width'],
          pts: ['Gonion · left', 'Gonion · right', 'Zygion · left', 'Zygion · right'],
          ref: [0.70, 0.80], dom: [0.58, 0.95],
          desc: 'Jaw width relative to cheekbone width — about 70–75% on average. Higher values give a squarer, more angular lower face; lower values a tapered, V-shaped one.',
        },
        {
          id: 'nose-eye', name: 'Nose / eye gap', full: 'Alar width ÷ intercanthal width', kind: 'ratio',
          lines: ['Alar width', 'Intercanthal width'],
          pts: ['Alare · left', 'Alare · right', 'Endocanthion · left', 'Endocanthion · right'],
          ref: [0.9, 1.1], dom: [0.7, 1.5],
          desc: 'Neoclassical canon: nose width roughly equals the distance between the inner eye corners.',
        },
        {
          id: 'mouth-nose', name: 'Mouth / nose width', full: 'Cheilion–cheilion ÷ alar width', kind: 'ratio',
          lines: ['Mouth width', 'Alar width'],
          pts: ['Cheilion · left', 'Cheilion · right', 'Alare · left', 'Alare · right'],
          ref: [1.5, 1.62], dom: [1.1, 2.0],
          desc: 'Mouth width relative to nose width. About 1.5–1.6 (close to the golden ratio) is a common aesthetic reference.',
        },
        {
          id: 'chin-philtrum', name: 'Chin / philtrum', full: 'Chin height ÷ philtrum length', kind: 'ratio',
          lines: ['Chin height', 'Philtrum length'],
          pts: ['Labrale inferius', 'Menton', 'Subnasale', 'Labrale superius'],
          ref: [2.0, 2.5], dom: [1.3, 3.3],
          desc: 'Lower lip to menton, divided by subnasale to upper lip. Around 2.0–2.5 is often cited; lower values suggest a short chin or a long philtrum.',
        },
        {
          id: 'lips', name: 'Lip ratio', full: 'Lower ÷ upper vermilion height', kind: 'ratio',
          lines: ['Lower lip height', 'Upper lip height'],
          pts: ['Stomion', 'Labrale inferius', 'Labrale superius', 'Stomion'],
          ref: [1.4, 1.8], dom: [0.8, 2.5],
          desc: 'Lower-lip height over upper-lip height. A lower lip about 1.6× the upper is a common aesthetic reference.',
        },
      ],
    },
    {
      name: 'Divisions',
      items: [
        {
          id: 'thirds', name: 'Facial thirds', full: 'Trichion · glabella · subnasale · menton', kind: 'segments',
          pts: ['Trichion', 'Glabella', 'Subnasale', 'Menton'], ideal: [1, 1, 1], base: 1,
          desc: 'Vertical canon: forehead, midface and lower face roughly equal. Each third is shown relative to the middle third. Lengths are projected onto the trichion–menton axis, so head tilt does not skew them.',
        },
        {
          id: 'fifths', name: 'Facial fifths', full: 'Face width in five eye-widths', kind: 'segments',
          pts: ['Face edge · left', 'Exocanthion · left', 'Endocanthion · left', 'Endocanthion · right', 'Exocanthion · right', 'Face edge · right'],
          ideal: [1, 1, 1, 1, 1], base: 2,
          desc: 'Horizontal canon: the face splits into five equal parts — two outer segments, two eye widths and the gap between the eyes. Shown relative to the central fifth.',
        },
        {
          id: 'lower-third', name: 'Lower third', full: 'Subnasale · stomion · menton', kind: 'segments',
          pts: ['Subnasale', 'Stomion', 'Menton'], ideal: [1, 2], base: 0,
          desc: 'Upper lip (subnasale → stomion) against lips-and-chin (stomion → menton). A 1 : 2 split is the classic ideal.',
        },
      ],
    },
    {
      name: 'Front angles',
      items: [
        {
          id: 'canthal-left', name: 'Canthal tilt · left', full: 'Eye on the left of the image', kind: 'tilt',
          pts: ['Endocanthion', 'Exocanthion'], ref: [4, 8], dom: [-6, 14],
          desc: 'Angle of the inner→outer eye-corner line against the horizontal. Slightly positive (outer corner higher, about 4–8°) is the most commonly cited ideal. Level the head first — any head roll adds straight onto this.',
        },
        {
          id: 'canthal-right', name: 'Canthal tilt · right', full: 'Eye on the right of the image', kind: 'tilt',
          pts: ['Endocanthion', 'Exocanthion'], ref: [4, 8], dom: [-6, 14],
          desc: 'Angle of the inner→outer eye-corner line against the horizontal. Slightly positive (outer corner higher, about 4–8°) is the most commonly cited ideal. Level the head first — any head roll adds straight onto this.',
        },
        {
          id: 'jaw-frontal', name: 'Jaw frontal angle', full: 'Gonion · menton · gonion', kind: 'angle',
          pts: ['Gonion · left', 'Menton', 'Gonion · right'], ref: [85, 95], dom: [65, 120],
          desc: 'Angle at the chin formed by both jaw corners. Smaller angles give a narrower, more tapered chin; larger ones a broader, squarer jaw. Sources vary — treat the range loosely.',
        },
      ],
    },
    {
      name: 'Profile',
      items: [
        {
          id: 'gonial', name: 'Gonial angle', full: 'Ramus · gonion · menton', kind: 'angle',
          pts: ['Ramus', 'Gonion', 'Menton'], ref: [120, 130], dom: [100, 145],
          desc: 'Jaw angle in profile, between the back border of the ramus and the lower border of the mandible. Roughly 120–130° is typical; lower values give a sharper, more defined angle.',
        },
        {
          id: 'convexity', name: 'Facial convexity', full: 'Glabella · subnasale · pogonion', kind: 'angle',
          pts: ['Glabella', 'Subnasale', 'Pogonion'], ref: [164, 172], dom: [148, 180],
          desc: 'Soft-tissue contour angle — on average about 12 ± 4° short of a straight line (≈ 168°). Smaller values mean a more convex profile (retruded chin). A concave profile also reads close to 180° here.',
        },
        {
          id: 'nasofrontal', name: 'Nasofrontal angle', full: 'Glabella · nasion · nasal dorsum', kind: 'angle',
          pts: ['Glabella', 'Nasion', 'Nasal dorsum'], ref: [115, 135], dom: [100, 150],
          desc: 'Angle at the root of the nose between forehead and nasal bridge. About 115–135° is the commonly cited range.',
        },
        {
          id: 'nasolabial', name: 'Nasolabial angle', full: 'Columella · subnasale · upper lip', kind: 'angle',
          pts: ['Columella', 'Subnasale', 'Labrale superius'], ref: [90, 110], dom: [70, 130],
          desc: 'Angle between the underside of the nose and the upper lip. About 90–95° is typical for men and 95–110° for women; it reflects nasal tip rotation.',
        },
        {
          id: 'mentolabial', name: 'Mentolabial angle', full: 'Lower lip · sulcus · pogonion', kind: 'angle',
          pts: ['Labrale inferius', 'Soft-tissue B point', 'Pogonion'], ref: [110, 130], dom: [85, 155],
          desc: 'Depth of the fold between lower lip and chin. Around 110–130° is typical; smaller means a deeper fold.',
        },
        {
          id: 'cervicomental', name: 'Cervicomental angle', full: 'Chin · cervical point · neck', kind: 'angle',
          pts: ['Menton', 'Cervical point', 'Neck'], ref: [105, 120], dom: [85, 145],
          desc: 'Angle between the underside of the chin and the neck. About 105–120° reads as a crisp jaw–neck transition; larger values look softer.',
        },
        {
          id: 'goode', name: 'Goode ratio', full: 'Nasal tip projection ÷ nasal length', kind: 'ratio',
          lines: ['Tip projection', 'Nasal length'],
          pts: ['Alar crease', 'Pronasale', 'Nasion', 'Pronasale'],
          ref: [0.55, 0.60], dom: [0.42, 0.72],
          desc: 'Tip projection (alar crease → tip) over nasal length (nasion → tip). 0.55–0.60 is the classic ideal; higher means an over-projected tip.',
        },
      ],
    },
  ],
};
