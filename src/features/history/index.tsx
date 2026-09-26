import { useState } from 'react'
import { useLive } from '@/app/hooks'
import { listSessions } from '@/services/training/queries'
import { formatDate } from '@/ui/format'
import {
  Badge,
  ButtonLink,
  EmptyState,
  LinkList,
  LinkRow,
  PageHeader,
  Stack,
  Toggle,
} from '@/ui/kit'
import Spinner from '@/ui/Spinner'

export default function History() {
  const [showDeleted, setShowDeleted] = useState(false)
  const { data: sessions } = useLive(
    (ctx) => listSessions(ctx, { includeVoided: showDeleted }),
    [showDeleted],
  )

  return (
    <>
      <PageHeader title="History" back="/train" />
      <Stack>
        <Toggle label="Show deleted sessions" checked={showDeleted} onChange={setShowDeleted} />
        {sessions === undefined ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            action={<ButtonLink to="/train/start">Start workout</ButtonLink>}
          >
            Every workout you log shows up here.
          </EmptyState>
        ) : (
          <LinkList>
            {sessions.map((s) => (
              <LinkRow
                key={s.id}
                to={
                  s.status === 'in_progress' ? `/train/session/${s.id}` : `/train/history/${s.id}`
                }
                label={`${formatDate(s.date)} · ${s.dayName}`}
                hint={`${s.gymName} · ${s.workingSets} sets${s.edited ? ' · edited' : ''}`}
                trailing={
                  s.voided ? (
                    <Badge tone="bad">Deleted</Badge>
                  ) : s.status === 'in_progress' ? (
                    <Badge tone="accent">In progress</Badge>
                  ) : s.status === 'abandoned' ? (
                    <Badge>Abandoned</Badge>
                  ) : s.isDeload ? (
                    <Badge>Deload</Badge>
                  ) : undefined
                }
              />
            ))}
          </LinkList>
        )}
      </Stack>
    </>
  )
}
