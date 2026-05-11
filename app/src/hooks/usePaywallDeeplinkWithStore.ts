import { useCallback } from 'react'

import { usePaywallDeeplink } from '@/hooks/usePaywallDeeplink'
import type { PaywallType } from '@/lib/paywall/shared'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface UsePaywallDeeplinkWithStoreOptions {
  enabled?: boolean
}

/**
 * Convenience wrapper that wires usePaywallDeeplink to useDevelopPageStore.openUpgradeModal.
 * Use this in pages that have access to the develop page store.
 *
 * Note: The `type` parameter from the deeplink is ignored because openUpgradeModal
 * only supports the upgrade flow (not credits).
 */
export function usePaywallDeeplinkWithStore({
  enabled = true,
}: UsePaywallDeeplinkWithStoreOptions = {}): void {
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)

  const handleOpenPaywall = useCallback(
    (source: string, _type?: PaywallType, itc?: string) => openUpgradeModal(source, itc),
    [openUpgradeModal]
  )

  usePaywallDeeplink({
    openPaywall: handleOpenPaywall,
    enabled,
  })
}
