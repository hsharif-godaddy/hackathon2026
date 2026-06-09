import type { PublishStrategy, PublishContext, BuildResult, DeploymentStrategy } from './PublishStrategy.js';
import type { DevSupervisorClient, PublishRequest, PublishResponse } from '../../../../services/DevSupervisorClient.js';
import type { ILogger } from '../../../../logging/types.js';
import { BuildError } from './PaaSPublishStrategy.js';

/**
 * Default Publish Strategy (AAB apps)
 *
 * Full git-based publish workflow:
 * - Ensures on main branch (merges feature branch if needed)
 * - Validates git state
 * - Runs production build
 * - Creates archive (auto-detects based on server.bundle.cjs)
 */
export class DefaultPublishStrategy implements PublishStrategy {
  readonly key: DeploymentStrategy = 'default';

  async prepareBuild(context: PublishContext): Promise<BuildResult> {
    const { logger, gitUtils, appPath, targetDir } = context;

    // 1. Ensure on main branch (merge feature branch if needed)
    const commitHash = await this.ensureMainBranch(context);

    // 2. Validate git state
    await this.validateGitState(context, commitHash);

    // 3. Build
    await this.build(context, commitHash);

    // 4. Create archive (auto-detect based on server.bundle.cjs)
    const archivePath = await this.createArchive(context, commitHash);

    // Lazy import avoids pulling the full GitOpsService dependency tree
    // into the publish strategy's static imports (breaks test mocks).
    import('../../../../services/GitOpsService.js')
      .then(({ GitOpsService }) => new GitOpsService().triggerAutoSync(context.appId, 'on_publish'))
      .catch(() => {});

    return { commitHash, archivePath };
  }

  /**
   * Ensure we're on main branch before publishing.
   * If on a feature branch, merge it to main first.
   * Detached HEAD (manually selected old commit) is allowed.
   */
  private async ensureMainBranch(context: PublishContext): Promise<string> {
    const { logger, gitUtils, appPath } = context;

    const currentBranch = await gitUtils.getCurrentBranch(appPath);

    // Skip merge logic if in detached HEAD state (user manually selected old commit to publish)
    // In detached HEAD, getCurrentBranch returns 'HEAD' or the commit hash
    const isDetachedHead = currentBranch === 'HEAD' || currentBranch.match(/^[0-9a-f]{7,40}$/i);

    if (isDetachedHead) {
      logger.info(`route.publish.${this.key}.detached-head`, {
        currentBranch,
        message: 'Publishing from detached HEAD (manually selected commit)',
      });
    } else if (currentBranch !== 'main') {
      logger.warn(`route.publish.${this.key}.not-on-main`, {
        currentBranch,
        action: 'squash-merging-to-main',
      });

      // Check for uncommitted changes and commit them first
      const hasChanges = await gitUtils.hasUncommittedChanges(appPath);
      if (hasChanges) {
        // Only stage tracked modified files (not untracked files like screenshots, IDE files)
        await gitUtils.addFiles(appPath, ['-u']);
        const commitResult = await gitUtils.commit(appPath, `Pre-publish commit from ${currentBranch}`);

        // If commit succeeded, log it. If it failed, that's okay - probably nothing was staged
        // (only untracked files exist, which git add -u doesn't stage)
        if (commitResult.success) {
          logger.info(`route.publish.${this.key}.pre-publish-commit`, {
            currentBranch,
          });
        } else {
          logger.debug(`route.publish.${this.key}.no-changes-to-commit`, {
            currentBranch,
            message: 'No tracked modified files to commit (untracked files may exist)',
          });
        }
      }

      // Switch to main and verify it's in a clean state before merging
      await gitUtils.switchBranch(appPath, 'main');

      // Verify main branch has no staged or modified files before merging
      // Note: Untracked files are allowed (e.g., screenshots, IDE files, etc.)
      const mainStatus = await gitUtils.getStatus(appPath);
      if (mainStatus.stagedFiles > 0 || mainStatus.modifiedFiles > 0) {
        throw new BuildError('Main branch has staged or modified files - cannot safely merge', 'Git state validation failed');
      }

      logger.info(`route.publish.${this.key}.main-verified`, {
        branch: mainStatus.branch,
        isClean: mainStatus.isClean,
      });

      // Check if we can do a fast-forward merge (preserves commit history)
      // Fast-forward is possible when main is a direct ancestor of the feature branch
      const canFastForward = await gitUtils.canFastForwardMerge(appPath, currentBranch);

      let mergeResult: { success: boolean; stdout: string };
      let mergeType: 'fast-forward' | 'squash' | 'none' = 'none';

      if (canFastForward) {
        // Fast-forward merge - preserves all original commit messages
        // This keeps history clean with descriptive commit messages
        logger.info(`route.publish.${this.key}.merge-strategy`, {
          strategy: 'fast-forward',
          reason: 'main is ancestor of feature branch',
        });

        mergeResult = await gitUtils.fastForwardMerge(appPath, currentBranch);
        mergeType = 'fast-forward';

        logger.info(`route.publish.${this.key}.merged-to-main`, {
          fromBranch: currentBranch,
          mergeType: 'fast-forward',
        });
      } else {
        // Can't fast-forward - need to squash merge
        // This happens when main has moved forward since the feature branch was created
        logger.info(`route.publish.${this.key}.merge-strategy`, {
          strategy: 'squash',
          reason: 'main has diverged from feature branch',
        });

        mergeResult = await gitUtils.squashMerge(appPath, currentBranch, 'Publish: merge feature branch');

        // Check if there were actually changes merged
        const branchHasNewCommits = !mergeResult.stdout.includes('No changes to commit') && !mergeResult.stdout.includes('already merged');

        if (!branchHasNewCommits) {
          logger.info(`route.publish.${this.key}.branch-already-merged`, {
            fromBranch: currentBranch,
            message: 'Feature branch has no new commits - already up-to-date with main',
          });
          mergeType = 'none';
        } else {
          logger.info(`route.publish.${this.key}.merged-to-main`, {
            fromBranch: currentBranch,
            mergeType: 'squash',
          });
          mergeType = 'squash';
        }
      }

      // Clean up the feature branch after successful merge (but not if no merge happened)
      if (mergeType !== 'none') {
        try {
          await gitUtils.deleteBranch(appPath, currentBranch);
          logger.info(`route.publish.${this.key}.branch-cleanup`, {
            deletedBranch: currentBranch,
            mergeType,
          });
        } catch (cleanupError) {
          // Non-critical - log warning but continue
          logger.warn(`route.publish.${this.key}.branch-cleanup-failed`, {
            branch: currentBranch,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
    }

    // Get current commit hash (we're guaranteed to be on main at this point)
    const fullCommitHash = await gitUtils.getCurrentCommit(appPath);
    logger.info(`route.publish.${this.key}.begin`, {
      commitHash: fullCommitHash.substring(0, 7),
    });

    return fullCommitHash;
  }

  /**
   * Validate git state - check status and commit history
   */
  private async validateGitState(context: PublishContext, commitHash: string): Promise<void> {
    const { logger, gitUtils, appPath } = context;

    // Check git status
    logger.info(`route.publish.${this.key}.git-status.begin`, {});

    const status = await gitUtils.getStatus(appPath);
    logger.info(`route.publish.${this.key}.git-status.success`, {
      branch: status.branch,
      isClean: status.isClean,
    });

    // Get commit details from git log to validate commit exists
    logger.info(`route.publish.${this.key}.git-log.begin`, {});

    const commits = await gitUtils.getCommitHistory(appPath, 100);

    // Validate that the requested commit exists in recent history
    const commitExists = commits.some(
      (commit) => commit.hash === commitHash
    );

    if (!commitExists && commits.length > 0) {
      logger.warn(`route.publish.${this.key}.commit-not-in-recent-history`, {
        commitHash: commitHash.substring(0, 7),
        recentCommitsCount: commits.length,
      });
      // Still proceed - commit might be older than the 100 we checked
    }

    logger.info(`route.publish.${this.key}.git-log.success`, {
      commitsCount: commits.length,
      latestCommit: commits[0]?.hash.substring(0, 7),
    });
  }

  /**
   * Run production build
   */
  private async build(context: PublishContext, commitHash: string): Promise<void> {
    const { logger, tasks } = context;

    logger.info(`route.publish.${this.key}.build.begin`, {
      commitHash: commitHash.substring(0, 7),
    });

    const buildResult = await tasks.runCommandSync({
      command: 'NODE_ENV=production npm run build',
      workingDir: '/app',
      timeoutSeconds: 120,
    });

    if (buildResult.exitCode !== 0) {
      logger.error(`route.publish.${this.key}.build.failed`, {
        commitHash: commitHash.substring(0, 7),
        exitCode: buildResult.exitCode,
        stderr: buildResult.stderr,
      });
      throw new BuildError(
        'Build failed',
        buildResult.stderr || buildResult.stdout,
        buildResult.exitCode
      );
    }

    logger.info(`route.publish.${this.key}.build.success`, {
      commitHash: commitHash.substring(0, 7),
      executionTime: buildResult.executionTimeMs
    });
  }

  /**
   * Create production archive
   * Archive auto-detects: dist-only if server.bundle.cjs exists, otherwise full source
   */
  private async createArchive(context: PublishContext, commitHash: string): Promise<string> {
    const { logger, gitUtils, appPath, targetDir } = context;

    const isLocalDev = !process.env.NOMAD_ALLOC_DIR;

    logger.info(`route.publish.${this.key}.archive.begin`, {
      commitHash: commitHash.substring(0, 7),
      isLocalDev,
      deploymentStrategy: this.key,
    });

    // No options passed - let createArchive auto-detect based on server.bundle.cjs presence
    const archiveResult = await gitUtils.createArchive(
      appPath,
      commitHash,
      targetDir
    );

    logger.info(`route.publish.${this.key}.archive.success`, {
      commitHash: commitHash.substring(0, 7),
      archivePath: archiveResult.path,
    });

    return archiveResult.path;
  }

  /**
   * Deploy to publish supervisor.
   * Default strategy: Direct pass-through, no recovery logic.
   */
  async deploy(
    publishSupervisor: DevSupervisorClient,
    request: PublishRequest,
    _logger: ILogger
  ): Promise<PublishResponse> {
    return publishSupervisor.publish(request);
  }
}
