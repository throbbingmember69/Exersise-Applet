// Calendar dates are local `YYYY-MM-DD` strings (LocalDate). Day arithmetic goes through
// UTC day numbers so daylight-saving changes can never shift a date.
import type { LocalDate, UserProfile, Weekday } from './types'

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

export function isLocalDate(s: string): s is LocalDate {
  const m = LOCAL_DATE_RE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1) return false
  return d <= daysInMonth(y, mo)
}

/** Validate and brand a date string. Throws on anything that isn't a real YYYY-MM-DD date. */
export function parseLocalDate(s: string): LocalDate {
  if (!isLocalDate(s)) throw new RangeError(`Not a valid YYYY-MM-DD date: ${JSON.stringify(s)}`)
  return s
}

/** The local calendar date of an instant. The only place Date getters are used. */
export function localDateOf(epochMs: number): LocalDate {
  const d = new Date(epochMs)
  return fromYmd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** Days since 1970-01-01 for a LocalDate (timezone-independent). */
export function dayNumber(date: LocalDate): number {
  const [y, m, d] = ymd(date)
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

export function fromDayNumber(n: number): LocalDate {
  const d = new Date(n * MS_PER_DAY)
  return fromYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(dayNumber(date) + days)
}

/** b − a in whole days. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return dayNumber(b) - dayNumber(a)
}

export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 0 = Sunday … 6 = Saturday (same convention as Date#getDay). */
export function weekday(date: LocalDate): Weekday {
  // 1970-01-01 was a Thursday (4).
  return ((((dayNumber(date) + 4) % 7) + 7) % 7) as Weekday
}

/** The first day of the week containing `date`, for a week starting on `startDay` (1 = Monday). */
export function weekStart(date: LocalDate, startDay: Weekday): LocalDate {
  const offset = (weekday(date) - startDay + 7) % 7
  return addDays(date, -offset)
}

/** Every date from a to b inclusive (empty if b < a). */
export function dateRange(a: LocalDate, b: LocalDate): LocalDate[] {
  const out: LocalDate[] = []
  for (let n = dayNumber(a), end = dayNumber(b); n <= end; n++) out.push(fromDayNumber(n))
  return out
}

/** Age in whole years on `date`: from birthDate when known, else ageYears advanced from ageAsOf. */
export function ageOn(profile: Pick<UserProfile, 'ageYears' | 'ageAsOf' | 'birthDate'>, date: LocalDate): number {
  if (profile.birthDate) return wholeYearsBetween(profile.birthDate, date)
  return profile.ageYears + wholeYearsBetween(profile.ageAsOf, date)
}

function wholeYearsBetween(from: LocalDate, to: LocalDate): number {
  const [fy, fm, fd] = ymd(from)
  const [ty, tm, td] = ymd(to)
  let years = ty - fy
  if (tm < fm || (tm === fm && td < fd)) years -= 1
  return Math.max(0, years)
}

function ymd(date: LocalDate): [number, number, number] {
  const m = LOCAL_DATE_RE.exec(date)
  if (!m) throw new RangeError(`Not a valid YYYY-MM-DD date: ${JSON.stringify(date)}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function fromYmd(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` as LocalDate
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
