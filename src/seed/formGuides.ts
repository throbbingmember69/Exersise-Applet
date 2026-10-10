// Curated form guides: one YouTube video per library exercise, from established coaching channels,
// plus short written cues that work offline at the gym. Researched for the October 2026 update;
// every link was checked live through YouTube's oEmbed endpoint on 2026-10-10. The user's own link
// (Exercise.formUrl) wins over these, and exercises without a guide get a YouTube search link.
// Static content, not stored in the database: fixing a link ships with the app, no migration.
import type { Exercise } from '@/domain/types'

export interface FormGuide {
  videoUrl: string
  title: string
  channel: string
  cues: readonly string[]
}

export const FORM_GUIDES: Readonly<Record<string, FormGuide>> = {
  'ex-smith-squat': {
    videoUrl: 'https://www.youtube.com/watch?v=fEuYM-miK5U',
    title: '9 Smith Machine Squat Mistakes and How to Fix Them',
    channel: 'Renaissance Periodization',
    cues: [
      'Set feet slightly ahead of the bar so you can sit straight down with an upright torso',
      'Rest the bar on your upper traps, brace your core, then unhook it',
      'Lower until thighs are at least parallel, knees tracking over your toes',
      'Don’t bounce out of the bottom; keep a controlled tempo and tension on the quads',
    ],
  },
  'ex-leg-extension': {
    videoUrl: 'https://www.youtube.com/watch?v=ljO4jkwv8wQ',
    title: 'How To Do Leg Extensions With Perfect Technique (Grow Every Quad Head)',
    channel: 'Jeff Nippard',
    cues: [
      'Line your knee joint up with the machine’s pivot and set the pad just above the ankle',
      'Grip the handles and keep your hips pinned down to the seat throughout',
      'Extend to full lockout, squeeze the quads, then lower slowly into a deep bend',
      'Avoid swinging the weight up or cutting the bottom half of the range short',
    ],
  },
  'ex-seated-leg-curl': {
    videoUrl: 'https://www.youtube.com/watch?v=ELOCsoDSmrg',
    title: 'How To: Seated Leg Curl (Cybex)',
    channel: 'ScottHermanFitness',
    cues: [
      'Align knees with the pivot, pad just above the heels, thigh pad snug on your legs',
      'Lean your torso slightly forward to put the hamstrings on more stretch',
      'Curl your heels down and back as far as possible, pause, then return slowly',
      'Don’t let the stack slam or your hips lift off the seat to finish reps',
    ],
  },
  'ex-hip-thrust': {
    videoUrl: 'https://www.youtube.com/watch?v=xDmFkJxPzeM',
    title: 'How To Build Great Glutes with Perfect Hip Thrust Technique (Fix Mistakes!)',
    channel: 'Jeff Nippard',
    cues: [
      'Set the bench or pad just under your shoulder blades, feet flat, about hip width',
      'Tuck your chin and keep your ribs down as you drive through your heels',
      'Finish with hips level with your shoulders and squeeze the glutes hard at the top',
      'Don’t arch your lower back to fake lockout; the movement comes from the hips',
    ],
  },
  'ex-standing-calf-raise': {
    videoUrl: 'https://www.youtube.com/watch?v=Xa18jxyeSnM',
    title: '8 Calf Raise Mistakes and How to Fix Them',
    channel: 'Renaissance Periodization',
    cues: [
      'Place the balls of your feet on the edge and keep knees straight but not locked',
      'Lower slowly until your heels are as deep as possible and pause in the stretch',
      'Rise as high as you can, pushing through the big toe and forefoot',
      'Avoid bouncing out of the bottom or bending the knees to cheat the weight up',
    ],
  },
  'ex-deadlift': {
    videoUrl: 'https://www.youtube.com/watch?v=MBbyAqvTNkU',
    title: 'How To Deadlift: 5 Step Deadlift | 2022',
    channel: 'Alan Thrall (Untamed Strength)',
    cues: [
      'Stand with the bar over mid-foot, feet about hip width, grip just outside your legs',
      'Bend your knees until the shins touch the bar, then lift your chest to flatten your back',
      'Brace hard and push the floor away, dragging the bar up your legs',
      'Don’t jerk the bar or let your hips shoot up first; keep the bar close all the way',
    ],
  },
  'ex-rdl': {
    videoUrl: 'https://www.youtube.com/watch?v=_oyxCn2iSjU',
    title: 'HOW TO DO ROMANIAN DEADLIFTS (RDLs): Build Beefy Hamstrings With Perfect Technique',
    channel: 'Jeff Nippard',
    cues: [
      'Start standing tall with a soft knee bend and the bar against your thighs',
      'Push your hips straight back, keeping the bar close as it slides down your legs',
      'Stop when the hamstrings are fully stretched, usually around mid-shin',
      'Keep your back flat; don’t round over to reach lower or squat the weight down',
    ],
  },
  'ex-bss': {
    videoUrl: 'https://www.youtube.com/watch?v=hPlKPjohFS0',
    title: 'The PERFECT Bulgarian Split Squat (Avoid These Errors!)',
    channel: 'Squat University',
    cues: [
      'Rest the top of your rear foot on a bench and set the front foot a stride ahead',
      'Drop straight down until the rear knee nearly touches the floor',
      'A slight forward lean biases the glutes; staying more upright biases the quads',
      'Keep the front knee tracking over the toes and don’t push off with the back leg',
    ],
  },
  'ex-leg-press': {
    videoUrl: 'https://www.youtube.com/watch?v=8vk6rWMSxOk',
    title: '7 Leg Press Mistakes and How to Fix Them',
    channel: 'Renaissance Periodization',
    cues: [
      'Place feet mid-platform about shoulder width and keep your back flat on the pad',
      'Lower the sled as deep as you can without your hips curling off the seat',
      'Press through the whole foot and stop just short of locking the knees',
      'Don’t let the knees cave in or the heels lift as you change direction',
    ],
  },
  'ex-hip-abduction': {
    videoUrl: 'https://www.youtube.com/watch?v=2b97cvyH9sE',
    title: 'How To: Hip Abduction (Cybex)',
    channel: 'ScottHermanFitness',
    cues: [
      'Sit tall with the pads on the outside of your knees and the start set for a full range',
      'Push your knees outward under control as far as you can, then pause briefly',
      'Leaning your torso slightly forward shifts more of the work to the upper glutes',
      'Return slowly; don’t let the weight stack crash or use a jerky rhythm',
    ],
  },
  'ex-hack-squat': {
    videoUrl: 'https://www.youtube.com/watch?v=4cxt_Tldugw',
    title: '9 Hack Squat Mistakes and How to Fix Them',
    channel: 'Renaissance Periodization',
    cues: [
      'Set your back and shoulders firmly against the pads with feet mid-platform',
      'Lower under control until your thighs pass parallel, knees tracking over toes',
      'Drive up through the whole foot, keeping your hips pressed into the backrest',
      'Avoid cutting depth or slamming into lockout between reps; keep a steady tempo',
    ],
  },
  'ex-db-walking-lunge': {
    videoUrl: 'https://www.youtube.com/watch?v=-yxNPwWlr8I',
    title: 'The Almighty Lunge: DB / Barbell',
    channel: 'Alan Thrall (Untamed Strength)',
    cues: [
      'Hold the dumbbells at your sides, stand tall and brace before each step',
      'Step forward far enough to lower the rear knee close to the floor',
      'Push through the front heel to stand and bring the back leg straight through',
      'Keep your torso steady; don’t let the front knee cave in or the weights swing',
    ],
  },
  'ex-lying-leg-curl': {
    videoUrl: 'https://www.youtube.com/watch?v=1Tq3QdYUuHs',
    title: 'How To: Prone Leg Curl (Cybex)',
    channel: 'ScottHermanFitness',
    cues: [
      'Line your knees up with the pivot point and set the pad just above your heels',
      'Press your hips into the bench and hold the handles to stay locked in place',
      'Curl as far as you can, squeeze, then lower slowly to nearly straight legs',
      'Don’t let your hips rise off the pad or kick the weight up with momentum',
    ],
  },
  'ex-db-rdl': {
    videoUrl: 'https://www.youtube.com/watch?v=FQKfr1YDhEk',
    title: 'How To: Dumbbell Romanian Deadlift',
    channel: 'ScottHermanFitness',
    cues: [
      'Hold the dumbbells in front of your thighs with a soft bend in the knees',
      'Hinge by pushing your hips back while the dumbbells stay close to your legs',
      'Lower until you feel a deep hamstring stretch, then drive your hips forward',
      'Keep a neutral spine; don’t round your back or let the weights drift forward',
    ],
  },
  'ex-back-extension': {
    videoUrl: 'https://www.youtube.com/watch?v=H8Swl1N-uis',
    title: 'STOP Doing Back Extensions Like This!',
    channel: 'Squat University',
    cues: [
      'Set the pad just below your hip crease so you can hinge freely at the hips',
      'Brace your trunk to hold your spine neutral and move only at the hips',
      'Hug a plate to your chest and rise until your body forms a straight line',
      'Don’t hyperextend at the top or round heavily at the bottom to chase range',
    ],
  },
  'ex-cable-glute-kickback': {
    videoUrl: 'https://www.youtube.com/watch?v=dJa_Nf4zdik',
    title:
      'Build Bigger Glutes With Perfect Training Technique ft. Stephanie Buttermore (Glute Kickback)',
    channel: 'Jeff Nippard',
    cues: [
      'Attach an ankle cuff to a low pulley and brace your hands on the frame',
      'Lean your torso forward slightly and keep a small bend in the working knee',
      'Drive the leg back by squeezing the glute, not by arching your lower back',
      'Control the return until you feel a stretch; don’t swing the leg for momentum',
    ],
  },
  'ex-seated-calf-raise': {
    videoUrl: 'https://www.youtube.com/watch?v=6O5hh1rBtx8',
    title: 'How to PROPERLY Calf Raise (SEATED CALF RAISE TIPS)',
    channel: 'Colossus Fitness',
    cues: [
      'Set the knee pad snug on your lower thighs with the balls of your feet on the platform',
      'Lower your heels slowly into a deep stretch and pause briefly at the bottom',
      'Push up as high as you can onto the forefoot and squeeze the calves at the top',
      'Avoid short, bouncy reps; pick a load you can move through the full range',
    ],
  },
  'ex-leg-press-calf-raise': {
    videoUrl: 'https://www.youtube.com/watch?v=XdtWVYFVhGU',
    title: 'Calf Raises on the Leg Press (90 Second Instruction)',
    channel: 'Seriously Strong Training',
    cues: [
      'Place the balls of your feet on the bottom edge of the platform, heels hanging off',
      'Keep your knees nearly straight and still so only your ankles move',
      'Let the platform push your toes back into a deep stretch, then press up fully',
      'Keep your feet secure and avoid bouncing; slipping off the edge is the main risk',
    ],
  },
  'ex-incline-db-bench': {
    videoUrl: 'https://www.youtube.com/watch?v=hChjZQhX1Ls',
    title: 'How To: Dumbbell Incline Press | 3 GOLDEN RULES (MADE BETTER!)',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the bench to about 30 degrees and plant your feet flat on the floor.',
      'Pull your shoulder blades back and down before the first rep.',
      'Lower the dumbbells to upper-chest level with elbows about 45 degrees from torso.',
      'Don’t let your shoulders roll forward or the dumbbells drift over your face.',
    ],
  },
  'ex-flat-machine-press': {
    videoUrl: 'https://www.youtube.com/watch?v=xUm0BiZCWlQ',
    title: 'How To: Chest Press (Cybex)',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the seat so the handles line up with the middle of your chest.',
      'Keep shoulder blades pinned to the pad and feet flat on the floor.',
      'Press forward smoothly and stop just short of locking out.',
      'Return slowly to a full chest stretch; don’t let the stack slam between reps.',
    ],
  },
  'ex-flat-db-press': {
    videoUrl: 'https://www.youtube.com/watch?v=QsYre__-aro',
    title: 'STOP Doing Dumbbell Press Like This (5 Mistakes Slowing Your Chest Gains)',
    channel: 'Jeremy Ethier',
    cues: [
      'Kick the dumbbells up off your knees as you lie back, feet planted.',
      'Retract your shoulder blades and keep your upper back tight on the bench.',
      'Lower until you feel a deep chest stretch, elbows tucked about 45 degrees.',
      'Press up and slightly in; don’t clank the bells together or flare the elbows.',
    ],
  },
  'ex-machine-fly': {
    videoUrl: 'https://www.youtube.com/watch?v=10hg4LAa7UQ',
    title: 'How to Perform a Peck Deck Fly | Hunter Labrada',
    channel: 'Hunter Labrada',
    cues: [
      'Set the seat so the handles sit at chest height with elbows slightly bent.',
      'Keep your chest up and shoulder blades back against the pad.',
      'Sweep the arms together in an arc and squeeze hard at the middle.',
      'Control the return to a full stretch; don’t let shoulders shrug or roll forward.',
    ],
  },
  'ex-incline-cable-press': {
    videoUrl: 'https://www.youtube.com/watch?v=UJL1YgWL6Rg',
    title: 'How To: Seated Cable Incline Chest Press',
    channel: 'Live Lean TV Daily Exercises',
    cues: [
      'Place an incline bench at 30-45 degrees between two low pulleys.',
      'Start with handles at upper-chest level and shoulder blades pinned to the bench.',
      'Press up and slightly inward over the upper chest without fully locking out.',
      'Lower under control; don’t let the cables drag your elbows far behind your torso.',
    ],
  },
  'ex-cable-crossover': {
    videoUrl: 'https://www.youtube.com/watch?v=8Um35Es-ROE',
    title: 'How To: Cable Fly (High-To-Low) || 3 GOLDEN RULES',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the pulleys high, take a staggered stance and lean slightly forward.',
      'Keep a soft, fixed bend in the elbows for the whole rep.',
      'Sweep the handles down and together in front of your lower chest.',
      'Don’t turn it into a press by bending the elbows, and don’t rush the stretch.',
    ],
  },
  'ex-incline-smith-press': {
    videoUrl: 'https://www.youtube.com/watch?v=b8DqTO6ak0k',
    title: 'How To: Smith Machine- Incline Bench Press',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the bench at about 30 degrees so the bar lands on your upper chest.',
      'Retract your shoulder blades and plant your feet before unracking.',
      'Lower to the upper chest with forearms vertical and elbows slightly tucked.',
      'Don’t bounce off the chest or let your shoulders roll forward at lockout.',
    ],
  },
  'ex-incline-machine-press': {
    videoUrl: 'https://www.youtube.com/watch?v=ig0NyNlSce4',
    title: 'How To: Incline Chest Press (Hammer Strength)',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the seat so the handles start level with your upper chest.',
      'Pin your back and shoulder blades to the pad and keep your chest up.',
      'Press along the machine’s path and stop just short of a hard lockout.',
      'Don’t let your shoulders roll forward or your hips lift off the seat.',
    ],
  },
  'ex-barbell-bench': {
    videoUrl: 'https://www.youtube.com/watch?v=vcBig73ojpE',
    title: 'How To Get A Huge Bench Press with Perfect Technique',
    channel: 'Jeff Nippard',
    cues: [
      'Set your eyes under the bar, pinch shoulder blades down and back, feet planted.',
      'Grip a bit wider than shoulder width with wrists stacked over elbows.',
      'Touch the lower chest with elbows slightly tucked, then press back toward the rack.',
      'Keep your glutes on the bench and never bounce the bar off your chest.',
    ],
  },
  'ex-low-high-cable-fly': {
    videoUrl: 'https://www.youtube.com/watch?v=eQ_NBB6OBH4',
    title: 'HOW TO: Chest "Low-To-High" Cable Fly (BIGGER UPPER CHEST) || PERFECT FORM',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the pulleys at the lowest position and stand centered in a split stance.',
      'Keep a soft bend in the elbows with palms facing up and forward.',
      'Sweep the handles up and together to about upper-chest or chin height.',
      'Don’t shrug or let the front delts take over; keep shoulders down.',
    ],
  },
  'ex-weighted-dip': {
    videoUrl: 'https://www.youtube.com/watch?v=yN6Q1UI_xkE',
    title: 'How To Do Dips For A Bigger Chest and Shoulders (Fix Mistakes!)',
    channel: 'Jeff Nippard',
    cues: [
      'Hang the weight from a dip belt and start locked out on the bars.',
      'Lean your torso forward and let the elbows flare slightly to bias the chest.',
      'Descend until you feel a solid chest stretch, keeping shoulders down.',
      'Don’t sink so deep that your shoulders roll forward at the bottom.',
    ],
  },
  'ex-push-up': {
    videoUrl: 'https://www.youtube.com/watch?v=MO10KOoQx5E',
    title: 'The Perfect Push-Up To Build Muscle (AVOID THESE MISTAKES!)',
    channel: 'Jeremy Ethier',
    cues: [
      'Place hands just outside shoulder width and squeeze glutes into a straight plank.',
      'Keep elbows about 45 degrees from your body, not flared out to the sides.',
      'Lower until your chest nearly touches the floor, then push the floor away.',
      'Don’t let your hips sag or your head poke forward.',
    ],
  },
  'ex-dip-machine': {
    videoUrl: 'https://www.youtube.com/watch?v=EBnq0A5L_wo',
    title: 'How to PROPERLY Use The Tricep Dip Machine (TRY THIS)',
    channel: 'Colossus Fitness',
    cues: [
      'Adjust the seat so the handles start around chest level.',
      'Sit tall with your back against the pad and grip the handles firmly.',
      'Press down until your arms are nearly straight, keeping elbows tucked in.',
      'Don’t shrug or hunch forward; control the handles back up.',
    ],
  },
  'ex-overhead-press': {
    videoUrl: 'https://www.youtube.com/watch?v=Wqq43dKW1TU',
    title: 'How To: Overhead Press (Cybex)',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the seat so the handles start at or just above shoulder height.',
      'Keep your back flat against the pad and your core braced.',
      'Press up to near lockout, then lower back to shoulder level each rep.',
      'Don’t arch your lower back off the pad or shrug at the top.',
    ],
  },
  'ex-seated-db-shoulder-press': {
    videoUrl: 'https://www.youtube.com/watch?v=GFblCmuEE18',
    title:
      'HOW TO: Dumbbell Shoulder Press (BIGGER SHOULDERS & BIGGER BENCH PRESS!) || PERFECT FORM',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the bench upright, feet flat and lower back pressed into the pad.',
      'Start with dumbbells at ear level and elbows slightly in front of your torso.',
      'Press up and slightly in without clanking the dumbbells at the top.',
      'Lower to at least ear level each rep; don’t arch away from the pad.',
    ],
  },
  'ex-lateral-raise': {
    videoUrl: 'https://www.youtube.com/watch?v=NNAs8jx_zJI',
    title: 'How to PROPERLY Lateral Raise Machine (STOP THIS)',
    channel: 'Colossus Fitness',
    cues: [
      'Set the seat so your shoulders line up with the machine’s pivot point.',
      'Lead with your elbows into the pads, keeping a slight bend in the arms.',
      'Raise to about shoulder height, pause briefly, then lower slowly.',
      'Don’t shrug your traps or swing your torso to move the weight.',
    ],
  },
  'ex-cable-lateral-raise': {
    videoUrl: 'https://www.youtube.com/watch?v=Sp8be0IFNvk',
    title: 'How to Fix your Cable Lateral Raise | DB vs. CABLE',
    channel: 'John Jewett',
    cues: [
      'Set the pulley low and stand side-on to the stack, holding the far handle.',
      'Start with the cable across the front of your body for a loaded stretch.',
      'Raise the arm out to the side, leading with the elbow, to about shoulder height.',
      'Don’t lean or swing to cheat; keep the shoulder down away from your ear.',
    ],
  },
  'ex-db-lateral-raise': {
    videoUrl: 'https://www.youtube.com/watch?v=4hTUCDUQaNA',
    title: 'The Only Dumbbell Lateral Raise Guide You Need (For Side Delt Growth)',
    channel: 'Renaissance Periodization',
    cues: [
      'Stand tall with a slight forward lean and the dumbbells at your sides.',
      'Raise the dumbbells out to the sides with a slight elbow bend, elbows leading.',
      'Stop around shoulder height and lower under control.',
      'Don’t swing your torso or shrug your traps to get the weight up.',
    ],
  },
  'ex-weighted-chin-up': {
    videoUrl: 'https://www.youtube.com/watch?v=bZ6Ysk9jf6E',
    title: 'How To: Weighted Chin-Up',
    channel: 'ScottHermanFitness',
    cues: [
      'Hang the load from a dip belt so it sits still between your legs, not swinging.',
      'Start from a dead hang with an underhand grip about shoulder width.',
      'Drive your elbows down toward your ribs until your chin clears the bar.',
      'Lower under control to straight arms each rep; no kipping or half reps.',
    ],
  },
  'ex-machine-barbell-row': {
    videoUrl: 'https://www.youtube.com/watch?v=5XfV6hvcxCE',
    title: 'Improve Your Machine Rows For A Bigger Back',
    channel: 'Renaissance Periodization',
    cues: [
      'Set the seat so the handles line up with your lower chest; brace on the pad.',
      'Start each rep from a full stretch, letting the shoulder blades reach forward.',
      'Drive the elbows back and hold the squeeze for a beat at the top.',
      'Keep your chest on the pad; don’t lean back or jerk the weight up.',
    ],
  },
  'ex-rocking-pulldown': {
    videoUrl: 'https://www.youtube.com/watch?v=OcFCHdQHjVU',
    title: 'Lat Pulldowns ("BAD" FORM | BIG GAINS!)',
    channel: 'ATHLEAN-X™',
    cues: [
      'Lock your thighs under the pad and start leaning slightly forward, arms long.',
      'Rock back about 20-30 degrees as you pull, driving the elbows to your sides.',
      'Come back upright as the bar rises so the lats get a full overhead stretch.',
      'Keep the rock smooth and controlled; it should never become a momentum swing.',
    ],
  },
  'ex-rear-delt-fly': {
    videoUrl: 'https://www.youtube.com/watch?v=6yMdhi2DVao',
    title: 'How To Properly Use The Rear Delt Fly Machine (+ BONUS TIP)',
    channel: 'Mind Pump TV',
    cues: [
      'Set the seat so the handles are at shoulder height; keep your chest on the pad.',
      'Hold the handles with a slight elbow bend and keep that angle fixed.',
      'Sweep the arms out wide and stop when they line up with your torso.',
      'Don’t shrug or pinch the shoulder blades; let the rear delts do the work.',
    ],
  },
  'ex-face-pull': {
    videoUrl: 'https://www.youtube.com/watch?v=ljgqer1ZpXg',
    title: 'STOP F*cking Up Face Pulls (PROPER FORM!)',
    channel: 'ATHLEAN-X™',
    cues: [
      'Set the rope at about eye level; use a long rope so your hands can split wide.',
      'Grip with thumbs pointing back toward you and step back to load the cable.',
      'Pull toward your face, splitting the rope and rotating hands back by your ears.',
      'Keep it light; leaning back or shrugging means the weight is too heavy.',
    ],
  },
  'ex-machine-row-upper': {
    videoUrl: 'https://www.youtube.com/watch?v=Mh-YpmPzdpE',
    title: 'Supported Row for a "THICK BACK" Exercise Index',
    channel: 'mountaindog1',
    cues: [
      'Set the seat so the chest pad sits mid-chest and you reach at full stretch.',
      'Use the wide handles and let the elbows flare out to about 45-60 degrees.',
      'Pull the elbows back past your torso and squeeze the upper back at the end.',
      'Keep your chest glued to the pad; don’t heave with the hips or shrug up.',
    ],
  },
  'ex-lat-pulldown': {
    videoUrl: 'https://www.youtube.com/watch?v=SALxEARiMkw',
    title: 'How to do Lat Pulldowns (AVOID MISTAKES!)',
    channel: 'ATHLEAN-X™',
    cues: [
      'Lock your thighs under the pad and grip just outside shoulder width.',
      'Lean back only slightly and pull the bar down to your upper chest.',
      'Think of driving the elbows toward your back pockets, not pulling with hands.',
      'Let the bar rise to a full stretch each rep; don’t yank it with body swing.',
    ],
  },
  'ex-neutral-pulldown': {
    videoUrl: 'https://www.youtube.com/watch?v=kVB6SlEyjQM',
    title: 'How to: Neutral Grip Pulldown [Lats-focused] for Physique Development',
    channel: 'Physique Development',
    cues: [
      'Use a shoulder-width neutral handle and anchor your thighs under the pad.',
      'Start with arms long and let the shoulders rise to stretch the lats.',
      'Pull the elbows down and in toward your hips, finishing at the upper chest.',
      'Keep the torso fairly still; leaning far back turns it into a row.',
    ],
  },
  'ex-seated-cable-row': {
    videoUrl: 'https://www.youtube.com/watch?v=sP_4vybjVJs',
    title: 'How To Properly Do The Seated Cable Row (IT MATTERS!)',
    channel: 'Mind Pump TV',
    cues: [
      'Sit tall with knees slightly bent and feet braced on the platform.',
      'Reach forward to let the shoulder blades spread while the spine stays neutral.',
      'Row the handle to your lower ribs with elbows close, and pause briefly.',
      'Don’t rock your torso back and forth to move the weight.',
    ],
  },
  'ex-chest-supported-tbar-row': {
    videoUrl: 'https://www.youtube.com/watch?v=TyLoy3n_a10',
    title: 'How to PROPERLY Machine T-Bar Row (FIX YOUR FORM)',
    channel: 'Colossus Fitness',
    cues: [
      'Set the chest pad so you can reach the handles with arms fully straight.',
      'Keep your chest pressed into the pad and feet planted the whole set.',
      'Pull the elbows back toward your hips, squeeze, then lower to a full stretch.',
      'Don’t lift your chest off the pad or shrug to finish the rep.',
    ],
  },
  'ex-one-arm-db-row': {
    videoUrl: 'https://www.youtube.com/watch?v=gfUg6qWohTk',
    title: 'STOP F*cking Up Dumbbell Rows (PROPER FORM!)',
    channel: 'ATHLEAN-X™',
    cues: [
      'Brace one hand on a bench, stagger your feet and keep your back flat.',
      'Let the dumbbell hang to a full stretch below your shoulder.',
      'Pull the dumbbell back toward your hip in an arc, elbow close to your side.',
      'Avoid twisting your torso open to heave the weight up.',
    ],
  },
  'ex-pull-up': {
    videoUrl: 'https://www.youtube.com/watch?v=Hdc7Mw6BIEE',
    title: 'The Best Way To Do Pull Ups For A Wide Back (Optimal Training Technique)',
    channel: 'Jeff Nippard',
    cues: [
      'Take an overhand grip a bit wider than shoulders and start from a dead hang.',
      'Pull the elbows down and back, bringing your upper chest toward the bar.',
      'Get your chin over the bar, then lower slowly to full arm extension.',
      'Avoid kipping, swinging or cutting reps short at the bottom.',
    ],
  },
  'ex-straight-arm-pulldown': {
    videoUrl: 'https://www.youtube.com/watch?v=mkO1CR8TDHg',
    title: 'The Forgotten Back Exercise (UNLOCK HIDDEN STRENGTH!)',
    channel: 'ATHLEAN-X™',
    cues: [
      'Set the cable high, hinge forward slightly and hold the bar with soft elbows.',
      'Keep the elbow angle fixed and sweep your arms down to your thighs.',
      'Squeeze the lats at the bottom, then let your arms rise to about head height.',
      'Don’t bend the elbows to push it down; that turns it into a triceps move.',
    ],
  },
  'ex-cable-rear-delt-fly': {
    videoUrl: 'https://www.youtube.com/watch?v=JENKmsEZQO8',
    title: 'How To - Standing Cable Rear Delt Fly - Hunter Labrada',
    channel: 'Labrada Nutrition',
    cues: [
      'Set both pulleys at shoulder height and take the opposite handles, arms crossed.',
      'Stand tall with a slight bend in the elbows and keep it fixed.',
      'Sweep the arms out and back until they line up with your body.',
      'Go light and don’t shrug or squeeze the shoulder blades together hard.',
    ],
  },
  'ex-hyper-y-w': {
    videoUrl: 'https://www.youtube.com/watch?v=1RsEmC4Us9c',
    title: "YTWL's (Weighted Variation) - Tutorial",
    channel: 'The Strength Institute',
    cues: [
      'Lock into the hyper bench and hinge forward with a flat back, light DBs hanging.',
      'For the Y, raise straight arms overhead at a 45-degree angle, thumbs up.',
      'For the W, bend the elbows and pull them down and back, rotating hands out.',
      'Keep your torso still and the weight light; don’t arch your low back to lift.',
    ],
  },
  'ex-barbell-shrug': {
    videoUrl: 'https://www.youtube.com/watch?v=zfAHfyTB_Ao',
    title: 'Barbell Shrug Technique For Growth | Targeting The Muscle',
    channel: 'Renaissance Periodization',
    cues: [
      'Hold the bar just outside your thighs with straight arms; straps are fine.',
      'Shrug straight up toward your ears instead of rolling the shoulders.',
      'Pause briefly at the top, then lower all the way for a full stretch.',
      'Keep the arms straight; don’t bend the elbows or bounce with the knees.',
    ],
  },
  'ex-db-shrug': {
    videoUrl: 'https://www.youtube.com/watch?v=cJRVVxmytaM',
    title: 'How To: Dumbbell Shrugs',
    channel: 'ScottHermanFitness',
    cues: [
      'Stand tall holding the dumbbells at your sides, palms facing in.',
      'Lift your shoulders straight up as high as you can, arms staying long.',
      'Hold the top for a second, then lower slowly to a full stretch.',
      'Skip the shoulder rolls and don’t let the elbows bend to help.',
    ],
  },
  'ex-preacher-curl': {
    videoUrl: 'https://www.youtube.com/watch?v=jGhd1pIcQ74',
    title: 'Machine Preacher Curl (Technique)',
    channel: 'Ryan Jewers',
    cues: [
      'Set the seat so your armpits sit snug against the top of the pad.',
      'Keep the backs of your upper arms flat on the pad for every rep.',
      'Lower until the elbows are nearly straight; don’t cut the stretch short.',
      'Don’t lift your elbows or shrug your shoulders to finish a hard rep.',
    ],
  },
  'ex-db-hammer-curl': {
    videoUrl: 'https://www.youtube.com/watch?v=8XLxfXROrTo',
    title: 'HOW TO: Dumbbell Hammer Curl (BICEPS PEAK BUILDER!) || PERFECT FORM',
    channel: 'ScottHermanFitness',
    cues: [
      'Stand tall with dumbbells at your sides, palms facing each other.',
      'Curl thumbs-up with your elbows pinned close to your ribs.',
      'Lower under control all the way to straight arms each rep.',
      'Don’t swing your torso or let your elbows drift forward to move the weight.',
    ],
  },
  'ex-incline-db-biceps-curl': {
    videoUrl: 'https://www.youtube.com/watch?v=DCe8f6vMe9A',
    title: 'Stop Screwing Up Incline Dumbbell Curls (PROPER FORM!)',
    channel: 'ATHLEAN-X™',
    cues: [
      'Set the bench to about 45-60 degrees and keep your shoulders on the pad.',
      'Let your arms hang straight down so the biceps start fully stretched.',
      'Curl without letting your elbows swing forward; upper arms stay still.',
      'Go lighter than standing curls and lower slowly into the bottom stretch.',
    ],
  },
  'ex-bayesian-curl': {
    videoUrl: 'https://www.youtube.com/watch?v=VPmJ-OpCoyY',
    title: 'Bayesian Curl Tutorial | GymSpot',
    channel: 'GymSpot',
    cues: [
      'Use a single handle on the lowest pulley and stand facing away from it.',
      'Step forward until the cable pulls your arm slightly behind your body.',
      'Curl with the elbow held back and still; only the forearm moves.',
      'Don’t let the elbow drift forward or your torso twist toward the cable.',
    ],
  },
  'ex-ez-bar-curl': {
    videoUrl: 'https://www.youtube.com/watch?v=6LrOTcr595A',
    title: 'EZ Bar Curls How To Perform Them Correctly',
    channel: 'KAGED',
    cues: [
      'Grip the angled parts of the bar about shoulder width, palms up.',
      'Keep elbows at your sides and curl until forearms are near vertical.',
      'Lower slowly to almost straight arms instead of dropping the bar.',
      'No hip drive or leaning back; if you need to swing, the load is too heavy.',
    ],
  },
  'ex-cable-curl': {
    videoUrl: 'https://www.youtube.com/watch?v=NFzTWp2qpiE',
    title: 'How To Do Cable Bicep Curls - Full Video Tutorial and Step-by-Step Guide',
    channel: 'Fit Father Project - Fitness For Busy Fathers',
    cues: [
      'Attach a bar or handle to a low pulley and stand a step back from it.',
      'Keep your elbows tucked at your sides and curl up to a full squeeze.',
      'Lower under control and keep tension on; don’t rest the stack between reps.',
      'Avoid leaning back or rolling your shoulders forward at the top.',
    ],
  },
  'ex-overhead-cable-triceps-extension': {
    videoUrl: 'https://www.youtube.com/watch?v=sUFUQVMWdnU',
    title: 'Cable Unilateral Tricep Overhead Extension (Technique)',
    channel: 'Ryan Jewers',
    cues: [
      'Face away from the cable with the handle behind your head, elbow up.',
      'Stagger your stance and brace so your torso stays still.',
      'Keep the upper arm by your head; extend fully, then lower into a deep stretch.',
      'Don’t let the elbow flare out or drop forward as you press.',
    ],
  },
  'ex-straight-bar-pushdown': {
    videoUrl: 'https://www.youtube.com/watch?v=8JBHlaS7Dkk',
    title: 'Tricep Pushdown with Straight Bar | TWEAK THIS!',
    channel: 'Nevels Fitness',
    cues: [
      'Take an overhand, about shoulder-width grip on a straight bar at a high pulley.',
      'Lean slightly forward with your elbows tucked against your sides.',
      'Press down to full lockout, then let the bar rise slowly to about chest height.',
      'Keep wrists straight and don’t let your elbows drift forward or flare.',
    ],
  },
  'ex-machine-triceps-extension': {
    videoUrl: 'https://www.youtube.com/watch?v=cBt1X8fwKKc',
    title: 'How To: Arm Extension (Cybex)',
    channel: 'ScottHermanFitness',
    cues: [
      'Adjust the seat so your elbows line up with the machine’s pivot point.',
      'Keep your elbows planted on the pad and your shoulders down.',
      'Extend fully, then return slowly until you feel a stretch in the triceps.',
      'Don’t lift your elbows off the pad or lean in to push the weight.',
    ],
  },
  'ex-overhead-rope-extension': {
    videoUrl: 'https://www.youtube.com/watch?v=l4i7iDLiMXs',
    title: 'Rope Overhead Tricep Extension — (FORM & TUTORIAL)',
    channel: 'Fit Father Project - Fitness For Busy Fathers',
    cues: [
      'Face away from the cable with the rope behind your head, one foot forward.',
      'Keep your upper arms close to your ears and pointed up and forward.',
      'Extend until the arms are straight, then lower slowly into a deep stretch.',
      'Don’t flare your elbows or arch your lower back to finish reps.',
    ],
  },
  'ex-rope-pushdown': {
    videoUrl: 'https://www.youtube.com/watch?v=vB5OHsJ3EME',
    title: 'How To: Rope Push-Down',
    channel: 'ScottHermanFitness',
    cues: [
      'Grip a rope on a high pulley, palms facing in, elbows tucked at your sides.',
      'Push down and spread the rope ends apart as your arms straighten.',
      'Let the rope rise under control until your elbows bend to about 90 degrees.',
      'Keep upper arms still; don’t lean over the rope or drive it with body weight.',
    ],
  },
  'ex-ez-skull-crusher': {
    videoUrl: 'https://www.youtube.com/watch?v=RavQHfFxbdA',
    title: 'How To: Skull Crusher (BUILD BIGGER TRICEPS!) || PERFECT FORM',
    channel: 'ScottHermanFitness',
    cues: [
      'Lie on a flat bench holding the EZ-bar on the angled grip above your chest.',
      'Angle your arms slightly back toward your head and keep upper arms fixed.',
      'Bend only at the elbows, lowering the bar to your forehead or just behind it.',
      'Don’t flare the elbows or turn it into a press; go lighter if form slips.',
    ],
  },
  'ex-cable-crunch': {
    videoUrl: 'https://www.youtube.com/watch?v=vsAPBAg0fb0',
    title: 'Cable Crunch',
    channel: 'Jim Stoppani, PhD',
    cues: [
      'Kneel a couple of feet from a high pulley, holding the rope beside your head.',
      'Keep your hips high and still; don’t sit back onto your heels.',
      'Curl your ribcage toward your pelvis by rounding your spine with your abs.',
      'Don’t pull with your arms or hinge at the hips to move the weight.',
    ],
  },
  'ex-hanging-leg-raise': {
    videoUrl: 'https://www.youtube.com/watch?v=Pr1ieGZ5atk',
    title: 'Hanging Leg Raise | HOW-TO',
    channel: 'ATHLEAN-X™',
    cues: [
      'Hang with a full grip and active shoulders, not slumped or shrugged.',
      'Tilt your pelvis up and curl your hips toward your chest, not just your legs.',
      'Lower slowly to a dead stop so you don’t swing into the next rep.',
      'Bend your knees to make it easier if you can’t lift without swinging.',
    ],
  },
  'ex-machine-crunch': {
    videoUrl: 'https://www.youtube.com/watch?v=_O1xunCfYEM',
    title: 'How To: Abdominal Crunch (Hammer Strength)',
    channel: 'ScottHermanFitness',
    cues: [
      'Set the seat so the pads sit at chest or shoulder height; lock your feet in.',
      'Exhale and curl your ribcage down toward your hips to crunch.',
      'Return slowly to a stretch without letting the plates touch down.',
      'Don’t pull with your arms or yank your neck; keep your hips on the seat.',
    ],
  },
}

/** A YouTube search for the exercise's form (for exercises without a curated guide). */
export function youtubeSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} proper form`)}`
}

export interface ResolvedFormGuide {
  videoUrl: string
  /** yours: the user's own link; curated: FORM_GUIDES; search: a YouTube search. */
  source: 'yours' | 'curated' | 'search'
  title: string | null
  channel: string | null
  cues: readonly string[]
}

/** The guide to show for an exercise: the user's link, else the curated video, else a search. */
export function formGuideFor(
  exercise: Pick<Exercise, 'id' | 'name' | 'formUrl'>,
): ResolvedFormGuide {
  const curated = FORM_GUIDES[exercise.id]
  if (exercise.formUrl) {
    return {
      videoUrl: exercise.formUrl,
      source: 'yours',
      title: null,
      channel: null,
      cues: curated?.cues ?? [],
    }
  }
  if (curated) return { ...curated, source: 'curated' }
  return {
    videoUrl: youtubeSearchUrl(exercise.name),
    source: 'search',
    title: null,
    channel: null,
    cues: [],
  }
}
