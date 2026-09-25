// The spec's three CSV exports (sets, body entries, nutrition entries), read from the database and
// formatted by domain/csv.ts: lb units, ISO dates, voided rows left out. Files start with a UTF-8
// byte-order mark so spreadsheet apps pick the right encoding.
import { bodyCsv, csvFileName, nutritionCsv, setsCsv, type CsvKind } from '@/domain/csv'
import type { LocalDate } from '@/domain/types'
import { today, type ServiceCtx } from '../context'

export type { CsvKind }

export const CSV_KINDS: readonly CsvKind[] = ['sets', 'body', 'nutrition']

export interface CsvExport {
  fileName: string
  mimeType: 'text/csv'
  text: string
}

export async function exportCsv(
  ctx: Pick<ServiceCtx, 'db' | 'now'>,
  kind: CsvKind,
  opts: { today?: LocalDate } = {},
): Promise<CsvExport> {
  return {
    fileName: csvFileName(kind, opts.today ?? today(ctx)),
    mimeType: 'text/csv',
    text: await csvText(ctx, kind),
  }
}

async function csvText(ctx: Pick<ServiceCtx, 'db'>, kind: CsvKind): Promise<string> {
  const { db } = ctx
  const options = { bom: true }
  switch (kind) {
    case 'sets': {
      const input = await db.transaction(
        'r',
        [db.sessions, db.sessionExercises, db.setLogs, db.programDays, db.gyms],
        async () => ({
          sessions: await db.sessions.toArray(),
          sessionExercises: await db.sessionExercises.toArray(),
          setLogs: await db.setLogs.toArray(),
          programDays: await db.programDays.toArray(),
          gyms: await db.gyms.toArray(),
        }),
      )
      return setsCsv(input, options)
    }
    case 'body':
      return bodyCsv(await db.bodyEntries.toArray(), options)
    case 'nutrition':
      return nutritionCsv(await db.nutritionEntries.toArray(), options)
  }
}
