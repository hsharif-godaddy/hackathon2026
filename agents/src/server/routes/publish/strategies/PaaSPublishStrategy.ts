import type { PublishStrategy, PublishContext, PublishResult, DeploymentStrategy } from './PublishStrategy.js';

/**
 * PaaS Publish Strategy
 *
 * Simplified publish workflow for PaaS apps:
 * - No git operations (code is uploaded directly, not developed in-app)
 * - Full source archive (needs package.json for npm install in publish container)
 * - Timestamp-based identifier instead of git commit hash
 */
export class PaaSPublishStrategy implements PublishStrategy {
  readonly key: DeploymentStrategy = 'paas';

  async publish(context: PublishContext): Promise<PublishResult> {
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

    // Build the application
    logger.info(`route.publish.${this.key}.build.begin`, {
      commitHash: commitHash.substring(0, 7),
    });

    const buildResult = await devSupervisor.exec({
      command: 'NODE_ENV=production npm run build',
      working_dir: '/app',
      timeout: 120,
      capture_output: true,
    });

    if (!buildResult.success) {
      logger.error(`route.publish.${this.key}.build.failed`, {
        commitHash: commitHash.substring(0, 7),
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
      { includeSource: true }
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
