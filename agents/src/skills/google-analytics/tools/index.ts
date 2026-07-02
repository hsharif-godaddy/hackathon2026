import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { Logger } from '../../../logging/index.js';
import { DevSupervisorError } from '../../../services/DevSupervisorClient.js';
import { SecretsManagementTool } from '../../../tools/secrets-management-tool.js';
import { SkillLoaderTool } from '../../../tools/skill-loader-tool.js';
import { AppRepository } from '../../../database/repositories/AppRepository.js';

const logger = Logger.create({ component: 'google-analytics-skill' });
const ROOTLAYOUT_PATH = 'src/layouts/RootLayout.tsx';
const GA_COMPONENT_IMPORT = "import GoogleAnalytics from '@/components/GoogleAnalytics';";
const GA_COMPONENT_JSX = '      <GoogleAnalytics />';

type CheckConfigOutput =
  | { success: false; error: string; recoverable: boolean }
  | { configured: false; action: 'requiresSecret'; message: string }
  | { configured: true; success: true };

type InstallOutput =
  | { success: false; error: string; recoverable: boolean }
  | { success: true; filesInstalled: string[]; rootLayoutPatched: boolean };

/**
 * Tool 1: checkConfiguration
 *
 * Checks if GA_MEASUREMENT_ID secret is configured in the app.
 * Call this first to determine whether requestSecrets is needed.
 */
export const checkConfigurationTool: SkillToolDefinition = {
  name: 'checkConfiguration',
  description:
    'Check if the GA_MEASUREMENT_ID secret is configured for this app. ' +
    'Returns configured=true if ready to install, or action="requiresSecret" ' +
    'if the user needs to provide their Measurement ID first.',

  parameters: z.object({}),

  async execute(_input: Record<string, never>, context?: unknown): Promise<CheckConfigOutput> {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      logger.error('google-analytics.checkConfiguration.missing-app-id', {});
      return { success: false, error: 'App ID is required', recoverable: false };
    }

    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) {
      logger.error('google-analytics.checkConfiguration.workspace-unavailable', { appId });
      return {
        success: false,
        error: 'Workspace not available. The app container may not be running.',
        recoverable: true,
      };
    }

    try {
      const secretsTool = new SecretsManagementTool(workspace.tasks);
      const result = await secretsTool.listSecretNames(appId);

      if (!result.success) {
        logger.warn('google-analytics.checkConfiguration.secret-check-failed', {
          appId,
          error: result.error,
        });
        return {
          configured: false,
          action: 'requiresSecret',
          message:
            'Could not verify secret configuration. ' +
            'Call requestSecrets to collect the GA4 Measurement ID from the user.',
        };
      }

      const hasGaSecret = result.secretNames.includes('GA_MEASUREMENT_ID');

      if (hasGaSecret) {
        logger.info('google-analytics.checkConfiguration.configured', { appId });
        return { configured: true, success: true };
      }

      logger.info('google-analytics.checkConfiguration.not-configured', { appId });
      return {
        configured: false,
        action: 'requiresSecret',
        message:
          'GA_MEASUREMENT_ID is not configured. ' +
          'Call requestSecrets to collect the GA4 Measurement ID from the user.',
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('google-analytics.checkConfiguration.error', { appId, error });
      return { success: false, error, recoverable: true };
    }
  },

  computeState(_input: unknown, output: CheckConfigOutput): Record<string, unknown> | null {
    if ('error' in output && !('configured' in output)) {
      return {
        workflowState: 'check-failed',
        lastError: output.error,
        nextStep: 'retry-check',
        updatedAt: new Date().toISOString(),
      };
    }

    if ('configured' in output && !output.configured) {
      return {
        workflowState: 'unconfigured',
        nextStep: 'request-secret',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    if ('configured' in output && output.configured) {
      return {
        workflowState: 'configured',
        nextStep: 'install-analytics',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return null;
  },
};

/**
 * Tool 2: installAnalytics
 *
 * Installs Google Analytics templates and patches RootLayout.
 * Single tool call that handles the full installation:
 * 1. Installs template files via SkillLoaderTool.installTemplates() (includes route regen)
 * 2. Patches RootLayout.tsx to include <GoogleAnalytics /> (idempotent)
 */
export const installAnalyticsTool: SkillToolDefinition = {
  name: 'installAnalytics',
  description:
    'Install Google Analytics 4 into the app. Copies template files (component + API route) ' +
    'and patches RootLayout.tsx to include the GoogleAnalytics component. Idempotent — ' +
    'safe to call multiple times. Call after GA_MEASUREMENT_ID secret is configured.',

  parameters: z.object({}),

  async execute(_input: Record<string, never>, context?: unknown): Promise<InstallOutput> {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      logger.error('google-analytics.installAnalytics.missing-app-id', {});
      return { success: false, error: 'App ID is required', recoverable: false };
    }

    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) {
      logger.error('google-analytics.installAnalytics.workspace-unavailable', { appId });
      return {
        success: false,
        error: 'Workspace not available. The app container may not be running.',
        recoverable: true,
      };
    }

    const appRepo = new AppRepository();
    const app = appRepo.findById(appId);
    if (!app) {
      logger.error('google-analytics.installAnalytics.app-not-found', { appId });
      return { success: false, error: `App not found: ${appId}`, recoverable: false };
    }

    try {
      // Step 1: Install template files via the shared skill installer
      const skillLoader = new SkillLoaderTool();
      const installResult = await skillLoader.installTemplates({
        skill: 'google-analytics',
        appPath: app.path,
        appId,
      });

      if (!installResult.success) {
        logger.error('google-analytics.installAnalytics.template-install-failed', {
          appId,
          error: installResult.error,
        });
        return {
          success: false,
          error: installResult.error || 'Failed to install template files',
          recoverable: true,
        };
      }

      const installedFiles: string[] = installResult.installedFiles || [];

      // Step 2: Patch RootLayout.tsx using line-based insertion for robust editing
      let rootLayoutPatched = false;
      try {
        const rootLayoutContent: string = await workspace.files.readText({ path: ROOTLAYOUT_PATH });

        const hasImport = rootLayoutContent.includes(GA_COMPONENT_IMPORT);
        const hasComponent = rootLayoutContent.includes('<GoogleAnalytics');

        if (!hasImport || !hasComponent) {
          if (!hasImport) {
            const lastImportLine = rootLayoutContent
              .split('\n')
              .reduce((acc: number, line: string, i: number) =>
                /^import /.test(line) ? i : acc, -1);
            await workspace.files.insert({
              path: ROOTLAYOUT_PATH,
              line: lastImportLine >= 0 ? lastImportLine + 2 : 1,
              content: GA_COMPONENT_IMPORT,
            });
          }

          if (!hasComponent) {
            const refreshedContent: string = await workspace.files.readText({ path: ROOTLAYOUT_PATH });
            const websiteMatch: RegExpMatchArray | null = refreshedContent.match(/<Website[\s>]/);
            if (!websiteMatch) {
              logger.warn('google-analytics.installAnalytics.no-website-element', { appId });
              return {
                success: false,
                error: 'Could not find <Website> element in RootLayout.tsx to insert GoogleAnalytics component',
                recoverable: false,
              };
            }
            const websiteLineIndex: number = refreshedContent
              .slice(0, websiteMatch.index)
              .split('\n').length;
            await workspace.files.insert({
              path: ROOTLAYOUT_PATH,
              line: websiteLineIndex + 1,
              content: GA_COMPONENT_JSX,
            });
          }

          rootLayoutPatched = true;
          logger.info('google-analytics.installAnalytics.rootlayout-patched', { appId });
        } else {
          logger.info('google-analytics.installAnalytics.rootlayout-already-patched', { appId });
        }
      } catch (layoutErr: unknown) {
        const isNotFound =
          layoutErr instanceof DevSupervisorError && layoutErr.code === 'not_found';
        if (isNotFound) {
          logger.warn('google-analytics.installAnalytics.rootlayout-not-found', { appId });
          return {
            success: false,
            error: 'RootLayout.tsx not found at src/layouts/RootLayout.tsx',
            recoverable: false,
          };
        }
        throw layoutErr;
      }

      logger.info('google-analytics.installAnalytics.complete', {
        appId,
        filesInstalled: installedFiles.length,
        rootLayoutPatched,
      });

      return { success: true, filesInstalled: installedFiles, rootLayoutPatched };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('google-analytics.installAnalytics.error', { appId, error });
      return { success: false, error, recoverable: true };
    }
  },

  computeState(_input: unknown, output: InstallOutput): Record<string, unknown> | null {
    if (!output.success) {
      return {
        workflowState: 'install-failed',
        lastError: output.error,
        nextStep: 'retry-install',
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      workflowState: 'installed',
      filesInstalled: output.filesInstalled,
      rootLayoutPatched: output.rootLayoutPatched,
      nextStep: 'confirm-to-user',
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  },
};
