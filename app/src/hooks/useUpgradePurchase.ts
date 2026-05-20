import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'

import { getErrorMessage } from '@/lib/errors'
import { invalidatePlanQueries, waitForQueryUpdate } from '@/lib/query-utils'
import { logger } from '@/lib/request-context'
import { type CreditGrant, GrantType } from '@/types/credits'

const PLAN_CHANGE_MUTATION_KEY = ['plan-change-polling'] as const

interface SubscriptionData {
  active?: {
    plan: string
    downgradedAt?: string
    downgradedPlan?: string
  }
}

interface PlanChangeParams {
  planBeforePurchase: string | undefined
  planAfterPurchase: string | undefined
  downgradedPlan: string | undefined
  isUpgrade: boolean
  source: string | undefined
  productId: string
  subscriptionId: string | undefined
  initialCreditsMax: number | undefined
}

interface PlanChangeResult {
  planAfterPurchase: string | undefined
  updated: boolean
  grantUpdated: boolean
}

export function useIsUpgradePolling(): boolean {
  return useIsMutating({ mutationKey: PLAN_CHANGE_MUTATION_KEY }) > 0
}

interface UseUpgradePurchaseResult {
  handlePurchaseSuccess: (
    planBeforePurchase: string | undefined,
    planAfterPurchase: string | undefined,
    downgradedPlan: string | undefined,
    isUpgrade: boolean,
    source: string | undefined,
    productId: string,
    subscriptionId: string | undefined,
    initialCreditsMax: number | undefined
  ) => Promise<PlanChangeResult>
  isPolling: boolean
}

export function useUpgradePurchase(): UseUpgradePurchaseResult {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationKey: PLAN_CHANGE_MUTATION_KEY,
    mutationFn: async ({
      planBeforePurchase,
      planAfterPurchase,
      downgradedPlan,
      isUpgrade,
      source,
      productId,
      subscriptionId,
      initialCreditsMax,
    }: PlanChangeParams): Promise<PlanChangeResult> => {
      const changeType = isUpgrade ? 'upgrade' : 'downgrade'
      logger.info(`plan.${changeType}.polling-start`, {
        planBeforePurchase,
        planAfterPurchase,
        source,
        productId,
        ...(isUpgrade && { subscriptionId, initialCreditsMax }),
      })

      const updated = await waitForQueryUpdate<SubscriptionData>(
        queryClient,
        ['subscriptions'],
        (data) => {
          if (isUpgrade) {
            // For upgrades: wait for plan to change and if upgrading from downgraded plan, wait for downgradedPlan to not be set
            return data?.active?.plan === planAfterPurchase && (downgradedPlan ? data?.active?.downgradedPlan !== downgradedPlan : true)
          } else {
            // For downgrades: wait for downgradedAt and downgradedPlan to be set and if downgrading to different downgraded plan, wait for downgradedPlan to not be the same
            return (!!(data?.active?.downgradedAt && data?.active?.downgradedPlan) && (downgradedPlan ? data?.active?.downgradedPlan !== downgradedPlan : true))
          }
        },
        { maxAttempts: 30, intervalMs: 2000 }
      )

      const updatedData = queryClient.getQueryData<SubscriptionData>(['subscriptions'])
      const finalPlan = isUpgrade
        ? updatedData?.active?.plan
        : updatedData?.active?.downgradedPlan ?? planAfterPurchase

      if (updated) {
        logger.info(`plan.${changeType}.polling-complete`, {
          planBeforePurchase,
          planAfterPurchase: finalPlan,
          downgradedAt: updatedData?.active?.downgradedAt,
        })
      } else {
        logger.warn(`plan.${changeType}.polling-timeout`, {
          planBeforePurchase,
          planAfterPurchase,
          productId,
        })
      }

      // For upgrades: poll for grant creditsMax to increase after subscription is updated
      // Works for both BMS (same grant, creditsMax increases) and legacy (new grant with higher creditsMax)
      let grantUpdated = false
      if (isUpgrade && updated && subscriptionId) {
        if (planBeforePurchase === undefined) {
          // D2P/new subscription - no prior grant to compare against, skip grant polling
          logger.info('plan.upgrade.grant-polling-skipped', {
            subscriptionId,
            reason: 'new_subscription',
          })
        } else if (typeof initialCreditsMax !== 'number') {
          logger.warn('plan.upgrade.grant-polling-skipped', {
            subscriptionId,
            reason: 'initial_credits_max_not_found',
            initialCreditsMax,
          })
        } else {
          logger.info('plan.upgrade.grant-polling-start', {
            subscriptionId,
            initialCreditsMax,
          })

          grantUpdated = await waitForQueryUpdate<CreditGrant[]>(
            queryClient,
            ['credit-grants', subscriptionId, true],
            (grants) => {
              if (!grants || !Array.isArray(grants)) return false

              const currentPlanMonthlyGrant = grants.find(
                (g) => g.type === GrantType.PlanMonthly && g.isAvailable
              )

              if (!currentPlanMonthlyGrant) return false

              // Unified check: creditsMax increases after upgrade (works for both BMS and legacy)
              if (typeof currentPlanMonthlyGrant.creditsMax !== 'number') return false
              return currentPlanMonthlyGrant.creditsMax > initialCreditsMax
            },
            { maxAttempts: 15, intervalMs: 2000 }
          )

          if (grantUpdated) {
            logger.info('plan.upgrade.grant-polling-complete', {
              subscriptionId,
            })
          } else {
            const finalGrants = queryClient.getQueryData<CreditGrant[]>(['credit-grants', subscriptionId, true])
            const finalCreditsMax = finalGrants?.find(
              (g) => g.type === GrantType.PlanMonthly && g.isAvailable
            )?.creditsMax
            logger.warn('plan.upgrade.grant-polling-timeout', {
              subscriptionId,
              initialCreditsMax,
              finalCreditsMax,
            })
          }
        }
      }

      return { planAfterPurchase: finalPlan, updated, grantUpdated }
    },
    onSettled: () => {
      invalidatePlanQueries(queryClient)
    },
    onError: (error, { planBeforePurchase, isUpgrade }) => {
      const changeType = isUpgrade ? 'upgrade' : 'downgrade'
      logger.error(`plan.${changeType}.polling-error`, {
        planBeforePurchase,
        error: getErrorMessage(error),
      })
    },
  })

  const handlePurchaseSuccess = async (
    planBeforePurchase: string | undefined,
    planAfterPurchase: string | undefined,
    downgradedPlan: string | undefined,
    isUpgrade: boolean,
    source: string | undefined,
    productId: string,
    subscriptionId: string | undefined,
    initialCreditsMax: number | undefined
  ): Promise<PlanChangeResult> => {
    try {
      return await mutation.mutateAsync({
        planBeforePurchase,
        planAfterPurchase,
        downgradedPlan,
        isUpgrade,
        source,
        productId,
        subscriptionId,
        initialCreditsMax,
      })
    } catch (error) {
      logger.error('plan.purchase.handle-success-failed', {
        error: getErrorMessage(error),
      })
      return { planAfterPurchase: undefined, updated: false, grantUpdated: false }
    }
  }

  return {
    handlePurchaseSuccess,
    isPolling: mutation.isPending,
  }
}
