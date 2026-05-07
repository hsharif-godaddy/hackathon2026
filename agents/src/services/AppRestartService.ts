/**
 * AppRestartService
 *
 * Provides restart cycle operations for apps. This includes stopping the dev server,
 * running npm install/build, creating PaaS config, and restarting the dev server.
 *
 * Extracted from ProjectImportService to allow reuse in git pull and other operations.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '../logging/index.js';
import { TerminalTool } from '../tools/terminal.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { measureAppDirSize } from '../utils/container-metrics.js';

const RESTART_TIMEOUTS = {
  INSTALL: 5 * 60 * 1000, // 5 minutes
  BUILD: 10 * 60 * 1000, // 10 minutes
} as const;

// Node.js defaults - customers define their own start script in package.json
export const DEFAULT_START_COMMAND = 'npm start';
export const DEFAULT_INSTALL_COMMAND = 'npm install --include=dev';
export const DEFAULT_BUILD_COMMAND = 'npm run build';
export const PAAS_NODEJS_V1_PRODUCT_ID = 'paas-nodejs-v1';

/**
 * Supported package managers
 */
export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export interface InstallCommandOptions {
  legacyPeerDeps?: boolean;
}

/**
 * Per-package-manager flag mappings for install options.
 * Each key maps to the CLI flag for each package manager (null = no equivalent).
 * To add a new option: add a row here and a matching field to InstallCommandOptions.
 */
const INSTALL_FLAGS: Record<keyof InstallCommandOptions, Record<PackageManager, string | null>> = {
  legacyPeerDeps: { npm: '--legacy-peer-deps', pnpm: '--no-strict-peer-dependencies', yarn: null },
};

/**
 * Get the install command for the given package manager.
 * Note: npm uses --include=dev to ensure devDependencies are installed (needed for build tools like Vite).
 * pnpm and yarn install devDependencies by default unless NODE_ENV=production or --prod flag is used,
 * so no additional flags are needed. These commands run in the preview container which has
 * NODE_ENV=development by default.
 */
export function getInstallCommand(
  packageManager: PackageManager = 'npm',
  options: InstallCommandOptions = {}
): string {
  const baseCommands: Record<PackageManager, string[]> = {
    npm: ['npm', 'install', '--include=dev'],
    pnpm: ['pnpm', 'install'],
    yarn: ['yarn', 'install'],
  };

  const parts = [...baseCommands[packageManager]];

  for (const [key, flagMap] of Object.entries(INSTALL_FLAGS)) {
    if (options[key as keyof InstallCommandOptions]) {
      const flag = flagMap[packageManager];
      if (flag) parts.push(flag);
    }
  }

  return parts.join(' ');
}

/**
 * Get the build command for the given package manager.
 * @param packageManager - Package manager to use
 * @param production - If true, prefixes with NODE_ENV=production (for publish builds)
 */
export function getBuildCommand(packageManager: PackageManager = 'npm', production = false): string {
  const prefix = production ? 'NODE_ENV=production ' : '';
  switch (packageManager) {
    case 'pnpm':
      return `${prefix}pnpm run build`;
    case 'yarn':
      return `${prefix}yarn run build`;
    case 'npm':
    default:
      return `${prefix}npm run build`;
  }
}

/**
 * Interface for dev-supervisor exec method (minimal interface for detectPackageManager)
 */
export interface DevSupervisorExec {
  exec(options: { command: string; timeout: number }): Promise<{ stdout?: string }>;
}

/**
 * Detect package manager by checking for lock files.
 * Used by zip upload, git pull, and publish flows.
 * Falls back to npm on any error (container unreachable, timeout, etc.)
 * @param devSupervisor - Dev supervisor client with exec method
 * @param projectRoot - Root path to check for lock files (default: /app)
 */
export async function detectPackageManager(
  devSupervisor: DevSupervisorExec,
  projectRoot = '/app'
): Promise<PackageManager> {
  try {
    // Check for pnpm-lock.yaml
    const pnpmCheck = await devSupervisor.exec({
      command: `test -f "${projectRoot}/pnpm-lock.yaml" && echo "found"`,
      timeout: 5,
    });
    if (pnpmCheck.stdout?.trim() === 'found') {
      return 'pnpm';
    }

    // Check for yarn.lock
    const yarnCheck = await devSupervisor.exec({
      command: `test -f "${projectRoot}/yarn.lock" && echo "found"`,
      timeout: 5,
    });
    if (yarnCheck.stdout?.trim() === 'found') {
      return 'yarn';
    }

    return 'npm';
  } catch {
    // Fall back to npm on any error (container unreachable, timeout, etc.)
    return 'npm';
  }
}

/**
 * @deprecated Build tool type is no longer used - always Node.js
 */
export type BuildToolType = 'nodejs';

/**
 * Command overrides for PaaS imports
 */
export interface CommandOverrides {
  install?: string;
  build?: string;
  dev?: string;
  start?: string;
}

/**
 * Options for performFullRestartCycle
 */
export interface RestartCycleOptions {
  skipInstall?: boolean;
  skipBuild?: boolean;
  /** Options passed to getInstallCommand (e.g. legacyPeerDeps) */
  installOptions?: InstallCommandOptions;
  /** @deprecated Use commands.start instead */
  devCommand?: string;
  /** Build tool type to determine default commands */
  buildToolType?: BuildToolType;
  /** Custom command overrides */
  commands?: CommandOverrides;
}

export interface RestartCycleResult {
  success: boolean;
  error?: string;
  phases: {
    install: boolean;
    build: boolean;
    restart: boolean;
  };
  metrics?: {
    installDurationMs?: number;
    buildDurationMs?: number;
    startDurationMs?: number;
    appDirSizeBytes?: number;
  };
}

export interface PaasConfig {
  productId?: string;
  cleanAppDirBeforeExtract?: boolean;
  runtime: {
    build: { command: string };
    serve: { command: string };
    dev: { command: string };
  };
}

/**
 * Provenance of the `runtime.serve.command` we write into `.airo/config.json`.
 * Captured at the call site where the fallback chain resolves. Surfaces in
 * the `app-restart.paas-config.written` event so we can audit, post-hoc,
 * why a customer ended up with a particular start command.
 */
export type ServeCommandSource = 'user' | 'scripts.start' | 'scripts.dev' | 'default';

export class AppRestartService {
  private logger = Logger.create({ component: 'app-restart' });

  /**
   * Perform a full restart cycle for an app
   *
   * This performs the following steps:
   * 1. Stop the dev server
   * 2. Run npm install
   * 3. Run npm build (if build script exists)
   * 4. Create PaaS config
   * 5. Restart the dev server
   *
   * @param appId - App ID
   * @param appPath - Path to the app directory
   * @param options - Optional configuration
   * @returns Result with success status and phase completion info
   */
  async performFullRestartCycle(
    appId: string,
    appPath: string,
    options?: RestartCycleOptions
  ): Promise<RestartCycleResult> {
    const metrics: NonNullable<RestartCycleResult['metrics']> = {};
    const result: RestartCycleResult = {
      success: false,
      phases: {
        install: false,
        build: false,
        restart: false,
      },
      metrics,
    };

    this.logger.info('app-restart.cycle.begin', { appId });

    try {
      // Detect package manager from lock files
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      const packageManager: PackageManager = devSupervisor
        ? await detectPackageManager(devSupervisor)
        : 'npm';

      this.logger.info('app-restart.package-manager.detected', { appId, packageManager });

      // Step 1: Stop dev server
      const stopResult = await this.stopDevServer(appId);
      if (!stopResult.success) {
        this.logger.warn('app-restart.stop-server.failed', {
          appId,
          error: stopResult.error,
        });
        // Continue anyway - the process might not have been running
      } else {
        // Wait for process to fully terminate and release file locks
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Step 2: Run install (unless skipped)
      let installDurationMs: number | undefined;
      if (!options?.skipInstall) {
        const installCommand = options?.commands?.install || getInstallCommand(packageManager, options?.installOptions ?? {});
        const installStartTime = Date.now();
        const installResult = await this.runCommand(appId, appPath, installCommand, 'install');
        installDurationMs = Date.now() - installStartTime;
        metrics.installDurationMs = installDurationMs;

        if (!installResult.success) {
          result.error = installResult.error || 'install failed';
          this.logger.error('app-restart.install.failed', {
            appId,
            error: result.error,
            command: installCommand,
          });
          return result;
        }
        result.phases.install = true;
        this.logger.info('app-restart.install.success', { appId, command: installCommand });
      } else {
        result.phases.install = true; // Mark as success since it was skipped
      }

      // Step 3: Run build (unless skipped)
      let buildDurationMs: number | undefined;
      if (!options?.skipBuild) {
        const buildCommand = options?.commands?.build || getBuildCommand(packageManager);
        const buildStartTime = Date.now();
        const buildResult = await this.runCommand(appId, appPath, buildCommand, 'build');
        buildDurationMs = Date.now() - buildStartTime;
        metrics.buildDurationMs = buildDurationMs;

        if (!buildResult.success) {
          // Build failure is not critical - log warning but continue
          this.logger.warn('app-restart.build.failed', {
            appId,
            error: buildResult.error,
            command: buildCommand,
          });
          // Still mark as success since build is optional for dev mode
          result.phases.build = true;
        } else {
          result.phases.build = true;
          this.logger.info('app-restart.build.success', { appId, command: buildCommand });
        }
      } else {
        result.phases.build = true; // Mark as success since it was skipped
      }

      // Step 4: Create PaaS config
      await this.createPaasConfig(
        appPath,
        options?.buildToolType,
        options?.commands?.start,
        undefined, // productId
        options?.commands?.dev,
        packageManager,
        undefined, // serveCommandSource — caller has no fallback chain; default resolves from customStartCommand presence
        appId
      );

      // Step 5: Restart dev server with resolved start command
      const startCommand = this.resolveStartCommand(options);
      const restartStartTime = Date.now();
      const restartResult = await this.restartDevServer(appId, startCommand);
      const startDurationMs = Date.now() - restartStartTime;
      metrics.startDurationMs = startDurationMs;

      if (!restartResult.success) {
        result.error = restartResult.error || 'Failed to restart dev server';
        this.logger.error('app-restart.restart.failed', {
          appId,
          error: result.error,
        });
        return result;
      }
      result.phases.restart = true;

      // Measure /app directory size
      if (devSupervisor) {
        const appDirSizeBytes = await measureAppDirSize(devSupervisor);
        if (appDirSizeBytes !== undefined) {
          metrics.appDirSizeBytes = appDirSizeBytes;
        }
      }

      result.success = true;
      this.logger.info('app-restart.cycle.success', { appId });
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error during restart cycle';
      this.logger.error('app-restart.cycle.error', {
        appId,
        error: result.error,
      });
      return result;
    }
  }

  /**
   * Resolve the start command based on options.
   * Always defaults to npm start - customers define their own start script.
   */
  private resolveStartCommand(options?: RestartCycleOptions): string {
    // Custom start command takes priority
    if (options?.commands?.start) {
      return options.commands.start;
    }

    // Legacy devCommand support
    if (options?.devCommand) {
      return options.devCommand;
    }

    // Always use npm start by default
    return DEFAULT_START_COMMAND;
  }

  /**
   * Run a command via dev-supervisor terminal
   */
  private async runCommand(
    appId: string,
    appPath: string,
    command: string,
    phase: 'install' | 'build'
  ): Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }> {
    try {
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);

      if (!devSupervisor) {
        return {
          success: false,
          error: 'Dev supervisor not available',
        };
      }

      const terminalTool = new TerminalTool(devSupervisor);
      const timeout = phase === 'install' ? RESTART_TIMEOUTS.INSTALL : RESTART_TIMEOUTS.BUILD;

      const result = await terminalTool.executeCommand(appPath, {
        command,
        timeout,
      });

      const response: { success: boolean; output?: string; error?: string; exitCode?: number } = {
        success: result.success,
        exitCode: result.exitCode,
      };
      const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      if (combinedOutput) response.output = combinedOutput;
      if (!result.success) {
        response.error = result.stderr || `${command} failed`;
      }
      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : `${command} failed`,
      };
    }
  }

  /**
   * Stop the dev server
   */
  async stopDevServer(appId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);

      if (!devSupervisor) {
        return { success: false, error: 'Dev supervisor not available' };
      }

      const success = await devSupervisor.stopProcess();

      const result: { success: boolean; error?: string } = { success };
      if (!success) result.error = 'Failed to stop dev server';
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop dev server',
      };
    }
  }

  /**
   * Run install command via dev-supervisor
   * @param appId - App ID
   * @param appPath - Path to the app directory
   * @param packageManager - Package manager to use (npm, yarn, pnpm)
   * @param installOptions - Options passed to getInstallCommand
   */
  async runInstall(
    appId: string,
    appPath: string,
    packageManager: PackageManager = 'npm',
    installOptions: InstallCommandOptions = {}
  ): Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }> {
    try {
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);

      if (!devSupervisor) {
        return {
          success: false,
          error: 'Dev supervisor not available',
        };
      }

      const terminalTool = new TerminalTool(devSupervisor);
      const installCommand = getInstallCommand(packageManager, installOptions);

      this.logger.info('app-restart.install.begin', { appId, packageManager, command: installCommand });

      const result = await terminalTool.executeCommand(appPath, {
        command: installCommand,
        timeout: RESTART_TIMEOUTS.INSTALL,
      });

      const response: { success: boolean; output?: string; error?: string; exitCode?: number } = {
        success: result.success,
        exitCode: result.exitCode,
      };
      const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      if (combinedOutput) response.output = combinedOutput;
      if (!result.success) {
        response.error = result.stderr || `${installCommand} failed`;
      }
      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'install failed',
      };
    }
  }

  /**
   * Run build command via dev-supervisor
   * @param appId - App ID
   * @param appPath - Path to the app directory
   * @param packageManager - Package manager to use (npm, yarn, pnpm)
   */
  async runBuild(
    appId: string,
    appPath: string,
    packageManager: PackageManager = 'npm'
  ): Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }> {
    try {
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);

      if (!devSupervisor) {
        return {
          success: false,
          error: 'Dev supervisor not available',
        };
      }

      const terminalTool = new TerminalTool(devSupervisor);
      const buildCommand = getBuildCommand(packageManager);

      this.logger.info('app-restart.build.begin', { appId, packageManager, command: buildCommand });

      const result = await terminalTool.executeCommand(appPath, {
        command: buildCommand,
        timeout: RESTART_TIMEOUTS.BUILD,
      });

      const response: { success: boolean; output?: string; error?: string; exitCode?: number } = {
        success: result.success,
        exitCode: result.exitCode,
      };
      const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      if (combinedOutput) response.output = combinedOutput;
      if (!result.success) {
        response.error = result.stderr || `${buildCommand} failed`;
      }
      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'build failed',
      };
    }
  }

  /**
   * Create PaaS configuration file for apps
   * @param appPath - Path to the app directory
   * @param _buildToolType - Deprecated, no longer used
   * @param customStartCommand - Custom start command override
   * @param productId - Optional product identifier for runtime behavior
   * @param customDevCommand - Custom dev command override
   * @param packageManager - Package manager to use for build command
   */
  async createPaasConfig(
    appPath: string,
    _buildToolType?: BuildToolType,
    customStartCommand?: string,
    productId?: string,
    customDevCommand?: string,
    packageManager: PackageManager = 'npm',
    /**
     * Where the resolved `runtime.serve.command` came from. Callers that
     * already ran a fallback chain (e.g. ProjectImportService Phase 10)
     * pass the true source; callers without a chain can pass
     * `customStartCommand ? 'user' : 'default'`. Defaults to the latter
     * for backwards compatibility.
     */
    serveCommandSource?: ServeCommandSource,
    /**
     * App identifier — surfaced on `paas-config.written` / `.write-failed`
     * so Loki queries can filter by the project-wide `app_id` field.
     * Optional for backwards compatibility; existing callers without an
     * appId in scope can omit it (older `app-restart.config.created`
     * event is unchanged).
     */
    appId?: string
  ): Promise<void> {
    const airoDir = join(appPath, '.airo');
    const configPath = join(airoDir, 'config.json');

    // Use detected package manager for build command
    const finalStartCmd = customStartCommand || DEFAULT_START_COMMAND;
    const finalDevCmd = customDevCommand || finalStartCmd;
    const finalBuildCmd = getBuildCommand(packageManager);
    const resolvedSource: ServeCommandSource =
      serveCommandSource ?? (customStartCommand ? 'user' : 'default');

    const paasConfig: PaasConfig = {
      runtime: {
        dev: {
          command: finalDevCmd,
        },
        build: {
          command: finalBuildCmd,
        },
        serve: {
          command: finalStartCmd,
        },
      },
    };
    if (productId) {
      paasConfig.productId = productId;
    }

    if (productId === PAAS_NODEJS_V1_PRODUCT_ID) {
      paasConfig.cleanAppDirBeforeExtract = true;
    }

    try {
      await mkdir(airoDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(paasConfig, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error('app-restart.paas-config.write-failed', {
        appId,
        appPath,
        path: configPath,
        // Preserve stack trace so ENOSPC / EACCES / path-composition bugs are
        // distinguishable from Loki alone. Matches the `{name,message,stack}`
        // shape other error events in this codebase use (e.g. route.publish.error).
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { name: 'UnknownError', message: String(error) },
      });
      throw error;
    }

    // Legacy event kept for dashboards that already filter on it. New
    // consumers should prefer `app-restart.paas-config.written` which carries
    // the resolved commands + source.
    this.logger.info('app-restart.config.created', { appPath });
    this.logger.info('app-restart.paas-config.written', {
      appId,
      appPath,
      path: configPath,
      serveCommand: finalStartCmd,
      serveCommandSource: resolvedSource,
      buildCommand: finalBuildCmd,
      devCommand: finalDevCmd,
      productId: productId ?? null,
      cleanAppDirBeforeExtract: paasConfig.cleanAppDirBeforeExtract ?? false,
    });
  }

  /**
   * Restart the dev server
   * @param appId - App ID
   * @param command - Optional command to start the dev server with
   */
  async restartDevServer(appId: string, command?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);

      if (!devSupervisor) {
        return { success: false, error: 'Dev supervisor not available' };
      }

      if (command) {
        this.logger.info('app-restart.restart.with-command', { appId, command });
        await devSupervisor.stopProcess();

        if (!command.trim()) {
          return { success: false, error: 'Invalid command: empty after port substitution' };
        }

        if (command.includes('&&') || command.includes(';') || command.includes('|')) {
          this.logger.warn('app-restart.restart.suspicious-command', { appId, command });
        }

        const escapedCommand = command.replace(/"/g, '\\"');
        const processInfo = await devSupervisor.startProcess({
          command: `sh -c "${escapedCommand}"`,
          working_dir: '/app',
        });

        if (processInfo.state === 'error') {
          return { success: false, error: processInfo.error || 'Failed to start process with custom command' };
        }

        return { success: true };
      }

      const restartResult = await devSupervisor.restartProcess({ graceful: true });

      if (!restartResult.success) {
        return { success: false, error: restartResult.error || 'Failed to restart dev server' };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restart dev server',
      };
    }
  }
}

// Export singleton instance
export const appRestartService = new AppRestartService();
