import { useState } from 'react'
import { useCommand, useLive } from '@/app/hooks'
import {
  archiveGym,
  createGym,
  renameGym,
  restoreGym,
  setGymSlotOverride,
} from '@/services/program/commands'
import { getGyms, type GymView } from '@/services/program/queries'
import { Badge, Button, Card, PageHeader, Stack } from '@/ui/kit'
import PromptSheet from '@/ui/PromptSheet'
import Spinner from '@/ui/Spinner'
import styles from './program.module.css'

/** Gym profiles: each gym can swap slots to its own exercises (set in a day's slot editor). */
export default function Gyms() {
  const { data: gyms } = useLive((ctx) => getGyms(ctx), [])
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<GymView | null>(null)
  const add = useCommand(createGym, { success: 'Gym added' })
  const rename = useCommand(renameGym)
  const archive = useCommand(archiveGym)
  const restore = useCommand(restoreGym)
  const clearOverride = useCommand(setGymSlotOverride)

  if (!gyms) return <Spinner />
  return (
    <>
      <PageHeader title="Gyms" back="/more" />
      <Stack>
        <p className={styles.hint} style={{ margin: 0 }}>
          Machines and cables keep separate loads per gym; dumbbells, barbells and chin-ups carry
          over. To use a different exercise at a gym, open a program day and edit the slot.
        </p>
        {gyms.map((g) => (
          <Card
            key={g.gym.id}
            title={
              <>
                {g.gym.name} {g.archived ? <Badge>Archived</Badge> : null}
              </>
            }
          >
            {g.overrides.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {g.overrides.map((o) => (
                  <li key={o.slotId} className={styles.slot}>
                    <span className={styles.slotMain}>
                      {o.dayName}: {o.slotLabel}
                      <div className={styles.hint}>→ {o.exercise.name}</div>
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => void clearOverride.run(g.gym.id, o.slotId, null)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.hint}>Uses the program’s exercises everywhere.</p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setRenaming(g)}>
                Rename
              </Button>
              {g.archived ? (
                <Button variant="ghost" onClick={() => void restore.run(g.gym.id)}>
                  Restore
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => void archive.run(g.gym.id)}>
                  Archive
                </Button>
              )}
            </div>
          </Card>
        ))}
        <Button block icon="plus" onClick={() => setAdding(true)}>
          Add gym
        </Button>
      </Stack>
      <PromptSheet
        open={adding}
        title="New gym"
        label="Name"
        confirmLabel="Add"
        onClose={() => setAdding(false)}
        onSubmit={(name) => void add.run(name).then(() => setAdding(false))}
      />
      <PromptSheet
        open={renaming !== null}
        title="Rename gym"
        label="Name"
        initial={renaming?.gym.name ?? ''}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => void rename.run(renaming!.gym.id, name).then(() => setRenaming(null))}
      />
    </>
  )
}
