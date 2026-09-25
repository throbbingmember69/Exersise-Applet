import { describe, expect, it } from 'vitest'
import { SEED_BODY_ENTRY } from '@/seed/profile'
import {
  BODY_CSV_HEADER,
  NUTRITION_CSV_HEADER,
  SETS_CSV_HEADER,
  bodyCsv,
  csvFileName,
  nutritionCsv,
  setsCsv,
  toCsv,
  type SetsCsvInput,
} from './csv'
import type {
  BodyEntry,
  Gym,
  LocalDate,
  NutritionEntry,
  ProgramDay,
  Session,
  SessionExercise,
  SetLog,
} from './types'
import { kgToLb } from './units'

// ── A strict RFC 4180 reader, so tests check what a spreadsheet would actually see ──

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"') {
      if (field !== '') throw new Error(`quote inside unquoted field at ${i}`)
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else if (c === '\r' || c === '\n') {
      throw new Error(`bare line break outside quotes at ${i}`)
    } else field += c
  }
  if (quoted) throw new Error('unterminated quoted field')
  if (field !== '' || row.length > 0) throw new Error('last record is not terminated by CRLF')
  return rows
}

function records(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text)
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]!])))
}

// ── Fixture: one realistic training week ────────────────────────────────────

const d = (s: string) => s as LocalDate
const at = (date: string, hh: number, mm = 0) => {
  const [y, m, day] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, day, hh, mm)
}

const gyms: Gym[] = [
  { id: 'gym-1', name: 'Gym 1', sortOrder: 0, archivedAt: null, createdAt: at('2026-09-24', 0) },
  {
    id: 'gym-2',
    name: 'Downtown, 2nd floor',
    sortOrder: 1,
    archivedAt: null,
    createdAt: at('2026-09-24', 0),
  },
]

const programDays: ProgramDay[] = [
  { id: 'day-lower-a', name: 'Lower A', weekday: 1, order: 0, note: '', archivedAt: null },
  { id: 'day-push', name: 'Push', weekday: 2, order: 1, note: '', archivedAt: null },
  { id: 'day-pull', name: 'Pull', weekday: 3, order: 2, note: '', archivedAt: null },
  { id: 'day-lower-b', name: 'Lower B', weekday: 5, order: 3, note: '', archivedAt: null },
  { id: 'day-upper', name: 'Upper', weekday: 6, order: 4, note: '', archivedAt: null },
]

function session(p: Pick<Session, 'id' | 'date' | 'startedAt'> & Partial<Session>): Session {
  return {
    finishedAt: p.startedAt + 3_600_000,
    tzOffsetMin: 240,
    status: 'finished',
    programDayId: null,
    gymId: 'gym-1',
    isDeload: false,
    jointPain: false,
    bodyweightLb: null,
    bodyweightSource: 'weighin',
    note: '',
    voidedAt: null,
    editedAt: null,
    createdAt: p.startedAt,
    ...p,
  }
}

function sessionExercise(
  p: Pick<
    SessionExercise,
    'id' | 'sessionId' | 'order' | 'exerciseId' | 'exerciseName' | 'loadType'
  > &
    Partial<SessionExercise>,
): SessionExercise {
  return {
    slotId: null,
    adHoc: false,
    perHand: false,
    unilateral: false,
    equipmentSpecific: false,
    gymScope: '*',
    isMainLift: false,
    isFinisher: false,
    swappedFromExerciseId: null,
    swapKind: 'none',
    prescription: {
      sets: 3,
      setsBeforeDeload: 3,
      repMin: 8,
      repMax: 12,
      rirMin: 1,
      rirMax: 2,
      restMinSec: 120,
      restMaxSec: 120,
      stepLb: 5,
    },
    muscleWeights: {},
    suggestion: {
      loadLb: null,
      repTargets: [],
      branch: 'start',
      missStreakBefore: 0,
      isCalibration: false,
      notices: [],
    },
    createdAt: 0,
    ...p,
  }
}

let loggedAt = at('2026-09-28', 17)
function set(
  sx: SessionExercise,
  setIndex: number,
  loadLb: number,
  reps: number,
  rir: number | null,
  extra: Partial<SetLog> = {},
): SetLog {
  loggedAt += 60_000
  return {
    id: `${sx.id}-set-${setIndex}`,
    sessionId: sx.sessionId,
    sessionExerciseId: sx.id,
    exerciseId: sx.exerciseId,
    setIndex,
    loadLb,
    reps,
    rir,
    isWarmup: false,
    note: '',
    loggedAt,
    editedAt: null,
    voidedAt: null,
    ...extra,
  }
}

const sessions: Session[] = [
  session({
    id: 's-sat',
    date: d('2026-10-03'),
    startedAt: at('2026-10-03', 15),
    status: 'in_progress',
    finishedAt: null,
    programDayId: 'day-upper',
    bodyweightLb: 162.5,
  }),
  session({
    id: 's-mon',
    date: d('2026-09-28'),
    startedAt: at('2026-09-28', 17),
    programDayId: 'day-lower-a',
    bodyweightLb: 163.4,
  }),
  session({
    id: 's-wed-pm',
    date: d('2026-09-30'),
    startedAt: at('2026-09-30', 18),
    programDayId: 'day-pull',
    bodyweightLb: 162.8,
  }),
  session({
    id: 's-dup',
    date: d('2026-09-30'),
    startedAt: at('2026-09-30', 19),
    programDayId: 'day-pull',
    bodyweightLb: 162.8,
    voidedAt: at('2026-09-30', 20),
  }),
  session({
    id: 's-tue',
    date: d('2026-09-29'),
    startedAt: at('2026-09-29', 17),
    programDayId: 'day-push',
    bodyweightLb: 163.1,
  }),
  session({
    id: 's-fri',
    date: d('2026-10-02'),
    startedAt: at('2026-10-02', 17),
    status: 'abandoned',
    programDayId: 'day-lower-b',
    gymId: 'gym-2',
    isDeload: true,
    bodyweightLb: 162.6,
  }),
  // Ad hoc session earlier the same day as Pull: it must sort first.
  session({
    id: 's-wed-am',
    date: d('2026-09-30'),
    startedAt: at('2026-09-30', 7),
    gymId: 'gym-2',
    bodyweightSource: 'trend',
  }),
]

const squat = sessionExercise({
  id: 'sx-mon-1',
  sessionId: 's-mon',
  order: 0,
  exerciseId: 'ex-smith-squat',
  exerciseName: 'Smith machine squat',
  loadType: 'machine',
})
const legExt = sessionExercise({
  id: 'sx-mon-2',
  sessionId: 's-mon',
  order: 1,
  exerciseId: 'ex-leg-extension',
  exerciseName: 'Leg extension',
  loadType: 'machine',
})
const incline = sessionExercise({
  id: 'sx-tue-1',
  sessionId: 's-tue',
  order: 0,
  exerciseId: 'ex-incline-db-bench',
  exerciseName: 'Incline DB bench press',
  loadType: 'dumbbell',
  perHand: true,
})
const chin = sessionExercise({
  id: 'sx-wed-1',
  sessionId: 's-wed-pm',
  order: 0,
  exerciseId: 'ex-weighted-chinup',
  exerciseName: 'Weighted chin-up',
  loadType: 'bodyweight_plus',
})
const shrug = sessionExercise({
  id: 'sx-wedam-1',
  sessionId: 's-wed-am',
  order: 0,
  exerciseId: 'ex-barbell-shrug',
  exerciseName: 'Barbell shrug',
  loadType: 'barbell',
  adHoc: true,
  isFinisher: true,
})
const dupChin = sessionExercise({
  id: 'sx-dup-1',
  sessionId: 's-dup',
  order: 0,
  exerciseId: 'ex-weighted-chinup',
  exerciseName: 'Weighted chin-up',
  loadType: 'bodyweight_plus',
})
const legPress = sessionExercise({
  id: 'sx-fri-1',
  sessionId: 's-fri',
  order: 0,
  exerciseId: 'ex-leg-press',
  exerciseName: 'Leg press',
  loadType: 'machine',
})
// Snapshot name differs from what the library might say today: the snapshot wins.
const lateral = sessionExercise({
  id: 'sx-sat-1',
  sessionId: 's-sat',
  order: 0,
  exerciseId: 'ex-machine-lateral-raise',
  exerciseName: 'Machine lateral raise (old stack)',
  loadType: 'machine',
})

const liveSets: SetLog[] = [
  set(squat, 0, 95, 8, null, { isWarmup: true }),
  set(squat, 1, 220, 10, 2),
  set(squat, 2, 220, 9, 1),
  set(squat, 3, 220, 8, 1),
  set(squat, 4, 220, 8, 0),
  set(legExt, 0, 170, 12, 1, { note: 'seat 4, pad 2' }),
  set(legExt, 1, 170, 12, 1),
  set(legExt, 2, 170, 11, 0),
  set(incline, 0, 70, 10, 2, { note: 'felt "heavy"' }),
  set(incline, 1, 70, 9, 1, { note: 'left shoulder\nclicked' }),
  set(incline, 2, 70, 8, 1, { note: 'grip\r\nslipped' }),
  set(shrug, 0, 135, 15, null, { note: '@gym2 rack' }),
  set(chin, 0, 25, 8, 1, { note: '=SUM(A1:A2)' }),
  set(chin, 1, 0, 10, 0),
  set(chin, 2, -20, 6, null, { note: '-20 assisted' }),
  set(legPress, 0, 360, 12, 3),
  set(lateral, 0, 37.5, 15, 1),
  set(lateral, 1, kgToLb(10), 12, 0),
]

const voidedSets: SetLog[] = [
  // Typo (2250 for 225), voided in Edit mode.
  set(squat, 5, 2250, 8, 1, { voidedAt: at('2026-09-28', 19) }),
  // Not voided itself, but its session is.
  set(dupChin, 0, 25, 8, 1),
  set(dupChin, 1, 25, 7, 0),
]

// Scramble the storage order so sorting is exercised.
const setLogs = [...liveSets, ...voidedSets].sort((a, b) => (a.id < b.id ? 1 : -1))

const input: SetsCsvInput = {
  sessions,
  sessionExercises: [lateral, squat, dupChin, chin, legExt, legPress, incline, shrug],
  setLogs,
  programDays,
  gyms,
}

const sessionById = new Map(sessions.map((s) => [s.id, s]))
const sxById = new Map(input.sessionExercises.map((x) => [x.id, x]))

// ── toCsv ────────────────────────────────────────────────────────────────────

describe('toCsv', () => {
  it('writes a header and rows with CRLF after every record', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          [1, 'x'],
          [2, 'y'],
        ],
      ),
    ).toBe('a,b\r\n1,x\r\n2,y\r\n')
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n')
  })

  it('quotes fields containing a comma, quote, CR or LF and doubles inner quotes', () => {
    expect(
      toCsv(['c'], [['a,b'], ['say "hi"'], ['line1\nline2'], ['cr\rhere'], ['crlf\r\nx']]),
    ).toBe('c\r\n"a,b"\r\n"say ""hi"""\r\n"line1\nline2"\r\n"cr\rhere"\r\n"crlf\r\nx"\r\n')
    expect(toCsv(['c'], [[' padded '], ["it's"]])).toBe("c\r\n padded \r\nit's\r\n")
  })

  it('writes null and empty strings as empty cells and booleans as true/false', () => {
    expect(toCsv(['a', 'b', 'c', 'd'], [[null, '', true, false]])).toBe(
      'a,b,c,d\r\n,,true,false\r\n',
    )
  })

  it('prints numbers as plain decimals without float noise or locale grouping', () => {
    const cells = [
      37.5,
      0.1 + 0.2,
      220,
      -20,
      1234567.5,
      1 / 3,
      2 / 3,
      kgToLb(100),
      -0,
      1e-7,
      -1e-9,
      0.000001,
    ]
    expect(
      toCsv(
        cells.map((_, i) => `n${i}`),
        [cells],
      ).split('\r\n')[1],
    ).toBe('37.5,0.3,220,-20,1234567.5,0.333333,0.666667,220.462262,0,0,0,0.000001')
  })

  it('writes non-finite numbers as empty cells', () => {
    expect(toCsv(['a', 'b', 'c'], [[Number.NaN, Infinity, -Infinity]])).toBe('a,b,c\r\n,,\r\n')
  })

  it('guards text cells that start like a formula, but never numbers', () => {
    const texts = ['=1+1', '+1', '-1', '@x', '\tx', 'a=b', 'safe']
    expect(
      parseCsv(
        toCsv(
          ['t'],
          texts.map((t) => [t]),
        ),
      )
        .slice(1)
        .flat(),
    ).toEqual(["'=1+1", "'+1", "'-1", "'@x", "'\tx", 'a=b', 'safe'])
    expect(toCsv(['n', 't'], [[-1, '-1']])).toBe("n,t\r\n-1,'-1\r\n")
  })

  it('guards before quoting, so a guarded cell with a comma or CR is still quoted', () => {
    expect(toCsv(['t'], [['=A1,B1'], ['\rx'], ['=say "x"']])).toBe(
      't\r\n"\'=A1,B1"\r\n"\'\rx"\r\n"\'=say ""x"""\r\n',
    )
  })

  it('adds a UTF-8 BOM only when asked', () => {
    expect(toCsv(['a'], [['é']], { bom: true })).toBe('\uFEFFa\r\né\r\n')
    expect(toCsv(['a'], [['é']], { bom: false }).startsWith('a')).toBe(true)
  })

  it('rejects rows whose width differs from the header', () => {
    expect(() => toCsv(['a', 'b'], [[1, 2], [1]])).toThrow(RangeError)
    expect(() => toCsv(['a'], [[1, 2]])).toThrow(/row 0 has 2 cells but the header has 1/)
  })
})

// ── setsCsv ──────────────────────────────────────────────────────────────────

describe('setsCsv', () => {
  const text = setsCsv(input)
  const rows = records(text)

  it('has the documented columns, with unit-suffixed mass headers', () => {
    expect(parseCsv(text)[0]).toEqual([...SETS_CSV_HEADER])
    expect(SETS_CSV_HEADER).toEqual([
      'date',
      'session_id',
      'session_status',
      'program_day',
      'gym',
      'exercise',
      'exercise_id',
      'load_type',
      'per_hand',
      'set_index',
      'is_warmup',
      'load_lb',
      'reps',
      'rir',
      'set_note',
      'session_bodyweight_lb',
      'is_deload',
    ])
  })

  it('acceptance: the CSV includes every non-voided set with date, exercise, load, reps and RIR', () => {
    expect(rows).toHaveLength(liveSets.length)
    for (const s of liveSets) {
      const matches = rows.filter(
        (r) =>
          r.session_id === s.sessionId &&
          r.exercise_id === s.exerciseId &&
          r.set_index === String(s.setIndex),
      )
      expect(matches, `set ${s.id}`).toHaveLength(1)
      const row = matches[0]!
      expect(row.date).toBe(sessionById.get(s.sessionId)!.date)
      expect(row.exercise).toBe(sxById.get(s.sessionExerciseId)!.exerciseName)
      expect(Number(row.load_lb)).toBeCloseTo(s.loadLb, 6)
      expect(row.reps).toBe(String(s.reps))
      expect(row.rir).toBe(s.rir === null ? '' : String(s.rir))
    }
  })

  it('excludes voided sets and every set of a voided session', () => {
    expect(rows.some((r) => r.session_id === 's-dup')).toBe(false)
    expect(rows.some((r) => r.load_lb === '2250')).toBe(false)
    expect(text).not.toContain('2250')
  })

  it('sorts by date, session start, exercise order, then set index', () => {
    expect(rows.map((r) => `${r.session_id}/${r.exercise_id}/${r.set_index}`)).toEqual([
      's-mon/ex-smith-squat/0',
      's-mon/ex-smith-squat/1',
      's-mon/ex-smith-squat/2',
      's-mon/ex-smith-squat/3',
      's-mon/ex-smith-squat/4',
      's-mon/ex-leg-extension/0',
      's-mon/ex-leg-extension/1',
      's-mon/ex-leg-extension/2',
      's-tue/ex-incline-db-bench/0',
      's-tue/ex-incline-db-bench/1',
      's-tue/ex-incline-db-bench/2',
      's-wed-am/ex-barbell-shrug/0',
      's-wed-pm/ex-weighted-chinup/0',
      's-wed-pm/ex-weighted-chinup/1',
      's-wed-pm/ex-weighted-chinup/2',
      's-fri/ex-leg-press/0',
      's-sat/ex-machine-lateral-raise/0',
      's-sat/ex-machine-lateral-raise/1',
    ])
  })

  it('writes a working row exactly, with ISO date and lb', () => {
    const lines = text.split('\r\n')
    expect(lines[1]).toBe(
      '2026-09-28,s-mon,finished,Lower A,Gym 1,Smith machine squat,ex-smith-squat,machine,false,0,true,95,8,,,163.4,false',
    )
    expect(lines[2]).toBe(
      '2026-09-28,s-mon,finished,Lower A,Gym 1,Smith machine squat,ex-smith-squat,machine,false,1,false,220,10,2,,163.4,false',
    )
  })

  it('flags warm-ups rather than dropping them', () => {
    const warmups = rows.filter((r) => r.is_warmup === 'true')
    expect(warmups.map((r) => [r.exercise, r.load_lb, r.reps])).toEqual([
      ['Smith machine squat', '95', '8'],
    ])
  })

  it('includes in-progress and abandoned sessions and says so', () => {
    const status = (id: string) => [
      ...new Set(rows.filter((r) => r.session_id === id).map((r) => r.session_status)),
    ]
    expect(status('s-fri')).toEqual(['abandoned'])
    expect(status('s-sat')).toEqual(['in_progress'])
    expect(status('s-mon')).toEqual(['finished'])
  })

  it('writes program day, gym, deload flag and session bodyweight; ad hoc days are blank', () => {
    const fri = rows.find((r) => r.session_id === 's-fri')!
    expect([fri.program_day, fri.gym, fri.is_deload, fri.session_bodyweight_lb]).toEqual([
      'Lower B',
      'Downtown, 2nd floor',
      'true',
      '162.6',
    ])
    const adHoc = rows.find((r) => r.session_id === 's-wed-am')!
    expect([adHoc.program_day, adHoc.session_bodyweight_lb, adHoc.is_deload]).toEqual([
      '',
      '',
      'false',
    ])
    expect(text).toContain(',"Downtown, 2nd floor",')
  })

  it('keeps bodyweight-plus added loads as plain numbers, including zero and assisted (negative)', () => {
    const chinRows = rows.filter((r) => r.exercise_id === 'ex-weighted-chinup')
    expect(
      chinRows.map((r) => [r.load_type, r.load_lb, r.reps, r.rir, r.session_bodyweight_lb]),
    ).toEqual([
      ['bodyweight_plus', '25', '8', '1', '162.8'],
      ['bodyweight_plus', '0', '10', '0', '162.8'],
      ['bodyweight_plus', '-20', '6', '', '162.8'],
    ])
    expect(text).toContain(",-20,6,,'-20 assisted,162.8,")
  })

  it('marks per-hand dumbbell loads', () => {
    const incl = rows.filter((r) => r.exercise_id === 'ex-incline-db-bench')
    expect(incl.map((r) => [r.load_type, r.per_hand, r.load_lb])).toEqual([
      ['dumbbell', 'true', '70'],
      ['dumbbell', 'true', '70'],
      ['dumbbell', 'true', '70'],
    ])
  })

  it('escapes notes with commas, quotes and line breaks, and guards formula-like notes', () => {
    expect(rows.map((r) => r.set_note).filter((n) => n !== '')).toEqual([
      'seat 4, pad 2',
      'felt "heavy"',
      'left shoulder\nclicked',
      'grip\r\nslipped',
      "'@gym2 rack",
      "'=SUM(A1:A2)",
      "'-20 assisted",
    ])
    expect(text).toContain(',"seat 4, pad 2",')
    expect(text).toContain(',"felt ""heavy""",')
    expect(text).toContain(',"left shoulder\nclicked",')
    expect(text).toContain(",'=SUM(A1:A2),")
    expect(text).not.toMatch(/,=SUM/)
  })

  it('uses the session-exercise snapshot name and prints kg-entered loads without float noise', () => {
    const lat = rows.filter((r) => r.session_id === 's-sat')
    expect(lat.map((r) => [r.exercise, r.load_lb])).toEqual([
      ['Machine lateral raise (old stack)', '37.5'],
      ['Machine lateral raise (old stack)', '22.046226'],
    ])
  })

  it('exports a set whose parent rows are missing, with those columns blank, after all dated rows', () => {
    const orphanSx = sessionExercise({
      id: 'sx-gone',
      sessionId: 's-gone',
      order: 0,
      exerciseId: 'ex-x',
      exerciseName: 'X',
      loadType: 'cable',
    })
    const orphan = set(orphanSx, 0, 50, 10, 2)
    const unknownParents = session({
      id: 's-unknown',
      date: d('2026-10-04'),
      startedAt: at('2026-10-04', 9),
      programDayId: 'day-deleted',
      gymId: 'gym-deleted',
    })
    const noSx = {
      ...set(orphanSx, 1, 55, 9, 1),
      sessionId: 's-unknown',
      sessionExerciseId: 'sx-missing',
    }
    const out = records(
      setsCsv({
        ...input,
        sessions: [...sessions, unknownParents],
        setLogs: [orphan, noSx, ...setLogs],
      }),
    )
    expect(out).toHaveLength(liveSets.length + 2)
    const [second, last] = out.slice(-2)
    expect(second).toMatchObject({
      date: '2026-10-04',
      session_id: 's-unknown',
      program_day: 'day-deleted',
      gym: 'gym-deleted',
      exercise: '',
      exercise_id: 'ex-x',
      load_type: '',
      per_hand: '',
      load_lb: '55',
    })
    expect(last).toMatchObject({
      date: '',
      session_id: 's-gone',
      session_status: '',
      program_day: '',
      gym: '',
      exercise: '',
      load_lb: '50',
      session_bodyweight_lb: '',
      is_deload: '',
    })
  })

  it('breaks ties deterministically when sessions share a start time', () => {
    const t = at('2026-10-05', 9)
    const a = session({ id: 's-a', date: d('2026-10-05'), startedAt: t })
    const b = session({ id: 's-b', date: d('2026-10-05'), startedAt: t })
    const xa = sessionExercise({
      id: 'x-a',
      sessionId: 's-a',
      order: 0,
      exerciseId: 'ex-a',
      exerciseName: 'A',
      loadType: 'cable',
    })
    const xb = sessionExercise({
      id: 'x-b',
      sessionId: 's-b',
      order: 0,
      exerciseId: 'ex-b',
      exerciseName: 'B',
      loadType: 'cable',
    })
    const sets = [set(xb, 0, 10, 10, 1), set(xa, 0, 10, 10, 1)]
    const run = (ss: Session[]) =>
      records(
        setsCsv({ sessions: ss, sessionExercises: [xa, xb], setLogs: sets, programDays, gyms }),
      ).map((r) => r.session_id)
    expect(run([b, a])).toEqual(['s-a', 's-b'])
    expect(run([a, b])).toEqual(['s-a', 's-b'])
  })

  it('writes only the header when there is nothing to export', () => {
    expect(
      setsCsv({ sessions: [], sessionExercises: [], setLogs: [], programDays: [], gyms: [] }),
    ).toBe(`${SETS_CSV_HEADER.join(',')}\r\n`)
  })

  it('passes the BOM option through and does not mutate its input', () => {
    const frozen: SetsCsvInput = {
      sessions: Object.freeze([...sessions]),
      sessionExercises: Object.freeze([...input.sessionExercises]),
      setLogs: Object.freeze([...setLogs]),
      programDays: Object.freeze([...programDays]),
      gyms: Object.freeze([...gyms]),
    }
    const before = JSON.stringify(frozen)
    expect(setsCsv(frozen, { bom: true })).toBe(`\uFEFF${text}`)
    expect(JSON.stringify(frozen)).toBe(before)
  })
})

// ── bodyCsv ──────────────────────────────────────────────────────────────────

describe('bodyCsv', () => {
  const entry = (p: Pick<BodyEntry, 'date'> & Partial<BodyEntry>): BodyEntry => ({
    weightLb: null,
    bodyFatPct: null,
    muscleMassLb: null,
    skeletalMusclePct: null,
    subcutFatPct: null,
    visceralRating: null,
    source: 'user',
    note: '',
    createdAt: 0,
    updatedAt: 0,
    voidedAt: null,
    ...p,
  })
  const entries: BodyEntry[] = [
    entry({ date: d('2026-09-26'), weightLb: 162.4 }),
    entry({ date: d('2026-09-25'), weightLb: 2250, voidedAt: 1 }),
    SEED_BODY_ENTRY,
    entry({
      date: d('2026-10-01'),
      weightLb: kgToLb(73.5),
      bodyFatPct: 14.1,
      note: '=after, "cardio"',
    }),
  ]

  it('writes the documented columns, date-sorted, voided entries excluded', () => {
    expect(bodyCsv(Object.freeze(entries))).toBe(
      [
        BODY_CSV_HEADER.join(','),
        '2026-09-24,163,14.3,132,55.3,12.7,5,seed,Baseline from the spec (smart scale)',
        '2026-09-26,162.4,,,,,,user,',
        '2026-10-01,162.039763,14.1,,,,,user,"\'=after, ""cardio"""',
        '',
      ].join('\r\n'),
    )
    expect(BODY_CSV_HEADER).toEqual([
      'date',
      'weight_lb',
      'body_fat_pct',
      'muscle_mass_lb',
      'skeletal_muscle_pct',
      'subcut_fat_pct',
      'visceral_rating',
      'source',
      'note',
    ])
  })

  it('supports the BOM option', () => {
    expect(bodyCsv([], { bom: true })).toBe(`\uFEFF${BODY_CSV_HEADER.join(',')}\r\n`)
  })
})

// ── nutritionCsv ─────────────────────────────────────────────────────────────

describe('nutritionCsv', () => {
  const entries: NutritionEntry[] = [
    {
      date: d('2026-09-30'),
      kcal: 3050,
      proteinG: 152.5,
      carbsG: 410,
      fatG: 84,
      steps: 9500,
      updatedAt: 0,
    },
    {
      date: d('2026-09-28'),
      kcal: 2980,
      proteinG: null,
      carbsG: null,
      fatG: null,
      steps: null,
      updatedAt: 0,
    },
    {
      date: d('2026-09-29'),
      kcal: null,
      proteinG: 150,
      carbsG: 400,
      fatG: 80,
      steps: 12000,
      updatedAt: 0,
    },
  ]

  it('writes the documented columns, date-sorted, blanks for missing values', () => {
    expect(nutritionCsv(Object.freeze(entries))).toBe(
      [
        'date,kcal,protein_g,carbs_g,fat_g,steps',
        '2026-09-28,2980,,,,',
        '2026-09-29,,150,400,80,12000',
        '2026-09-30,3050,152.5,410,84,9500',
        '',
      ].join('\r\n'),
    )
    expect(NUTRITION_CSV_HEADER).toEqual(['date', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'steps'])
    expect(entries[0]!.date).toBe('2026-09-30')
  })

  it('supports the BOM option', () => {
    expect(nutritionCsv([], { bom: true }).startsWith('\uFEFFdate,')).toBe(true)
  })
})

describe('csvFileName', () => {
  it('names each export by kind and ISO date', () => {
    expect(csvFileName('sets', d('2026-09-24'))).toBe('exersise-sets-2026-09-24.csv')
    expect(csvFileName('body', d('2026-09-24'))).toBe('exersise-body-2026-09-24.csv')
    expect(csvFileName('nutrition', d('2026-10-01'))).toBe('exersise-nutrition-2026-10-01.csv')
  })
})
