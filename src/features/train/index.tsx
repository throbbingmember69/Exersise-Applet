import { ButtonLink, LinkList, LinkRow, PageHeader, Stack } from '@/ui/kit'

export default function Train() {
  return (
    <>
      <PageHeader title="Train" />
      <Stack>
        <ButtonLink to="/train/start" variant="primary" block icon="play">
          Start workout
        </ButtonLink>
        <LinkList>
          <LinkRow to="/train/history" icon="history" label="History" hint="Past sessions" />
          <LinkRow
            to="/train/progress"
            icon="chart"
            label="Progress"
            hint="e1RM trends and stalls"
          />
          <LinkRow
            to="/train/volume"
            icon="list"
            label="Weekly volume"
            hint="Sets per muscle vs the 10–20 band"
          />
        </LinkList>
      </Stack>
    </>
  )
}
