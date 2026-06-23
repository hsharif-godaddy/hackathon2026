import type { PublishStrategy, PublishContext, BuildResult, DeploymentStrategy } from './PublishStrategy.js';
import type { DevSupervisorClient, ProcessInfo, PublishRequest, PublishResponse } from '../../../../services/DevSupervisorClient.js';
import type { ILogger } from '../../../../logging/types.js';
import {
  appRestartService,
  detectPackageManager,
  readPackageJsonScripts,
  resolveStartCommand,
} from '../../../../services/AppRestartService.js';

// =============================================================================
// PaaS Publish Recovery Configuration
// =============================================================================
// When PaaS publish times out, we restart the container and wait for healthy.
// Simple flow: timeout → restart → poll for healthy

const PAAS_PUBLISH_RECOVERY_CONFIG = {
  // Errors that trigger recovery flow (network-level, not app failures)
  recoverableErrors: [
    'socket hang up',
    'econnreset',
    'etimedout',
    'request timeout',
  ],
  // Health polling interval (ms)
  healthPollIntervalMs: 3000,
  // Default health polling timeout (ms) - can be overridden by request
  defaultHealthPollTimeoutMs: 60000,
};

/** Valid process states from dev-supervisor plus 'unknown' for connection failures */
type PreviewProcessState = ProcessInfo['state'] | 'unknown';

/** Parse JSON or return null — used for pre-flight file reads that may be missing or malformed. */
function safeJsonParse(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Walk a nested path on an `unknown` value, returning the string at the end
 * only if every step is a plain object and the leaf is a non-empty,
 * non-whitespace string. Lets preflight read values from arbitrary parsed
 * JSON without leaning on `any`.
 */
function extractNonEmptyString(obj: unknown, path: string[]): string | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' && cur.trim() !== '' ? cur : null;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Error thrown when preview is not in a healthy/running state
 */
export class PreviewNotRunningError extends Error {
  constructor(
    message: string,
    public readonly processState: PreviewProcessState,
    public readonly details?: string,
    /** True if this is a system/connection error rather than a known bad state */
    public readonly isSystemError: boolean = false
  ) {
    super(message);
    this.name = 'PreviewNotRunningError';
  }
}

/**
 * Error thrown when pre-flight validation finds neither `.airo/config.json`
 * with `runtime.serve.command` nor `package.json` with `scripts.start`.
 * Without one of these, `paas-run.sh` has no start command and will abort —
 * we raise 412 here so the caller sees a clear error instead of a 2-minute
 * health-check timeout.
 */
export class MissingStartCommandError extends Error {
  readonly statusCode = 412;
  constructor(
    public readonly preflight: PaasPreflightResult
  ) {
    super(
      'PaaS app has no start command: neither .airo/config.json ' +
      '(runtime.serve.command) nor package.json (scripts.start) defines one. ' +
      'Re-run the project import, or add a "start" script to package.json.'
    );
    this.name = 'MissingStartCommandError';
  }
}

interface PaasPreflightResult {
  hasAiroConfig: boolean;
  serveCommand: string | null;
  hasPackageJson: boolean;
  hasStartScript: boolean;
  startScript: string | null;
}

/**
 * PaaS Publish Strategy
 *
 * Simplified publish workflow for PaaS apps:
 * - No git operations (code is uploaded directly, not developed in-app)
 * - Full source archive (needs package.json for npm install in publish container)
 * - Timestamp-based identifier instead of git commit hash
 * - Preview must be running before publish is allowed
 * - Timeout recovery logic for supervisor communication
 */
export class PaaSPublishStrategy implements PublishStrategy {
  readonly key: DeploymentStrategy = 'paas';

  private static isRecoverableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return PAAS_PUBLISH_RECOVERY_CONFIG.recoverableErrors.some(
      (retryable) => message.includes(retryable)
    );
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async prepareBuild(context: PublishContext): Promise<BuildResult> {
    const { logger, gitUtils, appPath, targetDir } = context;

    // Step 0: Ensure preview is running before proceeding
    await this.ensurePreviewRunning(context);

    // Step 0.4: Resolve and persist a start command into .airo/config.json.
    // Preview boots dev-only apps via the image-floor CMD (`npm run dev`)
    // with no config, so apps that never went through the import path arrive
    // here with nothing for paas-run.sh to exec. The file is included in the
    // archive even when untracked (getUntrackedExclusions preserves .airo/).
    await this.ensureStartCommandPersisted(context);

    // Step 0.5: Pre-flight — verify the archive will contain a usable start
    // command, so we don't ship a tar that paas-run.sh will reject after a
    // 2-minute health-check timeout. After the persist step above this is a
    // safety net rather than a strict gate.
    await this.preflightStartCommand(context);

    // No git operations - generate hex timestamp identifier
    // Format as hex to pass git.ts validation (requires ^[a-f0-9]{7,40}$)
    // Use 12 chars: Date.now() in hex produces ~11-12 chars currently,
    // padding to 12 ensures consistent length and uniqueness for ~4,400 years
    const commitHash = Date.now().toString(16).padStart(12, '0');
    logger.info(`route.publish.${this.key}.git-skipped`, {
      identifier: commitHash,
      message: 'PaaS strategy: skipping git operations',
    });

    // Create archive with full source INCLUDING node_modules (PaaS optimization)
    // This allows publish container to skip npm install entirely
    logger.info(`route.publish.${this.key}.archive.begin`, {
      commitHash: commitHash.substring(0, 7),
      includeSource: true,
      includeNodeModules: true,
    });

    const archiveStartTime = Date.now();
    const archiveResult = await gitUtils.createArchive(
      appPath,
      commitHash,
      targetDir,
      // PaaS archives include node_modules (~500MB), so use longer timeout (120s vs default 60s)
      { includeSource: true, excludeUntracked: true, includeNodeModules: true, timeout: 120000 }
    );
    const archiveDurationMs = Date.now() - archiveStartTime;

    logger.info(`route.publish.${this.key}.archive.success`, {
      commitHash: commitHash.substring(0, 7),
      archivePath: archiveResult.path,
      archiveDurationMs: archiveDurationMs,
    });

    return {
      commitHash,
      archivePath: archiveResult.path,
    };
  }

  /**
   * Read `/app/.airo/config.json` and `/app/package.json` via dev-supervisor
   * and report what start command the publish container would find. Mirrors
   * paas-run.sh: prefer `.airo/config.json` → `runtime.serve.command`, else
   * `package.json` → `scripts.start`. Returns `null` when the exec itself
   * fails (infrastructure error) so callers can distinguish that from a
   * genuinely absent command. Reads the *working tree*, which is what both the
   * archive and paas-run.sh ultimately operate on.
   */
  private async readPaasStartState(context: PublishContext): Promise<PaasPreflightResult | null> {
    const { logger, tasks, appId } = context;

    // `|| true` on each cat keeps the overall exit code 0 when a file is
    // missing — without it a non-zero status makes exitCode !== 0 and we
    // can't distinguish "infrastructure failure" from "file absent".
    const SEP = '---airo-preflight-sep---';
    const result = await tasks.runCommandSync({
      command: `cat /app/.airo/config.json 2>/dev/null || true; printf '\\n${SEP}\\n'; cat /app/package.json 2>/dev/null || true`,
      timeoutSeconds: 10,
    });

    if (result.exitCode !== 0) {
      logger.warn(`route.publish.${this.key}.preflight.exec-failed`, {
        appId,
        stderr: result.stderr?.slice(0, 500),
      });
      return null;
    }

    // exitCode === 0 only tells us the shell ran; individual cats may have
    // produced empty output. We detect each file's presence by whether its
    // section parses as JSON.
    const [airoRaw = '', packageRaw = ''] = (result.stdout ?? '').split(SEP);

    const airoConfig = safeJsonParse(airoRaw);
    const packageJson = safeJsonParse(packageRaw);

    const serveCommand = extractNonEmptyString(airoConfig, ['runtime', 'serve', 'command']);
    const startScript = extractNonEmptyString(packageJson, ['scripts', 'start']);

    return {
      hasAiroConfig: isPlainObject(airoConfig),
      serveCommand,
      hasPackageJson: isPlainObject(packageJson),
      hasStartScript: startScript !== null,
      startScript,
    };
  }

  /**
   * Ensure `.airo/config.json` has a `runtime.serve.command` before the
   * archive is built.
   *
   * If no `serve.command` is present, resolve one via the shared fallback
   * chain (user → scripts.start → scripts.dev → default — same logic as
   * import and restart) and write it with `createPaasConfig`.
   *
   * The file does not need to be committed — `getUntrackedExclusions`
   * explicitly preserves `.airo/` in the archive even when untracked.
   *
   * An existing `serve.command` is never overwritten. On an infrastructure
   * read failure we skip and let the preflight handle reporting.
   */
  private async ensureStartCommandPersisted(context: PublishContext): Promise<void> {
    const { logger, tasks, appPath, appId } = context;

    const state = await this.readPaasStartState(context);
    if (!state) {
      // Could not read the workspace — don't blindly write. The preflight runs
      // next and applies the same null-handling (skip), preserving prior behavior.
      return;
    }

    // A committed `scripts.start` already ships in the archive (package.json is
    // tracked) and satisfies paas-run.sh, so when neither a config serve command
    // nor a start script exists we must synthesize one from the fallback chain.
    if (!state.serveCommand && !state.startScript) {
      const packageManager = await detectPackageManager(tasks);
      const scripts = await readPackageJsonScripts(tasks, '/app', appId);
      const { startCommand, serveCommandSource } = resolveStartCommand(
        undefined,
        scripts,
        packageManager
      );

      logger.info(`route.publish.${this.key}.start-command.resolved`, {
        appId,
        packageManager,
        serveCommandSource,
        startCommand,
      });

      await appRestartService.createPaasConfig(
        appPath,
        undefined, // buildToolType (deprecated)
        startCommand,
        undefined, // productId
        undefined, // customDevCommand
        packageManager,
        serveCommandSource,
        appId
      );
    } else if (!state.serveCommand) {
      // package.json's scripts.start already covers the runtime — nothing to
      // persist. (No config file may exist, so don't attempt to commit one.)
      logger.info(`route.publish.${this.key}.start-command.persisted`, {
        appId,
        reason: 'start-script-sufficient',
      });
      return;
    }

    logger.info(`route.publish.${this.key}.start-command.persisted`, {
      appId,
      hadServeCommand: state.serveCommand !== null,
    });
  }

  /**
   * Pre-flight safety net: confirm the publish container will find a start
   * command. Emits a diagnostic event with both flags. If neither
   * `.airo/config.json` → `runtime.serve.command` nor `package.json` →
   * `scripts.start` is present, throws MissingStartCommandError so the route
   * returns 412 instead of hanging for the full health-check timeout. After
   * {@link ensureStartCommandPersisted} this should normally pass.
   */
  private async preflightStartCommand(context: PublishContext): Promise<void> {
    const { logger, appId } = context;

    const preflight = await this.readPaasStartState(context);
    if (!preflight) {
      return; // infrastructure read failure — already logged
    }

    logger.info(`route.publish.${this.key}.preflight.config`, {
      appId,
      ...preflight,
    });

    if (!preflight.serveCommand && !preflight.startScript) {
      logger.error(
        `route.publish.${this.key}.preflight.missing-start-command`,
        { appId, ...preflight }
      );
      throw new MissingStartCommandError(preflight);
    }
  }

  /**
   * Verify the preview container is in a publishable state.
   * Queries the dev-supervisor's process status API via Unix socket.
   *
   * Only rejects on `error` state (a real crash). `stopped` is normal when
   * the app was idle-stopped by start-on-request after the idle timeout —
   * the files are still on disk for archiving, and the publish container
   * runs its own health check after deployment.
   */
  private async ensurePreviewRunning(context: PublishContext): Promise<void> {
    const { logger, runtime } = context;

    logger.info(`route.publish.${this.key}.preview-check.begin`, {});

    try {
      if (!runtime) {
        throw new PreviewNotRunningError('Preview is not healthy', 'unknown', 'Runtime not available', true);
      }

      const status = await runtime.status();
      logger.info(`route.publish.${this.key}.preview-check.result`, {
        state: status.state,
        healthStatus: status.health.status,
      });

      // Only reject on error state — the process crashed or failed to start.
      // stopped/starting/stopping are all acceptable: the app may have been
      // idle-stopped (start-on-request), and files are on disk for archiving.
      if (status.state === 'error') {
        throw new PreviewNotRunningError(
          'Preview is not healthy',
          status.state,
          `Process in error state: ${status.lastError ?? 'unknown'}`,
        );
      }

      // If running and health monitor reports unhealthy, the app is up but
      // not serving — reject so the user can investigate before publishing.
      if (status.state === 'running' && status.health.status === 'unhealthy') {
        throw new PreviewNotRunningError(
          'Preview is not healthy',
          status.state,
          `Process running but health check reports: ${status.health.message}`,
        );
      }

      return;
    } catch (error) {
      if (error instanceof PreviewNotRunningError) {
        throw error;
      }

      logger.error(`route.publish.${this.key}.preview-check.failed`, {
        error: error instanceof Error ? error.message : String(error),
      });

      throw new PreviewNotRunningError('Preview is not healthy', 'unknown', undefined, true);
    }
  }

  /**
   * Deploy to publish supervisor with timeout recovery.
   *
   * Simple flow: try publish → on timeout, restart container → wait for healthy
   */
  async deploy(
    publishSupervisor: DevSupervisorClient,
    request: PublishRequest,
    logger: ILogger
  ): Promise<PublishResponse> {
    // Step 1: Try normal publish
    try {
      return await publishSupervisor.publish(request);
    } catch (error) {
      if (!PaaSPublishStrategy.isRecoverableError(error as Error)) {
        throw error; // Non-recoverable, fail immediately
      }

      logger.warn('route.publish.supervisor.timeout_restarting', {
        commitHash: request.commitHash.substring(0, 7),
        error: (error as Error).message,
      });
    }

    // Step 2: Restart container
    const restartResult = await publishSupervisor.restartProcess({ graceful: true });
    if (!restartResult.success) {
      throw new Error(`Restart failed: ${restartResult.error}`);
    }

    // Step 3: Wait for healthy with correct version
    // Use request.healthTimeoutSeconds if provided, otherwise use default
    const timeoutMs = request.healthTimeoutSeconds
      ? request.healthTimeoutSeconds * 1000
      : PAAS_PUBLISH_RECOVERY_CONFIG.defaultHealthPollTimeoutMs;
    return await this.pollForHealth(publishSupervisor, request.commitHash, logger, timeoutMs);
  }

  /**
   * Polls the publish supervisor for health status until healthy with correct version or timeout.
   *
   * @param publishSupervisor - The supervisor client
   * @param commitHash - Expected version to match
   * @param logger - Logger instance
   * @param timeoutMs - Polling timeout in milliseconds
   */
  private async pollForHealth(
    publishSupervisor: DevSupervisorClient,
    commitHash: string,
    logger: ILogger,
    timeoutMs: number
  ): Promise<PublishResponse> {
    const { healthPollIntervalMs } = PAAS_PUBLISH_RECOVERY_CONFIG;
    const deadline = Date.now() + timeoutMs;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    logger.info('route.publish.supervisor.timeout_recovery_polling', {
      commitHash: commitHash.substring(0, 7),
      timeoutMs,
    });

    while (Date.now() < deadline) {
      let status;
      try {
        // Don't fetch logs during polling - only need health status
        status = await publishSupervisor.getPublishStatus({ includeLogs: false, lines: 0 });
        consecutiveErrors = 0; // Reset on successful call
      } catch (error) {
        consecutiveErrors++;
        logger.warn('route.publish.supervisor.timeout_recovery_poll_error', {
          error: (error as Error).message,
          consecutiveErrors,
        });
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Failed to get status after ${maxConsecutiveErrors} attempts: ${(error as Error).message}`);
        }
        await PaaSPublishStrategy.sleep(healthPollIntervalMs);
        continue;
      }

      // Check for error state first
      if (status.process.state === 'error') {
        logger.error('route.publish.supervisor.timeout_recovery_failed', {
          processState: status.process.state,
          healthMessage: status.health.message,
        });
        throw new Error(`Process in error state: ${status.health.message}`);
      }

      // Check if healthy AND version matches the expected commit
      if (status.health.status === 'healthy' && status.version === commitHash) {
        logger.info('route.publish.supervisor.timeout_recovery_success', {
          version: status.version,
        });
        return {
          status: 'success',
          version: status.version,
          healthStatus: 'healthy',
        };
      }

      // Log when healthy but version doesn't match (could be serving old version)
      if (status.health.status === 'healthy' && status.version !== commitHash) {
        logger.info('route.publish.supervisor.timeout_recovery_version_mismatch', {
          expectedVersion: commitHash.substring(0, 7),
          actualVersion: status.version?.substring(0, 7) ?? 'null',
        });
      }

      await PaaSPublishStrategy.sleep(healthPollIntervalMs);
    }

    logger.error('route.publish.supervisor.timeout_recovery_failed', {
      reason: 'polling_timeout',
    });
    throw new Error('Recovery timeout: app did not become healthy with expected version');
  }
}

/**
 * Build error with details for API response
 */
export class BuildError extends Error {
  constructor(
    message: string,
    public readonly details: string,
    public readonly exitCode?: number
  ) {
    super(message);
    this.name = 'BuildError';
  }
}
