import { useState } from 'react'
import { useCommand, useCtx, useUnits } from '@/app/hooks'
import type { MassUnit } from '@/domain/scaleCsv'
import { formatMassWithUnit } from '@/domain/units'
import { SpreadsheetError } from '@/domain/xlsx'
import { IMPORT_FILE_ACCEPT, readTableFile } from '@/platform/spreadsheet'
import { isServiceError } from '@/services/errors'
import {
  importScaleReadings,
  previewScaleImport,
  type ImportDayStatus,
  type ScaleImportPreview,
} from '@/services/nutrition/scaleImport'
import { formatDate } from '@/ui/format'
import { Badge, Button, Card, Toggle, type Tone } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import styles from './data.module.css'

const STATUS: Record<ImportDayStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'good' },
  update: { label: 'Update', tone: 'accent' },
  same: { label: 'Already there', tone: 'neutral' },
  exists: { label: 'Kept yours', tone: 'neutral' },
  future: { label: 'Future date', tone: 'warn' },
  invalid: { label: 'No usable values', tone: 'warn' },
}

const ORDER_TEXT = {
  YMD: 'year-month-day',
  MDY: 'month/day/year',
  DMY: 'day/month/year',
  named: 'month name',
}

/**
 * Import a smart-scale export (Arboleaf app: History → clock icon → Export, an Excel file; CSV
 * works too). Shows what was recognized and what each day will do before writing anything.
 */
export default function ScaleImportCard() {
  const ctx = useCtx()
  const units = useUnits()
  const [text, setText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [unit, setUnit] = useState<MassUnit | undefined>(undefined)
  const [keep, setKeep] = useState(false)
  const [preview, setPreview] = useState<ScaleImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCommand(importScaleReadings)

  const refresh = async (t: string, u: MassUnit | undefined, k: boolean) => {
    try {
      setPreview(await previewScaleImport(ctx, { text: t, massUnit: u, replaceExisting: !k }))
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
    setUnit(undefined)
    setKeep(false)
    await refresh(t, undefined, false)
  }

  const onImport = async () => {
    if (text === null) return
    const result = await run.run({ text, massUnit: unit, replaceExisting: !keep })
    if (!result) return
    await refresh(text, unit, keep)
  }

  const writable = preview ? preview.counts.new + preview.counts.update : 0

  return (
    <Card title="Import from your smart scale">
      <p className={styles.hint}>
        In the Arboleaf app: History → clock icon → Export, then pick the Excel file here (a CSV
        works too). Each day uses your earliest weigh-in (the morning one), and it replaces what you
        typed for that day.
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
            <strong>{fileName}</strong>: found{' '}
            {Object.entries(preview.recognized)
              .filter(([k]) => k !== 'date')
              .map(([, h]) => h)
              .join(', ') || 'no usable columns'}
            {preview.dateOrder ? ` · dates read as ${ORDER_TEXT[preview.dateOrder]}` : ''}
            {preview.massUnit ? ` · weights in ${preview.massUnit}` : ''}.
          </p>
          {preview.needsUnit || unit ? (
            <div className={kit.chips} role="group" aria-label="Weight unit in the file">
              {(['lb', 'kg'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  className={kit.chip}
                  aria-pressed={(unit ?? preview.massUnit) === u}
                  onClick={() => {
                    setUnit(u)
                    void refresh(text!, u, keep)
                  }}
                >
                  Weights in {u}
                </button>
              ))}
            </div>
          ) : null}
          {preview.warnings.length > 0 ? (
            <details className={styles.hint}>
              <summary>{preview.warnings.length} rows skipped</summary>
              <ul>
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <p>
            {(Object.keys(STATUS) as ImportDayStatus[])
              .filter((s) => preview.counts[s] > 0)
              .map((s) => (
                <span key={s} style={{ marginRight: 6 }}>
                  <Badge tone={STATUS[s].tone}>
                    {preview.counts[s]} {STATUS[s].label.toLowerCase()}
                  </Badge>
                </span>
              ))}
          </p>
          <Toggle
            label="Keep days I entered by hand"
            hint="Otherwise the scale’s reading replaces a day you already logged"
            checked={keep}
            onChange={(v) => {
              setKeep(v)
              void refresh(text!, unit, v)
            }}
          />
          <ul className={styles.days}>
            {preview.days
              .slice(-14)
              .reverse()
              .map((d) => (
                <li key={d.reading.date}>
                  <span>
                    {formatDate(d.reading.date)}
                    <span className={styles.hint}>
                      {' '}
                      {d.values.weightLb !== null
                        ? formatMassWithUnit(d.values.weightLb, units)
                        : ''}
                      {d.values.bodyFatPct !== null ? ` · ${d.values.bodyFatPct}%` : ''}
                    </span>
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
            disabled={writable === 0 || (preview.needsUnit && !unit) || run.pending}
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
