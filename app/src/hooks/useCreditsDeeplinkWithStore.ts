import { useCallback } from 'react'

import { type DeeplinkSource } from '@/hooks/deeplinkParams'
import { useCreditsDeeplink } from '@/hooks/useCreditsDeeplink'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface UseCreditsDeeplinkWithStoreOptions {
  enabled?: boolean
}

/**
 * Convenience wrapper that wires useCreditsDeeplink to useDevelopPageStore.openCreditsModal.
 * Use on develop pages that render DevelopCreditsModal.
 */
export function useCreditsDeeplinkWithStore({
  enabled = true,
}: UseCreditsDeeplinkWithStoreOptions = {}): void {
  const openCreditsModal = useDevelopPageStore((state) => state.openCreditsModal)

  const handleOpenCredits = useCallback(
    (source: DeeplinkSource) => openCreditsModal(source, PAYWALL_ITC.CREDITS),
    [openCreditsModal]
  )

  useCreditsDeeplink({
    openCredits: handleOpenCredits,
    enabled,
  })
}
