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
      // Archive/build + wait for mgmt-airo terminal deployment (up to 5m) — must exceed browser publishAction
      timeoutMs: 420000,
    })

    if (!clientResult.success) {
      logger.error('publish-client.failed', {
        appId,
        error: clientResult.error,
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
