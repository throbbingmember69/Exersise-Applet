import { createContext } from 'react'

export type ToastTone = 'neutral' | 'good' | 'bad'

export interface ToastApi {
  show: (message: string, opts?: { tone?: ToastTone; durationMs?: number }) => void
}

export const ToastContext = createContext<ToastApi>({ show: () => {} })
