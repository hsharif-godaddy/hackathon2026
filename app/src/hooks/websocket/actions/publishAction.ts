/**
 * Publish Action Executor
 *
 * Executes the publish workflow for an app.
 * This is triggered by agents when the user requests to publish their site.
 */

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import {
  appDetailsQueryKey,
  type AppDetailsResponse,
  fetchAppDetails,
} from '@/hooks/useAppDetails'
import { appFetch } from '@/lib/gasket-config'
import { regenerateToken } from '@/lib/jwt-regeneration'
import type { AiroSubscription } from '@/lib/mgmt-airo/types'
import { ClientPaywallProvider } from '@/lib/paywall/client-provider'
import { checkPaywallEligibility, PaywallAction } from '@/lib/paywall/core'
import { PAYWALL_ITC, PaywallDenialReason } from '@/lib/paywall/shared'
import { logger } from '@/lib/request-context'
import {
  getPublishComplianceBlockReason,
  isPublishBlockedByComplianceRules,
  PublishComplianceBlockReason,
} from '@/lib/subscription'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logAiroHQEvent } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'
import type { ClientActionExecutor } from './types'

export const publishAction: ClientActionExecutor = async (params) => {
  const { appId } = params

  // Validate required parameters
  if (!appId || typeof appId !== 'string') {
    throw new Error('appId is required and must be a string')
  }

  try {
    // Check paywall eligibility using core algorithm with client provider
    const provider = new ClientPaywallProvider()
    const { hasAccess, reason, details } = await checkPaywallEligibility(provider, appId, PaywallAction.Publish)
    if (!hasAccess) {
      logger.warn('publish-action.access-denied', { appId, reason })

      try {
        const store = useDevelopPageStore.getState()

        // Check if it's a publish limit issue vs a paywall issue
        if (reason === PaywallDenialReason.PublishLimitReached) {
          // Fetch published apps and subscription data for the modal
          const [publishedAppsData, subscriptionData] = await Promise.all([
            provider.getPublishedApps(),
            provider.getAccountSubscription(),
          ])

          // Show publish limit modal
          store.setShowPublishLimitModal(appId, true, {
            plan: subscriptionData?.plan,
            currentCount: publishedAppsData.count,
            limit: details.publishLimit ?? null,
            publishedApps: publishedAppsData.apps ?? [],
          })
          // Track that limit modal blocked this publish (prevents error alert from showing)
          store.setShowPaywallModal(appId, true)
        } else {
          // Show paywall modal for other cases (no subscription, free plan, etc.)
          store.setShowPaywallModal(appId, true)
          store.openUpgradeModal('publish', PAYWALL_ITC.PUBLISH)
        }
      } catch (storeError) {
        logger.warn('publish-action.modal-trigger-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }

      throw new Error(reason || 'You need an Airo Plus subscription to publish. Upgrade to continue.')
    }

    const qc = getQueryClient()
    let appDetails: AppDetailsResponse | undefined
    if (qc) {
      try {
        await qc.invalidateQueries({ queryKey: ['app-details', appId] })
        appDetails = await qc.fetchQuery<AppDetailsResponse>({
          queryKey: appDetailsQueryKey(appId),
          queryFn: () => fetchAppDetails(appId),
        })
      } catch (error) {
        logger.warn('websocket.client-action.publish.app-details-for-compliance-failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (!appDetails) {
      try {
        appDetails = await fetchAppDetails(appId)
      } catch (error) {
        logger.error('websocket.client-action.publish.app-details-unavailable', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new Error('Failed to load app details for publish')
      }
    }
    const subCache = qc?.getQueryData<{ active: AiroSubscription | null }>(['subscriptions'])
    const subscription = subCache?.active ?? undefined
    const complianceFlag =
      qc?.getQueryData<boolean>(['featureFlag', 'appbuilder-suspended-compliance-banner']) === true
    if (isPublishBlockedByComplianceRules(appDetails, subscription, complianceFlag)) {
      const blockReason = getPublishComplianceBlockReason(appDetails, subscription, complianceFlag)
      logger.warn('publish-action.blocked-compliance', { appId, blockReason })
      throw new Error('Publish blocked: compliance suspension')
    }

    // Log publish analytics event (matches UI behavior)
    try {
      const isFirstTimePublishing = !hasBeenPublished(appDetails)
      const airoHQTask = isFirstTimePublishing
        ? 'builder_project_first_published'
        : 'builder_project_published'

      logAiroHQEvent({
        category: 'click',
        recommendation_task: airoHQTask,
        recommendation_type: 'publish',
        recommendation_id: appId,
      })()

      logger.info('websocket.client-action.publish.analytics-logged', {
        appId,
        task: airoHQTask,
        isFirstTime: isFirstTimePublishing,
      })
    } catch (analyticsError) {
      // Non-critical - log but continue with publish
      logger.warn('websocket.client-action.publish.analytics-failed', {
        appId,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
      })
    }

    // Clear any previous publish errors and set publishing state (matches UI behavior)
    // This immediately updates the button text to "Publishing..."
    try {
      const store = useDevelopPageStore.getState()

      // Perform both state updates atomically to prevent inconsistent UI state
      store.clearPublishStatus(appId)
      store.setIsPublishing(appId, true)
    } catch (storeError) {
      logger.warn('websocket.client-action.publish.initial-state-update-failed', {
        appId,
        error: storeError instanceof Error ? storeError.message : String(storeError),
      })

      // Attempt to restore consistent state if partial update occurred
      try {
        const store = useDevelopPageStore.getState()
        store.setIsPublishing(appId, false)
      } catch {
        // Ignore restoration errors - state will be corrected on next publish attempt
      }
    }

    logger.info('websocket.client-action.publish.begin', {
      appId,
    })

    // Sync secrets from preview to publish if enabled (matches UI behavior)
    try {
      const syncResponse = await appFetch(`/api/secrets/${appId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'preview',
          destination: 'publish',
        }),
      })

      if (!syncResponse.ok) {
        logger.warn('websocket.client-action.publish.secrets-sync-failed', {
          appId,
          status: syncResponse.status,
        })
      } else {
        await syncResponse.json() // Consume response
      }
    } catch (syncError) {
      // Non-critical - log but continue
      logger.warn('websocket.client-action.publish.secrets-sync-error', {
        appId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      })
    }

    // Regenerate JWT with fresh permissions before publish
    logger.info('websocket.client-action.publish.regenerate-token', { appId })
    const tokenResult = await regenerateToken({ siteId: appId, force: true })

    // Get agent URL for this site
    const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

    if (!apiConfig.agentUrl) {
      throw new Error('Agent URL not available for this site')
    }

    // Call agent service directly with fresh token
    const publishUrl = `${apiConfig.agentUrl}/apps/${appId}/publish`
    logger.info('websocket.client-action.publish.calling-agent', { appId, url: publishUrl })

    const response = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenResult.token}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))

      // If this is a build/runtime error with details or logs, store it for the UI to handle
      // This includes both 400 (build errors) and 500 (supervisor/runtime errors)
      if (errorData.details || errorData.logs) {
        try {
          const setBuildErrorDetails = useDevelopPageStore.getState().setBuildErrorDetails

          // Combine details and logs so the agent gets the full picture
          const logText = errorData.logs
            ? errorData.logs.map((log: any) => log.message || log).join('\n')
            : '';
          const errorDetails = [errorData.details, logText].filter(Boolean).join('\n\n') || 'Unknown error';

          setBuildErrorDetails(appId, {
            error: errorData.error || 'Publish failed',
            details: errorDetails,
            exitCode: errorData.exitCode,
          })

          logger.info('websocket.client-action.publish.error.build-error-stored', {
            appId,
            error: errorData.error,
            status: response.status,
            hasDetails: !!errorData.details,
            hasLogs: !!errorData.logs,
            exitCode: errorData.exitCode
          })
        } catch (storeError) {
          logger.warn('websocket.client-action.publish.error-store-failed', {
            appId,
            error: storeError instanceof Error ? storeError.message : String(storeError),
          })
        }
      }

      // Set error state and clear publishing state (matches UI behavior)
      // EXCEPT when paywall modal is showing - in that case, don't show error alert
      try {
        const store = useDevelopPageStore.getState()
        const showPaywallModal = store.publishStates[appId]?.showPaywallModal ?? false

        // Only set publish error if paywall modal is not showing
        // This prevents showing both paywall modal and error alert
        if (!showPaywallModal) {
          store.setPublishError(appId, true)
        }

        store.setIsPublishing(appId, false)
      } catch (storeError) {
        logger.warn('websocket.client-action.publish.error-state-update-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }

      logger.error('websocket.client-action.publish.failed', {
        appId,
        status: response.status,
        error: errorData.error,
      })

      // Create error with additional metadata attached
      const error: any = new Error(errorData.error || `Publish failed with status ${response.status}`)
      error.errorDetails = errorData.details
      error.logs = errorData.logs
      error.exitCode = errorData.exitCode
      throw error
    }

    const result = await response.json()

    // Store the commit hash from the response for retry functionality
    if (result.commitHash) {
      try {
        const setLastPublishedCommitHash = useDevelopPageStore.getState().setLastPublishedCommitHash
        setLastPublishedCommitHash(appId, result.commitHash)
      } catch (storeError) {
        logger.warn('websocket.client-action.publish.store-update-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }
    }

    // Step 3: Create deployment record via app service (secure, trusted service)
    // Only if archive was created successfully
    if (result.success && result.commitHash) {
      try {
        logger.info('websocket.client-action.publish.archive-created', {
          appId,
          commitHash: result.commitHash.substring(0, 7),
        })

        logger.info('websocket.client-action.publish.creating-deployment', {
          appId,
          commitHash: result.commitHash.substring(0, 7),
        })

        const deploymentResponse = await appFetch(`/api/apps/${appId}/deployments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            gitHash: result.commitHash,
          }),
        })

        if (!deploymentResponse.ok) {
          const deploymentError = await deploymentResponse.json().catch(() => ({
            error: 'Failed to create deployment',
          }))

          logger.warn('websocket.client-action.publish.deployment-creation-failed', {
            appId,
            status: deploymentResponse.status,
            error: deploymentError.error,
          })
          // Don't throw - archive was created successfully, deployment is secondary
        } else {
          const deploymentData = await deploymentResponse.json()
          result.deployment = deploymentData

          logger.info('websocket.client-action.publish.deployment-created', {
            appId,
            deploymentId: deploymentData.deploymentId,
            status: deploymentData.status,
          })
        }
      } catch (deploymentError) {
        logger.warn('websocket.client-action.publish.deployment-creation-error', {
          appId,
          error: deploymentError instanceof Error ? deploymentError.message : String(deploymentError),
        })
        // Don't throw - archive was created successfully
      }
    }

    logger.info('websocket.client-action.publish.success', {
      appId,
      commitHash: result.commitHash?.substring(0, 7),
      deploymentId: result.deployment?.deploymentId,
    })

    // Update UI state to trigger deployment polling (matches UI behavior)
    if (result.deployment?.deploymentId) {
      try {
        const setDeploymentInProgressId = useDevelopPageStore.getState().setDeploymentInProgressId
        setDeploymentInProgressId(appId, result.deployment.deploymentId)
      } catch (storeError) {
        logger.warn('websocket.client-action.publish.deployment-id-store-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }

      // Invalidate queries to refresh UI
      try {
        const queryClient = getQueryClient()
        if (queryClient) {
          // Invalidate git history to refresh commit list in history tab
          // Do NOT use refetchType: 'active' - we need to invalidate even if History tab is not currently open
          // so that when user switches to it, the query refetches with fresh data
          await queryClient.invalidateQueries({
            queryKey: ['git-history', appId],
          })

          // Invalidate deployments queries to trigger immediate refetch with polling
          await queryClient.invalidateQueries({
            queryKey: ['deployments', appId],
            refetchType: 'active',
          })
        } else {
          logger.warn('websocket.client-action.publish.no-query-client', {
            appId,
            message: 'QueryClient not available, queries not invalidated',
          })
        }
      } catch (queryError) {
        logger.warn('websocket.client-action.publish.query-invalidation-failed', {
          appId,
          error: queryError instanceof Error ? queryError.message : String(queryError),
        })
      }

      logger.debug('websocket.client-action.publish.ui-updated', {
        appId,
        deploymentId: result.deployment.deploymentId,
      })
    } else {
      // No deployment tracking available (local dev or deployment creation failure),
      // show success immediately instead of polling
      try {
        const store = useDevelopPageStore.getState()
        store.setIsPublishing(appId, false)
        store.setPublishSuccess(appId, true)
      } catch (storeError) {
        logger.warn('websocket.client-action.publish.publish-success-store-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }
    }

    // Return minimal result data
    return {
      commitHash: result.commitHash,
      archivePath: result.archive?.path,
      deploymentId: result.deployment?.deploymentId,
      deploymentStatus: result.deployment?.status,
      deploymentMessage: result.deployment?.message,
    }
  } catch (error) {
    // Set error state and clear publishing state (matches UI behavior)
    // EXCEPT when paywall modal is showing - in that case, don't show error alert
    try {
      const store = useDevelopPageStore.getState()
      const showPaywallModal = store.publishStates[appId]?.showPaywallModal ?? false

      // Only set publish error if paywall modal is not showing
      // This prevents showing both paywall modal and error alert
      if (!showPaywallModal) {
        store.setPublishError(appId, true)
      }

      store.setIsPublishing(appId, false)
    } catch (storeError) {
      logger.warn('websocket.client-action.publish.error-state-update-failed', {
        appId,
        error: storeError instanceof Error ? storeError.message : String(storeError),
      })
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('websocket.client-action.publish.error', {
      appId,
      error: errorMessage,
    })
    throw error
  }
}
