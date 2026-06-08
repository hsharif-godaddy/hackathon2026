'use client'

import { memo, useCallback } from 'react'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useIsCreditPolling } from '@/hooks/useCreditPurchase'
import { useSubscriptionWithPolling } from '@/hooks/useSubscriptionWithPolling'
import { shipAnalyticsLog } from '@/lib/logging'
import { usePaywallStore } from '@/stores/usePaywallStore'
import CreditsUpgradeContainer from './CreditsUpgradeContainer'
import { GrantPollingModal } from './GrantPollingModal'

interface DevelopCreditsModalProps {
  appId: string
}

/**
 * Isolated from DevelopPageContent and wrapped in React.memo to prevent
 * re-renders during streaming. The page component subscribes to streaming
 * state (messages, activeStream, etc.) which changes on every chunk. Without
 * memo, React re-renders this component on every parent render, creating new
 * callback references that cascade into the CDS ComponentLoader, causing it
 * to re-initialize and flash a loading spinner.
 */
export const DevelopCreditsModal = memo(function DevelopCreditsModal({ appId }: DevelopCreditsModalProps) {
  const showCreditsModal = usePaywallStore((state) => state.showCreditsModal)
  const creditsModalSource = usePaywallStore((state) => state.creditsModalSource)
  const creditsModalItc = usePaywallStore((state) => state.creditsModalItc)
  const closeCreditsModal = usePaywallStore((state) => state.closeCreditsModal)

  const {
    subscription,
    builderEntitlementId,
  } = useSubscriptionWithPolling()

  const { data: grantsData } = useCreditGrants({
    subscriptionId: subscription?.id,
    syncSpend: false,
  })

  const isCreditPolling = useIsCreditPolling()

  const handleSuccess = useCallback(() => {
    closeCreditsModal()
  }, [closeCreditsModal])

  const handleClose = useCallback(() => {
    closeCreditsModal()
    shipAnalyticsLog(`${creditsModalSource ?? 'unknown'}.dismissed`, { appId })
  }, [closeCreditsModal, creditsModalSource, appId])

  const handleErrorClick = useCallback(() => {
    closeCreditsModal()
    shipAnalyticsLog(`${creditsModalSource ?? 'unknown'}.error`, { appId })
  }, [closeCreditsModal, creditsModalSource, appId])

  return (
    <>
      {isCreditPolling && <GrantPollingModal />}

      {showCreditsModal && builderEntitlementId && subscription?.id && (
        <CreditsUpgradeContainer
          entitlementId={builderEntitlementId}
          subscriptionId={subscription.id}
          initialGrantCount={grantsData?.length ?? 0}
          source={creditsModalSource ?? 'unknown'}
          itc={creditsModalItc ?? undefined}
          onSuccess={handleSuccess}
          onClose={handleClose}
          onErrorClick={handleErrorClick}
        />
      )}
    </>
  )
})
