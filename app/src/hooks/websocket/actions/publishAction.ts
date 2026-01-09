/**
 * Publish Action Executor
 *
 * Executes the publish workflow for an app.
 * This is triggered by agents when the user requests to publish their site.
 */

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { checkPaywallEligibility } from '@/lib/paywall/core'
import { ClientPaywallProvider } from '@/lib/paywall/client-provider'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { getQueryClient } from '@/components/providers/QueryClientProvider'
import type { ClientActionExecutor } from './types'

export const publishAction: ClientActionExecutor = async (params, context) => {
  const { appId, commitHash: providedCommitHash } = params

  // Validate required parameters
  if (!appId || typeof appId !== 'string') {
    throw new Error('appId is required and must be a string')
  }

  try {
    // Check paywall eligibility using core algorithm with client provider
    const provider = new ClientPaywallProvider()
    const { hasAccess, reason } = await checkPaywallEligibility(appId, provider)
    if (!hasAccess) {
      logger.warn('publish-action.access-denied', { appId, reason })

      // Show paywall modal
      try {
        const store = useDevelopPageStore.getState()
        store.setShowPaywallModal(appId, true)
      } catch (storeError) {
        logger.warn('publish-action.paywall-modal-trigger-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }

      throw new Error(reason || 'You need an Airo Plus subscription to publish. Upgrade to continue.')
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

    // Ensure commitHash is a string or undefined
    let commitHash = typeof providedCommitHash === 'string' && providedCommitHash
      ? providedCommitHash
      : undefined

    // If no commit hash provided, fetch the current commit (HEAD) from git history
    // This matches the behavior of the UI publish button
    if (!commitHash) {
      logger.debug('websocket.client-action.publish.fetching-commit', {
        appId,
      })

      const historyData = await appService.getGitHistory(appId)
      commitHash = historyData.currentCommit || historyData.commits?.[0]?.hash

      if (!commitHash || typeof commitHash !== 'string') {
        throw new Error('No commit found in git history')
      }

      logger.debug('websocket.client-action.publish.commit-fetched', {
        appId,
        commitHash: commitHash.substring(0, 7),
      })
    }

    logger.info('websocket.client-action.publish.begin', {
      appId,
      commitHash: commitHash.substring(0, 7),
    })

    // Store the commit hash for retry functionality (matches UI behavior)
    try {
      const setLastPublishedCommitHash = useDevelopPageStore.getState().setLastPublishedCommitHash
      setLastPublishedCommitHash(appId, commitHash)
    } catch (storeError) {
      logger.warn('websocket.client-action.publish.store-update-failed', {
        appId,
        error: storeError instanceof Error ? storeError.message : String(storeError),
      })
    }

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

    // Call the publish API with user authentication
    const response = await appFetch(`/api/apps/${appId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commitHash,
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

      // Invalidate deployments queries to trigger immediate refetch with polling
      try {
        const queryClient = getQueryClient()
        if (queryClient) {
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
