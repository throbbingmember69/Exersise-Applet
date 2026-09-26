// Nutrition read model and the UI's query functions (body log, intake and targets, phases,
// check-ins). Everything here only reads Dexie and runs the pure domain engine, so the functions
// are safe inside useLiveQuery. Nothing derived is stored: trend, maintenance estimates and the
// active target are recomputed from the logged rows on every read.
//
// Check-in rows are written by `syncCheckIns` (checkin.ts), which the UI calls when a nutrition
// screen opens (a query can't write). `getCheckInView` and `getPhaseView` read those rows.
//
// The NutritionModel below is shared with the nutrition commands so a proposal, a check-in and a
// query derive their numbers the same way.
import {
  bodyComposition,
  smoothedBodyFat as domainSmoothedBodyFat,
  type SmoothedBodyFat,
} from '@/domain/bodycomp'
import { checkinSchedule } from '@/domain/checkin'
import { addDays, ageOn, compareLocalDate, daysBetween, isLocalDate } from '@/domain/dates'
import {
  activeTargetOn,
  applyKcalChange,
  targetMacros,
  type Macros,
} from '@/domain/nutritionTargets'
import { nextPhaseType } from '@/domain/phaseSwitch'
import { mean } from '@/domain/rounding'
import {
  formulaTdee,
  measuredTdee,
  tdeeTimeline,
  type FormulaTdee,
  type MeasuredTdee,
  type TdeeCheckpoint,
  type TdeeEstimate,
  type TdeePoint,
} from '@/domain/tdee'
import {
  bodyweightOn as domainBodyweightOn,
  buildTrend,
  dailyWeights,
  sevenDayAvg,
  trendOn,
  weeklyRatePct,
  weighInDates,
  type Bodyweight,
  type DailyWeight,
  type TrendPoint,
  type TrendValue,
} from '@/domain/trend'
import type {
  BodyEntry,
  CheckIn,
  LocalDate,
  MaintenanceSource,
  NutritionEntry,
  Phase,
  PhaseType,
  Settings,
  SwitchPrompt,
  SwitchResponse,
  TargetRevision,
  TargetSource,
  UserProfile,
} from '@/domain/types'
import type { ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadSettings } from '../settings'

const DAYS_PER_WEEK = 7
/** Static per-meal protein tip: the daily target spread over this many meals (finding #55). */
export const PROTEIN_MEALS_PER_DAY = 4
/** Macro/kcal mismatch hint threshold, % of logged kcal (finding #53). */
export const MACRO_MISMATCH_PCT = 10
/** The flowchart starts with a lean bulk (spec: "Start with a lean bulk"). */
export const FIRST_PHASE_TYPE: PhaseType = 'bulk'
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

// ── Input parsing shared by the nutrition commands and queries ──────────────

/** Validate a `YYYY-MM-DD` input, throwing a user-facing error otherwise. */
export function toLocalDate(value: unknown, label = 'Date'): LocalDate {
  if (typeof value !== 'string' || !isLocalDate(value)) {
    throw new ServiceError('invalid_date', `${label} must be a valid YYYY-MM-DD date`, { value })
  }
  return value
}

/** Refuse a date after `todayDate` (logs, phase starts and ends can't be dated in the future). */
export function checkNotFuture(date: LocalDate, todayDate: LocalDate, label = 'Date'): LocalDate {
  if (compareLocalDate(date, todayDate) > 0) {
    throw new ServiceError('future_date', `${label} can't be after today (${todayDate})`, {
      value: date,
      today: todayDate,
    })
  }
  return date
}

// ── Data and model ──────────────────────────────────────────────────────────

/** Every row the nutrition services read, from one consistent snapshot. */
export interface NutritionData {
  settings: Settings
  profile: UserProfile | null
  bodyEntries: readonly BodyEntry[]
  nutritionEntries: readonly NutritionEntry[]
  phases: readonly Phase[]
  targetRevisions: readonly TargetRevision[]
  checkIns: readonly CheckIn[]
}

export async function loadNutritionData(ctx: Pick<ServiceCtx, 'db'>): Promise<NutritionData> {
  const { db } = ctx
  return db.transaction(
    'r',
    [
      db.settings,
      db.profile,
      db.bodyEntries,
      db.nutritionEntries,
      db.phases,
      db.targetRevisions,
      db.checkIns,
    ],
    async () => ({
      settings: await loadSettings(ctx),
      profile: (await db.profile.get('me')) ?? null,
      bodyEntries: await db.bodyEntries.toArray(),
      nutritionEntries: await db.nutritionEntries.toArray(),
      phases: await db.phases.toArray(),
      targetRevisions: await db.targetRevisions.toArray(),
      checkIns: await db.checkIns.toArray(),
    }),
  )
}

export async function loadNutritionModel(ctx: Pick<ServiceCtx, 'db'>): Promise<NutritionModel> {
  return new NutritionModel(await loadNutritionData(ctx))
}

function byStartDate(a: Phase, b: Phase): number {
  return compareLocalDate(a.startDate, b.startDate) || a.createdAt - b.createdAt
}

function byEffective(a: TargetRevision, b: TargetRevision): number {
  return compareLocalDate(a.effectiveDate, b.effectiveDate) || a.createdAt - b.createdAt
}

/** Check-in statuses the user answered (their week is history the phase can't be cut short of). */
const ANSWERED: ReadonlySet<CheckIn['status']> = new Set(['accepted', 'accepted_steps', 'skipped'])

function laterDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareLocalDate(a, b) >= 0 ? a : b
}

/** Derived nutrition state (trend, maintenance, targets, phases), memoized per snapshot. */
export class NutritionModel {
  readonly settings: Settings
  readonly profile: UserProfile | null
  /** Trend over every real weigh-in (seed entries excluded, voided entries ignored). */
  readonly trend: readonly TrendPoint[]
  readonly weighInDates: readonly LocalDate[]
  /** All phases, oldest first. */
  readonly phases: readonly Phase[]
  private readonly revisionsByPhase = new Map<string, TargetRevision[]>()
  private readonly checkInsByPhase = new Map<string, CheckIn[]>()
  private readonly measuredCache = new Map<LocalDate, MeasuredTdee | null>()
  private readonly bodyFatCache = new Map<LocalDate, SmoothedBodyFat | null>()
  private readonly trendAsOfCache = new Map<LocalDate, readonly TrendPoint[]>()
  /** Latest date of any body entry (null without entries). */
  private readonly lastBodyDate: LocalDate | null

  constructor(readonly data: NutritionData) {
    this.settings = data.settings
    this.profile = data.profile
    this.trend = buildTrend(data.bodyEntries, data.settings)
    this.lastBodyDate =
      data.bodyEntries
        .map((e) => e.date)
        .sort(compareLocalDate)
        .at(-1) ?? null
    this.weighInDates = weighInDates(data.bodyEntries)
    this.phases = [...data.phases].sort(byStartDate)
    for (const r of data.targetRevisions) {
      const list = this.revisionsByPhase.get(r.phaseId) ?? []
      list.push(r)
      this.revisionsByPhase.set(r.phaseId, list)
    }
    for (const list of this.revisionsByPhase.values()) list.sort(byEffective)
    for (const c of data.checkIns) {
      const list = this.checkInsByPhase.get(c.phaseId) ?? []
      list.push(c)
      this.checkInsByPhase.set(c.phaseId, list)
    }
    for (const list of this.checkInsByPhase.values()) {
      list.sort((a, b) => compareLocalDate(a.dueDate, b.dueDate))
    }
  }

  /** The phase in progress (status 'active'), if any. */
  activePhase(): Phase | null {
    return this.phases.filter((p) => p.status === 'active').at(-1) ?? null
  }

  /** The phase whose [startDate, endDate] contains `date` (an active phase has no end). */
  phaseOn(date: LocalDate): Phase | null {
    return (
      this.phases
        .filter(
          (p) =>
            compareLocalDate(p.startDate, date) <= 0 &&
            (p.endDate === null || compareLocalDate(date, p.endDate) <= 0),
        )
        .at(-1) ?? null
    )
  }

  /** The latest phase that started on or before `date`. */
  phaseStartedBy(date: LocalDate): Phase | null {
    return this.phases.filter((p) => compareLocalDate(p.startDate, date) <= 0).at(-1) ?? null
  }

  /** The latest phase that started strictly before `date`. */
  phaseBefore(date: LocalDate): Phase | null {
    return this.phases.filter((p) => compareLocalDate(p.startDate, date) < 0).at(-1) ?? null
  }

  /** Type of the last bulk or cut that started before `phase` (picks the phase after maintenance). */
  lastNonMaintenanceTypeBefore(phase: Phase): PhaseType | null {
    return (
      this.phases.filter((p) => p.type !== 'maintenance' && byStartDate(p, phase) < 0).at(-1)
        ?.type ?? null
    )
  }

  /** The flowchart's next phase after `phase` (a lean bulk when there is none). */
  suggestedNextType(phase: Phase | null): PhaseType {
    if (!phase) return FIRST_PHASE_TYPE
    return nextPhaseType(phase.type, this.lastNonMaintenanceTypeBefore(phase))
  }

  /** Target revisions of a phase, by effective date then creation. */
  revisionsOf(phaseId: string): readonly TargetRevision[] {
    return this.revisionsByPhase.get(phaseId) ?? []
  }

  /** Check-ins of a phase, by due date. */
  checkInsOf(phaseId: string): readonly CheckIn[] {
    return this.checkInsByPhase.get(phaseId) ?? []
  }

  /** The phase's target revision in effect on `date`. */
  targetOn(phase: Phase, date: LocalDate): TargetRevision | null {
    return activeTargetOn(this.revisionsOf(phase.id), date)
  }

  /**
   * The last date a phase's history is committed through: its start, its latest answered
   * check-in's due date or its latest target revision's effective date, whichever is later. The
   * phase can't end before it, so a following phase must start after it.
   */
  committedThrough(phase: Phase): LocalDate {
    let last = phase.startDate
    for (const c of this.checkInsOf(phase.id)) {
      if (ANSWERED.has(c.status)) last = laterDate(last, c.dueDate)
    }
    for (const r of this.revisionsOf(phase.id)) last = laterDate(last, r.effectiveDate)
    return last
  }

  /**
   * The earliest start date for a new phase: after the active phase's committed history, else
   * after the last phase's end. Null before any phase (the first one may be backdated freely).
   */
  earliestStartDate(): LocalDate | null {
    const active = this.activePhase()
    if (active) return addDays(this.committedThrough(active), 1)
    const last = this.phases
      .map((p) => p.endDate ?? p.startDate)
      .sort(compareLocalDate)
      .at(-1)
    return last === undefined ? null : addDays(last, 1)
  }

  /** Trend weight on a date, else the seed baseline (before any real weigh-in), else null. */
  weightOn(date: LocalDate): Bodyweight | null {
    return domainBodyweightOn(this.trend, this.data.bodyEntries, date)
  }

  trendOn(date: LocalDate): TrendValue | null {
    return trendOn(this.trend, date)
  }

  /**
   * The trend as it stood on `date`: built only from body entries dated on or before it, so a
   * later reading can't fill in (interpolate) the days up to `date`. Used for as-of evaluations.
   */
  trendAsOf(date: LocalDate): readonly TrendPoint[] {
    if (this.lastBodyDate === null || compareLocalDate(this.lastBodyDate, date) <= 0) {
      return this.trend
    }
    let trend = this.trendAsOfCache.get(date)
    if (!trend) {
      const upTo = this.data.bodyEntries.filter((e) => compareLocalDate(e.date, date) <= 0)
      trend = buildTrend(upTo, this.settings)
      this.trendAsOfCache.set(date, trend)
    }
    return trend
  }

  /** Smoothed body fat on a date (or the single-reading fallback). */
  bodyFatOn(date: LocalDate): SmoothedBodyFat | null {
    if (!this.bodyFatCache.has(date)) {
      this.bodyFatCache.set(date, domainSmoothedBodyFat(this.data.bodyEntries, date, this.settings))
    }
    return this.bodyFatCache.get(date) ?? null
  }

  /**
   * Formula maintenance on a date from the trend weight as of that date (or `fallbackWeightLb`),
   * body fat and age.
   */
  formulaOn(date: LocalDate, fallbackWeightLb: number | null = null): FormulaTdee | null {
    const weightLb =
      domainBodyweightOn(this.trendAsOf(date), this.data.bodyEntries, date)?.weightLb ??
      fallbackWeightLb
    const profile = this.profile
    if (weightLb === null || !profile) return null
    return formulaTdee(
      {
        trendLb: weightLb,
        bodyFatPct: this.bodyFatOn(date)?.pct ?? null,
        heightIn: profile.heightIn,
        age: ageOn(profile, date),
        sex: profile.sex,
      },
      this.settings,
    )
  }

  /**
   * Measured maintenance over the window ending on `date` (every phase start is a disruption),
   * from the data as it stood on `date`.
   */
  measuredOn(date: LocalDate): MeasuredTdee | null {
    if (!this.measuredCache.has(date)) {
      this.measuredCache.set(
        date,
        measuredTdee(
          {
            asOf: date,
            intake: this.data.nutritionEntries,
            weighInDates: this.weighInDates,
            trend: this.trendAsOf(date),
            disruptions: this.phases.map((p) => p.startDate),
          },
          this.settings,
        ),
      )
    }
    return this.measuredCache.get(date) ?? null
  }

  /**
   * The maintenance-estimate timeline of a phase: one checkpoint on the last day of each completed
   * phase week (the day before its check-in is due, so a check-in never counts the partly logged
   * due date) up to `upTo` (and up to the phase's end), plus `upTo` itself when `includeUpTo`. A
   * phase that started from a measured maintenance carries it in, so later measurements are
   * capped against it.
   */
  phaseTimeline(phase: Phase, upTo: LocalDate, includeUpTo = false): TdeePoint[] {
    const end =
      phase.endDate !== null && compareLocalDate(phase.endDate, upTo) < 0 ? phase.endDate : upTo
    const dates = checkinSchedule(phase.startDate, addDays(end, 1)).map((w) =>
      addDays(w.dueDate, -1),
    )
    const last = dates.at(-1)
    if (includeUpTo && (!last || compareLocalDate(last, upTo) < 0)) dates.push(upTo)
    const checkpoints: TdeeCheckpoint[] = dates.map((date) => ({
      date,
      measuredKcal: this.measuredOn(date)?.kcal ?? null,
      formulaKcal:
        this.formulaOn(date, phase.trendWeightLbAtStart)?.kcal ?? phase.maintenanceKcalAtStart,
    }))
    const initial: TdeeEstimate | null =
      phase.maintenanceSource === 'measured'
        ? { kcal: phase.maintenanceKcalAtStart, source: 'measured', capped: false }
        : null
    return tdeeTimeline(checkpoints, this.settings, initial)
  }

  /**
   * The maintenance estimate on `date`: the timeline of the latest phase started by then, or a
   * single checkpoint (formula, or an uncapped first measurement) before any phase.
   */
  maintenanceEstimateOn(date: LocalDate): TdeeEstimate | null {
    const phase = this.phaseStartedBy(date)
    if (phase) return this.phaseTimeline(phase, date, true).at(-1) ?? null
    const formula = this.formulaOn(date)
    if (!formula) return null
    const points = tdeeTimeline(
      [{ date, measuredKcal: this.measuredOn(date)?.kcal ?? null, formulaKcal: formula.kcal }],
      this.settings,
    )
    return points.at(-1) ?? null
  }
}

/** 1-based week of a phase that `date` falls in. */
export function phaseWeekOn(phase: Pick<Phase, 'startDate'>, date: LocalDate): number {
  return Math.floor(daysBetween(phase.startDate, date) / DAYS_PER_WEEK) + 1
}

// ── View types ──────────────────────────────────────────────────────────────

export interface TargetView extends Macros {
  revisionId: string
  effectiveDate: LocalDate
  source: TargetSource
  checkInId: string | null
  note: string
}

function targetView(r: TargetRevision): TargetView {
  return {
    ...targetMacros(r),
    revisionId: r.id,
    effectiveDate: r.effectiveDate,
    source: r.source,
    checkInId: r.checkInId,
    note: r.note,
  }
}

export interface MacroAmounts {
  kcal: number
  proteinG: number
  fatG: number
  carbsG: number
}

export interface TodayNutritionView {
  date: LocalDate
  phase: Phase | null
  /** 1-based week of the phase on `date`. */
  weekIndex: number | null
  target: TargetView | null
  intake: NutritionEntry | null
  /** Target minus what's logged (unlogged fields count as 0); negative when over. */
  remaining: MacroAmounts | null
  /** Protein target ÷ 4 meals. */
  perMealProteinG: number | null
  /** true when logged macros (4P + 4C + 9F) differ from logged kcal by more than 10%. */
  macroMismatch: boolean
}

/** Today's (or any date's) target, intake and what's left. */
export async function getTodayNutrition(
  ctx: Pick<ServiceCtx, 'db'>,
  input: { date: LocalDate },
): Promise<TodayNutritionView> {
  const date = toLocalDate(input.date)
  const model = await loadNutritionModel(ctx)
  const phase = model.phaseOn(date)
  const revision = phase ? model.targetOn(phase, date) : null
  const target = revision ? targetView(revision) : null
  const intake = model.data.nutritionEntries.find((e) => e.date === date) ?? null
  return {
    date,
    phase,
    weekIndex: phase ? phaseWeekOn(phase, date) : null,
    target,
    intake,
    remaining: target
      ? {
          kcal: target.kcal - (intake?.kcal ?? 0),
          proteinG: target.proteinG - (intake?.proteinG ?? 0),
          fatG: target.fatG - (intake?.fatG ?? 0),
          carbsG: target.carbsG - (intake?.carbsG ?? 0),
        }
      : null,
    perMealProteinG: target ? target.proteinG / PROTEIN_MEALS_PER_DAY : null,
    macroMismatch: intake ? macroMismatch(intake) : false,
  }
}

/** Logged macros disagree with logged kcal by more than MACRO_MISMATCH_PCT (all four needed). */
export function macroMismatch(
  e: Pick<NutritionEntry, 'kcal' | 'proteinG' | 'carbsG' | 'fatG'>,
): boolean {
  const { kcal, proteinG, carbsG, fatG } = e
  if (kcal === null || proteinG === null || carbsG === null || fatG === null || kcal <= 0) {
    return false
  }
  const fromMacros =
    KCAL_PER_G.protein * proteinG + KCAL_PER_G.carbs * carbsG + KCAL_PER_G.fat * fatG
  return Math.abs(fromMacros - kcal) > (MACRO_MISMATCH_PCT / 100) * kcal
}

export interface BodyCompositionView {
  weightLb: number
  weightSource: Bodyweight['source']
  smoothedBodyFat: SmoothedBodyFat | null
  leanMassLb: number | null
  fatMassLb: number | null
  ffmi: number | null
  bmi: number | null
}

export interface BodyView {
  asOf: LocalDate
  /** First date shown (null = all history). */
  from: LocalDate | null
  /** Non-voided entries up to asOf (seed baseline included), newest first. */
  entries: BodyEntry[]
  /** Voided entries (restorable), newest first. */
  voidedEntries: BodyEntry[]
  /** One weight per day from real weigh-ins; gaps interpolated and flagged. */
  dailyWeights: DailyWeight[]
  trend: TrendPoint[]
  /** Trend on asOf (stale after the last reading). */
  currentTrend: TrendValue | null
  sevenDayAvg: number | null
  /** Weekly trend rate on the latest trend day up to asOf. */
  weeklyRatePct: number | null
  rateDate: LocalDate | null
  latestWeight: { date: LocalDate; weightLb: number; source: BodyEntry['source'] } | null
  bodyComposition: BodyCompositionView | null
}

/** The body log: entries, daily weights, trend, 7-day average, rate and body composition. */
export async function getBodyView(
  ctx: Pick<ServiceCtx, 'db'>,
  input: { asOf: LocalDate; days?: number },
): Promise<BodyView> {
  const asOf = toLocalDate(input.asOf, 'As-of date')
  if (input.days !== undefined && !(Number.isInteger(input.days) && input.days >= 1)) {
    throw new ServiceError('invalid_days', 'Days must be a whole number of at least 1')
  }
  const model = await loadNutritionModel(ctx)
  const s = model.settings
  const from = input.days === undefined ? null : addDays(asOf, -(input.days - 1))
  const inWindow = (d: LocalDate) =>
    compareLocalDate(d, asOf) <= 0 && (from === null || compareLocalDate(d, from) >= 0)
  const newestFirst = (a: BodyEntry, b: BodyEntry) => compareLocalDate(b.date, a.date)

  const upToAsOf = model.data.bodyEntries.filter((e) => compareLocalDate(e.date, asOf) <= 0)
  const lastTrendDay = model.trend.filter((p) => compareLocalDate(p.date, asOf) <= 0).at(-1)
  const latest = upToAsOf
    .filter((e) => e.voidedAt === null && e.weightLb !== null)
    .sort(newestFirst)[0]
  const weight = model.weightOn(asOf)
  const bodyFat = model.bodyFatOn(asOf)
  const comp =
    weight && model.profile
      ? bodyComposition(weight.weightLb, bodyFat?.pct ?? null, model.profile.heightIn)
      : null

  return {
    asOf,
    from,
    entries: upToAsOf.filter((e) => e.voidedAt === null && inWindow(e.date)).sort(newestFirst),
    voidedEntries: upToAsOf.filter((e) => e.voidedAt !== null).sort(newestFirst),
    dailyWeights: dailyWeights(model.data.bodyEntries).filter((d) => inWindow(d.date)),
    trend: model.trend.filter((p) => inWindow(p.date)),
    currentTrend: model.trendOn(asOf),
    sevenDayAvg: sevenDayAvg(model.data.bodyEntries, asOf, s.sevenDayAvgMinReadings),
    weeklyRatePct: lastTrendDay ? weeklyRatePct(model.trend, lastTrendDay.date) : null,
    rateDate: lastTrendDay?.date ?? null,
    latestWeight:
      latest && latest.weightLb !== null
        ? { date: latest.date, weightLb: latest.weightLb, source: latest.source }
        : null,
    bodyComposition: weight
      ? {
          weightLb: weight.weightLb,
          weightSource: weight.source,
          smoothedBodyFat: bodyFat,
          leanMassLb: comp?.leanLb ?? null,
          fatMassLb: comp?.fatLb ?? null,
          ffmi: comp?.ffmi ?? null,
          bmi: comp?.bmi ?? null,
        }
      : null,
  }
}

export interface PendingCheckInView {
  checkIn: CheckIn
  /** Target that would be in effect tomorrow without a change. */
  currentTarget: Macros | null
  /** Target after accepting the suggested change (null when no change is suggested). */
  proposedTarget: Macros | null
  /** Daily steps target for the cut's steps option: 14-day average + the extra steps, when known. */
  stepsTarget: number | null
  /** The trend for the three weeks ending on the due date (for the chart with the band). */
  trend: TrendPoint[]
}

export interface CheckInView {
  phase: Phase | null
  pending: PendingCheckInView | null
  /** Every other check-in (answered or backfilled), newest first, across phases. */
  history: CheckIn[]
}

const CHART_WEEKS = 3

/** The actionable check-in (if any) and check-in history. Rows come from `syncCheckIns`. */
export async function getCheckInView(
  ctx: Pick<ServiceCtx, 'db'>,
  input: { asOf: LocalDate },
): Promise<CheckInView> {
  const asOf = toLocalDate(input.asOf, 'As-of date')
  const model = await loadNutritionModel(ctx)
  const phase = model.activePhase()
  const pendingRow = phase
    ? (model
        .checkInsOf(phase.id)
        .filter((c) => c.status === 'pending' && compareLocalDate(c.dueDate, asOf) <= 0)
        .at(-1) ?? null)
    : null
  let pending: PendingCheckInView | null = null
  if (phase && pendingRow) {
    const current = model.targetOn(phase, addDays(asOf, 1))
    const from = addDays(pendingRow.dueDate, -(CHART_WEEKS * DAYS_PER_WEEK - 1))
    pending = {
      checkIn: pendingRow,
      currentTarget: current ? targetMacros(current) : null,
      proposedTarget:
        current && pendingRow.suggestedKcalChange !== 0
          ? applyKcalChange(current, pendingRow.suggestedKcalChange)
          : null,
      stepsTarget:
        pendingRow.stepsAlternative === null
          ? null
          : stepsTarget(model, pendingRow.dueDate, pendingRow.stepsAlternative),
      trend: model.trend.filter(
        (p) =>
          compareLocalDate(p.date, from) >= 0 && compareLocalDate(p.date, pendingRow.dueDate) <= 0,
      ),
    }
  }
  const history = model.data.checkIns
    .filter((c) => c !== pendingRow && compareLocalDate(c.dueDate, asOf) <= 0)
    .sort((a, b) => compareLocalDate(b.dueDate, a.dueDate))
  return { phase, pending, history }
}

/**
 * Average daily steps over the tdeeWindowMinDays days ending on `date` plus `extra`, when steps
 * were logged on at least tdeeMinLoggedPct% of them (finding #48); else null.
 */
function stepsTarget(model: NutritionModel, date: LocalDate, extra: number): number | null {
  const s = model.settings
  const days = s.tdeeWindowMinDays
  const from = addDays(date, -(days - 1))
  const steps = model.data.nutritionEntries.flatMap((e) =>
    e.steps !== null && compareLocalDate(e.date, from) >= 0 && compareLocalDate(e.date, date) <= 0
      ? [e.steps]
      : [],
  )
  const avg = mean(steps)
  if (avg === null || steps.length * 100 < s.tdeeMinLoggedPct * days) return null
  return Math.round(avg) + extra
}

export interface PhasePromptView extends SwitchPrompt {
  checkInId: string
  dueDate: LocalDate
  weekIndex: number
  response: SwitchResponse | null
}

export interface MaintenanceView {
  atStart: { kcal: number; source: MaintenanceSource } | null
  formula: FormulaTdee | null
  measured: MeasuredTdee | null
  /** The running estimate: formula until the first measurement, then capped weekly updates. */
  current: TdeeEstimate | null
}

export interface PhaseView {
  asOf: LocalDate
  phase: Phase | null
  /** 1-based week of the phase on asOf. */
  weekIndex: number | null
  /** Whole weeks completed (the latest check-in week due). */
  completedWeeks: number | null
  plannedWeeks: number | null
  maxWeeks: number | null
  target: TargetView | null
  /** Every target revision of the phase, oldest first. */
  targets: TargetView[]
  maintenance: MaintenanceView
  /** The latest switch prompt raised at a check-in and not dismissed. */
  prompt: PhasePromptView | null
  /** What the flowchart suggests next (a lean bulk when no phase exists). */
  suggestedNextType: PhaseType
  /**
   * The earliest date the active phase can end (its latest answered check-in or target change);
   * the latest is today. Null without an active phase.
   */
  earliestEndDate: LocalDate | null
}

/** The active phase: progress, targets, maintenance estimates and any switch prompt. */
export async function getPhaseView(
  ctx: Pick<ServiceCtx, 'db'>,
  input: { asOf: LocalDate },
): Promise<PhaseView> {
  const asOf = toLocalDate(input.asOf, 'As-of date')
  const model = await loadNutritionModel(ctx)
  const phase = model.activePhase()
  const maintenance: MaintenanceView = {
    atStart: phase ? { kcal: phase.maintenanceKcalAtStart, source: phase.maintenanceSource } : null,
    formula: model.formulaOn(asOf, phase?.trendWeightLbAtStart ?? null),
    measured: model.measuredOn(asOf),
    current: model.maintenanceEstimateOn(asOf),
  }
  const started = phase !== null && compareLocalDate(phase.startDate, asOf) <= 0
  const revision = phase ? model.targetOn(phase, asOf) : null
  const promptRow = phase
    ? model
        .checkInsOf(phase.id)
        .filter((c) => c.switchPrompt !== null && compareLocalDate(c.dueDate, asOf) <= 0)
        .at(-1)
    : undefined
  return {
    asOf,
    phase,
    weekIndex: phase && started ? phaseWeekOn(phase, asOf) : null,
    completedWeeks:
      phase && started ? Math.floor(daysBetween(phase.startDate, asOf) / DAYS_PER_WEEK) : null,
    plannedWeeks: phase?.plannedWeeks ?? null,
    maxWeeks: phase?.maxWeeks ?? null,
    target: revision ? targetView(revision) : null,
    targets: phase ? model.revisionsOf(phase.id).map(targetView) : [],
    maintenance,
    prompt:
      promptRow?.switchPrompt && promptRow.switchResponse !== 'dismissed'
        ? {
            ...promptRow.switchPrompt,
            checkInId: promptRow.id,
            dueDate: promptRow.dueDate,
            weekIndex: promptRow.phaseWeekIndex,
            response: promptRow.switchResponse,
          }
        : null,
    suggestedNextType: model.suggestedNextType(phase ?? model.phases.at(-1) ?? null),
    earliestEndDate: phase ? model.committedThrough(phase) : null,
  }
}

export interface PhaseSummary {
  phase: Phase
  startTarget: TargetView | null
  latestTarget: TargetView | null
  /** Length in weeks for an ended phase (endDate inclusive); null while active. */
  lengthWeeks: number | null
  checkIns: number
  /** Check-ins answered with a calorie change. */
  acceptedChanges: number
}

/** Every phase, newest first, with its first and latest targets. */
export async function getPhaseHistory(ctx: Pick<ServiceCtx, 'db'>): Promise<PhaseSummary[]> {
  const model = await loadNutritionModel(ctx)
  return [...model.phases].reverse().map((phase) => {
    const revisions = model.revisionsOf(phase.id)
    const checkIns = model.checkInsOf(phase.id)
    const first = revisions[0]
    const last = revisions.at(-1)
    return {
      phase,
      startTarget: first ? targetView(first) : null,
      latestTarget: last ? targetView(last) : null,
      lengthWeeks:
        phase.endDate === null
          ? null
          : (daysBetween(phase.startDate, phase.endDate) + 1) / DAYS_PER_WEEK,
      checkIns: checkIns.length,
      acceptedChanges: checkIns.filter((c) => c.status === 'accepted').length,
    }
  })
}
