'use client'

import { UpgradeContainer } from '@/app/[market]/develop/components/paywall'
import { shipAnalyticsLog } from '@/lib/logging'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface UpgradeModalProps {
  analyticsData?: Record<string, unknown>
}

export function UpgradeModal({ analyticsData = {} }: UpgradeModalProps) {
  const showUpgradeModal = useDevelopPageStore((state) => state.showUpgradeModal)
  const upgradeModalSource = useDevelopPageStore((state) => state.upgradeModalSource)
  const upgradeModalItc = useDevelopPageStore((state) => state.upgradeModalItc)
  const closeUpgradeModal = useDevelopPageStore((state) => state.closeUpgradeModal)
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
