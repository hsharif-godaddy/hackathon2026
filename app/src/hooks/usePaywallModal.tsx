import React, { useCallback, useMemo, useState } from "react";
import { useQueryClient } from '@tanstack/react-query';

import { UpgradeContainer } from '@/app/[market]/develop/components/paywall'
import PublishLimitModal from '@/components/layout/PublishLimitModal'
import type { SiteInfo } from '@/lib/control-plane/types'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { logger } from '@/lib/request-context'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { SubscriptionPlan } from '@/types/credits'
import { usePaywallEligibility } from './usePaywallEligibility'
import { usePublishLimitCheck } from './usePublishLimitCheck'

interface UsePaywallModalOptions {
  appId?: string // Made optional for account-level subscriptions
  source: string
  /** Internal Tracking Code for purchase attribution */
  itc?: string
  onPurchaseSuccess?: () => Promise<void>
}

interface UsePaywallModalReturn {
  checkAndShowPaywall: (action: () => Promise<void>) => Promise<void>
  paywallModal: React.ReactElement | null
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
 * - Switchboard flag checks
 * - Analytics logging
 * - Purchase success handling
 *
 * @example
 * ```tsx
 * const { checkAndShowPaywall, paywallModal } = usePaywallModal({
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
 *     {paywallModal}
 *     <Button onClick={handleDownload} />
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
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal)
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(appId)
  const site = useSiteStore((state) => (appId ? state.getSite(appId) : null))
  const isSharedApp = Boolean(site?.sharedWithMe)

  // Publish limit check (only applies when source is 'publish', and not for shared apps
  // where the invitee is not the billing principal)
  const isPublishSource = source === 'publish'
  const {
    canPublish: canPublishWithLimit,
    isLoading: isPublishLimitLoading,
    confirmCanPublish,
  } = usePublishLimitCheck({ currentAppId: appId, enabled: isPublishSource && !isSharedApp })

  const handlePurchaseSuccess = useCallback(async () => {
    setShowAiroPlusPaywall(false)
    setHasCompletedPurchase(true)
    shipAnalyticsLog('builder.paywall.purchase_completed', { appId, source })

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
    ])

    // Execute optional post-purchase callback
    if (onPurchaseSuccess) {
      await onPurchaseSuccess()
    }
  }, [appId, onPurchaseSuccess, queryClient])

  const checkAndShowPaywall = useCallback(
    async (action: () => Promise<void>) => {
      // Owner-pays: invitees are not the billing principal — skip the paywall.
      if (isSharedApp) {
        await action()
        return
      }

      if (isPublishSource && !canPublishWithLimit) {
        if (isPublishLimitLoading) {
          return
        }
        // Cached deny may be stale. Re-confirm with fresh data before paywalling.
        // A thrown refetch error fails open (isError path below); a 404→active:null
        // still paywalls (legitimate "no subscription" response).
        const fresh = await confirmCanPublish()

        if (!fresh.canPublish && fresh.limit !== 0) {
          // Confirmed paid plan but at the app limit - show publish limit modal
          setPublishLimitData({
            plan: fresh.plan,
            currentCount: fresh.currentCount,
            limit: fresh.limit,
            publishedApps: fresh.publishedApps,
          })
          setShowPublishLimitModal(true)
          shipAnalyticsLog('publish.limit.modal.shown', {
            appId,
            plan: fresh.plan,
            currentCount: fresh.currentCount,
            limit: fresh.limit,
          })
          return
        }

        if (!fresh.hasPaidPlan) {
          if (fresh.isError) {
            // Refetch threw — can't confirm user is unpaid. Fail open; server FGA is the backstop.
            shipAnalyticsLog('builder.paywall.bypassed', {
              appId,
              source,
              reason: 'confirm_error',
            })
            await action()
            return
          }
          // Confirmed free / no plan / Airo Plus - paywall
          setShowAiroPlusPaywall(true)
          shipAnalyticsLog('builder.paywall.shown', {
            appId,
            source,
            plan: fresh.plan,
          })
          return
        }

        // Fresh data confirms a paid plan with capacity - execute the publish action.
        shipAnalyticsLog('builder.paywall.bypassed', {
          appId,
          source,
        })
        await action()
        return
      }

      // Show paywall only if not completed purchase and showPaywall is true
      const shouldShowPaywall = !hasCompletedPurchase && showPaywall

      if (shouldShowPaywall) {
        setShowAiroPlusPaywall(true)
        shipAnalyticsLog('builder.paywall.shown', {
          appId,
          source,
        })
        return
      }

      shipAnalyticsLog('builder.paywall.bypassed', {
        appId,
        source,
      })
      await action()
    },
    [
      appId,
      hasCompletedPurchase,
      showPaywall,
      source,
      isSharedApp,
      isPublishSource,
      isPublishLimitLoading,
      canPublishWithLimit,
      confirmCanPublish,
    ]
  )

  const paywallModal = useMemo(() => {
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
                plan: publishLimitData.plan,
            })
          }}
          onUpgrade={() => {
            setShowPublishLimitModal(false)
            setPublishLimitData(null)
            openUpgradeModal('publish_limit.upgrade_plan', PAYWALL_ITC.UPGRADE)
            shipAnalyticsLog('publish.limit.modal.upgrade_clicked', {
              appId,
                plan: publishLimitData.plan,
            })
          }}
        />
      )
    }

    if (!showAiroPlusPaywall) return null

    return (
      <UpgradeContainer
        source={source}
        itc={itc}
        onErrorClick={async () => {
          setShowAiroPlusPaywall(false)
          shipAnalyticsLog('builder.paywall.error', {
            appId,
            source,
          })
        }}
        onClose={() => {
          setShowAiroPlusPaywall(false)
          shipAnalyticsLog('builder.paywall.dismissed', {
            appId,
            source,
          })
        }}
        onSuccessClick={handlePurchaseSuccess}
      />
    )
  }, [showAiroPlusPaywall, showPublishLimitModal, publishLimitData, appId, source, itc, handlePurchaseSuccess, openUpgradeModal])

  return {
    checkAndShowPaywall,
    paywallModal,
    shouldShowPaywall: !isSharedApp && !hasCompletedPurchase && showPaywall,
    isPaywallLoading,
    isPublishLimitLoading,
  }
}
