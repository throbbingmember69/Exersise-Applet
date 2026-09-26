import { useState } from 'react'
import { useCommand, useLive } from '@/app/hooks'
import {
  outOfEvidenceRange,
  SETTINGS_REGISTRY,
  type SettingGroup,
  type SettingMeta,
  type SettingKey,
} from '@/domain/settings/registry'
import {
  loadSettingOverrides,
  loadSettings,
  resetSettings,
  updateSettings,
} from '@/services/settings'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { Badge, Button, Card, PageHeader, Stack } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import Sheet from '@/ui/Sheet'
import Spinner from '@/ui/Spinner'
import styles from './settings.module.css'

const GROUPS: Record<SettingGroup, string> = {
  energy: 'Maintenance and trend',
  rateBands: 'Rate bands (% bodyweight per week)',
  macros: 'Protein, fat and rounding',
  checkin: 'Weekly check-in',
  body: 'Body data',
  phases: 'Phases',
  volume: 'Volume',
  progression: 'Progression',
  deload: 'Deload',
  app: 'App',
}

function decimalsOf(step: number): number {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1]!.length : 0
}

function show(v: number, m: SettingMeta): string {
  return `${Number(v.toFixed(decimalsOf(m.step)))}${m.unit ? ` ${m.unit}` : ''}`
}

export default function Settings() {
  const { data: settings } = useLive((ctx) => loadSettings(ctx), [])
  const { data: overrides } = useLive((ctx) => loadSettingOverrides(ctx), [])
  const [editing, setEditing] = useState<SettingMeta | null>(null)
  const [resetAll, setResetAll] = useState(false)
  const reset = useCommand(resetSettings, { success: 'All settings back to defaults' })

  if (!settings || !overrides) return <Spinner />
  const groups = Object.keys(GROUPS) as SettingGroup[]

  return (
    <>
      <PageHeader title="Settings" back="/more" />
      <p className={styles.hint}>
        Every rule threshold. <Badge tone="accent">Evidence</Badge> values come from the studies in
        the spec; <Badge>Heuristic</Badge> values are practical defaults. All are editable.
      </p>
      <Stack>
        {groups.map((g) => (
          <Card key={g} title={GROUPS[g]}>
            <ul className={styles.list}>
              {SETTINGS_REGISTRY.filter((m) => m.group === g).map((m) => {
                const value = settings[m.key]
                const changed = m.key in overrides
                return (
                  <li key={m.key}>
                    <button type="button" className={styles.row} onClick={() => setEditing(m)}>
                      <span>
                        {m.label}
                        {changed ? <span className={styles.changed}> · changed</span> : null}
                      </span>
                      <span className={styles.value}>
                        {show(value, m)}{' '}
                        <Badge tone={m.tag === 'Evidence' ? 'accent' : 'neutral'}>
                          {m.tag === 'Evidence' ? 'E' : 'H'}
                        </Badge>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
        ))}
        <Button variant="danger" block onClick={() => setResetAll(true)}>
          Reset all to defaults
        </Button>
      </Stack>

      <Sheet
        open={editing !== null}
        title={editing?.label ?? 'Setting'}
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <SettingForm
            key={editing.key}
            meta={editing}
            value={settings[editing.key as SettingKey]}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={resetAll}
        title="Reset every setting?"
        danger
        confirmLabel="Reset"
        onCancel={() => setResetAll(false)}
        onConfirm={() => {
          setResetAll(false)
          void reset.run()
        }}
      >
        Your data isn’t touched; only the thresholds go back to the defaults.
      </ConfirmDialog>
    </>
  )
}

function SettingForm({
  meta,
  value,
  onClose,
}: {
  meta: SettingMeta
  value: number
  onClose: () => void
}) {
  const [v, setV] = useState<number | null>(value)
  const save = useCommand(updateSettings, { success: 'Saved' })
  const reset = useCommand(resetSettings)
  const outside = v !== null && outOfEvidenceRange(meta.key as SettingKey, v)
  return (
    <div className={kit.stack}>
      <p className={styles.hint}>
        <Badge tone={meta.tag === 'Evidence' ? 'accent' : 'neutral'}>{meta.tag}</Badge> {meta.help}
      </p>
      <NumberStepper
        label={meta.label}
        value={v}
        onChange={setV}
        step={meta.step}
        min={meta.min}
        max={meta.max}
        decimals={decimalsOf(meta.step)}
      />
      <p className={styles.hint}>
        Default {show(meta.default, meta)} · allowed {meta.min}–{meta.max}
        {meta.evidenceRange
          ? ` · evidence range ${meta.evidenceRange[0]}–${meta.evidenceRange[1]}`
          : ''}
      </p>
      {outside ? (
        <p>
          <Badge tone="warn">Outside the evidence range</Badge>
        </p>
      ) : null}
      <div className={kit.actions}>
        <Button
          onClick={() => void reset.tryRun([meta.key as SettingKey]).then((ok) => ok && onClose())}
        >
          Use default
        </Button>
        <Button
          variant="primary"
          disabled={v === null}
          onClick={() =>
            void save
              .tryRun({ [meta.key]: v } as Partial<Record<SettingKey, number>>)
              .then((ok) => ok && onClose())
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}
