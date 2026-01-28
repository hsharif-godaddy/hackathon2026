/**
 * Publish Action Executor
 *
 * Executes the publish workflow for an app.
 * This is triggered by agents when the user requests to publish their site.
 */

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { appFetch } from '@/lib/gasket-config'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { ClientPaywallProvider } from '@/lib/paywall/client-provider'
import { checkPaywallEligibility } from '@/lib/paywall/core'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
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
    const { hasAccess, reason } = await checkPaywallEligibility(provider, appId)
    if (!hasAccess) {
      logger.warn('publish-action.access-denied', { appId, reason })

      // Show paywall modal
      try {
        const store = useDevelopPageStore.getState()
        // Track that paywall blocked this publish (prevents error alert from showing)
        store.setShowPaywallModal(appId, true)
        // Actually show the upgrade modal in the UI
        store.openUpgradeModal('publish')
      } catch (storeError) {
        logger.warn('publish-action.paywall-modal-trigger-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }

      throw new Error(reason || 'You need an Airo Plus subscription to publish. Upgrade to continue.')
    }

    // Log publish analytics event (matches UI behavior)
    try {
      const site = useSiteStore.getState().getSite(appId)
      const isFirstTimePublishing = !hasBeenPublished(site)
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

    // Get current commit hash for backward compatibility with old agents services
    // New agents services ignore this parameter and use current HEAD
    // Old agents services require commitHash in the request body
    // TODO: Remove this once all agents services are updated (after migration period)
    let currentCommitHash: string | undefined
    try {
      const gitHistory = await appService.getGitHistory(appId)
      currentCommitHash = gitHistory.currentCommit || undefined
      logger.debug('websocket.client-action.publish.current-commit', {
        appId,
        commitHash: currentCommitHash?.substring(0, 7)
      })
    } catch (error) {
      // Non-critical - new agents services don't need this
      logger.warn('websocket.client-action.publish.get-commit-failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to get current commit (backward compatibility only)'
      })
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
      body: JSON.stringify({
        // Send commitHash for backward compatibility with old agents services
        // New agents services accept but ignore this parameter
        ...(currentCommitHash && { commitHash: currentCommitHash })
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))

      // If this is a build error, store it for the UI to handle
      if (response.status === 400 && errorData.details) {
        try {
          const setBuildErrorDetails = useDevelopPageStore.getState().setBuildErrorDetails
          setBuildErrorDetails(appId, {
            error: errorData.error || 'Build failed',
            details: errorData.details,
            exitCode: errorData.exitCode,
          })

          // Automatically send build error logs to agent
          logger.info('websocket.client-action.publish.build-error.auto-send-to-agent', {
            appId,
            error: errorData.error,
            hasDetails: !!errorData.details,
            exitCode: errorData.exitCode
          })

          // Dispatch event to automatically send build error to agent
          // The develop page listens for this event and handles the error fix request
          if (typeof window !== 'undefined') {
            window.postMessage({
              type: 'build-error-fix-request',
              appId,
              errorMessage: errorData.error || 'Build failed',
              errorDetails: errorData.details,
              exitCode: errorData.exitCode,
              autoSend: true // Flag to indicate this was auto-triggered
            }, window.location.origin)
          }
        } catch (storeError) {
          logger.warn('websocket.client-action.publish.build-error-store-failed', {
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
      throw new Error(errorData.error || `Publish failed with status ${response.status}`)
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
