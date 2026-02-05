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
import { modifyViteConfig } from './ViteConfigModifier.js';
import { appRestartService, DEFAULT_DEV_COMMAND } from './AppRestartService.js';
import { GitTool } from '../tools/git-tool.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { DevSupervisorClient } from './DevSupervisorClient.js';
import { ImportJobStatus, ValidationErrorKey, type ImportJob, type ValidationError } from '../types/import.js';
import {
  isSupportedProjectInContainer,
  SUPPORTED_BUILD_TOOLS,
} from '../server/middleware/git-import-validation.js';

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

export class ProjectImportService {
  private logger = Logger.create({ service: 'project-import' });
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
        this.logger.warn('project-import.security-validation.failed', {
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

      const agentZipPath = join(app.path, `.import-${jobId}.zip`);
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
        containerExtractPath
      );

      if (!extractResult.success) {
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

      // Phase 6: Copy files to app directory (inside container)
      await this.updateStatus(jobId, ImportJobStatus.COPYING);
      const copyResult = await this.copyFilesInContainer(
        devSupervisor,
        validation.projectRoot || containerProjectPath!,
        app.path
      );

      if (!copyResult.success) {
        await this.importJobRepo.markFailed(
          jobId,
          copyResult.error || 'Failed to copy files',
          ImportJobStatus.COPYING
        );
        await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
        if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);
        return;
      }

      // Phase 7: Modify vite config to allow all hosts (for proxy compatibility)
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
      const installResult = await appRestartService.runNpmInstall(appId, app.path);

      if (installResult.output) {
        await this.importJobRepo.update(jobId, { installOutput: installResult.output });
      }

      if (!installResult.success) {
        await this.gitRollback(appId, app.path);
        await this.importJobRepo.markFailed(
          jobId,
          installResult.error || 'npm install failed',
          ImportJobStatus.INSTALLING,
          [{
            key: ValidationErrorKey.INSTALL_FAILED,
            message: installResult.error || 'npm install failed',
            details: { exitCode: installResult.exitCode },
          }]
        );
        await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
        if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);
        return;
      }

      // Phase 9: Build (if script exists)
      if (validation.hasBuildScript) {
        await this.updateStatus(jobId, ImportJobStatus.BUILDING);
        const buildResult = await appRestartService.runNpmBuild(appId, app.path);

        if (buildResult.output) {
          await this.importJobRepo.update(jobId, { buildOutput: buildResult.output });
        }

        if (!buildResult.success) {
          await this.gitRollback(appId, app.path);
          await this.importJobRepo.markFailed(
            jobId,
            buildResult.error || 'npm run build failed',
            ImportJobStatus.BUILDING,
            [{
              key: ValidationErrorKey.BUILD_FAILED,
              message: buildResult.error || 'npm run build failed',
              details: { exitCode: buildResult.exitCode },
            }]
          );
          await this.cleanupContainerFiles(devSupervisor, containerZipPath, containerProjectPath);
          if (sourceType === 'zip') await this.cleanupZipFile(params.zipPath!);
          return;
        }
      }

      // Phase 10: Create PaaS configuration file for uploaded apps
      this.logger.info('project-import.config.create', { jobId, appId });
      await appRestartService.createPaasConfig(app.path);
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

      // Phase 12: Restart dev server with new command from config
      await this.updateStatus(jobId, ImportJobStatus.RESTARTING);
      const restartResult = await appRestartService.restartDevServer(appId, DEFAULT_DEV_COMMAND);

      if (!restartResult.success) {
        this.logger.warn('project-import.restart.failed', {
          jobId,
          appId,
          error: restartResult.error,
        });
      }

      // Mark as completed
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
    extractPath: string
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
    packageManager?: 'npm' | 'yarn' | 'pnpm';
    hasBuildScript?: boolean;
    hasDevScript?: boolean;
    errors?: ValidationError[];
    warnings?: ValidationError[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Find project root - check if package.json exists at extract path or in single subdirectory
    let projectRoot = extractPath;

    // Check for package.json at root
    const checkRootResult = await devSupervisor.exec({
      command: `test -f "${extractPath}/package.json" && echo "found" || echo "notfound"`,
      timeout: 5, // seconds
    });

    if (checkRootResult.stdout?.trim() !== 'found') {
      // Check if there's a single subdirectory with package.json (common zip structure)
      const lsResult = await devSupervisor.exec({
        command: `ls -1 "${extractPath}"`,
        timeout: 5, // seconds
      });

      const entries = (lsResult.stdout || '').trim().split('\n').filter(Boolean);

      if (entries.length === 1 && entries[0]) {
        const subdir = join(extractPath, entries[0]);
        const checkSubdirResult = await devSupervisor.exec({
          command: `test -f "${subdir}/package.json" && echo "found" || echo "notfound"`,
          timeout: 5, // seconds
        });

        if (checkSubdirResult.stdout?.trim() === 'found') {
          projectRoot = subdir;
        }
      }
    }

    // Verify package.json exists at project root
    const finalCheckResult = await devSupervisor.exec({
      command: `test -f "${projectRoot}/package.json" && echo "found" || echo "notfound"`,
      timeout: 5, // seconds
    });

    if (finalCheckResult.stdout?.trim() !== 'found') {
      errors.push({
        key: ValidationErrorKey.PACKAGE_JSON_NOT_FOUND,
        message: 'No package.json found in zip root or subdirectory',
        details: { searchedPath: extractPath },
      });
      return { valid: false, errors };
    }

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
    let packageManager: 'npm' | 'yarn' | 'pnpm' = 'npm';

    const pnpmCheck = await devSupervisor.exec({
      command: `test -f "${projectRoot}/pnpm-lock.yaml" && echo "found"`,
      timeout: 5, // seconds
    });
    if (pnpmCheck.stdout?.trim() === 'found') {
      packageManager = 'pnpm';
    } else {
      const yarnCheck = await devSupervisor.exec({
        command: `test -f "${projectRoot}/yarn.lock" && echo "found"`,
        timeout: 5, // seconds
      });
      if (yarnCheck.stdout?.trim() === 'found') {
        packageManager = 'yarn';
      }
    }

    // Check for scripts
    const scripts = packageJson.scripts || {};
    const hasBuildScript = 'build' in scripts;
    const hasDevScript = 'dev' in scripts || 'start' in scripts;

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

    const result: {
      valid: boolean;
      projectRoot?: string;
      packageManager?: 'npm' | 'yarn' | 'pnpm';
      hasBuildScript?: boolean;
      hasDevScript?: boolean;
      errors?: ValidationError[];
      warnings?: ValidationError[];
    } = {
      valid: true,
      projectRoot,
      packageManager,
      hasBuildScript,
      hasDevScript,
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

      // Delete all files except .git, node_modules, .is_ready, dev_setup_and_serve.sh, and public/assets
      // Preserve public/assets as it contains persistent user data, refer this doc for more detail -> docs/persistent-storage-architecture.md
      const deleteResult = await devSupervisor.exec({
        command: `find "${containerAppPath}" -mindepth 1 -maxdepth 1 ! -name ".git" ! -name "node_modules" ! -name ".is_ready" ! -name ".import-*" ! -name "dev_setup_and_serve.sh" ! -name "public" -exec rm -rf {} + && find "${containerAppPath}/public" -mindepth 1 -maxdepth 1 ! -name "assets" -exec rm -rf {} +`,
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

