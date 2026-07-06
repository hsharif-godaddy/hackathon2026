/**
 * Publish Action Executor
 *
 * Executes the publish workflow for an app.
 * This is triggered by agents when the user requests to publish their site.
 */

import {
  PUBLISH_CONFIRMATION_TIMEOUT_MS,
  PublishDenialReason,
  PublishUpgradeRequiredError,
} from '@airo/shared/publish'

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { ensureFreshToken } from '@/hooks/github/useGitHubTokenHealth'
import {
  appDetailsQueryKey,
  type AppDetailsResponse,
  fetchAppDetails,
} from '@/hooks/useAppDetails'
import { getSwitchboardFlag } from '@/hooks/useSwitchboard'
import { appFetch, AuthDismissedError, authPreflight } from '@/lib/gasket-config'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { type AiroSubscription, DeploymentStatus } from '@/lib/mgmt-airo/types'
import { ClientPaywallProvider } from '@/lib/paywall/client-provider'
import { checkPaywallEligibility, PaywallAction } from '@/lib/paywall/core'
import {
  handlePublishPermissionDenied,
  isPermissionDeniedResponse,
  publishPermissionDeniedError,
  shouldSuppressPublishError,
} from '@/lib/paywall/publish-permission-denied'
import { PAYWALL_ITC, PaywallDenialReason } from '@/lib/paywall/shared'
import * as postAgentPublish from '@/lib/post-agent-publish'
import { logger } from '@/lib/request-context'
import {
  getPublishComplianceBlockReason,
  isPublishBlockedByComplianceRules,
} from '@/lib/subscription'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'
import type { ClientActionExecutor } from './types'

// How long to wait for the user to approve/decline an agent-initiated publish.
// This budgets the human think-time window only. On APPROVAL the browser signals
// the agent (via context.resetActionTimeout) to reset the pending publish action's
// timeout, so the actual publish work gets a fresh full window rather than sharing
// the agent's deadline with think-time. INVARIANT: {@link PUBLISH_CONFIRMATION_TIMEOUT_MS}
// must stay <= PUBLISH_CLIENT_ACTION_TIMEOUT_MS (@airo/shared/publish) so the agent
// never times out during approval before the reset arrives.

/**
 * Human-in-the-loop gate for agent-initiated publishes.
 *
 * Only the agent publish path reaches this executor — the UI Publish button uses
 * `usePublishApp` and never dispatches the `publish` client action — so requiring
 * approval here cannot double-prompt a user-initiated publish.
 *
 * Sets the store to 'pending' (which renders AgentPublishConfirmationModal) and
 * resolves when the user approves/declines. Resolves to false on timeout so the
 * modal is dismissed.
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


export const publishAction: ClientActionExecutor = async (params, context, requestId) => {
  const { appId } = params

  // Validate required parameters
  if (!appId || typeof appId !== 'string') {
    throw new Error('appId is required and must be a string')
  }

  try {
    // Owner-pays: a collaborator on a shared app is never the billing principal,
    // so skip the paywall entirely — their publish permission is authorized by FGA
    // server-side. Without this, the invitee's absent subscription denies publish
    // and pops the owner-only upgrade paywall.
    const isSharedApp = Boolean(useSiteStore.getState().getSite(appId)?.sharedWithMe)

    // Check paywall eligibility using core algorithm with client provider
    const provider = new ClientPaywallProvider()
    const eligibility = isSharedApp
      ? null
      : await checkPaywallEligibility(provider, appId, PaywallAction.Publish)
    if (eligibility && !eligibility.hasAccess) {
      const { reason, details } = eligibility
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
    const tokenResult = await regenerateToken({ siteId: appId, force: true, authLevel: 3 })

    // Get agent URL for this site
    const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

    if (!apiConfig.agentUrl) {
      throw new Error('Agent URL not available for this site')
    }

    const publishUrl = postAgentPublish.url(apiConfig.agentUrl, appId)
    logger.info('websocket.client-action.publish.calling-agent', { appId, url: publishUrl })

    const isAsyncPublishEnabled = getSwitchboardFlag('appbuilder-async-publish')
    const { response, parsedBody } = await postAgentPublish.postWithStaleRetry({
      agentUrl: apiConfig.agentUrl,
      appId,
      token: tokenResult.token,
      publishedUrl: appDetails.published_url,
      async: isAsyncPublishEnabled !== false,
      refreshToken: async function refreshPublishToken() {
        logger.info('websocket.client-action.publish.token-stale-retry', { appId })
        return regenerateToken({ siteId: appId, force: true, authLevel: 3 })
      },
    })

    if (response.status === 409) {
      const conflictData: any = parsedBody ?? {}
      if (conflictData.jobId) {
        logger.info('websocket.client-action.publish.reattaching-existing-job', { appId, jobId: conflictData.jobId, phase: conflictData.phase })
      }
    }

    if (!response.ok && !(response.status === 409 && (parsedBody as any)?.jobId)) {
      const errorData: any = parsedBody ?? { error: 'Unknown error' }

      if (isPermissionDeniedResponse(response.status, errorData)) {
        logger.warn('websocket.client-action.publish.paywall-denied', { appId, error: errorData.error })
        try {
          handlePublishPermissionDenied(appId)
        } catch (storeError) {
          logger.warn('websocket.client-action.publish.paywall-modal-failed', {
            appId,
            error: storeError instanceof Error ? storeError.message : String(storeError),
          })
        }

        throw publishPermissionDeniedError(errorData.error)
      }

      if (errorData.details || errorData.logs) {
        try {
          const logText = errorData.logs
            ? errorData.logs.map((log: any) => log.message || log).join('\n')
            : ''
          const errorDetails = [errorData.details, logText].filter(Boolean).join('\n\n') || 'Unknown error'
          useDevelopPageStore.getState().setBuildErrorDetails(appId, {
            error: errorData.error || 'Publish failed',
            details: errorDetails,
            exitCode: errorData.exitCode,
          })
        } catch (storeError) {
          logger.warn('websocket.client-action.publish.error-store-failed', {
            appId,
            error: storeError instanceof Error ? storeError.message : String(storeError),
          })
        }
      }

      try {
        const store = useDevelopPageStore.getState()
        if (!shouldSuppressPublishError(appId)) store.setPublishError(appId, true)
        store.setFirstPublishDeployPending(appId, false)
        store.setIsPublishing(appId, false)
      } catch (storeError) {
        logger.warn('websocket.client-action.publish.error-state-update-failed', {
          appId,
          error: storeError instanceof Error ? storeError.message : String(storeError),
        })
      }

      const error: any = new Error(errorData.error || `Publish failed with status ${response.status}`)
      error.errorDetails = errorData.details
      error.logs = errorData.logs
      error.exitCode = errorData.exitCode
      throw error
    }

    const submitResult = response.status === 409 ? (parsedBody as any) : await response.json()
    logger.info('websocket.client-action.publish.submitted', { appId, jobId: submitResult.jobId })

    let commitHash: string | undefined

    if (!submitResult.jobId) {
      // Sync path: server already completed publish, use response directly
      commitHash = submitResult.commitHash
    } else {
      // Async path: poll until terminal state
      const { pollPublishStatus } = await import('@/lib/publish-polling')
      const pollResult = await pollPublishStatus(
        apiConfig.agentUrl,
        appId,
        tokenResult.token,
        {
          refreshToken: async function refreshPollToken() {
            return regenerateToken({ siteId: appId, force: true, authLevel: 3 })
          },
        },
      )

      if (pollResult.phase === 'timeout') {
        logger.warn('websocket.client-action.publish.poll-timeout', { appId })
        try {
          const store = useDevelopPageStore.getState()
          store.setFirstPublishDeployPending(appId, false)
          store.setIsPublishing(appId, false)
        } catch (e) {
          logger.warn('websocket.client-action.publish.store-update-failed', { appId, context: 'timeout', error: e instanceof Error ? e.message : String(e) })
        }
        throw new Error('Publish did not complete within the time limit. The site may still be deploying; check the Publish panel.')
      }

      if (pollResult.phase === 'failed') {
        const errorDetails = pollResult.logs?.join('\n') || pollResult.error || 'Unknown error'
        try {
          useDevelopPageStore.getState().setBuildErrorDetails(appId, {
            error: pollResult.error || 'Publish failed',
            details: errorDetails,
          })
        } catch (e) {
          logger.warn('websocket.client-action.publish.store-update-failed', { appId, context: 'failed', error: e instanceof Error ? e.message : String(e) })
        }

        const error: any = new Error(pollResult.error || 'Publish failed')
        error.errorDetails = errorDetails
        error.logs = pollResult.logs
        throw error
      }

      commitHash = pollResult.commitHash
    }

    // Deployed: create deployment record and update UI
    if (!commitHash) {
      throw new Error('Publish succeeded but no commit hash returned')
    }
    try {
      useDevelopPageStore.getState().setLastPublishedCommitHash(appId, commitHash)
    } catch (e) {
      logger.warn('websocket.client-action.publish.store-update-failed', { appId, context: 'commitHash', error: e instanceof Error ? e.message : String(e) })
    }

    let deploymentId: string | undefined
    try {
      const deploymentResponse = await appFetch(`/api/apps/${appId}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitHash: commitHash }),
      })

      if (deploymentResponse.ok) {
        const deploymentData = await deploymentResponse.json()
        deploymentId = deploymentData.deploymentId
        logger.info('websocket.client-action.publish.deployment-created', {
          appId,
          deploymentId: deploymentData.deploymentId,
        })
      } else {
        logger.warn('websocket.client-action.publish.deployment-creation-failed', {
          appId,
          status: deploymentResponse.status,
        })
      }
    } catch (deploymentError) {
      logger.warn('websocket.client-action.publish.deployment-creation-error', {
        appId,
        error: deploymentError instanceof Error ? deploymentError.message : String(deploymentError),
      })
    }

    // Update UI state
    if (deploymentId) {
      try {
        useDevelopPageStore.getState().setDeploymentInProgressId(appId, deploymentId)
        const queryClient = getQueryClient()
        if (queryClient) {
          await queryClient.invalidateQueries({ queryKey: ['git-history', appId] })
          await queryClient.invalidateQueries({ queryKey: ['deployments', appId], refetchType: 'active' })
        }
      } catch (e) {
        logger.warn('websocket.client-action.publish.store-update-failed', { appId, context: 'deployment-tracking', error: e instanceof Error ? e.message : String(e) })
      }
    } else {
      try {
        const store = useDevelopPageStore.getState()
        if (store.getPublishState(appId).firstPublishDeployPending) {
          store.setShowFirstPublishCongrats(appId, true)
        }
        store.setFirstPublishDeployPending(appId, false)
        store.setIsPublishing(appId, false)
        store.setPublishSuccess(appId, true)
      } catch (e) {
        logger.warn('websocket.client-action.publish.store-update-failed', { appId, context: 'publish-success', error: e instanceof Error ? e.message : String(e) })
      }
    }

    if (typeof window !== 'undefined' && commitHash) {
      window.dispatchEvent(new CustomEvent('publish-snapshot-request', {
        detail: { appId, deploymentId, commitHash },
      }))
    }

    logger.info('websocket.client-action.publish.success', { appId, commitHash: commitHash.substring(0, 7) })

    return {
      commitHash,
      deploymentId,
      deploymentStatus: deploymentId ? DeploymentStatus.DEPLOYED : undefined,
    }
  } catch (error) {
    if (error instanceof AuthDismissedError) return { cancelled: true }
    try {
      const store = useDevelopPageStore.getState()
      if (!shouldSuppressPublishError(appId)) {
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
