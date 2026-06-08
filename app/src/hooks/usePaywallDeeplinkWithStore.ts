import { useCallback } from 'react'

import { usePaywallDeeplink } from '@/hooks/usePaywallDeeplink'
import type { PaywallType } from '@/lib/paywall/shared'
import { usePaywallStore } from '@/stores/usePaywallStore'

interface UsePaywallDeeplinkWithStoreOptions {
  enabled?: boolean
}

/**
 * Convenience wrapper that wires usePaywallDeeplink to usePaywallStore.openUpgradeModal.
 *
 * Note: The `type` parameter from the deeplink is ignored because openUpgradeModal
 * only supports the upgrade flow (not credits).
 */
export function usePaywallDeeplinkWithStore({
  enabled = true,
}: UsePaywallDeeplinkWithStoreOptions = {}): void {
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal)

  const handleOpenPaywall = useCallback(
    (source: string, _type?: PaywallType, itc?: string) => openUpgradeModal(source, itc),
    [openUpgradeModal]
  )

  usePaywallDeeplink({
    openPaywall: handleOpenPaywall,
    enabled,
  })
}
