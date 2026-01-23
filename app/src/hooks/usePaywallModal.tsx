import { JSX,useCallback, useState } from "react";
import { useQueryClient } from '@tanstack/react-query';

import SinglePlanUpgradeContainer from '@/app/develop/components/SinglePlanUpgradeContainer'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { entitlementPollingService } from '@/services/EntitlementPollingService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { usePaywallEligibility } from './usePaywallEligibility'
import { useSwitchboard } from './useSwitchboard'

interface UsePaywallModalOptions {
  appId: string | undefined
  source: string
  onPurchaseSuccess?: () => Promise<void>
}

interface UsePaywallModalReturn {
  checkAndShowPaywall: (action: () => Promise<void>) => Promise<void>
  PaywallModal: () => JSX.Element | null
  isPolling: boolean
  shouldShowPaywall: boolean
}

/**
 * Hook for managing paywall modal state and flow
 *
 * Encapsulates all the common paywall UI orchestration logic:
 * - Modal visibility state
 * - Entitlements polling after purchase
 * - Switchboard flag checks
 * - Analytics logging
 * - Purchase success handling
 *
 * @example
 * ```tsx
 * const { checkAndShowPaywall, PaywallModal, isPolling } = usePaywallModal({
 *   appId,
 *   source: 'download'
 * })
 *
 * const handleDownload = async () => {
 *   await checkAndShowPaywall(async () => {
 *     await download(appId)
 *   })
 * }
 *
 * return (
 *   <>
 *     <PaywallModal />
 *     <Button disabled={isPolling} onClick={handleDownload} />
 *   </>
 * )
 * ```
 */
export function usePaywallModal({
  appId,
  source,
  onPurchaseSuccess,
}: UsePaywallModalOptions): UsePaywallModalReturn {
  const [showAiroPlusPaywall, setShowAiroPlusPaywall] = useState(false)
  const [hasCompletedPurchase, setHasCompletedPurchase] = useState(false)
  const queryClient = useQueryClient()
  const isPollingEntitlements = useDevelopPageStore((state) => state.isPollingEntitlements)
  const setIsPollingEntitlements = useDevelopPageStore((state) => state.setIsPollingEntitlements)
  const { data: isAiroPlusPaywallEnabled } = useSwitchboard('appbuilder-airoplus-paywall')
  const { data: isPaywallEnabledInMarket } = useSwitchboard('appbuilder-airoplus-markets')
  const { showPaywall } = usePaywallEligibility(appId)
  const site = useSiteStore((state) => (appId ? state.getSite(appId) : null))

  const logInAppPurchase = useCallback(
    (subscriptionId: string, entitlementId: string) => {
      shipAnalyticsLog('airoplus.purchase.in-app', {
        appId,
        subscriptionId,
        entitlementId,
        source: `${source}-paywall`,
        appName: site?.name,
      })
    },
    [appId, source, site?.name]
  )

  const handlePurchaseSuccess = useCallback(async () => {
    setShowAiroPlusPaywall(false)
    setIsPollingEntitlements(true)

    const result = await entitlementPollingService.pollForEntitlements(appId)
    setIsPollingEntitlements(false)

    if (result.success) {
      if (result.data) {
        logInAppPurchase(result.data.subscriptionId, result.data.entitlementId)
      }
      setHasCompletedPurchase(true)

      // Regenerate JWT with fresh permissions after successful purchase
      // This ensures the user immediately gets canDownload and canPublish permissions
      try {
        logger.info('paywall-modal.regenerating-jwt', { appId, reason: 'subscription_purchased' })
        await regenerateToken({ siteId: appId, force: true })
        logger.info('paywall-modal.jwt-regenerated', { appId })
      } catch (jwtError) {
        // Non-critical - log but continue
        // Token will be regenerated on next download/publish attempt
        logger.warn('paywall-modal.jwt-regeneration-failed', {
          appId,
          error: jwtError instanceof Error ? jwtError.message : String(jwtError),
        })
      }

      // Invalidate paywall eligibility query to update UI immediately
      await queryClient.invalidateQueries({
        queryKey: ['paywall-eligibility', appId],
        refetchType: 'active',
      })

      // Execute optional post-purchase callback
      if (onPurchaseSuccess) {
        await onPurchaseSuccess()
      }
    } else {
      logger.error('paywall-modal.entitlements.polling.failed', {
        appId,
        source,
        error: result.error,
      })
    }
  }, [appId, source, logInAppPurchase, setIsPollingEntitlements, onPurchaseSuccess, queryClient])

  const checkAndShowPaywall = useCallback(
    async (action: () => Promise<void>) => {
      if (!appId) return

      // Show paywall only if not completed purchase and showPaywall is true
      const shouldShowPaywall = !hasCompletedPurchase && showPaywall

      if (isAiroPlusPaywallEnabled && isPaywallEnabledInMarket && shouldShowPaywall) {
        setShowAiroPlusPaywall(true)
        shipAnalyticsLog('airoplus.paywall.shown', {
          appId,
          appName: site?.name,
          source,
        })
        return
      }

      // Execute action if paywall not needed
      await action()
    },
    [
      appId,
      hasCompletedPurchase,
      showPaywall,
      isAiroPlusPaywallEnabled,
      isPaywallEnabledInMarket,
      site?.name,
      source,
    ]
  )

  const PaywallModal = useCallback(() => {
    if (!showAiroPlusPaywall) return null

    return (
      <SinglePlanUpgradeContainer
        onErrorClick={async () => {
          setShowAiroPlusPaywall(false)
          shipAnalyticsLog('airoplus.paywall.error', {
            appId,
            appName: site?.name,
            source,
          })
        }}
        onClose={() => {
          setShowAiroPlusPaywall(false)
          shipAnalyticsLog('airoplus.paywall.dismissed', {
            appId,
            appName: site?.name,
            source,
          })
        }}
        onSuccessClick={handlePurchaseSuccess}
      />
    )
  }, [showAiroPlusPaywall, appId, site?.name, source, handlePurchaseSuccess])

  return {
    checkAndShowPaywall,
    PaywallModal,
    isPolling: isPollingEntitlements,
    shouldShowPaywall: !hasCompletedPurchase && showPaywall,
  }
}
