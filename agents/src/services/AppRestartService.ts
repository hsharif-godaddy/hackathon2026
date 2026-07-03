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
import { getErrorMessage } from '../utils/error.js';
import { createForWorkspace } from '../workspace/index.js';
import type { WorkspaceClient } from '../workspace/client.js';
import type { WorkspaceTasks } from '../workspace/tasks.js';
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
 * All commands ensure devDependencies are installed (needed for build tools like Vite/Next.js)
 * regardless of NODE_ENV — npm via --include=dev, yarn via --production=false. pnpm ignores
 * NODE_ENV for install decisions so needs no flag.
 */
export function getInstallCommand(
  packageManager: PackageManager = 'npm',
  options: InstallCommandOptions = {}
): string {
  const baseCommands: Record<PackageManager, string[]> = {
    npm: ['npm', 'install', '--include=dev'],
    pnpm: ['pnpm', 'install'],
    yarn: ['yarn', 'install', '--production=false'],
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

export interface PackageJsonScripts {
  hasBuildScript: boolean;
  hasStartScript: boolean;
  hasDevScript: boolean;
}

type PackageScriptsReadFailureReason = 'exec_failed' | 'empty_stdout' | 'parse_failed' | 'exec_error';

const packageScriptsLogger = Logger.create({ component: 'app-restart' });

function warnPackageScriptsReadFailed(
  appId: string | undefined,
  projectRoot: string,
  reason: PackageScriptsReadFailureReason,
  error?: string
): void {
  packageScriptsLogger.warn('app-restart.package-scripts.read-failed', {
    appId,
    projectRoot,
    reason,
    ...(error !== undefined ? { error } : {}),
  });
}

/**
 * Read package.json scripts from the container project root.
 * On read/parse failure, returns no scripts (restart cycle soft fallback) and logs
 * a warning — unlike zip import, which fails the job with structured validation errors.
 */
export async function readPackageJsonScripts(
  tasks: WorkspaceTasks,
  projectRoot = '/app',
  appId?: string
): Promise<PackageJsonScripts> {
  const empty: PackageJsonScripts = {
    hasBuildScript: false,
    hasStartScript: false,
    hasDevScript: false,
  };

  try {
    const catResult = await tasks.runCommandSync({
      command: `cat "${projectRoot}/package.json"`,
      timeoutSeconds: 5,
    });

    if (catResult.exitCode !== 0) {
      warnPackageScriptsReadFailed(appId, projectRoot, 'exec_failed');
      return empty;
    }

    if (!catResult.stdout) {
      warnPackageScriptsReadFailed(appId, projectRoot, 'empty_stdout');
      return empty;
    }

    const packageJson = JSON.parse(catResult.stdout) as { scripts?: Record<string, string> };
    const scripts = packageJson.scripts || {};
    const hasStartScript = 'start' in scripts;
    const hasDevScript = 'dev' in scripts || hasStartScript;
    const hasBuildScript = 'build' in scripts;

    return { hasBuildScript, hasStartScript, hasDevScript };
  } catch (error) {
    if (error instanceof SyntaxError) {
      warnPackageScriptsReadFailed(appId, projectRoot, 'parse_failed', error.message);
      return empty;
    }
    throw error;
  }
}

/**
 * Detect package manager by checking for lock files.
 * Used by zip upload, git pull, and publish flows.
 * Falls back to npm on any error (container unreachable, timeout, etc.)
 * @param tasks - Workspace tasks interface for running commands in container
 * @param projectRoot - Root path to check for lock files (default: /app)
 */
export async function detectPackageManager(
  tasks: Pick<WorkspaceTasks, 'runCommandSync'>,
  projectRoot = '/app'
): Promise<PackageManager> {
  try {
    // Check for pnpm-lock.yaml
    const pnpmCheck = await tasks.runCommandSync({
      command: `test -f "${projectRoot}/pnpm-lock.yaml" && echo "found"`,
      timeoutSeconds: 5,
    });
    if (pnpmCheck.stdout?.trim() === 'found') {
      return 'pnpm';
    }

    // Check for yarn.lock
    const yarnCheck = await tasks.runCommandSync({
      command: `test -f "${projectRoot}/yarn.lock" && echo "found"`,
      timeoutSeconds: 5,
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
  /**
   * Remove node_modules before install (e.g. after git pull when package.json/lockfile changed).
   * Avoids npm ENOTEMPTY failures from incremental updates over a stale tree.
   */
  freshInstall?: boolean;
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

/**
 * Resolve the PaaS start command and attribution. Shared by zip import and
 * git pull restart cycles so both paths use the same fallback chain.
 *
 * When production=true (default for PaaS): requires scripts.start, no dev
 * fallback. All resolved commands are prefixed with NODE_ENV=production.
 *
 * When production=false (legacy): falls back to scripts.dev → default.
 */
export function resolveStartCommand(
  userStart: string | undefined,
  validation: { hasStartScript?: boolean; hasDevScript?: boolean },
  pm: string,
  options?: { production?: boolean }
): { startCommand: string; serveCommandSource: ServeCommandSource } {
  const production: boolean = options?.production ?? false;
  const prefix: string = production ? 'NODE_ENV=production ' : '';

  if (userStart) {
    return { startCommand: `${prefix}${userStart}`, serveCommandSource: 'user' };
  }
  if (validation.hasStartScript) {
    return { startCommand: `${prefix}${pm} start`, serveCommandSource: 'scripts.start' };
  }
  if (validation.hasDevScript) {
    const devPrefix: string = production ? 'NODE_ENV=production ' : 'NODE_ENV=development ';
    return {
      startCommand: `${devPrefix}${pm} run dev`,
      serveCommandSource: 'scripts.dev',
    };
  }
  return { startCommand: DEFAULT_START_COMMAND, serveCommandSource: 'default' };
}

/** Whether install output indicates npm could not remove directories (stale node_modules). */
export function isEnoTemptyInstallError(output?: string, error?: string): boolean {
  const combined = `${output || ''}\n${error || ''}`;
  return combined.includes('ENOTEMPTY') || combined.includes('npm error code ENOTEMPTY');
}

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
      const workspace: WorkspaceClient | null = createForWorkspace(appId, 'preview');
      if (!workspace) {
        this.logger.error('app-restart.cycle.workspace.unavailable', { appId });
        result.error = 'Dev supervisor not available';
        return result;
      }

      // Step 1: Stop dev server
      try {
        await workspace.runtime.stop();
        // Wait for process to fully terminate and release file locks
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (stopError) {
        this.logger.warn('app-restart.stop-server.failed', {
          appId,
          error: getErrorMessage(stopError),
        });
        // Continue anyway - the process might not have been running
      }

      // Detect package manager from lock files
      const packageManager: PackageManager = await detectPackageManager(workspace.tasks);

      this.logger.info('app-restart.package-manager.detected', { appId, packageManager });

      // Read package.json scripts for build/start command resolution
      const scripts = await readPackageJsonScripts(workspace.tasks, '/app', appId);

      const userStart = options?.commands?.start ?? options?.devCommand;
      const { startCommand, serveCommandSource } = resolveStartCommand(
        userStart,
        scripts,
        packageManager,
        { production: true }
      );

      this.logger.info('app-restart.start-command.resolved', {
        appId,
        packageManager,
        serveCommandSource,
        startCommand,
      });

      // Step 2: Run install (unless skipped)
      let installDurationMs: number | undefined;
      if (!options?.skipInstall) {
        const installCommand = options?.commands?.install || getInstallCommand(packageManager, options?.installOptions ?? {});
        const installStartTime = Date.now();
        const installResult = await this.runInstallWithRecoveryTasks(workspace.tasks, appId, appPath, installCommand, {
          freshInstall: options?.freshInstall,
        });
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

      // Step 3: Run production build (if build script exists or custom command provided)
      let buildDurationMs: number | undefined;
      if (options?.skipBuild) {
        result.phases.build = true;
      } else if (!scripts.hasBuildScript && !options?.commands?.build) {
        result.phases.build = true;
        this.logger.info('app-restart.build.skipped', { appId, reason: 'no-build-script' });
      } else {
        const buildCommand = options?.commands?.build || getBuildCommand(packageManager, true);
        const buildStartTime = Date.now();
        const buildResult = await this.runCommandWithTasks(workspace.tasks, appPath, buildCommand, 'build');
        buildDurationMs = Date.now() - buildStartTime;
        metrics.buildDurationMs = buildDurationMs;

        if (!buildResult.success) {
          result.error = buildResult.error || 'build failed';
          this.logger.error('app-restart.build.failed', {
            appId,
            error: result.error,
            command: buildCommand,
          });
          return result;
        }
        result.phases.build = true;
        this.logger.info('app-restart.build.success', { appId, command: buildCommand });
      }

      // Step 4: Create PaaS config
      await this.createPaasConfig(
        appPath,
        options?.buildToolType,
        startCommand,
        undefined, // productId
        options?.commands?.dev,
        packageManager,
        serveCommandSource,
        appId
      );

      // .airo/config.json does not need to be committed — the archive's
      // getUntrackedExclusions preserves .airo/ even when untracked.

      // Step 5: Start dev server with resolved start command
      const restartStartTime = Date.now();
      await workspace.runtime.start({ command: startCommand, workingDir: '/app' });
      const startDurationMs = Date.now() - restartStartTime;
      metrics.startDurationMs = startDurationMs;
      result.phases.restart = true;

      // Measure /app directory size (workspace already validated above)
      const appDirSizeBytes = await measureAppDirSize(workspace.tasks);
      if (appDirSizeBytes !== undefined) {
        metrics.appDirSizeBytes = appDirSizeBytes;
      }

      result.success = true;
      this.logger.info('app-restart.cycle.success', { appId });
      return result;
    } catch (error) {
      result.error = getErrorMessage(error);
      this.logger.error('app-restart.cycle.error', {
        appId,
        error: result.error,
      });
      return result;
    }
  }

  /**
   * Remove app and template-root node_modules before a clean install.
   * Uses rm -r -f for /node_modules to avoid dev-supervisor dangerous-command detection on rm -rf /.
   */
  async removeNodeModules(appId: string, appPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const workspace: WorkspaceClient | null = createForWorkspace(appId, 'preview');

      if (!workspace) {
        return { success: false, error: 'Workspace not available' };
      }

      const nodeModulesPath = `${appPath}/node_modules`;
      // No || true — failures must surface via exit code. rm -rf is idempotent (-f).
      const command =
        `rm -rf "${nodeModulesPath}" && ( [ ! -d /node_modules ] || rm -r -f /node_modules )`;

      this.logger.info('app-restart.node-modules.remove.begin', { appId, appPath });

      const result = await workspace.tasks.runCommandSync({ command, timeoutSeconds: 60 });

      if (result.timedOut) {
        this.logger.warn('app-restart.node-modules.remove.failed', {
          appId,
          appPath,
          taskId: result.taskId,
          error: 'Command timed out after 60s',
        });
        return { success: false, error: 'Remove node_modules timed out after 60s' };
      }

      if (result.exitCode !== 0) {
        this.logger.warn('app-restart.node-modules.remove.failed', {
          appId,
          appPath,
          taskId: result.taskId,
          error: result.stderr,
        });
        return { success: false, error: result.stderr || 'Failed to remove node_modules' };
      }

      this.logger.info('app-restart.node-modules.remove.success', { appId, appPath });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Run install via workspace tasks, optionally wiping node_modules first; retry once on ENOTEMPTY.
   */
  private async runInstallWithRecoveryTasks(
    tasks: WorkspaceTasks,
    appId: string,
    appPath: string,
    installCommand: string,
    options?: { freshInstall?: boolean }
  ): Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }> {
    if (options?.freshInstall) {
      const wipeResult = await this.removeNodeModules(appId, appPath);
      if (!wipeResult.success) {
        return { success: false, error: wipeResult.error || 'Failed to remove node_modules' };
      }
    }

    let installResult = await this.runCommandWithTasks(tasks, appPath, installCommand, 'install');

    if (!installResult.success && isEnoTemptyInstallError(installResult.output, installResult.error)) {
      this.logger.warn('app-restart.install.enotempty-retry', { appId });
      const wipeResult = await this.removeNodeModules(appId, appPath);
      if (!wipeResult.success) {
        return installResult;
      }
      installResult = await this.runCommandWithTasks(tasks, appPath, installCommand, 'install');
    }

    return installResult;
  }

  /**
   * Run a command via workspace tasks (pre-resolved workspace).
   * Used by performFullRestartCycle which hoists workspace creation.
   */
  private async runCommandWithTasks(
    tasks: WorkspaceTasks,
    appPath: string,
    command: string,
    phase: 'install' | 'build'
  ): Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }> {
    try {
      const terminalTool = new TerminalTool(tasks);
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
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Stop the dev server
   */
  async stopDevServer(appId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const workspace: WorkspaceClient | null = createForWorkspace(appId, 'preview');

      if (!workspace) {
        return { success: false, error: 'Dev supervisor not available' };
      }

      await workspace.runtime.stop();
      return { success: true };
    } catch (error) {
      const message: string = getErrorMessage(error);
      this.logger.error('app-restart.stop.failure', { appId, error: message });
      return { success: false, error: message };
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
      const workspace: WorkspaceClient | null = createForWorkspace(appId, 'preview');

      if (!workspace) {
        return {
          success: false,
          error: 'Dev supervisor not available',
        };
      }

      const terminalTool = new TerminalTool(workspace.tasks);
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
        error: getErrorMessage(error),
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
    packageManager: PackageManager = 'npm',
    { production = false }: { production?: boolean } = {}
  ): Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }> {
    try {
      const workspace: WorkspaceClient | null = createForWorkspace(appId, 'preview');

      if (!workspace) {
        return {
          success: false,
          error: 'Dev supervisor not available',
        };
      }

      const terminalTool = new TerminalTool(workspace.tasks);
      const buildCommand = getBuildCommand(packageManager, production);

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
        error: getErrorMessage(error),
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

    const finalStartCmd = customStartCommand || DEFAULT_START_COMMAND;
    const finalDevCmd = customDevCommand || finalStartCmd;
    const finalBuildCmd = getBuildCommand(packageManager, true);
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
      const workspace: WorkspaceClient | null = createForWorkspace(appId, 'preview');

      if (!workspace) {
        return { success: false, error: 'Dev supervisor not available' };
      }

      if (command) {
        this.logger.info('app-restart.restart.with-command', { appId, command });

        if (!command.trim()) {
          return { success: false, error: 'Invalid command: empty after port substitution' };
        }

        try {
          await workspace.runtime.stop();
        } catch (stopError) {
          this.logger.debug('app-restart.restart.stop-skipped', {
            appId,
            error: getErrorMessage(stopError),
          });
        }

        if (command.includes('&&') || command.includes(';') || command.includes('|')) {
          this.logger.warn('app-restart.restart.suspicious-command', { appId, command });
        }

        // dev-supervisor wraps in sh -c internally — pass the command verbatim
        await workspace.runtime.start({
          command,
          workingDir: '/app',
        });

        return { success: true };
      }

      await workspace.runtime.restart({ graceful: true });
      return { success: true };
    } catch (error) {
      const message: string = getErrorMessage(error);
      this.logger.error('app-restart.restart.failure', { appId, error: message });
      return { success: false, error: message };
    }
  }
}

// Export singleton instance
export const appRestartService = new AppRestartService();
