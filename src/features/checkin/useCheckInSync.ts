import { useEffect } from 'react'
import { useCtx } from '@/app/hooks'
import type { LocalDate } from '@/domain/types'
import { syncCheckIns } from '@/services/nutrition/checkin'

/**
 * Bring weekly check-ins up to date for `today` (a command: queries can't write). Runs when the
 * screen mounts and when the day rolls over; failures are logged, not toasted (nothing the user
 * did caused them, and the check-in screen retries).
 */
export function useCheckInSync(today: LocalDate): void {
  const ctx = useCtx()
  useEffect(() => {
    syncCheckIns(ctx, { asOf: today }).catch((e: unknown) => console.error('check-in sync', e))
  }, [ctx, today])
}
