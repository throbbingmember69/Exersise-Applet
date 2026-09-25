import { ButtonLink, EmptyState } from './kit'

export default function NotFound() {
  return (
    <EmptyState title="Page not found" action={<ButtonLink to="/">Go to Today</ButtonLink>}>
      That screen doesn’t exist.
    </EmptyState>
  )
}
