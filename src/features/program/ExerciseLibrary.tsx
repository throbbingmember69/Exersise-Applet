import { useMemo, useState } from 'react'
import { useLive } from '@/app/hooks'
import { getExerciseLibrary } from '@/services/program/queries'
import { Badge, ButtonLink, LinkList, LinkRow, PageHeader, Stack } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import Spinner from '@/ui/Spinner'

export default function ExerciseLibrary() {
  const { data: library } = useLive((ctx) => getExerciseLibrary(ctx), [])
  const [query, setQuery] = useState('')
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (library ?? []).filter(
      (e) =>
        q === '' ||
        e.exercise.name.toLowerCase().includes(q) ||
        e.muscles.some((m) => m.name.toLowerCase().includes(q)),
    )
  }, [library, query])

  return (
    <>
      <PageHeader title="Exercise library" back="/more" />
      <Stack>
        <ButtonLink to="/program/exercises/new" variant="primary" block icon="plus">
          New exercise
        </ButtonLink>
        <input
          className={kit.input}
          type="search"
          placeholder="Search exercises or muscles"
          aria-label="Search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {library === undefined ? (
          <Spinner />
        ) : (
          <LinkList>
            {list.map((e) => (
              <LinkRow
                key={e.exercise.id}
                to={`/program/exercises/${e.exercise.id}`}
                label={e.exercise.name}
                hint={
                  e.muscles
                    .filter((m) => m.weight === 1)
                    .map((m) => m.name)
                    .join(', ') +
                  (e.usedInSlots.length > 0
                    ? ` · in ${e.usedInSlots.length} slot${e.usedInSlots.length > 1 ? 's' : ''}`
                    : '')
                }
                trailing={
                  e.archived ? (
                    <Badge>Archived</Badge>
                  ) : e.exercise.isMainLift ? (
                    <Badge tone="accent">Main lift</Badge>
                  ) : e.exercise.isFinisher ? (
                    <Badge>Finisher</Badge>
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
