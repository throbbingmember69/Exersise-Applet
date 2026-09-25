import { EmptyState, PageHeader } from './kit'

/** Stand-in for screens that are still being built. */
export default function Placeholder({
  title,
  back,
  description,
}: {
  title: string
  back?: string | true
  description: string
}) {
  return (
    <>
      <PageHeader title={title} back={back} />
      <EmptyState title="Coming soon">{description}</EmptyState>
    </>
  )
}
