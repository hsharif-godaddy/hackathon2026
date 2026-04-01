/**
 * Publish Client AI Tool
 *
 * AI-lib wrapper for the publish client tool.
 * Allows agents to trigger publishing through the client (browser).
 */

import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { Logger } from '../../logging/index.js'
import { getClientActionService } from '../../server/ai-lib-websocket-server.js'
import { validateDomainName } from '../../utils/domain-validation.js'
import { executePublish } from '../publish-client-tool.js'
import { MemoryTool } from '../memory-tool.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

const logger = Logger.create({ component: 'publish-client-tool' })
const memoryTool = new MemoryTool()
const appRepo = new AppRepository()

interface SiteDomain {
  fqdn: string
  domainType: string
  status: string
}

function hasCustomDomain(domains?: SiteDomain[]): boolean {
  if (!domains || !Array.isArray(domains)) return false
  return domains.some(d => d.domainType !== 'prefix' && d.status === 'active')
}

/**
 * Publish tool for AI agents
 *
 * This triggers the full publish workflow through the client:
 * 1. Client calls /api/apps/:id/publish with user JWT
 * 2. Control plane validates auth and calls agents service
 * 3. Agents service creates git archive
 * 4. Control plane notifies mgmt-airo to start deployment
 * 5. Deployment proceeds to production
 */
export const publishClientAITool: Tool = createTool(
  `Publish the app to production.

WHEN TO USE:
- ONLY when user explicitly requests to publish ("publish my site", "deploy to production", "push to production")

NEVER USE:
- After making edits or fixes
- After committing changes
- When you think the app is "ready"
- Automatically after completing a feature

AFTER SUCCESSFUL PUBLISH:
- Check if the site has a custom domain attached
- If NO custom domain exists and ENABLE_DOMAIN_ATTACH is enabled, offer "Add a custom domain" as a next step using suggestedResponse
- If custom domain exists, skip domain suggestion and offer other next steps

IMPORTANT: Always call publishStatus after this tool to verify the app started successfully.`,
  z.object({
    commitHash: z
      .string()
      .optional()
      .describe('Optional specific commit hash to publish (defaults to current HEAD)'),
  }),
  async (input, context) => {
    // Extract required context
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for publishing')
    }

    // Pre-validate publish permission to fail fast before the ~35s publish workflow
    const permissions = (context?.metadata as any)?.permissions ?? {}
    const canPublish = permissions.canPublish ?? false
    if (!canPublish) {
      logger.warn('publish-client.permission-denied', { appId, reason: 'missing canPublish permission' })
      return {
        success: false,
        message: 'Publishing requires an Airo Plus subscription. Please upgrade your plan to publish your site. Do not call publishStatus — no publish was started.',
        requiresUpgrade: true,
        publishStarted: false,
      }
    }

    // Get socketId from context with validation
    const socketId = (context as any)?.socketId
    if (!socketId || typeof socketId !== 'string') {
      throw new Error('Socket ID not available in context - tool must be called via WebSocket')
    }

    // Get client action service from global registry
    const clientActionService = getClientActionService(socketId)
    if (!clientActionService) {
      throw new Error('Client action service not available - cannot execute publish')
    }

    // Execute publish via client
    const publishOptions: { appId: string; commitHash?: string } = { appId }
    if (input.commitHash) {
      publishOptions.commitHash = input.commitHash
    }
    const result = await executePublish(publishOptions, clientActionService)

    // If publish failed, throw detailed error to inform agent AND show error in UI
    if (!result.success) {
      let errorMessage = `Publish failed: ${result.error || 'Unknown error'}`

      // Include detailed error information if available
      if (result.errorDetails) {
        errorMessage += `\n\nDetails:\n${result.errorDetails}`
      }

      // Include logs if available
      if (result.logs && result.logs.length > 0) {
        errorMessage += '\n\nLogs:\n'
        for (const log of result.logs) {
          const timestamp = log.timestamp ? `[${log.timestamp}] ` : ''
          errorMessage += `${timestamp}${log.message}\n`
        }
      }

      // Include exit code if available
      if (result.exitCode !== undefined) {
        errorMessage += `\nExit code: ${result.exitCode}`
      }

      throw new Error(errorMessage)
    }

    // Build response message
    const commitInfo = result.commitHash ? result.commitHash.substring(0, 7) : 'HEAD'
    let message = `Successfully published commit ${commitInfo}.`

    if (result.deploymentId) {
      message += `\nDeployment ID: ${result.deploymentId}`
      if (result.deploymentStatus) {
        message += `\nStatus: ${result.deploymentStatus}`
      }
      if (result.deploymentMessage) {
        message += `\n${result.deploymentMessage}`
      }
    } else if (result.archivePath) {
      message += `\nArchive path: ${result.archivePath}`
    }

    // Check for custom domain and purchased domains to determine next step suggestion
    let shouldSuggestDomain = false
    let purchasedDomain: string | null = null
    let autoAttachedDomain: string | null = null
    const domainAttachEnabled = (context?.metadata as any)?.permissions?.canPurchaseDomain ?? false

    if (domainAttachEnabled) {
      try {
        const siteDataResult = await clientActionService.executeAction({
          action: 'getSiteData',
          params: { appId },
          timeoutMs: 10000,
        })

        if (siteDataResult.success && siteDataResult.result) {
          const siteData = siteDataResult.result as { domains?: SiteDomain[] }
          const hasCustom = hasCustomDomain(siteData.domains)
          shouldSuggestDomain = !hasCustom

          // Check memory for mentioned or purchased domains if no custom domain exists
          if (!hasCustom) {
            try {
              const app = appRepo.findById(appId)
              if (app) {
                // Check for purchased domain (stored by domain tool)
                const purchasedResult = await memoryTool.readMemory(
                  { key: 'domain.purchased' },
                  app.path,
                  appId
                )
                if (purchasedResult.success && purchasedResult.exists) {
                  const purchased = purchasedResult.value as { fqdn?: string; connectedToProject?: boolean }
                  if (purchased?.fqdn && !purchased.connectedToProject) {
                    purchasedDomain = purchased.fqdn
                  }
                }

                // Auto-attach purchased domain if one exists and not yet connected
                if (purchasedDomain) {
                  // SECURITY: Validate domain name format before passing to client action
                  const validation = validateDomainName(purchasedDomain)
                  if (!validation.valid) {
                    logger.warn('publish-client.invalid-domain-name', {
                      appId,
                      domainName: purchasedDomain,
                      error: validation.error,
                    })
                  } else {
                    try {
                      logger.info('publish-client.auto-attach-domain', {
                        appId,
                        domainName: purchasedDomain,
                      })

                      const attachResult = await clientActionService.executeAction({
                        action: 'attachDomain',
                        params: {
                          appId,
                          domainName: purchasedDomain,
                        },
                        timeoutMs: 30000,
                      })

                      if (attachResult.success) {
                        autoAttachedDomain = purchasedDomain
                        shouldSuggestDomain = false
                        message += `\n\n✅ Automatically connected ${purchasedDomain} to your site!`

                        // Update memory to mark domain as connected (with separate error handling)
                        try {
                          await memoryTool.setMemory(
                            {
                              key: 'domain.purchased',
                              value: {
                                fqdn: purchasedDomain,
                                connectedToProject: true,
                                autoAttachedAt: new Date().toISOString(),
                              },
                            },
                            app.path,
                            appId
                          )
                        } catch (memoryError) {
                          logger.warn('publish-client.memory-update-failed', {
                            appId,
                            domainName: purchasedDomain,
                            error: memoryError instanceof Error ? memoryError.message : String(memoryError),
                          })
                        }

                        logger.info('publish-client.auto-attach-success', {
                          appId,
                          domainName: purchasedDomain,
                        })
                      } else {
                        logger.warn('publish-client.auto-attach-failed', {
                          appId,
                          domainName: purchasedDomain,
                          error: attachResult.error || 'Unknown error',
                        })
                      }
                    } catch (attachError) {
                      logger.warn('publish-client.auto-attach-error', {
                        appId,
                        domainName: purchasedDomain,
                        error: attachError instanceof Error ? attachError.message : String(attachError),
                      })
                    }
                  }
                }
              }
            } catch (memoryError) {
              logger.debug('publish-client.memory-check-failed', {
                appId,
                error: memoryError instanceof Error ? memoryError.message : String(memoryError),
              })
            }
          }

          logger.debug('publish-client.domain-check', {
            appId,
            hasDomains: !!siteData.domains?.length,
            hasCustomDomain: hasCustom,
            shouldSuggestDomain,
            purchasedDomain,
            autoAttachedDomain,
          })
        }
      } catch (error) {
        logger.warn('publish-client.domain-check-failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Add domain suggestion to message if applicable (only if domain wasn't auto-attached)
    if (shouldSuggestDomain && domainAttachEnabled && !autoAttachedDomain) {
      if (purchasedDomain) {
        message += `\n\n[NEXT STEP: User purchased ${purchasedDomain} earlier. Use suggestedResponse to offer "Connect ${purchasedDomain}" option.]`
      } else {
        message += '\n\n[NEXT STEP: Site has no custom domain. Use suggestedResponse to offer "Add a custom domain" option.]'
      }
    }

    message += '\n\nUse publishStatus to verify the app started successfully.'

    return {
      success: true,
      message,
      deploymentId: result.deploymentId,
      commitHash: result.commitHash,
      shouldSuggestDomain,
      domainAttachEnabled,
      purchasedDomain: purchasedDomain || undefined,
      autoAttachedDomain: autoAttachedDomain || undefined,
    }
  }
)
