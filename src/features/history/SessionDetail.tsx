import { useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { useCommand, useLive, useUnits } from '@/app/hooks'
import { formatMassWithUnit } from '@/domain/units'
import {
  addSet,
  editSession,
  editSet,
  restoreSession,
  restoreSet,
  voidSession,
  voidSetInEdit,
} from '@/services/training/edit'
import { getSessionDetail, type SetView } from '@/services/training/queries'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { formatDate, formatLoad, formatRegime } from '@/ui/format'
import { Badge, Button, Card, EmptyState, Field, PageHeader, Stack, Toggle } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import MassInput from '@/ui/MassInput'
import Spinner from '@/ui/Spinner'
import SetEditor from '@/features/logger/SetEditor'
import styles from '@/features/logger/logger.module.css'

/** A past session: read-only, with an explicit Edit mode for fixing mistakes (DECISIONS #8). */
export default function SessionDetail() {
  const { id = '' } = useParams()
  const units = useUnits()
  const { data: detail } = useLive((ctx) => getSessionDetail(ctx, id), [id])
  const [editing, setEditing] = useState(false)
  const [askEdit, setAskEdit] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [editSetId, setEditSetId] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [bodyweight, setBodyweight] = useState<number | null | undefined>(undefined)

  const saveSet = useCommand(editSet)
  const deleteSet = useCommand(voidSetInEdit)
  const undeleteSet = useCommand(restoreSet)
  const newSet = useCommand(addSet)
  const saveSession = useCommand(editSession, { success: 'Session updated' })
  const del = useCommand(voidSession, { success: 'Session deleted' })
  const undelete = useCommand(restoreSession, { success: 'Session restored' })

  if (detail === undefined) return <Spinner />
  if (detail === null) {
    return (
      <>
        <PageHeader title="Session" back="/train/history" />
        <EmptyState title="Session not found" />
      </>
    )
  }
  const { session } = detail
  if (session.status === 'in_progress') return <Navigate to={`/train/session/${id}`} replace />

  const allSets = detail.exercises.flatMap((e) => e.sets.map((s) => ({ s, e })))
  const editingSet = allSets.find((x) => x.s.id === editSetId) ?? null
  const addingEx = detail.exercises.find((e) => e.sessionExerciseId === addingTo) ?? null
  const newSetDraft: SetView | null = addingEx
    ? {
        id: `new-${addingEx.sessionExerciseId}`,
        setIndex: addingEx.sets.length + addingEx.voidedSets.length,
        loadLb: addingEx.sets.at(-1)?.loadLb ?? addingEx.suggestion.loadLb ?? 0,
        reps: addingEx.prescription.repMin,
        rir: null,
        isWarmup: false,
        note: '',
        loggedAt: 0,
        edited: false,
      }
    : null

  return (
    <>
      <PageHeader
        title={detail.dayName}
        back="/train/history"
        actions={
          detail.voided ? null : editing ? (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Done
            </Button>
          ) : (
            <Button variant="ghost" icon="edit" onClick={() => setAskEdit(true)}>
              Edit
            </Button>
          )
        }
      />
      <p className={`${styles.muted} ${styles.small}`} style={{ marginTop: '-0.5rem' }}>
        {formatDate(session.date)} · {detail.gymName} · {detail.workingSetCount} sets
        {session.bodyweightLb !== null
          ? ` · BW ${formatMassWithUnit(session.bodyweightLb, units)}`
          : ''}
      </p>
      <Stack>
        {detail.voided ? (
          <Card>
            <p>
              <Badge tone="bad">Deleted</Badge> This session doesn’t count toward anything.
            </p>
            <Button block onClick={() => void undelete.run(id)}>
              Restore session
            </Button>
          </Card>
        ) : null}
        {session.status === 'abandoned' ? (
          <p className={styles.muted}>Abandoned: logged, but not counted toward progression.</p>
        ) : null}
        {session.note ? <Card title="Note">{session.note}</Card> : null}

        {detail.exercises.map((e) => (
          <Card key={e.sessionExerciseId}>
            <div className={styles.exerciseHeader}>
              <div>
                <h2 className={styles.exerciseTitle}>{e.exerciseName}</h2>
                <div className={`${styles.muted} ${styles.small}`}>
                  {formatRegime(e.prescription, e.prescription.sets)}
                </div>
              </div>
              {e.result.isPr ? <Badge tone="good">PR</Badge> : null}
            </div>
            {e.sets.length === 0 && e.voidedSets.length === 0 ? (
              <p className={styles.why}>Skipped</p>
            ) : (
              <ol className={styles.sets}>
                {e.sets.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={styles.setRow}
                      disabled={!editing}
                      onClick={() => setEditSetId(s.id)}
                      aria-label={`Set ${s.setIndex + 1}${editing ? ', edit' : ''}`}
                    >
                      <span className={styles.setIndex}>{s.isWarmup ? 'W' : s.setIndex + 1}</span>
                      <span>
                        {formatLoad(s.loadLb, e, units)} × {s.reps}
                        {s.rir !== null ? ` · RIR ${s.rir}` : ''}
                      </span>
                      <span className={styles.muted}>{s.edited ? 'edited' : ''}</span>
                    </button>
                  </li>
                ))}
                {editing
                  ? e.voidedSets.map((s) => (
                      <li key={s.id} className={styles.row}>
                        <span className={styles.muted}>
                          Deleted: {formatLoad(s.loadLb, e, units)} × {s.reps}
                        </span>
                        <Button variant="ghost" onClick={() => void undeleteSet.run(s.id)}>
                          Restore
                        </Button>
                      </li>
                    ))
                  : null}
              </ol>
            )}
            {editing ? (
              <Button variant="ghost" icon="plus" onClick={() => setAddingTo(e.sessionExerciseId)}>
                Add set
              </Button>
            ) : null}
          </Card>
        ))}

        {editing ? (
          <Card title="Session">
            <div className={kit.stack}>
              <Field label="Note" htmlFor="edit-note">
                <input
                  id="edit-note"
                  className={kit.input}
                  value={note ?? session.note}
                  maxLength={500}
                  onChange={(ev) => setNote(ev.target.value)}
                />
              </Field>
              <Field label={`Bodyweight (${units})`}>
                <MassInput
                  label="Bodyweight"
                  valueLb={bodyweight === undefined ? session.bodyweightLb : bodyweight}
                  onChangeLb={setBodyweight}
                  unit={units}
                  stepLb={0.5}
                />
              </Field>
              <Toggle
                label="Joint pain"
                checked={session.jointPain}
                onChange={(v) => void saveSession.run(id, { jointPain: v })}
              />
              <Toggle
                label="Deload session"
                checked={session.isDeload}
                onChange={(v) => void saveSession.run(id, { isDeload: v })}
              />
              <Toggle
                label="Abandoned (don’t count toward progression)"
                checked={session.status === 'abandoned'}
                onChange={(v) => void saveSession.run(id, { status: v ? 'abandoned' : 'finished' })}
              />
              <div className={kit.actions}>
                <Button
                  variant="primary"
                  disabled={note === null && bodyweight === undefined}
                  onClick={() =>
                    void saveSession
                      .run(id, {
                        ...(note !== null ? { note } : {}),
                        ...(bodyweight != null ? { bodyweightLb: bodyweight } : {}),
                      })
                      .then(() => {
                        setNote(null)
                        setBodyweight(undefined)
                      })
                  }
                >
                  Save changes
                </Button>
              </div>
              <Button variant="danger" block onClick={() => setAskDelete(true)}>
                Delete session
              </Button>
            </div>
          </Card>
        ) : null}
      </Stack>

      <SetEditor
        set={editingSet?.s ?? null}
        exercise={editingSet?.e ?? { loadType: 'machine', perHand: false }}
        unit={units}
        stepLb={editingSet?.e.prescription.stepLb ?? 5}
        onClose={() => setEditSetId(null)}
        onSave={(patch) => {
          if (editingSet) void saveSet.run(editingSet.s.id, patch)
          setEditSetId(null)
        }}
        onDelete={() => {
          if (editingSet) void deleteSet.run(editingSet.s.id)
          setEditSetId(null)
        }}
      />
      <SetEditor
        set={newSetDraft}
        exercise={addingEx ?? { loadType: 'machine', perHand: false }}
        unit={units}
        stepLb={addingEx?.prescription.stepLb ?? 5}
        onClose={() => setAddingTo(null)}
        onSave={(patch) => {
          if (addingEx) void newSet.run({ sessionExerciseId: addingEx.sessionExerciseId, ...patch })
          setAddingTo(null)
        }}
      />
      <ConfirmDialog
        open={askEdit}
        title="Edit this session?"
        confirmLabel="Edit"
        onCancel={() => setAskEdit(false)}
        onConfirm={() => {
          setAskEdit(false)
          setEditing(true)
        }}
      >
        Use this to fix mistakes. Suggestions for later sessions are recalculated from what you
        save.
      </ConfirmDialog>
      <ConfirmDialog
        open={askDelete}
        title="Delete this session?"
        danger
        confirmLabel="Delete"
        onCancel={() => setAskDelete(false)}
        onConfirm={() => {
          setAskDelete(false)
          setEditing(false)
          void del.run(id)
        }}
      >
        It stops counting toward progression, volume and charts. You can restore it from History
        (show deleted sessions).
      </ConfirmDialog>
    </>
  )
}
