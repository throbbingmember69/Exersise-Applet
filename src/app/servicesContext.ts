import { createContext } from 'react'
import type { ServiceCtx } from '@/services/context'

/** The service context (database, clock, ids) for the running app or a test. */
export const ServicesContext = createContext<ServiceCtx | null>(null)
