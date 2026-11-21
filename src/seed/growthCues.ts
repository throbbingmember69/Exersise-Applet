// Growth cues: the parts of an exercise's technique that research ties to muscle growth, one or
// two per program exercise, each with the reason and its source. They sit apart from the form
// guides' general coaching cues (seed/formGuides.ts) and show first in the Form sheet, with the
// first one on the logger card. Researched 2026-11-21 for the per-exercise review
// (docs/EXERCISE-EVIDENCE.md, which has the full sources). Static content, no migration.
//
// The common thread: loading a muscle at long lengths (the stretched part of the range) is the
// best-supported technique lever (Maeo 2021 and 2023, Kinoshita 2023, Pedrosa 2023, Kassiano 2023,
// Kubo 2019). Full range matches "lengthened partials" in trained lifters (Wolf 2023 meta-analysis,
// Wolf 2025). EMG-only support is labelled as such: activation doesn't prove growth.

export interface GrowthCue {
  /** What to do, in a short imperative line. */
  cue: string
  /** Why, with the source. */
  why: string
}

const FULL_STRETCH =
  'Loading the muscle at long lengths is the best-supported technique lever for growth (Wolf 2023 review).'
const OVERHEAD_TRICEPS =
  'Overhead extensions grew the triceps more than neutral-arm pushdowns, most in the long head (Maeo 2023).'
const VERTICAL_PULL =
  'Grip and pulldown style change lat activation little (EMG); the full stretch at the top matters more.'
const REAR_DELT =
  'The reverse fly activated the rear delts more than rows or pulldowns (EMG); squeezing the shoulder blades shifts work to the traps.'
const TRAPS_EMG =
  'Trap evidence is EMG only: shrugging with the arms about 30° out raised upper- and lower-trap activity (2014).'
const INCLINE_PRESS =
  'Incline pressing grew the upper (clavicular) chest most in a training study, and activates it most (EMG).'

export const GROWTH_CUES: Readonly<Record<string, readonly GrowthCue[]>> = {
  // ── Lower ─────────────────────────────────────────────────────────────────
  'ex-smith-squat': [
    {
      cue: 'Squat to full depth, thighs below parallel, on every rep.',
      why: 'Full squats grew the glutes and adductors about 3× more than half squats, with equal quad growth (Kubo 2019).',
    },
  ],
  'ex-leg-extension': [
    {
      cue: 'Recline the backrest as far as the machine allows.',
      why: 'Leg extensions with the hip reclined (40° vs 90°) grew the rectus femoris more over 10 weeks (2025 trial).',
    },
    {
      cue: 'Lower all the way into a deep knee bend; don’t cut the bottom half.',
      why: 'Leg extensions grow the rectus femoris, which squats and leg presses barely train (+13% vs +1%, Maeo).',
    },
  ],
  'ex-seated-leg-curl': [
    {
      cue: 'Sit tall or lean forward, and let the pad straighten your knees fully each rep.',
      why: 'Hip flexion lengthens the hamstrings: seated curls grew them more than lying curls (+14% vs +9%, Maeo 2021).',
    },
  ],
  'ex-hip-thrust': [
    {
      cue: 'Drive to full hip lockout, then lower until the hips are just above the floor.',
      why: 'Hip thrusts and squats grew the glutes about equally (Plotkin 2023); full range beats short partials (Wolf 2023).',
    },
  ],
  'ex-hip-abduction': [
    {
      cue: 'Use the full range: let the pads come all the way in, slowly, before each rep.',
      why: 'Squats and hip thrusts barely grew the gluteus medius and minimus (Plotkin 2023); targeted hip work did.',
    },
  ],
  'ex-standing-calf-raise': [
    {
      cue: 'Keep your knees straight and pause 1–2 s in the deepest stretch at the bottom.',
      why: 'Knee-straight raises grew the gastrocnemius far more than seated ones (+12% vs +2%, Kinoshita 2023).',
    },
    {
      cue: 'When full reps run out, finish with bottom-half partials.',
      why: 'Calf partials in the stretched half grew the gastrocnemius more than full reps (+15% vs +7%, Kassiano 2023).',
    },
  ],
  'ex-cable-crunch': [
    {
      cue: 'Curl your ribs toward your pelvis (round the spine); keep the hips still.',
      why: 'Spinal flexion is what loads the abs; the crunch thickened them most of the exercises tested (2023 ultrasound).',
    },
  ],
  'ex-deadlift': [
    {
      cue: 'Train it for strength; the curls, RDLs and back extensions are the hamstring builders.',
      why: 'No training study shows conventional deadlifts growing the hamstrings; long-length hip work does (Maeo 2024).',
    },
  ],
  'ex-rdl': [
    {
      cue: 'Soft knees; push the hips back until a deep hamstring stretch, then stand without leaning back.',
      why: 'Hip-flexed, long-length loading grew the hamstrings more (Maeo 2021 and 2024); the RDL loads them that way.',
    },
  ],
  'ex-bss': [
    {
      cue: 'Go deep, back knee near the floor; a longer stride and slight forward lean bias the glutes.',
      why: 'Deeper ranges grew the glutes more in squats (Kubo 2019); the lean-for-glutes cue rests on EMG only.',
    },
  ],
  'ex-back-extension': [
    {
      cue: 'Hinge at the hips to a full stretch with a neutral spine; rise to a straight line, not past it.',
      why: '45° hip extensions grew the hamstrings’ long head more than Nordic curls (Bourne 2017).',
    },
  ],
  // ── Push ──────────────────────────────────────────────────────────────────
  'ex-incline-db-bench': [
    { cue: 'Bench at 30–45°; lower the dumbbells into a deep chest stretch.', why: INCLINE_PRESS },
  ],
  'ex-flat-machine-press': [
    {
      cue: 'Let the handles come back to chest line for a full stretch each rep.',
      why: FULL_STRETCH,
    },
  ],
  'ex-machine-fly': [
    { cue: 'Open wide into a deep pec stretch and control it; don’t bounce.', why: FULL_STRETCH },
  ],
  'ex-overhead-press': [
    {
      cue: 'Full range: handles from about chin level to just short of lockout.',
      why: 'Chest pressing already loads the front delts heavily, so this is the most optional press; keep it full range.',
    },
  ],
  'ex-lateral-raise': [
    {
      cue: 'Raise to about shoulder height leading with the elbows; lower slowly.',
      why: 'Cable and dumbbell raises grew the side delts equally (Larsen 2025): sets and effort matter more than the tool.',
    },
  ],
  'ex-db-shrug': [
    {
      cue: 'Arms slightly out from your sides; shrug straight up, hold 1 s, drop to a full stretch.',
      why: TRAPS_EMG,
    },
  ],
  'ex-barbell-shrug': [
    { cue: 'Shrug straight up, hold 1 s at the top, then drop to a full stretch.', why: TRAPS_EMG },
  ],
  'ex-overhead-cable-triceps-extension': [
    {
      cue: 'Keep the elbow overhead and lower into a deep stretch behind your head.',
      why: OVERHEAD_TRICEPS,
    },
  ],
  'ex-dip-machine': [
    { cue: 'Go to full depth each rep, then press to lockout.', why: FULL_STRETCH },
  ],
  // ── Pull ──────────────────────────────────────────────────────────────────
  'ex-weighted-chin-up': [
    {
      cue: 'Start every rep from a dead hang, arms straight, and pull until your chin clears the bar.',
      why: 'Vertical pulls activated the lats more than rows (EMG); the dead hang loads them at long length.',
    },
  ],
  'ex-machine-barbell-row': [
    {
      cue: 'At the bottom, let the shoulder blades spread forward for a full stretch.',
      why: FULL_STRETCH,
    },
  ],
  'ex-rocking-pulldown': [
    { cue: 'Arms fully straight at the top; keep the torso swing small.', why: VERTICAL_PULL },
  ],
  'ex-neutral-pulldown': [
    {
      cue: 'Arms fully straight at the top, shoulders rising; no torso swing.',
      why: VERTICAL_PULL,
    },
  ],
  'ex-lat-pulldown': [
    {
      cue: 'Arms fully straight at the top, shoulders rising; no torso swing.',
      why: VERTICAL_PULL,
    },
  ],
  'ex-incline-db-y-raise': [
    {
      cue: 'Light weight, thumbs up; raise in a Y without shrugging.',
      why: 'The prone Y gave the highest lower-trap activity of the shoulder-blade exercises tested (Ekstrom 2003, EMG).',
    },
  ],
  'ex-rear-delt-fly': [
    {
      cue: 'Fixed slight elbow bend; move at the shoulder, not the shoulder blades.',
      why: REAR_DELT,
    },
  ],
  'ex-cable-rear-delt-fly': [
    {
      cue: 'Fixed slight elbow bend; move at the shoulder, not the shoulder blades.',
      why: REAR_DELT,
    },
  ],
  'ex-face-pull': [
    {
      cue: 'Pull to your face and rotate the hands back at the end.',
      why: 'Mainly a rotator-cuff and upper-back exercise; the reverse fly is the stronger rear-delt builder (EMG).',
    },
  ],
  'ex-preacher-curl': [
    {
      cue: 'Lower all the way to a straight elbow; don’t bounce out of the bottom.',
      why: 'Preacher curls in the stretched range grew the lower biceps more (Pedrosa 2023).',
    },
  ],
  'ex-bayesian-curl': [
    {
      cue: 'Stand ahead of the cable so the arm starts behind your body; curl from a full stretch.',
      why: 'Bayesian and preacher curls grew the biceps equally (2025 within-person trial): a change of stimulus.',
    },
  ],
  'ex-db-hammer-curl': [
    {
      cue: 'Neutral grip, full range: lower to a straight elbow every rep.',
      why: 'The neutral grip shifts work to the brachialis and brachioradialis; the full range keeps the stretch.',
    },
  ],
  // ── Upper ─────────────────────────────────────────────────────────────────
  'ex-incline-smith-press': [
    {
      cue: 'Bench about 30°; lower the bar to the upper chest for a deep stretch.',
      why: INCLINE_PRESS,
    },
  ],
  'ex-cable-crossover': [
    {
      cue: 'Let the handles pull your arms back into a deep stretch; control it.',
      why: FULL_STRETCH,
    },
  ],
  'ex-machine-row-upper': [
    {
      cue: 'At the front, let the shoulder blades spread forward for a full stretch.',
      why: FULL_STRETCH,
    },
  ],
  'ex-cable-shrug': [
    { cue: 'Shrug straight up, hold 1 s at the top, then drop to a full stretch.', why: TRAPS_EMG },
  ],
  'ex-incline-db-biceps-curl': [
    {
      cue: 'Keep the arm behind your torso and lower to a full stretch.',
      why: 'Incline curls grew the upper biceps more and preacher curls the lower (2025 trial): the two complement each other.',
    },
  ],
  'ex-straight-bar-pushdown': [
    {
      cue: 'Let the bar rise until the elbows bend fully; lock out at the bottom.',
      why: 'Neutral-arm work grew the triceps less than overhead extensions (Maeo 2023); keep the full range.',
    },
  ],
  'ex-overhead-rope-extension': [
    {
      cue: 'Upper arms by your ears; lower into a deep stretch behind your head.',
      why: OVERHEAD_TRICEPS,
    },
  ],
  'ex-machine-triceps-extension': [
    { cue: 'Return slowly to a full elbow bend for the stretch.', why: FULL_STRETCH },
  ],
  // ── Smaller muscles (2026-11-21) ──────────────────────────────────────────
  'ex-ab-wheel-rollout': [
    {
      cue: 'Roll out until hips and arms are nearly straight, ribs down; don’t let the lower back sag.',
      why: 'Rollouts load the abs stretched and gave some of the highest ab and oblique activation (EMG).',
    },
  ],
  'ex-cable-woodchop': [
    {
      cue: 'Turn through your trunk with long arms and square hips; the arms only hold the handle.',
      why: 'The obliques rotate the trunk; arm-driven chops shift the work away (EMG only, no growth trials).',
    },
  ],
  'ex-neck-extension': [
    {
      cue: 'Slow, full range from chin-to-chest back to neutral; no jerking.',
      why: 'Direct neck extensions grew the neck 13% in 12 weeks; lifting without them grew it 0% (Conley 1997).',
    },
  ],
  'ex-neck-flexion': [
    {
      cue: 'Tuck the chin, curl up slowly through the full range, and lower under control.',
      why: 'The neck grows only when trained directly (Conley 1997); flexion balances the extension work.',
    },
  ],
}

/** An exercise's growth cues ([] when it has none). */
export function growthCuesFor(exerciseId: string): readonly GrowthCue[] {
  return GROWTH_CUES[exerciseId] ?? []
}
