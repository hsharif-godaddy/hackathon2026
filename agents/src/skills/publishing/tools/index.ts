import { z } from 'zod';

import type { SkillToolDefinition } from '@airo/ai-skills';
import { PublishDenialReason } from '@airo/shared/publish';
import { AppRepository } from '../../../database/repositories/AppRepository.js';
import { MemoryRepository } from '../../../database/repositories/MemoryRepository.js';
import { logger } from '../../../logging/index.js';
import { customerIdFromContext } from '../../../memory/interfaces/scope.js';
import { getActionService } from '../../../server/agent-runtime.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { validateDomainName } from '../../../utils/domain-validation.js';
import { MemoryTool } from '../../../tools/memory-tool.js';
import { executePublish } from '../../../tools/publish-client-tool.js';

const memoryTool = new MemoryTool();
const appRepo = new AppRepository();
const memoryRepo = new MemoryRepository();

interface SiteDomain {
  fqdn: string;
  domainType: string;
  isPrimary?: boolean;
  status: string;
}

function hasCustomDomain(domains?: SiteDomain[]): boolean {
  if (!domains || !Array.isArray(domains)) return false;
  return domains.some(d => d.domainType !== 'prefix' && d.status === 'active');
}

export const publishTool: SkillToolDefinition = {
  name: 'publish',
  description: `Publish to production. Only on explicit user request—never after edits/commits/without being asked. ` +
    `Always call this tool when user asks to publish — eligibility is checked automatically. ` +
    `Success: no custom domain + domain attach → suggestedResponse "Add custom domain"; else other steps. publishing__status optional (user asks for prod health/logs). ` +
    `Build/publish failure: do NOT call publishing__status—error already has logs; status shows live container (previous deploy), not failed build. ` +
    `Errors: service unavailable → no retry; requiresUpgrade → tell user upgrade options shown, they can retry after upgrading; session ended → stop. ExitCode → fix code, retry once.`,

  parameters: z.object({
    commitHash: z
      .string()
      .optional()
      .describe('Commit to publish; omit for HEAD'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required for publishing');
    }

    const socketId = (context as any)?.socketId;
    if (!socketId || typeof socketId !== 'string') {
      throw new Error('Socket ID not available in context - tool must be called via WebSocket');
    }

    const clientActionService = getActionService(socketId);
    if (!clientActionService) {
      logger.warn('skill.publishing.publish.no-client-service', { appId });
      return {
        success: false,
        message: 'Cannot publish right now — no client connection. Please use the publish button in the UI.',
        publishStarted: false,
      };
    }

    const publishOptions: { appId: string; commitHash?: string } = { appId };
    if (input.commitHash) {
      publishOptions.commitHash = input.commitHash;
    }
    const result = await executePublish(publishOptions, clientActionService);

    if (!result.success) {
      if (result.requiresUpgrade) {
        const reason = result.reason || PublishDenialReason.NoSubscription;
        logger.info('skill.publishing.publish.requires-upgrade', { appId, reason });
        const message = reason === PublishDenialReason.PublishLimitReached
          ? 'You\'ve reached your publish limit. Upgrade your plan or unpublish an existing app to continue. The upgrade options have been shown.'
          : 'A paid subscription is required to publish. The upgrade options have been shown to the user.';
        return {
          success: false,
          message,
          requiresUpgrade: true,
          publishStarted: false,
        };
      }

      let errorMessage = `Publish failed: ${result.error || 'Unknown error'}`;

      if (result.errorDetails) {
        errorMessage += `\n\nDetails:\n${result.errorDetails}`;
      }

      if (result.logs && result.logs.length > 0) {
        errorMessage += '\n\nLogs:\n';
        for (const log of result.logs) {
          const timestamp = log.timestamp ? `[${log.timestamp}] ` : '';
          errorMessage += `${timestamp}${log.message}\n`;
        }
      }

      if (result.exitCode !== undefined) {
        errorMessage += `\nExit: ${result.exitCode}`;
      }

      throw new Error(errorMessage);
    }

    const commitInfo = result.commitHash ? result.commitHash.substring(0, 7) : 'HEAD';
    let message = `Published commit ${commitInfo}.`;

    if (result.deploymentId) {
      message += `\nDeployment: ${result.deploymentId}`;
      if (result.deploymentStatus) {
        message += `\nStatus: ${result.deploymentStatus}`;
      }
      if (result.deploymentMessage) {
        message += `\n${result.deploymentMessage}`;
      }
    } else if (result.archivePath) {
      message += `\nArchive: ${result.archivePath}`;
    }

    let shouldSuggestDomain = false;
    let purchasedDomain: string | null = null;
    let autoAttachedDomain: string | null = null;
    let publishedUrl: string | undefined;
    let siteDataDomains: SiteDomain[] | undefined;
    const domainAttachEnabled = (context?.metadata as any)?.permissions?.canPurchaseDomain ?? false;

    try {
      const siteDataResult = await clientActionService.executeAction({
        action: 'getSiteData',
        params: { appId },
        timeoutMs: 10000,
      });

      if (siteDataResult.success && siteDataResult.result) {
        const siteData = siteDataResult.result as { publishedUrl?: string; domains?: SiteDomain[] };
        publishedUrl = siteData.publishedUrl;
        siteDataDomains = siteData.domains;

        if (domainAttachEnabled) {
          const hasCustom = hasCustomDomain(siteData.domains);
          shouldSuggestDomain = !hasCustom;

          if (!hasCustom) {
            try {
              const app = appRepo.findById(appId);
              if (app) {
                const purchasedResult = await memoryTool.readMemory(
                  { key: 'domain.purchased' },
                  app.path,
                  appId,
                  customerIdFromContext(context)
                );
                if (purchasedResult.success && purchasedResult.exists) {
                  const purchased = purchasedResult.value as { fqdn?: string; connectedToProject?: boolean };
                  if (purchased?.fqdn && !purchased.connectedToProject) {
                    purchasedDomain = purchased.fqdn;
                  }
                }

                if (purchasedDomain) {
                  // SECURITY: Validate domain name format before passing to client action
                  const validation = validateDomainName(purchasedDomain);
                  if (!validation.valid) {
                    logger.warn('skill.publishing.publish.invalid-domain-name', {
                      appId,
                      domainName: purchasedDomain,
                      error: validation.error,
                    });
                  } else {
                    try {
                      logger.info('skill.publishing.publish.auto-attach-domain', {
                        appId,
                        domainName: purchasedDomain,
                      });

                      const attachResult = await clientActionService.executeAction({
                        action: 'attachDomain',
                        params: {
                          appId,
                          domainName: purchasedDomain,
                        },
                        timeoutMs: 30000,
                      });

                      if (attachResult.success) {
                        autoAttachedDomain = purchasedDomain;
                        shouldSuggestDomain = false;
                        message += `\n\nConnected domain: ${purchasedDomain}`;

                        // Refetch to get canonical URL from control plane (resolves prefix/custom domain priority)
                        try {
                          const refreshResult = await clientActionService.executeAction({
                            action: 'getSiteData',
                            params: { appId },
                            timeoutMs: 10000,
                          });
                          if (refreshResult.success && refreshResult.result) {
                            publishedUrl = (refreshResult.result as { publishedUrl?: string }).publishedUrl;
                          }
                        } catch (refreshError) {
                          logger.warn('skill.publishing.publish.canonical-url-refresh-failed', {
                            appId,
                            domainName: purchasedDomain,
                            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
                          });
                        }

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
                            appId,
                            customerIdFromContext(context)
                          );
                        } catch (memoryError) {
                          logger.warn('skill.publishing.publish.memory-update-failed', {
                            appId,
                            domainName: purchasedDomain,
                            error: memoryError instanceof Error ? memoryError.message : String(memoryError),
                          });
                        }

                        logger.info('skill.publishing.publish.auto-attach-success', {
                          appId,
                          domainName: purchasedDomain,
                        });
                      } else {
                        logger.warn('skill.publishing.publish.auto-attach-failed', {
                          appId,
                          domainName: purchasedDomain,
                          error: attachResult.error || 'Unknown error',
                        });
                      }
                    } catch (attachError) {
                      logger.warn('skill.publishing.publish.auto-attach-error', {
                        appId,
                        domainName: purchasedDomain,
                        error: attachError instanceof Error ? attachError.message : String(attachError),
                      });
                    }
                  }
                }
              }
            } catch (memoryError) {
              logger.debug('skill.publishing.publish.memory-check-failed', {
                appId,
                error: memoryError instanceof Error ? memoryError.message : String(memoryError),
              });
            }
          }

          logger.debug('skill.publishing.publish.domain-check', {
            appId,
            hasDomains: !!siteData.domains?.length,
            hasCustomDomain: hasCustom,
            shouldSuggestDomain,
            purchasedDomain,
            autoAttachedDomain,
          });
        }
      }
    } catch (error) {
      logger.warn('skill.publishing.publish.site-data-failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Persist publish state to SQLite so agent context is accurate on subsequent turns
    try {
      if (publishedUrl) {
        appRepo.updatePublishedUrl(appId, publishedUrl);
      }
      if (siteDataDomains && siteDataDomains.length > 0) {
        const customDomains = siteDataDomains
          .filter(d => d.domainType !== 'prefix')
          .map(d => ({
            fqdn: d.fqdn,
            isPrimary: d.isPrimary ?? false,
            status: d.status,
          }));
        if (customDomains.length > 0) {
          await memoryRepo.set(appId, 'site.domains', customDomains);
        }
      }
    } catch (persistError) {
      logger.warn('skill.publishing.publish.state-persist-failed', {
        appId,
        error: persistError instanceof Error ? persistError.message : String(persistError),
      });
    }

    if (publishedUrl) {
      message += `\npublishedUrl: ${publishedUrl}`;
    }

    if (shouldSuggestDomain && domainAttachEnabled && !autoAttachedDomain) {
      if (purchasedDomain) {
        message += `\n\n[NEXT: User bought ${purchasedDomain}. suggestedResponse → offer "Connect ${purchasedDomain}".]`;
      } else {
        message += '\n\n[NEXT: No custom domain. suggestedResponse → offer "Add a custom domain".]';
      }
    }

    message += '\n\nYou can call publishing__status if the user wants production logs or health details (optional).';

    return {
      success: true,
      message,
      deploymentId: result.deploymentId,
      commitHash: result.commitHash,
      publishedUrl,
      shouldSuggestDomain,
      domainAttachEnabled,
      purchasedDomain: purchasedDomain || undefined,
      autoAttachedDomain: autoAttachedDomain || undefined,
    };
  },

  config: {
    timeout: 150000,
    requiresApp: true,
  },
};

export const statusTool: SkillToolDefinition = {
  name: 'status',
  description: `Published app status: version, health, process, logs from the live container. ` +
    `Use for production issues, health checks, or after successful publish. ` +
    `Not for failed build debugging—publish error already has those logs; this shows the running deployment.`,

  parameters: z.object({
    lines: z
      .number()
      .optional()
      .describe('Log lines to retrieve (default 200)'),
    includeLogs: z
      .boolean()
      .optional()
      .describe('Include logs (default true)'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID required');
    }

    const workspace = createForWorkspace(appId, 'publish');
    if (!workspace) {
      return 'Publish supervisor unavailable — app may not be published yet, or publish task is not running. Try publishing first.';
    }

    // Run getSiteData (URL enrichment) and getPublishStatus in parallel — URL is best-effort
    const socketId = (context as any)?.socketId;
    const clientActionService = socketId && typeof socketId === 'string'
      ? getActionService(socketId)
      : null;

    const siteDataPromise = clientActionService
      ? clientActionService.executeAction({ action: 'getSiteData', params: { appId }, timeoutMs: 10000 })
      : Promise.resolve(null);

    const [siteDataSettled, statusSettled] = await Promise.allSettled([
      siteDataPromise,
      workspace.deployments.status({ logLines: input.lines ?? 200, includeLogs: input.includeLogs ?? true }),
    ]);

    let publishedUrl: string | undefined;
    if (siteDataSettled.status === 'fulfilled' && siteDataSettled.value?.success && siteDataSettled.value?.result) {
      publishedUrl = (siteDataSettled.value.result as { publishedUrl?: string }).publishedUrl;
    } else if (siteDataSettled.status === 'rejected') {
      logger.warn('skill.publishing.status.site-data-fetch-failed', {
        appId,
        error: siteDataSettled.reason instanceof Error ? siteDataSettled.reason.message : String(siteDataSettled.reason),
      });
    }

    if (statusSettled.status === 'rejected') {
      const errorMessage = statusSettled.reason instanceof Error ? statusSettled.reason.message : String(statusSettled.reason);
      throw new Error(`Failed to get publish status: ${errorMessage}`);
    }
    const status = statusSettled.value;

    let message = '';
    if (publishedUrl) {
      message += `publishedUrl: ${publishedUrl}\n`;
    }
    message += `Version: ${status.version ? `${status.version.substring(0, 7)} (${status.version})` : 'none'}\n`;
    message += `Health: ${status.health.status}`;
    if (status.health.message) message += ` — ${status.health.message}`;
    message += `\nProcess: ${status.process.state}`;
    if (status.process.pid && status.process.pid > 0) message += `, PID ${status.process.pid}`;
    if (status.process.startedAt) message += `, started ${status.process.startedAt.toISOString()}`;
    message += '\n';

    if (status.warnings?.length) {
      message += `\nWarnings:\n${status.warnings.map(w => `- ${w}`).join('\n')}\n`;
    }

    if (status.logs?.length) {
      const stderrLogs = status.logs.filter(log => log.source === 'stderr');
      const stdoutLogs = status.logs.filter(log => log.source === 'stdout');

      if (stderrLogs.length > 0) {
        message += `\nstderr:\n\`\`\`\n${stderrLogs.map(l => l.message).join('\n')}\n\`\`\`\n`;
      }
      if (stdoutLogs.length > 0) {
        message += `\nstdout:\n\`\`\`\n${stdoutLogs.map(l => l.message).join('\n')}\n\`\`\`\n`;
      }
    }

    if (status.health.status === 'unhealthy') {
      message += '\nUnhealthy — check `npm run build` for errors and verify dependencies are installed.';
    }

    return message;
  },

  config: {
    timeout: 30000,
    requiresApp: true,
  },
};
