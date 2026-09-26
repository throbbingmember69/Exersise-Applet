import { useState } from 'react'
import { useCommand, useCtx } from '@/app/hooks'
import type { CronometerField } from '@/domain/cronometerCsv'
import { SpreadsheetError } from '@/domain/xlsx'
import { IMPORT_FILE_ACCEPT, readTableFile } from '@/platform/spreadsheet'
import { isServiceError } from '@/services/errors'
import {
  importCronometer,
  previewCronometerImport,
  type CronometerDayStatus,
  type CronometerImportPreview,
} from '@/services/nutrition/cronometerImport'
import { formatDate, formatInt } from '@/ui/format'
import { Badge, Button, Card, type Tone } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import styles from './data.module.css'

const STATUS: Record<CronometerDayStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'good' },
  update: { label: 'Update', tone: 'accent' },
  same: { label: 'Already there', tone: 'neutral' },
  future: { label: 'Future date', tone: 'warn' },
  invalid: { label: 'Not plausible', tone: 'warn' },
}

const FIELD_NAME: Record<CronometerField, string> = {
  kcal: 'calories',
  proteinG: 'protein',
  carbsG: 'carbs',
  fatG: 'fat',
}

function macros(v: Partial<Record<CronometerField, number | null>>): string {
  const parts: string[] = []
  if (v.kcal != null) parts.push(`${formatInt(v.kcal)} kcal`)
  if (v.proteinG != null) parts.push(`P ${formatInt(v.proteinG)}`)
  if (v.carbsG != null) parts.push(`C ${formatInt(v.carbsG)}`)
  if (v.fatG != null) parts.push(`F ${formatInt(v.fatG)}`)
  return parts.join(' · ')
}

/**
 * Import a Cronometer CSV (Daily Nutrition, or Servings summed per day). Days in the file replace
 * the calories and macros logged for them; steps are kept.
 */
export default function CronometerImportCard() {
  const ctx = useCtx()
  const [text, setText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<CronometerImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCommand(importCronometer)

  const refresh = async (t: string) => {
    try {
      setPreview(await previewCronometerImport(ctx, { text: t }))
      setError(null)
    } catch (e) {
      setPreview(null)
      setError(isServiceError(e) ? e.message : 'Could not read that file.')
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    let t: string
    try {
      t = await readTableFile(file)
    } catch (e) {
      setText(null)
      setPreview(null)
      setError(e instanceof SpreadsheetError ? e.message : 'Could not read that file.')
      return
    }
    setText(t)
    setFileName(file.name)
    await refresh(t)
  }

  const onImport = async () => {
    if (text === null) return
    const result = await run.run({ text })
    if (!result) return
    await refresh(text)
  }

  const writable = preview ? preview.counts.new + preview.counts.update : 0
  const found = preview
    ? (Object.keys(FIELD_NAME) as CronometerField[])
        .filter((f) => preview.recognized[f])
        .map((f) => FIELD_NAME[f])
    : []

  return (
    <Card title="Import from Cronometer">
      <p className={styles.hint}>
        On the Cronometer website, export <strong>Daily Nutrition</strong> (Servings works too) as a
        CSV and pick it here. Each day in the file replaces the calories and macros logged for it;
        steps are kept.
      </p>
      <label className={`${kit.button} ${kit.block}`}>
        Choose file
        <input
          type="file"
          accept={IMPORT_FILE_ACCEPT}
          className={kit.srOnly}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}

      {preview ? (
        <div className={kit.stack} style={{ marginTop: 'var(--space-3)' }}>
          <p className={styles.hint}>
            <strong>{fileName}</strong>
            {preview.kind
              ? `: ${preview.kind === 'daily' ? 'daily totals' : 'foods, added up per day'}`
              : ''}
            {found.length > 0 ? ` · found ${found.join(', ')}` : ''}.
          </p>
          {preview.warnings.length > 0 ? (
            <details className={styles.hint}>
              <summary>
                {preview.warnings.length} note{preview.warnings.length > 1 ? 's' : ''}
              </summary>
              <ul>
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <p>
            {(Object.keys(STATUS) as CronometerDayStatus[])
              .filter((s) => preview.counts[s] > 0)
              .map((s) => (
                <span key={s} style={{ marginRight: 6 }}>
                  <Badge tone={STATUS[s].tone}>
                    {preview.counts[s]} {STATUS[s].label.toLowerCase()}
                  </Badge>
                </span>
              ))}
          </p>
          <ul className={styles.days}>
            {preview.days
              .slice(-14)
              .reverse()
              .map((d) => (
                <li key={d.day.date}>
                  <span>
                    {formatDate(d.day.date)}
                    <span className={styles.hint}> {macros(d.values)}</span>
                    {d.status === 'update' && d.existing ? (
                      <span className={styles.hint}> (was {macros(d.existing) || 'empty'})</span>
                    ) : null}
                    {d.problems.length > 0 ? (
                      <span className={styles.error}> {d.problems.join('; ')}</span>
                    ) : null}
                  </span>
                  <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                </li>
              ))}
          </ul>
          {preview.days.length > 14 ? (
            <p className={styles.hint}>Showing the latest 14 of {preview.days.length} days.</p>
          ) : null}
          <Button
            variant="primary"
            block
            disabled={writable === 0 || run.pending}
            onClick={() => void onImport()}
          >
            {writable === 0
              ? 'Nothing new to import'
              : `Import ${writable} day${writable > 1 ? 's' : ''}`}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
