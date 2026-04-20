import type { PublishStrategy, PublishContext, BuildResult, DeploymentStrategy } from './PublishStrategy.js';
import type { DevSupervisorClient, PublishRequest, PublishResponse } from '../../../../services/DevSupervisorClient.js';
import type { ILogger } from '../../../../logging/types.js';
import { detectPackageManager, getBuildCommand } from '../../../../services/AppRestartService.js';

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

/**
 * PaaS Publish Strategy
 *
 * Simplified publish workflow for PaaS apps:
 * - No git operations (code is uploaded directly, not developed in-app)
 * - Full source archive (needs package.json for npm install in publish container)
 * - Timestamp-based identifier instead of git commit hash
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
    const { logger, devSupervisor, gitUtils, appPath, targetDir } = context;

    // No git operations - generate hex timestamp identifier
    // Format as hex to pass git.ts validation (requires ^[a-f0-9]{7,40}$)
    // Use 12 chars: Date.now() in hex produces ~11-12 chars currently,
    // padding to 12 ensures consistent length and uniqueness for ~4,400 years
    const commitHash = Date.now().toString(16).padStart(12, '0');
    logger.info(`route.publish.${this.key}.git-skipped`, {
      identifier: commitHash,
      message: 'PaaS strategy: skipping git operations',
    });

    // Detect package manager from lock files (uses shared utility)
    const packageManager = await detectPackageManager(devSupervisor);
    logger.info(`route.publish.${this.key}.package-manager.detected`, { packageManager });
    const buildCommand = getBuildCommand(packageManager, true); // production=true for publish

    // Build the application
    logger.info(`route.publish.${this.key}.build.begin`, {
      commitHash: commitHash.substring(0, 7),
      packageManager,
      command: buildCommand,
    });

    const buildResult = await devSupervisor.exec({
      command: buildCommand,
      working_dir: '/app',
      timeout: 120,
      capture_output: true,
    });

    if (!buildResult.success) {
      logger.error(`route.publish.${this.key}.build.failed`, {
        commitHash: commitHash.substring(0, 7),
        packageManager,
        exitCode: buildResult.exit_code,
        stderr: buildResult.stderr,
      });
      throw new BuildError(
        'Build failed',
        buildResult.stderr || buildResult.stdout,
        buildResult.exit_code
      );
    }

    logger.info(`route.publish.${this.key}.build.success`, {
      commitHash: commitHash.substring(0, 7),
      packageManager,
      executionTime: buildResult.execution_time,
    });

    // Create archive with full source (includeSource: true)
    logger.info(`route.publish.${this.key}.archive.begin`, {
      commitHash: commitHash.substring(0, 7),
      includeSource: true,
    });

    const archiveResult = await gitUtils.createArchive(
      appPath,
      commitHash,
      targetDir,
      { includeSource: true, excludeUntracked: true }
    );

    logger.info(`route.publish.${this.key}.archive.success`, {
      commitHash: commitHash.substring(0, 7),
      archivePath: archiveResult.path,
    });

    return {
      commitHash,
      archivePath: archiveResult.path,
    };
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
