'use client'

import { UpgradeContainer } from '@/app/[market]/develop/components/paywall'
import { shipAnalyticsLog } from '@/lib/logging'
import { usePaywallStore } from '@/stores/usePaywallStore'

interface UpgradeModalProps {
  analyticsData?: Record<string, unknown>
}

export function UpgradeModal({ analyticsData = {} }: UpgradeModalProps) {
  const showUpgradeModal = usePaywallStore((state) => state.showUpgradeModal)
  const upgradeModalSource = usePaywallStore((state) => state.upgradeModalSource)
  const upgradeModalItc = usePaywallStore((state) => state.upgradeModalItc)
  const closeUpgradeModal = usePaywallStore((state) => state.closeUpgradeModal)
  const source = upgradeModalSource ?? 'unknown'

  if (!showUpgradeModal) {
    return null
  }

  return (
    <UpgradeContainer
      source={source}
      itc={upgradeModalItc ?? undefined}
      onSuccessClick={closeUpgradeModal}
      onClose={() => {
        closeUpgradeModal()
        shipAnalyticsLog(`${source}.dismissed`, analyticsData)
      }}
      onErrorClick={() => {
        closeUpgradeModal()
        shipAnalyticsLog(`${source}.error`, analyticsData)
      }}
    />
  )
}
