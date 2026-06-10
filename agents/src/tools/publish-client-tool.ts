/**
 * Publish Client Tool
 *
 * Executes publish workflow via client-side action.
 * The client (browser) makes the authenticated API call to trigger deployment.
 */

import { logger } from '../logging/index.js'
import type { IClientActionService } from '../services/ClientActionService.js'

export interface PublishOptions {
  appId: string
}

export interface PublishResult {
  success: boolean
  commitHash?: string
  archivePath?: string
  deploymentId?: string
  deploymentStatus?: string
  deploymentMessage?: string
  error?: string
  errorDetails?: string
  logs?: Array<{ message: string; source?: string; timestamp?: string }>
  exitCode?: number
  requiresUpgrade?: boolean
  reason?: string
  /** User declined (or let time out) the publish-approval prompt in the client. */
  cancelled?: boolean
}

/**
 * Execute publish action via client
 */
export async function executePublish(
  options: PublishOptions,
  clientActionService: IClientActionService
): Promise<PublishResult> {
  const { appId } = options

  logger.info('publish-client.begin', {
    appId,
  })

  try {
    // Execute client action and wait for result
    const clientResult = await clientActionService.executeAction({
      action: 'publish',
      params: {
        appId,
      },
      // Initial budget for the human-in-the-loop approval/think-time window. The
      // browser shows an approval modal first (up to PUBLISH_CONFIRMATION_TIMEOUT_MS
      // = 300s in publishAction.ts) and, on APPROVAL, emits client_action_reset_timeout
      // which resets this pending action's timeout to a fresh window for the actual
      // publish work (archive/build + wait for mgmt-airo terminal deployment, up to 5m).
      // INVARIANT: this must be >= the browser confirmation timeout so the agent never
      // times out during approval before the reset arrives. If the browser/agent is old
      // and no reset arrives, this single window degrades to the prior (shared-deadline)
      // behavior. The reset carries no client-chosen duration, so the work phase reuses
      // this same server-owned 420s.
      timeoutMs: 420000,
    })

    if (!clientResult.success) {
      const requiresUpgrade = clientResult.requiresUpgrade === true
      logger.error('publish-client.failed', {
        appId,
        error: clientResult.error,
        requiresUpgrade,
        hasErrorDetails: !!clientResult.errorDetails,
        hasLogs: !!clientResult.logs,
        exitCode: clientResult.exitCode,
      })
      return {
        success: false,
        error: clientResult.error || 'Publish failed',
        errorDetails: clientResult.errorDetails,
        logs: clientResult.logs,
        exitCode: clientResult.exitCode,
        requiresUpgrade,
        reason: clientResult.reason,
      }
    }

    // The client wraps any normal executor return as { success: true, result }, so a
    // declined approval arrives as a success with a `cancelled` flag rather than an
    // error. Surface it explicitly so the agent reports "not published" (no commit) and
    // does not retry — the publish never started.
    if ((clientResult.result as { cancelled?: boolean } | undefined)?.cancelled) {
      logger.info('publish-client.cancelled', { appId })
      return {
        success: false,
        cancelled: true,
        error: 'Publish was not approved by the user.',
      }
    }

    const publishData = clientResult.result as {
      commitHash: string
      archivePath: string
      deploymentId?: string
      deploymentStatus?: string
      deploymentMessage?: string
    }

    logger.info('publish-client.success', {
      appId,
      commitHash: publishData.commitHash?.substring(0, 7),
      deploymentId: publishData.deploymentId,
    })

    // Build result with all properties
    const publishResult: PublishResult = {
      success: true,
      commitHash: publishData.commitHash,
      archivePath: publishData.archivePath,
      ...(publishData.deploymentId && { deploymentId: publishData.deploymentId }),
      ...(publishData.deploymentStatus && { deploymentStatus: publishData.deploymentStatus }),
      ...(publishData.deploymentMessage && { deploymentMessage: publishData.deploymentMessage }),
    }

    return publishResult
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('publish-client.error', {
      appId,
      error: errorMessage,
    })
    return {
      success: false,
      error: errorMessage,
    }
  }
}
