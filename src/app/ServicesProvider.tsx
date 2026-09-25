import type { ReactNode } from 'react'
import type { ServiceCtx } from '@/services/context'
import { ServicesContext } from './servicesContext'

export default function ServicesProvider({
  ctx,
  children,
}: {
  ctx: ServiceCtx
  children: ReactNode
}) {
  return <ServicesContext.Provider value={ctx}>{children}</ServicesContext.Provider>
}
