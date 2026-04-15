import { z } from 'zod';

import type { SkillToolDefinition } from '@airo/ai-skills';
import { AppRepository } from '../../../database/repositories/AppRepository.js';
import { logger } from '../../../logging/index.js';
import { getClientActionService } from '../../../server/ai-lib-websocket-server.js';
import type { PublishStatusResponse } from '../../../services/DevSupervisorClient.js';
import { DevSupervisorClientFactory } from '../../../utils/dev-supervisor-client-factory.js';
import { validateDomainName } from '../../../utils/domain-validation.js';
import { MemoryTool } from '../../../tools/memory-tool.js';
import { executePublish } from '../../../tools/publish-client-tool.js';

const memoryTool = new MemoryTool();
const appRepo = new AppRepository();

interface SiteDomain {
  fqdn: string;
  domainType: string;
  status: string;
}

function hasCustomDomain(domains?: SiteDomain[]): boolean {
  if (!domains || !Array.isArray(domains)) return false;
  return domains.some(d => d.domainType !== 'prefix' && d.status === 'active');
}

export const publishTool: SkillToolDefinition = {
  name: 'publish',
  description: `Publish to production. Only on explicit user request—never after edits/commits/without being asked. ` +
    `Success: no custom domain + domain attach → suggestedResponse "Add custom domain"; else other steps. publishing__status optional (user asks for prod health/logs). ` +
    `Build/publish failure: do NOT call publishing__status—error already has logs; status shows live container (previous deploy), not failed build. ` +
    `Errors: service unavailable → no retry; subscription → upgrade, no retry; session ended → stop. ExitCode → fix code, retry once.`,

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

    const permissions = (context?.metadata as any)?.permissions ?? {};
    const canPublish = permissions.canPublish ?? false;
    if (!canPublish) {
      logger.warn('skill.publishing.publish.permission-denied', { appId, reason: 'missing canPublish permission' });
      return {
        success: false,
        message: 'Upgrade to publish. Do not call publishing__status — no publish started.',
        requiresUpgrade: true,
        publishStarted: false,
      };
    }

    const socketId = (context as any)?.socketId;
    if (!socketId || typeof socketId !== 'string') {
      throw new Error('Socket ID not available in context - tool must be called via WebSocket');
    }

    const clientActionService = getClientActionService(socketId);
    if (!clientActionService) {
      throw new Error('Client action service unavailable — cannot publish');
    }

    const publishOptions: { appId: string; commitHash?: string } = { appId };
    if (input.commitHash) {
      publishOptions.commitHash = input.commitHash;
    }
    const result = await executePublish(publishOptions, clientActionService);

    if (!result.success) {
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
    const domainAttachEnabled = (context?.metadata as any)?.permissions?.canPurchaseDomain ?? false;

    if (domainAttachEnabled) {
      try {
        const siteDataResult = await clientActionService.executeAction({
          action: 'getSiteData',
          params: { appId },
          timeoutMs: 10000,
        });

        if (siteDataResult.success && siteDataResult.result) {
          const siteData = siteDataResult.result as { domains?: SiteDomain[] };
          const hasCustom = hasCustomDomain(siteData.domains);
          shouldSuggestDomain = !hasCustom;

          if (!hasCustom) {
            try {
              const app = appRepo.findById(appId);
              if (app) {
                const purchasedResult = await memoryTool.readMemory(
                  { key: 'domain.purchased' },
                  app.path,
                  appId
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
      } catch (error) {
        logger.warn('skill.publishing.publish.domain-check-failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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

    const publishSupervisor = DevSupervisorClientFactory.createForPublishSupervisor(appId);
    if (!publishSupervisor) {
      return 'Publish supervisor unavailable — app may not be published yet, or publish task is not running. Try publishing first.';
    }

    let status: PublishStatusResponse;
    try {
      status = await publishSupervisor.getPublishStatus({
        lines: input.lines ?? 200,
        includeLogs: input.includeLogs ?? true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get publish status: ${errorMessage}`);
    }

    let message = `Version: ${status.version ? `${status.version.substring(0, 7)} (${status.version})` : 'none'}\n`;
    message += `Health: ${status.health.status}`;
    if (status.health.message) message += ` — ${status.health.message}`;
    message += `\nProcess: ${status.process.state}`;
    if (status.process.pid > 0) message += `, PID ${status.process.pid}`;
    if (status.process.uptime) message += `, up ${status.process.uptime}`;
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
