import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button, EmptyState } from './kit'

export default function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'
  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: 640, margin: '0 auto' }}>
      <EmptyState
        title="Something went wrong"
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      >
        {message}. Your data is safe on this device.
      </EmptyState>
    </main>
  )
}
