/**
 * ProjectImportService
 *
 * Orchestrates the complete zip import flow with container-side processing.
 *
 * @see docs/zip-import-plan.md for architecture and design decisions
 */

import { rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Logger } from '../logging/index.js';
import { ImportJobRepository, UpdateImportJobParams } from '../database/repositories/ImportJobRepository.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { zipSecurityService } from './ZipSecurityService.js';
import { gitCloneService } from './GitCloneService.js';
import { codeSyncFileCleanupService } from './CodeSyncFileCleanupService.js';
import { projectSourceDetectionService } from './ProjectSourceDetectionService.js';
import { modifyViteConfig } from './ViteConfigModifier.js';
import {
  appRestartService,
  DEFAULT_START_COMMAND,
  getInstallCommand,
  getBuildCommand,
  detectPackageManager,
  type PackageManager,
} from './AppRestartService.js';
import { measureAppDirSize, bytesToMB } from '../utils/container-metrics.js';
import { injectPortHandling } from './ExpressPortInjector.js';
import { GitTool } from '../tools/git-tool.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { DevSupervisorClient } from './DevSupervisorClient.js';
import { ImportJobStatus, ValidationErrorKey, type ImportJob, type ValidationError } from '../types/import.js';
import {
  isSupportedProjectInContainer,
  SUPPORTED_BUILD_TOOLS,
} from '../server/middleware/git-import-validation.js';
import { diagnoseSnapshotService } from './DiagnoseSnapshotService.js';

/**
 * Airo platform-specific .gitignore patterns
 * These patterns are essential for proper platform operation and should be present in all apps
 */
const AIRO_GITIGNORE_PATTERNS = [
  'node_modules',
  '.import-*',
  '.api/',
  '.ssl/*.pem',
  '.claude/',
  '.env',
  '.env.local',
  '.env.*.local',
] as const;

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
 * Parameters for starting an import
 */
export interface StartImportParams {
  appId: string;
  appName: string;
  sourceType: 'zip';

  // For zip imports
  zipPath?: string;
  zipFileName?: string;
  zipFileSize?: number;

  // For PaaS Node.js imports
  /** Entry file for Node.js projects (e.g., 'src/server.ts') */
  entryFile?: string;
  /** Product ID (e.g., 'paas-nodejs-v1') for runtime behavior */
  productId?: string;
  /** Custom commands to override defaults */
  commands?: CommandOverrides;
}

/**
 * Result of project validation
 */
interface PackageJsonInfo {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export type ServeCommandSource = 'user' | 'scripts.start' | 'scripts.dev' | 'default';

/**
 * Resolve the PaaS start command and attribution. Extracted from `importZipFile`
 * so the fallback chain is directly testable and the `serveCommandSource`
 * attribution (surfaced in the `project-import.config.create` Loki event)
 * can be asserted without re-implementing the formula in tests.
 *
 * Priority: user-provided → scripts.start → scripts.dev → default.
 * Dev-script fallback forces NODE_ENV=development because some Vite/React
 * apps break when `<pm> run dev` runs under NODE_ENV=production.
 */
export function resolveStartCommand(
  userStart: string | undefined,
  validation: { hasStartScript?: boolean; hasDevScript?: boolean },
  pm: string
): { startCommand: string; serveCommandSource: ServeCommandSource } {
  if (userStart) {
    return { startCommand: userStart, serveCommandSource: 'user' };
  }
  if (validation.hasStartScript) {
    return { startCommand: `${pm} start`, serveCommandSource: 'scripts.start' };
  }
  if (validation.hasDevScript) {
    return {
      startCommand: `NODE_ENV=development ${pm} run dev`,
      serveCommandSource: 'scripts.dev',
    };
  }
  return { startCommand: DEFAULT_START_COMMAND, serveCommandSource: 'default' };
}

export class ProjectImportService {
  private logger = Logger.create({ component: 'project-import' });
  private importJobRepo = new ImportJobRepository();
  private appRepo = new AppRepository();

  /**
   * Start the import process for a zip file or git repository
   * This creates the import job and begins background processing
   *
   * @param params - Import parameters
   * @returns Created import job
   */
  async startImport(params: StartImportParams): Promise<ImportJob> {
    const { appId, sourceType } = params;

    this.logger.info('project-import.start', {
      appId,
      sourceType,
      zipFileName: params.zipFileName,
      zipFileSize: params.zipFileSize,
    });

    // Create import job
    const job = await this.importJobRepo.create({
      appId,
      sourceType,
      zipFileName: params.zipFileName!,
      zipFileSize: params.zipFileSize!,
    });

    // Start background processing (don't await)
    this.processImport(job.id, params).catch(error => {
      this.logger.error('project-import.background.failed', {
        jobId: job.id,
        appId,
        sourceType,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return job;
  }

  /**
   * Process the import in the background
   *
   * This method implements container-side processing:
   * For Zip: 1. Validate zip on agent (security) 2. Copy zip to container 3. Extract inside container
   * For Git: 1. Clone repository inside container using dev-supervisor
   * Then: Validate, copy files, install, build, commit, restart
   *
   * @param jobId - Import job ID
   * @param params - Import parameters
   */
  private async processImport(jobId: string, params: StartImportParams): Promise<void> {
    const { appId, sourceType } = params;
    // Paths for container-side operations
    let containerZipPath: string | null = null;
    let containerExtractPath: string | null = null;
    let containerProjectPath: string | null = null;
    let agentZipPath: string | undefined;

    try {
      // Mark as started
      await this.importJobRepo.update(jobId, {
        startedAt: new Date(),
      });

      // Get app info
      const app = this.appRepo.findById(appId);
      if (!app) {
        throw new Error(`App not found: ${appId}`);
      }

      // Validate app path exists (shared mount point)
      if (!app.path || !existsSync(app.path)) {
        throw new Error(`App path not found or not accessible: ${app.path}`);
      }

      // Get dev-supervisor client for container operations
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor) {
        throw new Error('Dev supervisor not available for container operations');
      }

      // Zip import flow
      const zipPath = params.zipPath!;

      // Phase 1: Validate zip on agent (security checks)
      await this.updateStatus(jobId, ImportJobStatus.VALIDATING);
      const securityValidation = await zipSecurityService.validate(zipPath);

      if (!securityValidation.valid) {
        this.logger.error('project-import.security-validation.failed', {
          jobId,
          appId,
          errors: securityValidation.errors,
          stats: securityValidation.stats,
        });

        await this.importJobRepo.markFailed(
          jobId,
          'Zip security validation failed',
          ImportJobStatus.VALIDATING,
          securityValidation.errors
        );
        await this.cleanupZipFile(zipPath);
        return;
      }

      this.logger.info('project-import.security-validation.success', {
        jobId,
        appId,
        stats: securityValidation.stats,
      });

      // Phase 2: Copy zip to container via shared filesystem
      await this.updateStatus(jobId, ImportJobStatus.EXTRACTING);

      agentZipPath = join(app.path, `.import-${jobId}.zip`);
      containerZipPath = `/app/.import-${jobId}.zip`;
      containerExtractPath = `/app/.import-${jobId}-extract`;

      this.logger.info('project-import.copy-zip-to-container', {
        jobId,
        appId,
        sourceZipPath: zipPath,
        agentZipPath,
        containerZipPath,
      });

      // Copy zip file to container via shared filesystem mount (agent-side path)
      await cp(zipPath, agentZipPath);

      // Phase 3: Extract zip inside container (container-side paths for dev-supervisor)
      const extractResult = await this.extractZipInContainer(
        devSupervisor,
        containerZipPath,
        containerExtractPath,
        { jobId, appId }
      );

      if (!extractResult.success) {
        this.logger.error('project-import.extraction.failed', {
          jobId,
          appId,
          stage: ImportJobStatus.EXTRACTING,
          errors: extractResult.errors,
        });
        await this.preserveDiagnoseSnapshotForFailure({
          jobId,
          appId,
          appPath: app.path,
          agentZipPath,
        });
        await this.importJobRepo.markFailed(
          jobId,
          'Zip extraction failed in container',
          ImportJobStatus.EXTRACTING,
          extractResult.errors
        );
        await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
        await this.cleanupZipFile(params.zipPath!);
        return;
      }

      containerProjectPath = containerExtractPath;

      // Continue with shared flow
      // At this point, containerProjectPath contains the extracted zip

      // Phase 4: Validate project structure in container
      await this.updateStatus(jobId, ImportJobStatus.VALIDATING);
      const validation = await this.validateProjectInContainer(
        devSupervisor,
        containerProjectPath!
      );

      if (!validation.valid) {
        this.logger.error('project-import.validation.failed', {
          jobId,
          appId,
          stage: ImportJobStatus.VALIDATING,
          errors: validation.errors,
        });
        await this.preserveDiagnoseSnapshotForFailure({
          jobId,
          appId,
          appPath: app.path,
          agentZipPath,
        });
        await this.importJobRepo.markFailed(
          jobId,
          'Project validation failed',
          ImportJobStatus.VALIDATING,
          validation.errors
        );
        await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
        if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);
        return;
      }

      // Update job with project info
      const updateParams: UpdateImportJobParams = { extractedPath: containerProjectPath };
      if (validation.packageManager) updateParams.detectedPackageManager = validation.packageManager;
      if (validation.hasBuildScript !== undefined) updateParams.hasBuildScript = validation.hasBuildScript;
      if (validation.hasDevScript !== undefined) updateParams.hasDevScript = validation.hasDevScript;
      if (validation.warnings && validation.warnings.length > 0) {
        updateParams.validationErrors = validation.warnings;
      }
      await this.importJobRepo.update(jobId, updateParams);

      // Phase 5: Stop dev server before copying (to release file locks)
      this.logger.info('project-import.stop-server.start', { appId });
      const stopResult = await appRestartService.stopDevServer(appId);
      if (!stopResult.success) {
        this.logger.warn('project-import.stop-server.failed', {
          appId,
          error: stopResult.error,
        });
        // Continue anyway - cleanup might still work
      } else {
        // Wait a bit for process to fully terminate and release file locks
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.logger.info('project-import.stop-server.success', { appId });
      }

      // Phase 6a: Clean up junk/security-sensitive files BEFORE copy
      // Delete all configured patterns from extracted directory so they never overwrite existing app files
      const extractedProjectPath = validation.projectRoot || containerProjectPath!;
      const cleanupResult = await codeSyncFileCleanupService.deleteCleanablePatterns(
        devSupervisor,
        extractedProjectPath
      );

      if (!cleanupResult.success) {
        this.logger.warn('project-import.pre-copy-cleanup.warning', {
          jobId,
          appId,
          error: cleanupResult.error,
        });
        // Continue anyway - cleanup failure shouldn't block import
      }

      // Phase 6: Copy files to app directory (inside container)
      await this.updateStatus(jobId, ImportJobStatus.COPYING);
      const copyResult = await this.copyFilesInContainer(
        devSupervisor,
        extractedProjectPath,
        app.path
      );

      if (!copyResult.success) {
        this.logger.error('project-import.copy.failed', {
          jobId,
          appId,
          stage: ImportJobStatus.COPYING,
          error: copyResult.error,
        });
        await this.preserveDiagnoseSnapshotForFailure({
          jobId,
          appId,
          appPath: app.path,
          agentZipPath,
        });
        await this.importJobRepo.markFailed(
          jobId,
          copyResult.error || 'Failed to copy files',
          ImportJobStatus.COPYING
        );
        await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
        if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);
        return;
      }

      // Add warnings for files detected during zip validation
      const cleanableFiles = securityValidation.cleanableFiles;
      if (cleanableFiles && cleanableFiles.length > 0) {
        const cleanedWarnings = codeSyncFileCleanupService.createWarnings(cleanableFiles);
        const existingWarnings = validation.warnings || [];
        await this.importJobRepo.update(jobId, {
          validationErrors: [...existingWarnings, ...cleanedWarnings],
        });

        this.logger.info('project-import.cleanup-files.success', {
          jobId,
          appId,
          cleanedCount: cleanableFiles.length,
        });
      }

      // Ensure .gitignore has Airo-specific patterns after copy
      await this.ensureAiroGitignorePatterns(
        devSupervisor,
        '/app',
        validation.hasGitignoreFile ?? false
      );

      projectSourceDetectionService.detectAndLogInBackground({
        appId,
        appPath: app.path,
        jobId,
        trigger: 'zip_import',
      });

      // Phase 7a: Inject PORT handling for entry file if provided
      if (params.entryFile) {
        this.logger.info('project-import.port-injection.start', {
          jobId,
          appId,
          entryFile: params.entryFile,
        });

        const portInjectionResult = await injectPortHandling(
          devSupervisor,
          '/app',
          params.entryFile
        );

        if (portInjectionResult.modified) {
          this.logger.info('project-import.port-injection.success', {
            jobId,
            appId,
            entryFile: params.entryFile,
          });
        } else if (portInjectionResult.skipped) {
          this.logger.info('project-import.port-injection.skipped', {
            jobId,
            appId,
            reason: portInjectionResult.reason,
          });
        } else if (portInjectionResult.error) {
          this.logger.warn('project-import.port-injection.failed', {
            jobId,
            appId,
            error: portInjectionResult.error,
          });
          // Don't fail the import - the user might have already configured PORT handling
        }
      }

      // Phase 7b: Modify vite config to allow all hosts (for proxy compatibility)
      // Use '/app' as this is the standard container mount
      const viteConfigResult = await modifyViteConfig(devSupervisor, '/app');
      if (viteConfigResult.modified) {
        this.logger.info('project-import.vite-config.modified', {
          jobId,
          appId,
          configFile: viteConfigResult.configFile,
        });
      } else if (viteConfigResult.error) {
        this.logger.warn('project-import.vite-config.warning', {
          jobId,
          appId,
          error: viteConfigResult.error,
        });
      }

      // Phase 8: Install dependencies (already runs in container via dev-supervisor)
      await this.updateStatus(jobId, ImportJobStatus.INSTALLING);
      const detectedPm = validation.packageManager || 'npm';
      const installStartTime = Date.now();
      const installResult = await appRestartService.runInstall(appId, app.path, detectedPm, { legacyPeerDeps: true });
      const installDurationMs = Date.now() - installStartTime;

      if (installResult.output) {
        await this.importJobRepo.update(jobId, { installOutput: installResult.output });
      }

      if (!installResult.success) {
        const installCommand = getInstallCommand(detectedPm, { legacyPeerDeps: true });
        const installFailedMsg = installResult.error || `${installCommand} failed`;
        this.logger.error('project-import.install.failed', {
          jobId,
          appId,
          stage: ImportJobStatus.INSTALLING,
          error: installResult.error,
          exitCode: installResult.exitCode,
          packageManager: detectedPm,
        });
        await this.preserveDiagnoseSnapshotForFailure({
          jobId,
          appId,
          appPath: app.path,
          agentZipPath,
        });
        await this.gitRollback(appId, app.path);
        await this.importJobRepo.markFailed(
          jobId,
          installFailedMsg,
          ImportJobStatus.INSTALLING,
          [{
            key: ValidationErrorKey.INSTALL_FAILED,
            message: installFailedMsg,
            details: { exitCode: installResult.exitCode, packageManager: detectedPm },
          }]
        );
        await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
        if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);
        return;
      }

      // Phase 9: Build (if script exists)
      let buildDurationMs: number | undefined;
      if (validation.hasBuildScript) {
        await this.updateStatus(jobId, ImportJobStatus.BUILDING);
        const buildStartTime = Date.now();
        const buildResult = await appRestartService.runBuild(appId, app.path, detectedPm);
        buildDurationMs = Date.now() - buildStartTime;

        if (buildResult.output) {
          await this.importJobRepo.update(jobId, { buildOutput: buildResult.output });
        }

        if (!buildResult.success) {
          const buildCommand = getBuildCommand(detectedPm);
          const buildFailedMsg = buildResult.error || `${buildCommand} failed`;
          this.logger.error('project-import.build.failed', {
            jobId,
            appId,
            stage: ImportJobStatus.BUILDING,
            error: buildResult.error,
            exitCode: buildResult.exitCode,
            packageManager: detectedPm,
          });
          await this.preserveDiagnoseSnapshotForFailure({
            jobId,
            appId,
            appPath: app.path,
            agentZipPath,
          });
          await this.gitRollback(appId, app.path);
          await this.importJobRepo.markFailed(
            jobId,
            buildFailedMsg,
            ImportJobStatus.BUILDING,
            [{
              key: ValidationErrorKey.BUILD_FAILED,
              message: buildFailedMsg,
              details: { exitCode: buildResult.exitCode, packageManager: detectedPm },
            }]
          );
          await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
          if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);
          return;
        }
      }

      // Phase 10: Create PaaS configuration file for uploaded apps
      const pm = validation.packageManager || 'npm';
      const { startCommand, serveCommandSource } = resolveStartCommand(
        params.commands?.start,
        validation,
        pm
      );
      this.logger.info('project-import.config.create', {
        jobId,
        appId,
        packageManager: pm,
        serveCommandSource,
      });
      await appRestartService.createPaasConfig(
        app.path,
        undefined,
        startCommand,
        params.productId,
        params.commands?.dev,
        pm,
        serveCommandSource,
        appId
      );
      this.logger.info('project-import.config.created', { jobId, appId });

      // Phase 10.5: Cleanup temp files BEFORE git commit to prevent them from being committed
      // The .import-{jobId}-extract/ directory must be removed before `git add .` runs
      this.logger.info('project-import.pre-commit-cleanup.start', {
        jobId,
        appId,
        containerZipPath,
        containerExtractPath
      });
      await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerExtractPath);
      this.logger.info('project-import.pre-commit-cleanup.complete', { jobId, appId });
      // Clear paths so we don't try to clean up again in error handler (idempotent)
      containerZipPath = null;
      containerExtractPath = null;
      // containerProjectPath points to containerExtractPath (or a subdirectory), already cleaned
      containerProjectPath = null;

      // Phase 11: Git commit
      await this.updateStatus(jobId, ImportJobStatus.COMMITTING);
      const commitResult = await this.gitCommit(appId, app.path);

      if (!commitResult.success) {
        this.logger.error('project-import.commit.failed', {
          jobId,
          appId,
          stage: ImportJobStatus.COMMITTING,
          error: commitResult.error,
        });
        await this.importJobRepo.markFailed(
          jobId,
          commitResult.error || 'Git commit failed',
          ImportJobStatus.COMMITTING,
          [{
            key: ValidationErrorKey.GIT_COMMIT_FAILED,
            message: commitResult.error || 'Git commit failed',
          }]
        );
        await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
        if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);
        return;
      }

      // Phase 12: Restart dev server with start command (or custom command)
      // Priority: user-provided command > start script > dev script > default
      await this.updateStatus(jobId, ImportJobStatus.RESTARTING);
      const restartStartTime = Date.now();
      const restartResult = await appRestartService.restartDevServer(appId, startCommand);
      const startDurationMs = Date.now() - restartStartTime;

      if (!restartResult.success) {
        this.logger.warn('project-import.restart.failed', {
          jobId,
          appId,
          error: restartResult.error,
        });
      }

      // Measure /app directory size
      const appDirSizeBytes = await measureAppDirSize(devSupervisor);

      // Log consolidated metrics for zip import (use -1 for missing values to keep consistent numeric type in ES)
      this.logger.info('project-import.metrics', {
        jobId,
        appId,
        sourceType,
        installDurationMs: installDurationMs ?? -1,
        buildDurationMs: buildDurationMs ?? -1,
        startDurationMs: startDurationMs ?? -1,
        appDirSizeMB: bytesToMB(appDirSizeBytes),
      });

      // Mark as completed
      await diagnoseSnapshotService.cleanupForApp(app.path, appId);
      await this.importJobRepo.markCompleted(jobId);
      this.appRepo.updateStatus(appId, 'created');

      this.logger.info('project-import.complete', { jobId, appId });

      // Cleanup agent-side zip file (container files already cleaned before commit)
      if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);

    } catch (error) {
      this.logger.error('project-import.failed', {
        jobId,
        appId,
        sourceType,
        error: error instanceof Error ? error.message : String(error),
      });

      await this.importJobRepo.markFailed(
        jobId,
        error instanceof Error ? error.message : 'Unknown error',
        'unknown'
      );

      // Best-effort cleanup
      try {
        const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
        if (devSupervisor) {
          await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      if (sourceType === 'zip' && params.zipPath) await this.cleanupZipFile(params.zipPath);
    }
  }

  /**
   * Update job status
   */
  private async updateStatus(jobId: string, status: ImportJobStatus): Promise<void> {
    await this.importJobRepo.updateStatus(jobId, status);
    this.logger.info('project-import.status', { jobId, status });
  }

  /**
   * Extract zip file inside the container using dev-supervisor exec
   *
   * @param devSupervisor - Client to execute commands in container
   * @param zipPath - Path to zip file inside container filesystem
   * @param extractPath - Destination path for extraction
   * @returns Extraction result
   */
  private async extractZipInContainer(
    devSupervisor: DevSupervisorClient,
    zipPath: string,
    extractPath: string,
    context: { jobId: string; appId: string }
  ): Promise<{ success: boolean; errors?: ValidationError[] }> {
    try {
      // Create extraction directory
      const mkdirResult = await devSupervisor.exec({
        command: `mkdir -p "${extractPath}"`,
        timeout: 10, // seconds
      });

      if (!mkdirResult.success) {
        return {
          success: false,
          errors: [{
            key: ValidationErrorKey.ZIP_CORRUPTED,
            message: 'Failed to create extraction directory',
            details: { stderr: mkdirResult.stderr },
          }],
        };
      }

      // Extract zip using unzip command in container
      const unzipResult = await devSupervisor.exec({
        command: `unzip -o "${zipPath}" -d "${extractPath}"`,
        timeout: 60, // 1 minute timeout for extraction (seconds)
      });

      if (!unzipResult.success) {
        this.logger.error('project-import.extract-in-container.failure', {
          jobId: context.jobId,
          appId: context.appId,
          zipPath,
          extractPath,
          exitCode: unzipResult.exit_code,
          stderr: unzipResult.stderr,
          timedOut: unzipResult.timed_out,
          executionTime: unzipResult.execution_time,
        });
        return {
          success: false,
          errors: [{
            key: ValidationErrorKey.ZIP_CORRUPTED,
            message: 'Zip extraction failed in container',
            details: { stderr: unzipResult.stderr, exitCode: unzipResult.exit_code },
          }],
        };
      }

      this.logger.info('project-import.extract-in-container.success', {
        zipPath,
        extractPath,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        errors: [{
          key: ValidationErrorKey.ZIP_CORRUPTED,
          message: error instanceof Error ? error.message : 'Extraction failed unexpectedly',
        }],
      };
    }
  }

  /**
   * Maximum depth to search for package.json in nested directories
   * Handles common zip structures where projects are wrapped in parent folders
   */
  private static readonly MAX_PROJECT_DEPTH = 3;

  /**
   * Directories to ignore when searching for project root
   * These are common artifacts from zip creation that should not be considered as project directories
   */
  private static readonly IGNORED_ZIP_DIRECTORIES = [
    '__MACOSX',      // macOS resource fork directory created by Finder
    '.DS_Store',     // macOS metadata file (not a directory, but filter anyway)
  ];

  /**
   * Find the project root directory by searching for package.json
   *
   * Handles nested zip structures by iteratively descending into single subdirectories
   * up to MAX_PROJECT_DEPTH levels. This handles common scenarios:
   * - package.json at root (depth 0)
   * - Single folder wrapping project (depth 1)
   * - Double-nested parent/app/ structure (depth 2)
   * - Up to MAX_PROJECT_DEPTH levels of nesting
   *
   * Ignores common zip artifacts like __MACOSX when determining if there's a single subdirectory.
   *
   * @param devSupervisor - Client to execute commands in container
   * @param extractPath - Starting path to search from
   * @param maxDepth - Maximum depth to search (default: MAX_PROJECT_DEPTH)
   * @returns Result with found status, project root path, and depth if found
   */
  private async findProjectRootInContainer(
    devSupervisor: DevSupervisorClient,
    extractPath: string,
    maxDepth: number = ProjectImportService.MAX_PROJECT_DEPTH
  ): Promise<{ found: boolean; projectRoot?: string; depth?: number }> {
    let currentPath = extractPath;

    for (let depth = 0; depth < maxDepth; depth++) {
      // Check if package.json exists at current level
      const checkResult = await devSupervisor.exec({
        command: `test -f "${currentPath}/package.json" && echo "found" || echo "notfound"`,
        timeout: 5,
      });

      if (checkResult.stdout?.trim() === 'found') {
        return { found: true, projectRoot: currentPath, depth };
      }

      // If not found, check for single subdirectory to descend into
      const lsResult = await devSupervisor.exec({
        command: `ls -1 "${currentPath}"`,
        timeout: 5,
      });

      const allEntries = (lsResult.stdout || '').trim().split('\n').filter(Boolean);

      // Filter out ignored directories (like __MACOSX)
      const entries = allEntries.filter(
        entry => !ProjectImportService.IGNORED_ZIP_DIRECTORIES.includes(entry)
      );

      if (entries.length !== 1 || !entries[0]) {
        // Multiple entries or empty - can't descend unambiguously
        this.logger.debug('project-import.find-root.stop-descent', {
          currentPath,
          depth,
          reason: entries.length === 0 ? 'empty_directory' : 'multiple_entries',
          allEntries,
          filteredEntries: entries,
        });
        break;
      }

      // Descend into the single subdirectory
      currentPath = join(currentPath, entries[0]);
    }

    this.logger.debug('project-import.find-root.not-found', {
      extractPath,
      maxDepth,
      lastSearchedPath: currentPath,
    });

    return { found: false };
  }

  /**
   * Validate the extracted project inside the container
   *
   * Checks for package.json, scripts, and detects package manager
   */
  private async validateProjectInContainer(
    devSupervisor: DevSupervisorClient,
    extractPath: string
  ): Promise<{
    valid: boolean;
    projectRoot?: string;
    packageManager?: PackageManager;
    hasBuildScript?: boolean;
    hasDevScript?: boolean;
    hasStartScript?: boolean;
    hasGitignoreFile?: boolean;
    matchedTool?: string;
    errors?: ValidationError[];
    warnings?: ValidationError[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Find project root - search up to MAX_PROJECT_DEPTH levels for package.json
    const findResult = await this.findProjectRootInContainer(devSupervisor, extractPath);

    if (!findResult.found || !findResult.projectRoot) {
      errors.push({
        key: ValidationErrorKey.PACKAGE_JSON_NOT_FOUND,
        message: `No package.json found in zip (searched up to ${ProjectImportService.MAX_PROJECT_DEPTH} levels deep)`,
        details: { searchedPath: extractPath, maxDepth: ProjectImportService.MAX_PROJECT_DEPTH },
      });
      return { valid: false, errors };
    }

    const projectRoot = findResult.projectRoot;

    // Log the depth for debugging
    this.logger.info('project-import.project-root-found', {
      extractPath,
      projectRoot,
      depth: findResult.depth,
    });

    // Read package.json content
    const catResult = await devSupervisor.exec({
      command: `cat "${projectRoot}/package.json"`,
      timeout: 5, // seconds
    });

    if (!catResult.success || !catResult.stdout) {
      errors.push({
        key: ValidationErrorKey.PACKAGE_JSON_NOT_FOUND,
        message: 'Could not read package.json',
      });
      return { valid: false, errors };
    }

    let packageJson: PackageJsonInfo;
    try {
      packageJson = JSON.parse(catResult.stdout);
    } catch {
      errors.push({
        key: ValidationErrorKey.PACKAGE_JSON_INVALID,
        message: 'package.json is not valid JSON',
      });
      return { valid: false, errors };
    }

    // Check for name field
    if (!packageJson.name) {
      warnings.push({
        key: ValidationErrorKey.PACKAGE_JSON_MISSING_NAME,
        message: 'package.json missing name field',
      });
    }

    // Check for supported build tool (required)
    const buildToolCheck = await isSupportedProjectInContainer(devSupervisor, projectRoot, packageJson);
    const supportedToolNames = SUPPORTED_BUILD_TOOLS.map(t => t.name).join(', ');

    if (!buildToolCheck.supported) {
      const allConfigFiles = SUPPORTED_BUILD_TOOLS.flatMap(t => [...t.configFiles]);
      errors.push({
        key: ValidationErrorKey.NOT_VITE_PROJECT,
        message: `Only ${supportedToolNames}-based projects are supported. No supported config file or dependency found.`,
        details: { searchedConfigs: allConfigFiles },
      });
      return { valid: false, errors };
    }

    // Detect package manager by checking lock files
    const packageManager = await detectPackageManager(devSupervisor, projectRoot);

    // Check for scripts
    const scripts = packageJson.scripts || {};
    const hasBuildScript = 'build' in scripts;
    const hasStartScript = 'start' in scripts;
    const hasDevScript = 'dev' in scripts || hasStartScript;

    if (!hasDevScript) {
      warnings.push({
        key: ValidationErrorKey.NO_DEV_SCRIPT,
        message: 'No dev or start script found in package.json',
      });
    }

    if (!hasBuildScript) {
      warnings.push({
        key: ValidationErrorKey.NO_BUILD_SCRIPT,
        message: 'No build script found in package.json, skipping build step',
      });
    }

    // Check if imported project has .gitignore
    const gitignoreCheckResult = await devSupervisor.exec({
      command: `test -f "${projectRoot}/.gitignore" && echo "found" || echo "notfound"`,
      timeout: 5, // seconds
    });
    const hasGitignoreFile = gitignoreCheckResult.stdout?.trim() === 'found';

    const result: {
      valid: boolean;
      projectRoot?: string;
      packageManager?: PackageManager;
      hasBuildScript?: boolean;
      hasDevScript?: boolean;
      hasStartScript?: boolean;
      hasGitignoreFile?: boolean;
      matchedTool?: string;
      errors?: ValidationError[];
      warnings?: ValidationError[];
    } = {
      valid: true,
      projectRoot,
      packageManager,
      hasBuildScript,
      hasDevScript,
      hasStartScript,
      hasGitignoreFile,
      matchedTool: buildToolCheck.matchedTool,
    };

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    return result;
  }

  /**
   * Copy files from extracted location to app directory inside container
   *
   * Uses shell commands via dev-supervisor to perform file operations
   */
  private async copyFilesInContainer(
    devSupervisor: DevSupervisorClient,
    projectRoot: string,
    appPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.logger.info('project-import.copy-in-container.start', { projectRoot, appPath });

      // Convert agent path to container path (/app is the standard container mount)
      const containerAppPath = '/app';

      // Delete all files except .git, .gitignore, and .is_ready
      // Preserve .gitignore so it's not lost when imported project doesn't have one
      // Persistent user data (media uploads) lives at /shared-storage/ (outside /app), so no special handling needed
      // Note: node_modules is NOT preserved - it gets deleted and recreated by npm install in Phase 8
      // Also delete /node_modules (root level) which contains Vite deps baked into the Docker image
      // This prevents conflicts when importing Next.js projects into Vite-based containers
      // Note: Using "rm -r -f" instead of "rm -rf" for /node_modules to avoid
      // triggering dev-supervisor's dangerous command detection which blocks "rm -rf /"
      const deleteResult = await devSupervisor.exec({
        command: `find "${containerAppPath}" -mindepth 1 -maxdepth 1 ! -name ".git" ! -name ".gitignore" ! -name ".is_ready" ! -name ".import-*" ! -name "public" -exec rm -rf {} + && { [ -d "${containerAppPath}/public" ] && find "${containerAppPath}/public" -mindepth 1 -maxdepth 1 ! -name "assets" -exec rm -rf {} + || true; } && { [ -d /node_modules ] && rm -r -f /node_modules || true; }`,
        timeout: 30, // seconds
      });

      if (!deleteResult.success) {
        this.logger.error('project-import.copy-in-container.cleanup-failed', {
          projectRoot,
          appPath,
          containerAppPath,
          stderr: deleteResult.stderr,
          exitCode: deleteResult.exit_code,
        });
        return {
          success: false,
          error: `Failed to clean app directory: ${deleteResult.stderr}`,
        };
      }

      // Copy new content from extracted project (excluding node_modules and .git)
      const copyResult = await devSupervisor.exec({
        command: `find "${projectRoot}" -mindepth 1 -maxdepth 1 ! -name "node_modules" ! -name ".git" -exec cp -r {} "${containerAppPath}/" \\;`,
        timeout: 60, // seconds
      });

      if (!copyResult.success) {
        return {
          success: false,
          error: `Failed to copy files: ${copyResult.stderr}`,
        };
      }

      this.logger.info('project-import.copy-in-container.success', { projectRoot, appPath });

      return { success: true };
    } catch (error) {
      this.logger.error('project-import.copy-in-container.failed', {
        projectRoot,
        appPath,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to copy files',
      };
    }
  }

  /**
   * Ensure Airo-specific .gitignore patterns are present after import
   *
   * Handles three scenarios:
   * 1. Imported project HAS .gitignore: Append missing Airo patterns to customer's file
   * 2. Imported project has NO .gitignore but app already has one: Keep the existing
   *    .gitignore (it was preserved during file deletion by excluding it from the find command)
   * 3. Neither has .gitignore: Create default with essential Airo platform patterns
   *
   * @param devSupervisor - Client to execute commands in container
   * @param containerAppPath - Path to app directory in container
   * @param importedProjectHadGitignoreFile - Whether the imported project contained a .gitignore
   */
  private async ensureAiroGitignorePatterns(
    devSupervisor: DevSupervisorClient,
    containerAppPath: string,
    importedProjectHadGitignoreFile: boolean
  ): Promise<void> {
    const gitignorePath = `${containerAppPath}/.gitignore`;

    try {
      // Check if .gitignore exists in app directory
      const checkResult = await devSupervisor.exec({
        command: `test -f "${gitignorePath}" && echo "exists" || echo "missing"`,
        timeout: 5,
      });

      const exists = checkResult.stdout?.trim() === 'exists';

      if (!exists) {
        // Edge case: neither had .gitignore - create default
        this.logger.info('project-import.gitignore.create-default', { containerAppPath });
        const defaultContent = `# Airo Platform\n${AIRO_GITIGNORE_PATTERNS.join('\n')}`;
        const createResult = await devSupervisor.exec({
          command: `cat > "${gitignorePath}" << 'EOF'\n${defaultContent}\nEOF`,
          timeout: 10,
        });

        if (!createResult.success) {
          this.logger.warn('project-import.gitignore.create-failed', {
            containerAppPath,
            stderr: createResult.stderr,
            exitCode: createResult.exit_code,
          });
        }
        return;
      }

      if (importedProjectHadGitignoreFile) {
        // Imported project had .gitignore - append Airo patterns if missing
        this.logger.info('project-import.gitignore.append-patterns', { containerAppPath });

        for (const pattern of AIRO_GITIGNORE_PATTERNS) {
          // Escape single quotes in pattern for shell safety
          const escapedPattern = pattern.replace(/'/g, "'\\''");
          // Use grep -qxF for exact line match, append if not found
          await devSupervisor.exec({
            command: `grep -qxF '${escapedPattern}' "${gitignorePath}" || echo '${escapedPattern}' >> "${gitignorePath}"`,
            timeout: 5,
          });
        }
      } else {
        // Imported project had NO .gitignore, but app directory has one
        // The existing .gitignore was preserved during file deletion (excluded from find command)
        this.logger.info('project-import.gitignore.preserved', { containerAppPath });
      }
    } catch (error) {
      // Non-critical operation - log but don't fail the import
      this.logger.warn('project-import.gitignore.error', {
        containerAppPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up temporary files in the container
   *
   * @param devSupervisor - Client to execute commands in container
   * @param zipPath - Path to the copied zip file (or null)
   * @param extractPath - Path to the extraction directory (or null)
   */
  private async cleanupContainerFiles(
    devSupervisor: DevSupervisorClient,
    zipPath: string | null,
    extractPath: string | null
  ): Promise<void> {
    try {
      const paths: string[] = [];
      if (zipPath) paths.push(zipPath);
      if (extractPath) paths.push(extractPath);

      if (paths.length > 0) {
        await devSupervisor.exec({
          command: `rm -rf ${paths.map(p => `"${p}"`).join(' ')}`,
          timeout: 30, // seconds
        });
        this.logger.info('project-import.container-cleanup.success', { paths });
      }
    } catch (error) {
      this.logger.warn('project-import.container-cleanup.failed', {
        zipPath,
        extractPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Commit imported code to git
   */
  private async gitCommit(
    appId: string,
    appPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);

      // Add all files
      const addResult = await gitTool.executeGitOperation(appPath, {
        operation: 'add',
        files: ['.'],
      });

      if (!addResult.success) {
        const result: { success: boolean; error?: string } = { success: false };
        if (addResult.error) result.error = addResult.error;
        return result;
      }

      // Commit with message
      const commitResult = await gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: 'Import: Project imported from zip file',
      });

      const result: { success: boolean; error?: string } = { success: commitResult.success };
      if (commitResult.error) result.error = commitResult.error;
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Git commit failed',
      };
    }
  }

  /**
   * Copy the failing project tree (or zip) for diagnose before rollback/cleanup.
   */
  private async preserveDiagnoseSnapshotForFailure(args: {
    jobId: string;
    appId: string;
    appPath: string;
    agentZipPath?: string;
  }): Promise<void> {
    const snapshotPath = await diagnoseSnapshotService.preserve({
      jobId: args.jobId,
      appId: args.appId,
      appPath: args.appPath,
      agentZipPath: args.agentZipPath,
    });
    if (!snapshotPath) return;

    try {
      await this.importJobRepo.update(args.jobId, { diagnoseSnapshotPath: snapshotPath });
    } catch (error) {
      this.logger.warn('project-import.diagnose_snapshot.persist_failed', {
        jobId: args.jobId,
        appId: args.appId,
        snapshotPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Rollback git changes on failure
   * Uses git reset --hard to discard all changes and git clean to remove untracked files
   */
  private async gitRollback(appId: string, appPath: string): Promise<void> {
    try {
      this.logger.info('project-import.rollback.start', { appId });

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const gitTool = new GitTool(devSupervisor || undefined);

      // Step 1: Reset all tracked files to HEAD (discards all changes)
      const resetResult = await gitTool.executeGitOperation(appPath, {
        operation: 'reset',
        options: {
          mode: 'hard',
          hash: 'HEAD',
        },
      });

      if (!resetResult.success) {
        this.logger.warn('project-import.rollback.reset-failed', {
          appId,
          error: resetResult.error,
        });
        return;
      }

      // Step 2: Remove all untracked files and directories
      const cleanResult = await gitTool.executeGitOperation(appPath, {
        operation: 'clean',
      });

      if (cleanResult.success) {
        this.logger.info('project-import.rollback.success', { appId });
      } else {
        this.logger.warn('project-import.rollback.clean-failed', {
          appId,
          error: cleanResult.error,
        });
      }
    } catch (error) {
      this.logger.warn('project-import.rollback.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up uploaded zip file on the agent
   */
  private async cleanupZipFile(zipPath: string): Promise<void> {
    try {
      if (existsSync(zipPath)) {
        await rm(zipPath, { force: true });
        this.logger.info('project-import.zip-cleanup.success', { zipPath });
      }
    } catch (error) {
      this.logger.warn('project-import.zip-cleanup.failed', {
        zipPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get import job status
   *
   * @param appId - App ID
   * @returns Import job or null
   */
  async getImportStatus(appId: string): Promise<ImportJob | null> {
    return this.importJobRepo.findByAppId(appId);
  }
}

// Export singleton instance
export const projectImportService = new ProjectImportService();

