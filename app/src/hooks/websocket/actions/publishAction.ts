/**
 * Publish Action Executor
 *
 * Executes the publish workflow for an app.
 * This is triggered by agents when the user requests to publish their site.
 */

import { PublishDenialReason, PublishUpgradeRequiredError } from '@airo/shared/publish'

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { ensureFreshToken } from '@/hooks/github/useGitHubTokenHealth'
import {
  appDetailsQueryKey,
  type AppDetailsResponse,
  fetchAppDetails,
} from '@/hooks/useAppDetails'
import { appFetch, AuthDismissedError, authPreflight } from '@/lib/gasket-config'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { type AiroSubscription, DeploymentStatus } from '@/lib/mgmt-airo/types'
import { ClientPaywallProvider } from '@/lib/paywall/client-provider'
import { checkPaywallEligibility, PaywallAction } from '@/lib/paywall/core'
import { PAYWALL_ITC, PaywallDenialReason } from '@/lib/paywall/shared'
import * as postAgentPublish from '@/lib/post-agent-publish'
import { logger } from '@/lib/request-context'
import {
  getPublishComplianceBlockReason,
  isPublishBlockedByComplianceRules,
} from '@/lib/subscription'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'
import type { ClientActionExecutor } from './types'

const MAX_PUBLISH_WAIT_MS = 5 * 60 * 1000;

// How long to wait for the user to approve/decline an agent-initiated publish.
// This budgets the human think-time window only. On APPROVAL the browser signals
// the agent (via context.resetActionTimeout) to reset the pending publish action's
// timeout, so the actual publish work gets a fresh full window rather than sharing
// the agent's deadline with think-time. INVARIANT: this must stay <= the agent-side
// executeAction timeout (420s in publish-client-tool.ts) so the agent never times
// out during approval before the reset arrives.
const PUBLISH_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Human-in-the-loop gate for agent-initiated publishes.
 *
 * Only the agent publish path reaches this executor — the UI Publish button uses
 * `usePublishApp` and never dispatches the `publish` client action — so requiring
 * approval here cannot double-prompt a user-initiated publish.
 *
 * Sets the store to 'pending' (which renders AgentPublishConfirmationModal) and
 * resolves when the user approves/declines, mirroring the subscribe pattern in
 * waitForPublishResult. Resolves to false on timeout so the modal is dismissed.
 *
 * NOTE: this is the harness's FIRST human-in-the-loop gate and is a deliberate
 * one-off, not a reusable primitive. It only works because publish already
 * round-trips to the browser as a `publish` client action, so the approval can
 * piggyback on that trip. The next likely HITL candidates (socialPostPublish,
 * commerce mutations, deleteRow — see agents `non-idempotent-tools.ts`) execute
 * server-side and CANNOT reuse this browser-side gate. When a second consumer
 * lands, do not copy this: lift it into a generic primitive declared on
 * `SkillToolDefinition.config` and enforced in the `build-skill-tools.ts`
 * execute wrapper, round-tripped via a generic `confirm` client action (which
 * must also define a headless/PaaS default, since there is no UI there).
 */
function awaitAgentPublishApproval(appId: string, onApproved?: () => void): Promise<boolean> {
  const store = useDevelopPageStore.getState();
  store.requestAgentPublishConfirmation(appId);

  return new Promise(function awaitDecision(resolve) {
    const finish = (approved: boolean): void => {
      clearTimeout(timeout);
      unsubscribe();
      // Approval only (never decline/timeout): tell the agent to refresh the
      // pending publish action's timeout so the work phase doesn't inherit the
      // time already spent waiting for the user.
      if (approved) onApproved?.();
      // Reset to 'idle' so a later publish in the same session starts clean.
      useDevelopPageStore.getState().resetAgentPublishConfirmation(appId);
      resolve(approved);
    };

    const timeout = setTimeout(function handleTimeout() {
      logger.warn('publish-action.confirmation.timeout', { appId, elapsedMs: PUBLISH_CONFIRMATION_TIMEOUT_MS });
      finish(false);
    }, PUBLISH_CONFIRMATION_TIMEOUT_MS);

    const unsubscribe = useDevelopPageStore.subscribe(function checkConfirmation(state) {
      const status = state.publishStates[appId]?.agentPublishConfirmation;
      if (status === 'approved') finish(true);
      else if (status === 'cancelled') finish(false);
    });
  });
}

/**
 * Subscribes to useDevelopPageStore and resolves when the existing
 * useDeploymentsQuery polling detects a terminal deployment status
 * (signaled by deploymentInProgressId being cleared to null).
 *
 * @throws Error if deployment fails or the wait exceeds MAX_PUBLISH_WAIT_MS
 */
function waitForPublishResult(appId: string): Promise<DeploymentStatus> {
  return new Promise(function awaitTerminalStatus(resolve, reject) {
    const timeout = setTimeout(function handleTimeout() {
      unsubscribe();
      logger.warn('publish-action.deployment-wait.timeout', { appId, elapsedMs: MAX_PUBLISH_WAIT_MS });
      reject(new Error(
        'Deployment did not reach a finished state within the time limit. Check the Publish panel or try again.',
      ));
    }, MAX_PUBLISH_WAIT_MS);

    const unsubscribe = useDevelopPageStore.subscribe(function checkPublishState(state) {
      const publishState = state.publishStates[appId];
      if (!publishState || publishState.deploymentInProgressId !== null) return;

      clearTimeout(timeout);
      unsubscribe();

      if (publishState.publishError) {
        reject(new Error('Deployment failed. Check the Publish panel for details.'));
      } else {
        resolve(DeploymentStatus.DEPLOYED);
      }
    });
  });
}

export const publishAction: ClientActionExecutor = async (params, context, requestId) => {
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

      // Record the blocked attempt so publish attempt rate can be calculated accurately
      try {
        shipAnalyticsLog('publish.attempted', { appId, blockedReason: 'paywall_denied', trigger: 'agent' })
        logImpressionEvent('develop.publish.attempt', { appId, blockedReason: 'paywall_denied', trigger: 'agent' })()
      } catch (analyticsError) {
        logger.warn('publish-action.blocked-paywall.analytics-failed', {
          appId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
        })
      }

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
          usePaywallStore.getState().openUpgradeModal('publish', PAYWALL_ITC.PUBLISH)
        }
      } catch (storeError) {
        logger.warn('publish-action.modal-trigger-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }

      const denialReason = reason === PaywallDenialReason.PublishLimitReached
        ? PublishDenialReason.PublishLimitReached
        : PublishDenialReason.NoSubscription
      throw new PublishUpgradeRequiredError(denialReason, reason || undefined)
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
      try {
        shipAnalyticsLog('publish.attempted', { appId, blockedReason: blockReason, trigger: 'agent' })
        logImpressionEvent('develop.publish.attempt', { appId, blockedReason: blockReason, trigger: 'agent' })()
      } catch (analyticsError) {
        logger.warn('publish-action.blocked-compliance.analytics-failed', {
          appId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
        })
      }
      throw new Error('Publish blocked: compliance suspension')
    }

    const preflightFailure = await authPreflight(3)
    if (preflightFailure) {
      try {
        shipAnalyticsLog('publish.attempted', { appId, blockedReason: 'auth_required', trigger: 'agent' })
        logImpressionEvent('develop.publish.attempt', { appId, blockedReason: 'auth_required', trigger: 'agent' })()
      } catch (analyticsError) {
        logger.warn('publish-action.blocked-auth-required.analytics-failed', {
          appId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
        })
      }
      throw new Error('Authentication required')
    }

    // Human-in-the-loop gate: the agent may only publish to production with explicit
    // user approval. Placed after eligibility/compliance/auth so we never prompt for a
    // publish that would be denied, and before any side effects (publishing state,
    // secrets sync, token regen) so a decline leaves no visible trace and shows no
    // error alert. The agent side treats this { cancelled: true } as a non-error.
    // On approval we signal the agent to reset this client action's timeout so the
    // publish work gets a fresh window rather than sharing the deadline with the
    // approval wait. The signal carries only requestId; the agent reuses the action's
    // original server-owned budget (the browser never chooses the duration).
    const approved = await awaitAgentPublishApproval(appId, () => {
      if (requestId) context.resetActionTimeout?.(requestId)
    })
    if (!approved) {
      logger.info('websocket.client-action.publish.user-declined', { appId })
      return { cancelled: true }
    }

    // publish.attempt fires once the user has approved (and all prior gates passed) and
    // the actual publish is about to start. It is emitted AFTER the approval gate so a
    // declined/timed-out publish — which returns above and never reaches here — is
    // excluded from the attempt rate, matching the gate's "a decline leaves no visible
    // trace" contract. commitHash is the current HEAD — the artifact identifier for this
    // publish attempt.
    try {
      const currentCommitHash = appDetails?.gitHash ?? appDetails?.git_hash
      shipAnalyticsLog('publish.attempted', { appId, commitHash: currentCommitHash, trigger: 'agent' })
      logImpressionEvent('develop.publish.attempt', { appId, trigger: 'agent' })()
    } catch (attemptError) {
      // Non-critical — log but don't block the publish
      logger.warn('websocket.client-action.publish.attempt-analytics-failed', {
        appId,
        error: attemptError instanceof Error ? attemptError.message : String(attemptError),
      })
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

    const firstPublishDeployPending = !hasBeenPublished(appDetails)

    // Clear any previous publish errors and set publishing state (matches UI behavior)
    // This immediately updates the button text to "Publishing..."
    try {
      const store = useDevelopPageStore.getState()

      // Perform publish UI state updates together to prevent inconsistent UI state
      store.clearPublishStatus(appId)
      store.setFirstPublishDeployPending(appId, firstPublishDeployPending)
      store.setIsPublishing(appId, true)
    } catch (storeError) {
      logger.warn('websocket.client-action.publish.initial-state-update-failed', {
        appId,
        error: storeError instanceof Error ? storeError.message : String(storeError),
      })

      // Attempt to restore consistent state if partial update occurred
      try {
        const store = useDevelopPageStore.getState()
        store.setFirstPublishDeployPending(appId, false)
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

    await ensureFreshToken(appId, 'publish')

    // Regenerate JWT with fresh permissions before publish
    logger.info('websocket.client-action.publish.regenerate-token', { appId })
    const tokenResult = await regenerateToken({ siteId: appId, force: true })

    // Get agent URL for this site
    const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

    if (!apiConfig.agentUrl) {
      throw new Error('Agent URL not available for this site')
    }

    const publishUrl = postAgentPublish.url(apiConfig.agentUrl, appId)
    logger.info('websocket.client-action.publish.calling-agent', { appId, url: publishUrl })

    const { response, parsedBody } = await postAgentPublish.postWithStaleRetry({
      agentUrl: apiConfig.agentUrl,
      appId,
      token: tokenResult.token,
      publishedUrl: appDetails.published_url,
      refreshToken: async function refreshPublishToken() {
        logger.info('websocket.client-action.publish.token-stale-retry', { appId })
        return regenerateToken({ siteId: appId, force: true })
      },
    })

    if (!response.ok) {
      const errorData: any = parsedBody ?? { error: 'Unknown error' }

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

        store.setFirstPublishDeployPending(appId, false)
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

      const finalDeploymentStatus = await waitForPublishResult(appId)
      result.deployment.status = finalDeploymentStatus

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('publish-snapshot-request', {
          detail: {
            appId,
            deploymentId: result.deployment.deploymentId,
            commitHash: result.commitHash,
          }
        }))
      }
    } else {
      // No deployment tracking available (local dev or deployment creation failure),
      // show success immediately instead of polling
      try {
        const store = useDevelopPageStore.getState()
        if (store.getPublishState(appId).firstPublishDeployPending) {
          store.setShowFirstPublishCongrats(appId, true)
        }
        store.setFirstPublishDeployPending(appId, false)
        store.setIsPublishing(appId, false)
        store.setPublishSuccess(appId, true)
      } catch (storeError) {
        logger.warn('websocket.client-action.publish.publish-success-store-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }

      if (typeof window !== 'undefined' && result.commitHash) {
        window.dispatchEvent(new CustomEvent('publish-snapshot-request', {
          detail: {
            appId,
            deploymentId: result.deployment?.deploymentId,
            commitHash: result.commitHash,
          }
        }))
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
    if (error instanceof AuthDismissedError) return { cancelled: true }
    try {
      const store = useDevelopPageStore.getState()
      const showPaywallModal = store.publishStates[appId]?.showPaywallModal ?? false

      // Only set publish error if paywall modal is not showing
      // This prevents showing both paywall modal and error alert
      if (!showPaywallModal) {
        store.setPublishError(appId, true)
      }

      store.setFirstPublishDeployPending(appId, false)
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
