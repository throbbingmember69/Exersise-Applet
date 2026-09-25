import { LinkList, LinkRow, PageHeader, Stack } from '@/ui/kit'

export default function More() {
  return (
    <>
      <PageHeader title="More" />
      <Stack>
        <LinkList>
          <LinkRow to="/program" icon="list" label="Program" hint="Days, slots and rep ranges" />
          <LinkRow to="/program/exercises" icon="train" label="Exercise library" />
          <LinkRow to="/program/gyms" icon="swap" label="Gyms" hint="Per-gym exercise swaps" />
        </LinkList>
        <LinkList>
          <LinkRow to="/settings" icon="settings" label="Settings" hint="Rule thresholds" />
          <LinkRow to="/settings/profile" icon="body" label="Profile" hint="Age, height, units" />
          <LinkRow
            to="/settings/data"
            icon="download"
            label="Data & backup"
            hint="Backup, restore, CSV"
          />
        </LinkList>
      </Stack>
    </>
  )
}
