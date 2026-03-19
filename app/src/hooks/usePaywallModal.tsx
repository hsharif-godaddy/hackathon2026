import { JSX, useCallback, useState } from "react";
import { useQueryClient } from '@tanstack/react-query';

import { UpgradeContainer } from '@/app/develop/components/paywall'
import PublishLimitModal from '@/components/layout/PublishLimitModal'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { logger } from '@/lib/request-context'
import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter'
import { entitlementPollingService } from '@/services/EntitlementPollingService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { SubscriptionPlan } from '@/types/credits'
import { usePaywallEligibility } from './usePaywallEligibility'
import { usePublishLimitCheck } from './usePublishLimitCheck'
import { useSwitchboard } from './useSwitchboard'

interface UsePaywallModalOptions {
  appId?: string // Made optional for account-level subscriptions
  source: string
  /** Internal Tracking Code for purchase attribution */
  itc?: string
  onPurchaseSuccess?: () => Promise<void>
}

interface UsePaywallModalReturn {
  checkAndShowPaywall: (action: () => Promise<void>) => Promise<void>
  PaywallModal: () => JSX.Element | null
  isPolling: boolean
  shouldShowPaywall: boolean
  isPaywallLoading: boolean
  /** Whether publish limit check is loading */
  isPublishLimitLoading: boolean
}

/**
 * Hook for managing paywall modal state and flow
 *
 * Encapsulates all the common paywall UI orchestration logic:
 * - Modal visibility state
 * - Account-level entitlements polling after purchase
 * - Switchboard flag checks
 * - Analytics logging
 * - Purchase success handling
 *
 * @example
 * ```tsx
 * const { checkAndShowPaywall, PaywallModal, isPolling } = usePaywallModal({
 *   source: 'download',
 *   appId // Optional for logging
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
  itc,
  onPurchaseSuccess,
}: UsePaywallModalOptions): UsePaywallModalReturn {
  const [showAiroPlusPaywall, setShowAiroPlusPaywall] = useState(false)
  const [showPublishLimitModal, setShowPublishLimitModal] = useState(false)
  const [publishLimitData, setPublishLimitData] = useState<{
    plan: SubscriptionPlan | undefined;
    currentCount: number;
    limit: number | null;
    publishedApps: SiteInfo[];
  } | null>(null)
  const [hasCompletedPurchase, setHasCompletedPurchase] = useState(false)
  const queryClient = useQueryClient()
  const isPollingEntitlements = useDevelopPageStore((state) => state.isPollingEntitlements)
  const setIsPollingEntitlements = useDevelopPageStore((state) => state.setIsPollingEntitlements)
  const { data: isAiroPlusPaywallEnabled } = useSwitchboard('appbuilder-airoplus-paywall')
  const { data: isPaywallEnabledInMarket } = useSwitchboard('appbuilder-airoplus-markets')
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants')
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(appId)
  const site = useSiteStore((state) => (appId ? state.getSite(appId) : null))

  // Publish limit check (only applies when source is 'publish')
  const isPublishSource = source === 'publish'
  const {
    canPublish: canPublishWithLimit,
    currentCount,
    limit,
    plan,
    publishedApps,
    isLoading: isPublishLimitLoading,
  } = usePublishLimitCheck({ currentAppId: appId, enabled: isPublishSource })

  const logInAppPurchase = useCallback(
    (subscriptionId: string, entitlementId: string) => {
      shipAnalyticsLog('airoplus.purchase.success', {
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

    // Skip entitlements polling when grants are enabled - access is based on subscription plan only
    // Use explicit === false check to avoid polling while flag is loading (undefined)
    if (isGrantsEnabled === false) {
      setIsPollingEntitlements(true)

      const result = await entitlementPollingService.pollForAccountEntitlements()
      setIsPollingEntitlements(false)

      if (result.success && result.data) {
        logInAppPurchase(result.data.subscriptionId, result.data.entitlementId)
      }
    }

    setHasCompletedPurchase(true)

    // Regenerate JWT with fresh permissions after successful purchase if appId provided
    // This ensures the user immediately gets canDownload and canPublish permissions
    if (appId) {
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
    }

    // Invalidate paywall-related queries to update UI immediately
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
      queryClient.invalidateQueries({ queryKey: ['active-subscription'] }),
      queryClient.invalidateQueries({ queryKey: ['entitlements'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    ])

    // Execute optional post-purchase callback
    if (onPurchaseSuccess) {
      await onPurchaseSuccess()
    }
  }, [appId, isGrantsEnabled, logInAppPurchase, setIsPollingEntitlements, onPurchaseSuccess, queryClient])

  const checkAndShowPaywall = useCallback(
    async (action: () => Promise<void>) => {
      // For publish source, check publish limits first
      if (isPublishSource && !canPublishWithLimit) {
        // Free plan or no plan (limit === 0) - show paywall
        if (limit === 0) {
          if (isAiroPlusPaywallEnabled && isPaywallEnabledInMarket) {
            setShowAiroPlusPaywall(true)
            shipAnalyticsLog('airoplus.paywall.shown', {
              appId,
              appName: site?.name,
              source,
              plan,
            })
            return
          }
        } else {
          // Paid plan at limit - show publish limit modal
          setPublishLimitData({
            plan,
            currentCount,
            limit,
            publishedApps,
          })
          setShowPublishLimitModal(true)
          shipAnalyticsLog('publish.limit.modal.shown', {
            appId,
            appName: site?.name,
            plan,
            currentCount,
            limit,
          })
          return
        }
      }

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
      isPublishSource,
      canPublishWithLimit,
      plan,
      currentCount,
      limit,
      publishedApps,
    ]
  )

  const PaywallModal = useCallback(() => {
    // Show publish limit modal if applicable
    if (showPublishLimitModal && publishLimitData) {
      return (
        <PublishLimitModal
          plan={publishLimitData.plan}
          currentCount={publishLimitData.currentCount}
          limit={publishLimitData.limit}
          publishedApps={publishLimitData.publishedApps}
          onClose={() => {
            setShowPublishLimitModal(false)
            setPublishLimitData(null)
            shipAnalyticsLog('publish.limit.modal.dismissed', {
              appId,
              appName: site?.name,
              plan: publishLimitData.plan,
            })
          }}
          onUpgrade={() => {
            setShowPublishLimitModal(false)
            setPublishLimitData(null)
            openUpgradeModal('publish_limit.upgrade_plan', PAYWALL_ITC.UPGRADE)
            shipAnalyticsLog('publish.limit.modal.upgrade_clicked', {
              appId,
              appName: site?.name,
              plan: publishLimitData.plan,
            })
          }}
        />
      )
    }

    if (!showAiroPlusPaywall) {return null}

    return (
      <UpgradeContainer
        source={source}
        itc={itc}
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
  }, [showAiroPlusPaywall, showPublishLimitModal, publishLimitData, appId, site?.name, source, itc, handlePurchaseSuccess, openUpgradeModal])

  return {
    checkAndShowPaywall,
    PaywallModal,
    isPolling: isPollingEntitlements,
    shouldShowPaywall: !hasCompletedPurchase && showPaywall,
    isPaywallLoading,
    isPublishLimitLoading,
  }
}
