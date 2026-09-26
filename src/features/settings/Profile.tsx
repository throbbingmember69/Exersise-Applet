import { useState } from 'react'
import { useCommand, useLive, useToday } from '@/app/hooks'
import { ageOn } from '@/domain/dates'
import type { Sex, UnitSystem, UserProfile } from '@/domain/types'
import { cmToIn, inToCm } from '@/domain/units'
import { loadProfile, updateProfile } from '@/services/settings'
import { Button, Card, Field, PageHeader, Stack } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import Spinner from '@/ui/Spinner'

export default function Profile() {
  const { data: profile } = useLive((ctx) => loadProfile(ctx), [])
  if (!profile) return <Spinner />
  return <ProfileForm key={profile.updatedAt} profile={profile} />
}

function ProfileForm({ profile }: { profile: UserProfile }) {
  const today = useToday()
  const [name, setName] = useState(profile.name)
  const [sex, setSex] = useState<Sex>(profile.sex)
  const [age, setAge] = useState<number | null>(ageOn(profile, today))
  const [heightIn, setHeightIn] = useState<number | null>(profile.heightIn)
  const save = useCommand(updateProfile, { success: 'Profile saved' })
  const setUnits = useCommand(updateProfile)
  const metric = profile.units === 'kg'

  return (
    <>
      <PageHeader title="Profile" back="/more" />
      <Stack>
        <Card title="Display units">
          <div className={kit.chips} role="group" aria-label="Units">
            {(['lb', 'kg'] as UnitSystem[]).map((u) => (
              <button
                key={u}
                type="button"
                className={kit.chip}
                aria-pressed={profile.units === u}
                onClick={() => void setUnits.run({ units: u })}
              >
                {u === 'lb' ? 'lb · in' : 'kg · cm'}
              </button>
            ))}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 0 }}>
            Only changes how numbers are shown; your data is stored the same way.
          </p>
        </Card>
        <Card title="About you">
          <div className={kit.stack}>
            <Field label="Name" htmlFor="profile-name">
              <input
                id="profile-name"
                className={kit.input}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Sex" hint="Used by the Mifflin-St Jeor maintenance formula">
              <div className={kit.chips} role="group" aria-label="Sex">
                {(['male', 'female'] as Sex[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={kit.chip}
                    aria-pressed={sex === s}
                    onClick={() => setSex(s)}
                  >
                    {s === 'male' ? 'Male' : 'Female'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Age">
              <NumberStepper
                label="Age"
                value={age}
                onChange={setAge}
                step={1}
                min={13}
                max={100}
                decimals={0}
              />
            </Field>
            <Field label={metric ? 'Height (cm)' : 'Height (in)'}>
              <NumberStepper
                label="Height"
                value={
                  heightIn === null
                    ? null
                    : metric
                      ? Math.round(inToCm(heightIn) * 10) / 10
                      : heightIn
                }
                onChange={(v) => setHeightIn(v === null ? null : metric ? cmToIn(v) : v)}
                step={metric ? 1 : 0.5}
                min={metric ? 120 : 48}
                max={metric ? 230 : 90}
                decimals={1}
              />
            </Field>
          </div>
          <div className={kit.actions}>
            <Button
              variant="primary"
              disabled={age === null || heightIn === null}
              onClick={() =>
                void save.run({
                  name: name.trim(),
                  sex,
                  ageYears: age!,
                  ageAsOf: today,
                  birthDate: null,
                  heightIn: heightIn!,
                })
              }
            >
              Save
            </Button>
          </div>
        </Card>
      </Stack>
    </>
  )
}
