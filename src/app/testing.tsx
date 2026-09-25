// Test harness for screens: a seeded throwaway database, a fixed clock, the app providers and a
// memory router. Tests only.
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { createTestCtx } from '@/services/context'
import ServicesProvider from './ServicesProvider'
import ToastProvider from './ToastProvider'

export type TestCtx = ReturnType<typeof createTestCtx>

/**
 * Render `element` at `path` (matching `route`, e.g. '/train/session/:id'). Extra routes let
 * navigation targets render something assertable.
 */
export function renderScreen(
  element: ReactElement,
  opts: {
    ctx?: TestCtx
    route?: string
    path?: string
    extraRoutes?: RouteObject[]
  } = {},
) {
  const ctx = opts.ctx ?? createTestCtx()
  const route = opts.route ?? '/'
  const router = createMemoryRouter(
    [
      { path: route, element },
      ...(opts.extraRoutes ?? []),
      { path: '*', element: <p>Navigated elsewhere</p> },
    ],
    { initialEntries: [opts.path ?? route] },
  )
  const utils = render(
    <ServicesProvider ctx={ctx}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ServicesProvider>,
  )
  return { ...utils, ctx, router }
}

/** Close and delete a test database. */
export async function disposeCtx(ctx: TestCtx): Promise<void> {
  ctx.db.close()
  await ctx.db.delete()
}
