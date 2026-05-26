/**
 * GitOpsService
 *
 * Service class for handling git operations (push, pull) with job tracking.
 * Encapsulates business logic that was previously in route handlers.
 */

import { AppRepository } from '../database/repositories/AppRepository.js';
import { ImportJobRepository } from '../database/repositories/ImportJobRepository.js';
import { ImportJobStatus, type ImportJob } from '../types/import.js';
import { GitTool } from '../tools/git-tool.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { createForWorkspace } from '../workspace/index.js';
import { isSupportedProjectOnHost, matchesBuildToolOnHost, SUPPORTED_BUILD_TOOLS } from '../server/middleware/git-import-validation.js';
import { appRestartService, type BuildToolType } from './AppRestartService.js';
import { modifyViteConfig } from './ViteConfigModifier.js';
import { injectPortHandling } from './ExpressPortInjector.js';
import { codeSyncFileCleanupService } from './CodeSyncFileCleanupService.js';
import { projectSourceDetectionService } from './ProjectSourceDetectionService.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { bytesToMB } from '../utils/container-metrics.js';

const logger = Logger.create({ component: 'git-ops-service' });

/**
 * Base parameters for git sync operations
 */
export interface GitSyncParams {
  appId: string;
  remoteName?: string;
  branch?: string;
  token?: string;
  repoUrl?: string;
}

/**
 * Parameters for git push (extends base with forcePush option)
 */
export interface GitPushParams extends GitSyncParams {
  forcePush?: boolean;
}

/**
 * Command overrides for PaaS imports
 * Allows customers to specify custom install/build/start commands
 */
export interface CommandOverrides {
  /** Custom install command (default: 'npm install') */
  install?: string;
  /** Custom build command (default: 'npm run build') */
  build?: string;
  /** Custom dev command for runtime.dev.command */
  dev?: string;
  /** Custom start command (default: 'npm start' for Node.js, vite for Vite) */
  start?: string;
}

/**
 * Parameters for git pull (extends base with vite config modification option)
 */
export interface GitPullParams extends GitSyncParams {
  /** Whether to modify vite config to set server.allowedHosts: true (for proxy compatibility) */
  modifyViteConfig?: boolean;
  /** Entry file for Node.js projects (e.g., 'src/server.ts') */
  entryFile?: string;
  /** Custom commands to override defaults */
  commands?: CommandOverrides;
}

/**
 * Result from starting a git operation
 */
export interface GitOperationStartResult {
  success: boolean;
  jobId?: string;
  status?: ImportJobStatus;
  error?: string;
  errorCode?: 'APP_NOT_FOUND' | 'CONTAINER_UNAVAILABLE' | 'JOB_IN_PROGRESS' | 'INTERNAL_ERROR';
  existingJobId?: string;
}

/**
 * Result from getting job status
 */
export interface GitJobStatusResult {
  success: boolean;
  job?: ImportJob;
  error?: string;
  errorCode?: 'JOB_NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR';
}

export class GitOpsService {
  private appRepository = new AppRepository();
  private importJobRepo = new ImportJobRepository();

  /**
   * Start an async git push operation
   *
   * Creates a job record and returns immediately with job ID.
   * The actual push operation runs in the background.
   *
   * @param params - Push operation parameters
   * @returns Result with job ID for status polling
   */
  async startPush(params: GitPushParams): Promise<GitOperationStartResult> {
    const { appId, remoteName, branch, forcePush, token, repoUrl } = params;

    logger.info('git-ops.push.begin', {
      appId,
      remoteName: remoteName || 'origin',
      branch,
      forcePush: forcePush || false,
    });

    try {
      // Validate credential pattern: both token and repoUrl must be provided together, or neither
      const hasToken = token !== undefined && token !== '';
      const hasRepoUrl = repoUrl !== undefined && repoUrl !== '';
      if (hasToken !== hasRepoUrl) {
        logger.warn('git-ops.push.invalid-pattern', {
          appId,
          hasToken,
          hasRepoUrl,
        });
        return {
          success: false,
          error: 'Both repoUrl and token must be provided together, or neither',
          errorCode: 'INTERNAL_ERROR',
        };
      }

      // Get app
      const app = this.appRepository.findById(appId);
      if (!app) {
        return { success: false, error: 'App not found', errorCode: 'APP_NOT_FOUND' };
      }

      // Get dev-supervisor for the app
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor || !devSupervisor.isAvailable()) {
        return {
          success: false,
          error: 'App container is not available',
          errorCode: 'CONTAINER_UNAVAILABLE',
        };
      }

      // Check for existing active job
      const existingJob = await this.importJobRepo.findByAppId(appId);
      if (existingJob && existingJob.status !== ImportJobStatus.COMPLETED && existingJob.status !== ImportJobStatus.FAILED) {
        return {
          success: false,
          error: 'An import or sync operation is already in progress',
          errorCode: 'JOB_IN_PROGRESS',
          existingJobId: existingJob.id,
        };
      }

      // Create import job for tracking
      const job = await this.importJobRepo.create({
        appId,
        sourceType: 'git_push',
        gitBranch: branch,
      });

      // Execute push operation in background
      setImmediate(async () => {
        await this.executePushInBackground(job.id, appId, app.path, {
          remoteName: remoteName || 'origin',
          branch,
          forcePush: forcePush || false,
          token,
          repoUrl,
        });
      });

      return {
        success: true,
        jobId: job.id,
        status: job.status,
      };
    } catch (error) {
      logger.error('git-ops.push.exception', {
        appId,
        error: getErrorMessage(error),
      });

      return {
        success: false,
        error: getErrorMessage(error),
        errorCode: 'INTERNAL_ERROR',
      };
    }
  }

  /**
   * Execute git push in background
   */
  private async executePushInBackground(
    jobId: string,
    appId: string,
    appPath: string,
    options: {
      remoteName: string;
      branch?: string;
      forcePush: boolean;
      token?: string;
      repoUrl?: string;
    }
  ): Promise<void> {

    try {
      await this.importJobRepo.updateStatus(jobId, ImportJobStatus.PUSHING);

      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        logger.error('git-ops.push.workspace.unavailable', {
          appId,
          jobId,
          stage: 'pushing',
        });
        await this.importJobRepo.markFailed(
          jobId,
          'Workspace no longer available',
          'pushing'
        );
        return;
      }

      const gitTool = new GitTool(workspace.tasks);

      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'push',
        remoteName: options.remoteName,
        branch: options.branch,
        forcePush: options.forcePush,
        token: options.token,
        repoUrl: options.repoUrl,
      });

      if (!result.success) {
        logger.error('git-ops.push.error', {
          appId,
          jobId,
          error: result.error,
        });

        await this.importJobRepo.markFailed(
          jobId,
          result.error || 'Git push failed',
          'pushing'
        );
        return;
      }

      logger.info('git-ops.push.success', { appId, jobId });
      await this.importJobRepo.markCompleted(jobId);
    } catch (error) {
      logger.error('git-ops.push.exception', {
        appId,
        jobId,
        error: getErrorMessage(error),
      });

      await this.importJobRepo.markFailed(
        jobId,
        getErrorMessage(error),
        'pushing'
      );
    }
  }

  /**
   * Start an async git pull operation
   *
   * Creates a job record and returns immediately with job ID.
   * The actual pull operation runs in the background.
   *
   * @param params - Pull operation parameters
   * @returns Result with job ID for status polling
   */
  async startPull(params: GitPullParams): Promise<GitOperationStartResult> {
    const { appId, remoteName, branch, token, repoUrl, modifyViteConfig: shouldModifyViteConfig } = params;

    logger.info('git-ops.pull.begin', {
      appId,
      remoteName: remoteName || 'origin',
      branch,
      modifyViteConfig: shouldModifyViteConfig,
    });

    try {
      // Validate credential pattern: both token and repoUrl must be provided together, or neither
      const hasToken = token !== undefined && token !== '';
      const hasRepoUrl = repoUrl !== undefined && repoUrl !== '';
      if (hasToken !== hasRepoUrl) {
        logger.warn('git-ops.pull.invalid-pattern', {
          appId,
          hasToken,
          hasRepoUrl,
        });
        return {
          success: false,
          error: 'Both repoUrl and token must be provided together, or neither',
          errorCode: 'INTERNAL_ERROR',
        };
      }

      // Get app
      const app = this.appRepository.findById(appId);
      if (!app) {
        return { success: false, error: 'App not found', errorCode: 'APP_NOT_FOUND' };
      }

      // Get dev-supervisor for the app
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor || !devSupervisor.isAvailable()) {
        return {
          success: false,
          error: 'App container is not available',
          errorCode: 'CONTAINER_UNAVAILABLE',
        };
      }

      // Check for existing active job
      const existingJob = await this.importJobRepo.findByAppId(appId);
      if (existingJob && existingJob.status !== ImportJobStatus.COMPLETED && existingJob.status !== ImportJobStatus.FAILED) {
        return {
          success: false,
          error: 'An import or sync operation is already in progress',
          errorCode: 'JOB_IN_PROGRESS',
          existingJobId: existingJob.id,
        };
      }

      // Create import job for tracking
      const job = await this.importJobRepo.create({
        appId,
        sourceType: 'git_pull',
        gitBranch: branch,
      });

      // Execute pull operation in background
      setImmediate(async () => {
        await this.executePullInBackground(job.id, appId, app.path, {
          remoteName: remoteName || 'origin',
          branch,
          token,
          repoUrl,
          modifyViteConfig: shouldModifyViteConfig,
          entryFile: params.entryFile,
          commands: params.commands,
        });
      });

      return {
        success: true,
        jobId: job.id,
        status: job.status,
      };
    } catch (error) {
      logger.error('git-ops.pull.exception', {
        appId,
        error: getErrorMessage(error),
      });

      return {
        success: false,
        error: getErrorMessage(error),
        errorCode: 'INTERNAL_ERROR',
      };
    }
  }

  /**
   * Execute git pull in background
   */
  private async executePullInBackground(
    jobId: string,
    appId: string,
    appPath: string,
    options: {
      remoteName: string;
      branch?: string;
      token?: string;
      repoUrl?: string;
      modifyViteConfig?: boolean;
      entryFile?: string;
      commands?: CommandOverrides;
    }
  ): Promise<void> {

    try {
      await this.importJobRepo.updateStatus(jobId, ImportJobStatus.PULLING);

      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        logger.error('git-ops.pull.workspace.unavailable', {
          appId,
          jobId,
          stage: 'pulling',
        });
        await this.importJobRepo.markFailed(
          jobId,
          'Workspace no longer available',
          'pulling'
        );
        return;
      }

      const gitTool = new GitTool(workspace.tasks);
      // Phase 3 services (codeSyncFileCleanupService, modifyViteConfig, injectPortHandling)
      // still accept DevSupervisorClient — will be migrated separately.
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor) {
        logger.error('git-ops.pull.devSupervisor.unavailable', {
          appId,
          jobId,
          stage: 'pulling',
          kind: 'devSupervisor',
        });
        await this.importJobRepo.markFailed(
          jobId,
          'DevSupervisor no longer available for post-pull services',
          'pulling'
        );
        return;
      }

      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'pull',
        remoteName: options.remoteName,
        branch: options.branch,
        token: options.token,
        repoUrl: options.repoUrl,
        allowUnrelatedHistories: true,
        noRebase: true,
      });

      if (!result.success) {
        logger.error('git-ops.pull.error', {
          appId,
          jobId,
          error: result.error,
        });

        await this.importJobRepo.markFailed(
          jobId,
          result.error || 'Git pull failed',
          'pulling'
        );
        return;
      }

      // Validate pulled code uses a supported build tool and detect which one
      const supportedToolNames = SUPPORTED_BUILD_TOOLS.map(t => t.name).join(', ');
      const matchedTool = SUPPORTED_BUILD_TOOLS.find(tool => matchesBuildToolOnHost(appPath, tool));

      if (!matchedTool) {
        logger.error('git-ops.pull.unsupported-project', { appId, jobId, supportedTools: supportedToolNames });

        // Rollback the pull using ORIG_HEAD
        const rollbackResult = await gitTool.executeGitOperation(appPath, {
          operation: 'reset',
          options: { mode: 'hard', hash: 'ORIG_HEAD' },
        });

        const rollbackFailed = !rollbackResult.success;
        if (rollbackFailed) {
          logger.error('git-ops.pull.rollback-failed', {
            appId,
            jobId,
            error: rollbackResult.error,
          });
        }

        await this.importJobRepo.markFailed(
          jobId,
          rollbackFailed
            ? `Unsupported project (${supportedToolNames}). Rollback failed - repository may be inconsistent.`
            : `Unsupported project (${supportedToolNames}). Changes rolled back.`,
          'pulling'
        );
        return;
      }

      // Clean up junk/security-sensitive files after pull (single command, no scanning).
      // Exclude .git/ — it must be preserved for subsequent pulls to work.
      await codeSyncFileCleanupService.deleteCleanablePatterns(devSupervisor, '/app', ['.git/']);
      logger.info('git-ops.pull.cleanup-files.complete', { appId, jobId });

      projectSourceDetectionService.detectAndLogInBackground({
        appId,
        appPath,
        jobId,
        trigger: 'git_pull',
      });

      // Always use Node.js build tool type (Vite detection removed)
      const buildToolType: BuildToolType = 'nodejs';

      // Modify vite config if requested (for proxy compatibility).
      // Non-fatal: failures are logged as warnings but don't fail the job,
      // matching zip import behavior. The app may still work without this modification.
      if (options.modifyViteConfig) {
        const viteConfigResult = await modifyViteConfig(devSupervisor, '/app');
        if (viteConfigResult.modified) {
          logger.info('git-ops.pull.vite-config.modified', {
            appId,
            jobId,
            configFile: viteConfigResult.configFile,
          });
        } else if (viteConfigResult.error) {
          logger.warn('git-ops.pull.vite-config.warning', {
            appId,
            jobId,
            error: viteConfigResult.error,
          });
        }
      }

      // For Node.js projects, inject PORT handling
      if (buildToolType === 'nodejs') {
        if (!options.entryFile) {
          logger.warn('git-ops.pull.nodejs.no-entry-file', {
            appId,
            jobId,
            message: 'Node.js project detected but no entryFile provided. Skipping PORT injection.',
          });
        } else {
          logger.info('git-ops.pull.nodejs.port-injection.start', {
            appId,
            jobId,
            entryFile: options.entryFile,
          });

          const portInjectionResult = await injectPortHandling(
            devSupervisor,
            '/app',
            options.entryFile
          );

          if (portInjectionResult.modified) {
            logger.info('git-ops.pull.nodejs.port-injection.success', {
              appId,
              jobId,
              entryFile: options.entryFile,
            });
          } else if (portInjectionResult.skipped) {
            logger.info('git-ops.pull.nodejs.port-injection.skipped', {
              appId,
              jobId,
              reason: portInjectionResult.reason,
            });
          } else if (portInjectionResult.error) {
            logger.warn('git-ops.pull.nodejs.port-injection.failed', {
              appId,
              jobId,
              error: portInjectionResult.error,
            });
            // Don't fail - the user might have already configured PORT handling
          }
        }
      }

      // Perform restart cycle with custom commands and build tool type
      const restartResult = await appRestartService.performFullRestartCycle(appId, appPath, {
        buildToolType,
        installOptions: { legacyPeerDeps: true },
        commands: options.commands,
      });

      if (!restartResult.success) {
        logger.error('git-ops.pull.restart-failed', {
          appId,
          jobId,
          error: restartResult.error,
          phases: restartResult.phases,
        });
        await this.importJobRepo.markFailed(
          jobId,
          restartResult.error || 'Restart failed after git pull',
          'restarting'
        );
        return;
      }

      // Log consolidated metrics for git pull (use -1 for missing values to keep consistent numeric type in ES)
      const metrics = restartResult.metrics ?? {};
      logger.info('git-ops.pull.metrics', {
        appId,
        jobId,
        sourceType: 'git_pull',
        installDurationMs: metrics.installDurationMs ?? -1,
        buildDurationMs: metrics.buildDurationMs ?? -1,
        startDurationMs: metrics.startDurationMs ?? -1,
        appDirSizeMB: bytesToMB(metrics.appDirSizeBytes),
      });

      // Commit pulled changes only after successful restart
      void this.commitPostPulledChanges(gitTool, appPath, appId, jobId);
      logger.info('git-ops.pull.success', { appId, jobId });
      await this.importJobRepo.markCompleted(jobId);
    } catch (error) {
      logger.error('git-ops.pull.exception', {
        appId,
        jobId,
        error: getErrorMessage(error),
      });

      await this.importJobRepo.markFailed(
        jobId,
        getErrorMessage(error),
        'pulling'
      );
    }
  }

  /**
   * Commit pulled changes to local repository
   *
   * Stages all changes and commits them to ensure the local git state is clean.
   * This is called after a successful restart to persist the pulled changes.
   *
   * @param gitTool - GitTool instance
   * @param appPath - Path to the app
   * @param appId - App ID for logging
   * @param jobId - Job ID for logging
   */
  private async commitPostPulledChanges(
    gitTool: GitTool,
    appPath: string,
    appId: string,
    jobId: string
  ): Promise<void> {
    // This is a non-blocking step - failures should not affect the pull operation
    try {
      logger.info('git-ops.pull.committing', { appId, jobId });

      // Stage all changes
      const addResult = await gitTool.executeGitOperation(appPath, {
        operation: 'add',
        files: ['.'],
      });

      if (!addResult.success) {
        logger.warn('git-ops.pull.add-failed', {
          appId,
          jobId,
          error: addResult.error,
        });
        return;
      }

      // Commit the changes
      const commitResult = await gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: 'Post-pull state commit',
      });

      if (!commitResult.success) {
        // Commit may fail if there are no changes to commit (already clean)
        // This is not an error condition
        logger.info('git-ops.pull.commit-skipped', {
          appId,
          jobId,
          reason: commitResult.error,
        });
      } else {
        logger.info('git-ops.pull.commit-success', { appId, jobId });
      }
    } catch (error) {
      // Log and swallow any unexpected errors - commit is non-blocking
      logger.warn('git-ops.pull.commit-error', {
        appId,
        jobId,
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Get status of a specific git sync job
   *
   * @param appId - App ID (for ownership verification)
   * @param jobId - Job ID to look up
   * @returns Job status result
   */
  async getJobStatus(appId: string, jobId: string): Promise<GitJobStatusResult> {
    logger.info('git-ops.status.begin', { appId, jobId });

    try {
      const job = await this.importJobRepo.findById(jobId);

      if (!job) {
        return {
          success: false,
          error: `No sync operation found with ID: ${jobId}`,
          errorCode: 'JOB_NOT_FOUND',
        };
      }

      // Verify the job belongs to this app
      if (job.appId !== appId) {
        return {
          success: false,
          error: 'This job does not belong to the specified app',
          errorCode: 'FORBIDDEN',
        };
      }

      logger.info('git-ops.status.success', {
        appId,
        jobId: job.id,
        status: job.status,
        sourceType: job.sourceType,
      });

      return {
        success: true,
        job,
      };
    } catch (error) {
      logger.error('git-ops.status.exception', {
        appId,
        jobId,
        error: getErrorMessage(error),
      });

      return {
        success: false,
        error: getErrorMessage(error),
        errorCode: 'INTERNAL_ERROR',
      };
    }
  }
}

// Export singleton instance
export const gitOpsService = new GitOpsService();
