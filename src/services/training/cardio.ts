// Post-workout cardio: log it from the logger while the session is in progress, or fix it in a
// finished session's Edit mode (stamps editedAt, like sets). Entries are voided, never deleted.
// The block query gives the logger this week's ramping target and a suggested machine
// (domain/cardio.ts); nothing about the ramp is stored.
import {
  cardioTarget,
  CARDIO_MODALITIES,
  isLegDay,
  suggestedCardioModality,
  type CardioTarget,
} from '@/domain/cardio'
import { compareLocalDate } from '@/domain/dates'
import { plannedDayVolume } from '@/domain/volume'
import { assertCanEdit, assertCanLog, requireSession } from '@/db/guards'
import type {
  CardioIntensity,
  CardioLog,
  CardioModality,
  ProgramSlot,
  Session,
} from '@/domain/types'
import type { ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadTrainingModel } from './model'

export const CARDIO_INTENSITIES: readonly CardioIntensity[] = ['easy', 'moderate', 'hard']
const MAX_MINUTES = 180
const HEART_RATE: readonly [number, number] = [30, 250]
const MAX_NOTE = 500

export interface CardioInput {
  sessionId: string
  modality: CardioModality
  minutes: number
  intensity: CardioIntensity
  avgHeartRate?: number | null
  note?: string
}

export type CardioPatch = Partial<
  Pick<CardioLog, 'modality' | 'minutes' | 'intensity' | 'avgHeartRate' | 'note'>
>
const PATCH_FIELDS = ['modality', 'minutes', 'intensity', 'avgHeartRate', 'note'] as const

type Mode = 'log' | 'edit'

function checkValues(p: CardioPatch): void {
  if (p.modality !== undefined && !CARDIO_MODALITIES.includes(p.modality)) {
    throw new ServiceError('invalid_cardio', 'Pick a cardio machine.', { modality: p.modality })
  }
  if (
    p.minutes !== undefined &&
    (!Number.isInteger(p.minutes) || p.minutes < 1 || p.minutes > MAX_MINUTES)
  ) {
    throw new ServiceError(
      'invalid_cardio',
      `Minutes must be a whole number from 1 to ${MAX_MINUTES}.`,
      {
        minutes: p.minutes,
      },
    )
  }
  if (p.intensity !== undefined && !CARDIO_INTENSITIES.includes(p.intensity)) {
    throw new ServiceError('invalid_cardio', 'Pick easy, moderate or hard.', {
      intensity: p.intensity,
    })
  }
  const hr = p.avgHeartRate
  if (
    hr !== undefined &&
    hr !== null &&
    (!Number.isInteger(hr) || hr < HEART_RATE[0] || hr > HEART_RATE[1])
  ) {
    throw new ServiceError(
      'invalid_cardio',
      `Heart rate must be a whole number from ${HEART_RATE[0]} to ${HEART_RATE[1]} bpm.`,
      { avgHeartRate: hr },
    )
  }
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > MAX_NOTE)) {
    throw new ServiceError(
      'invalid_note',
      `The note must be text of at most ${MAX_NOTE} characters.`,
    )
  }
}

function checkPatch(patch: CardioPatch): CardioPatch {
  const out: CardioPatch = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!(PATCH_FIELDS as readonly string[]).includes(key)) {
      throw new ServiceError('field_not_editable', `A cardio entry's ${key} can't be changed.`, {
        field: key,
      })
    }
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  checkValues(out)
  return out
}

function assertMode(session: Session, mode: Mode): void {
  if (mode === 'log') assertCanLog(session)
  else assertCanEdit(session)
}

async function addCardio(ctx: ServiceCtx, input: CardioInput, mode: Mode): Promise<string> {
  const { db } = ctx
  const values = {
    modality: input.modality,
    minutes: input.minutes,
    intensity: input.intensity,
    avgHeartRate: input.avgHeartRate ?? null,
    note: input.note ?? '',
  }
  checkValues(values)
  const id = ctx.newId()
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.cardioLogs], async () => {
    const session = requireSession(await db.sessions.get(input.sessionId), input.sessionId)
    assertMode(session, mode)
    await db.cardioLogs.add({
      id,
      sessionId: session.id,
      date: session.date,
      ...values,
      loggedAt: now,
      editedAt: mode === 'edit' ? now : null,
      voidedAt: null,
    })
    if (mode === 'edit') await db.sessions.update(session.id, { editedAt: now })
  })
  return id
}

async function withCardio(
  ctx: ServiceCtx,
  id: string,
  mode: Mode,
  write: (log: CardioLog, now: number) => Promise<void>,
): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.cardioLogs], async () => {
    const log = await db.cardioLogs.get(id)
    if (!log)
      throw new ServiceError('cardio_not_found', 'That cardio entry no longer exists.', { id })
    const session = requireSession(await db.sessions.get(log.sessionId), log.sessionId)
    assertMode(session, mode)
    await write(log, now)
    if (mode === 'edit') await db.sessions.update(session.id, { editedAt: now })
  })
}

function assertLive(log: CardioLog): void {
  if (log.voidedAt !== null) {
    throw new ServiceError('cardio_voided', 'That cardio entry is deleted.', { id: log.id })
  }
}

// ── Logger (session in progress) ─────────────────────────────────────────────

/** Log cardio for the in-progress session. Returns the new entry's id. */
export function logCardio(ctx: ServiceCtx, input: CardioInput): Promise<string> {
  return addCardio(ctx, input, 'log')
}

/** Correct a cardio entry of the in-progress session. */
export async function updateCardio(ctx: ServiceCtx, id: string, patch: CardioPatch): Promise<void> {
  const p = checkPatch(patch)
  if (Object.keys(p).length === 0) return
  await withCardio(ctx, id, 'log', async (log) => {
    assertLive(log)
    await ctx.db.cardioLogs.update(log.id, p)
  })
}

/** Delete (soft-void) a cardio entry of the in-progress session. */
export async function voidCardio(ctx: ServiceCtx, id: string): Promise<void> {
  await withCardio(ctx, id, 'log', async (log, now) => {
    assertLive(log)
    await ctx.db.cardioLogs.update(log.id, { voidedAt: now })
  })
}

// ── Edit mode (finished or abandoned session) ────────────────────────────────

/** Add cardio that was missed while logging. Returns the new entry's id. */
export function addCardioInEdit(ctx: ServiceCtx, input: CardioInput): Promise<string> {
  return addCardio(ctx, input, 'edit')
}

/** Correct a cardio entry of a finished or abandoned session. */
export async function editCardio(ctx: ServiceCtx, id: string, patch: CardioPatch): Promise<void> {
  const p = checkPatch(patch)
  if (Object.keys(p).length === 0) return
  await withCardio(ctx, id, 'edit', async (log, now) => {
    assertLive(log)
    await ctx.db.cardioLogs.update(log.id, { ...p, editedAt: now })
  })
}

/** Delete (soft-void) a cardio entry of a finished or abandoned session. Restorable. */
export async function voidCardioInEdit(ctx: ServiceCtx, id: string): Promise<void> {
  await withCardio(ctx, id, 'edit', async (log, now) => {
    assertLive(log)
    await ctx.db.cardioLogs.update(log.id, { voidedAt: now, editedAt: now })
  })
}

/** Restore a voided cardio entry of a finished or abandoned session. */
export async function restoreCardio(ctx: ServiceCtx, id: string): Promise<void> {
  await withCardio(ctx, id, 'edit', async (log, now) => {
    if (log.voidedAt === null) {
      throw new ServiceError('cardio_not_voided', "That cardio entry isn't deleted.", { id })
    }
    await ctx.db.cardioLogs.update(log.id, { voidedAt: null, editedAt: now })
  })
}

// ── Query ────────────────────────────────────────────────────────────────────

export interface CardioBlockView {
  sessionId: string
  /** 'log' while the session is in progress; 'edit' once it's finished or abandoned. */
  mode: Mode
  /** This week's ramping target (the session's training week). */
  target: CardioTarget
  /** The machine to start from: the bike on a leg day, else the last one used. */
  suggestedModality: CardioModality
  legDay: boolean
  /** This session's live entries, oldest first. */
  entries: CardioLog[]
  /** This session's voided entries (Edit mode can restore them). */
  voided: CardioLog[]
  totalMinutes: number
  metTarget: boolean
}

/** The cardio block of a session: its entries, this week's target and a suggested machine. */
export async function getCardioBlock(
  ctx: Pick<ServiceCtx, 'db'>,
  sessionId: string,
): Promise<CardioBlockView | null> {
  const { db } = ctx
  const [model, logs] = await Promise.all([loadTrainingModel(ctx), db.cardioLogs.toArray()])
  const session = model.data.sessions.find((s) => s.id === sessionId)
  if (!session) return null
  const settings = model.settings
  const target = cardioTarget({ sessions: model.data.sessions, logs }, session.date, settings)

  const resolve = (slot: ProgramSlot) =>
    model.exercise(slot.defaultExerciseId)
      ? model.resolveSlotExercise(slot, session.gymId).exercise
      : null
  const dayVolume =
    session.programDayId === null
      ? null
      : plannedDayVolume(model.slotsOf(session.programDayId), resolve).byMuscle
  const legDay = isLegDay(dayVolume, settings)

  const sessionDate = new Map(model.data.sessions.map((s) => [s.id, s]))
  const earlier = logs
    .filter((l) => l.voidedAt === null && l.sessionId !== sessionId)
    .filter((l) => {
      const s = sessionDate.get(l.sessionId)
      return s !== undefined && s.voidedAt === null && isBefore(s, session)
    })
    .sort((a, b) => a.loggedAt - b.loggedAt)
  const last = earlier.at(-1)?.modality ?? null

  const mine = logs.filter((l) => l.sessionId === sessionId).sort((a, b) => a.loggedAt - b.loggedAt)
  const entries = mine.filter((l) => l.voidedAt === null)
  const totalMinutes = entries.reduce((sum, l) => sum + l.minutes, 0)
  return {
    sessionId,
    mode: session.status === 'in_progress' ? 'log' : 'edit',
    target,
    suggestedModality: suggestedCardioModality(dayVolume, last, settings),
    legDay,
    entries,
    voided: mine.filter((l) => l.voidedAt !== null),
    totalMinutes,
    metTarget: totalMinutes >= target.minutes,
  }
}

function isBefore(a: Pick<Session, 'date' | 'startedAt'>, b: Pick<Session, 'date' | 'startedAt'>) {
  return compareLocalDate(a.date, b.date) < 0 || (a.date === b.date && a.startedAt < b.startedAt)
}
