import { AppRepository } from '../database/repositories/AppRepository.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { GitUtils } from '../utils/git.js';
import { logger } from '../logging/index.js';

/**
 * Tracks active feature branches per app
 */
interface AppBranchInfo {
  appId: string;
  branchName: string;
  conversationId?: string | undefined;  // Primary: for meaningful tracking and audit
  socketId?: string | undefined;         // Fallback: for disconnection lookup
  userPrompt?: string | undefined;
  createdAt: Date;
}

/**
 * Git Hook Service
 *
 * Manages automated git operations throughout the message lifecycle:
 * - Branch safety check and feature branch creation at message start
 * - Commit all changes and squash merge to main at message completion
 *
 * All changes accumulate on the feature branch during the AI response, then
 * get committed and squash-merged to main at the end. This avoids race conditions
 * from parallel tool calls competing for .git/index.lock.
 *
 * All operations are transparent to the LLM and designed to never block execution.
 * Tracks branches per appId since git operations are per-repository.
 *
 * Shutdown integration:
 * When the server receives SIGTERM, wsServer.close() fires socket disconnect
 * events which trigger handleConnectionEnd asynchronously. The shutdown sequence
 * in app.ts calls waitForInFlightOps() to block until those git operations
 * complete, ensuring no work is lost. Callers must register promises via
 * trackOperation() for this to work.
 */
export class GitHookService {
  private appRepository: AppRepository;
  private appBranches: Map<string, AppBranchInfo>;
  private inFlightOps: Set<Promise<unknown>>;

  constructor() {
    this.appRepository = new AppRepository();
    this.appBranches = new Map();
    this.inFlightOps = new Set();
  }

  /**
   * Generate timestamp in YYYYMMDDHHmmss format for branch names and commits
   */
  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  /**
   * Generate feature branch name from timestamp and app ID
   */
  private generateBranchName(appId: string): string {
    const timestamp = this.generateTimestamp();
    // Use app ID to create unique branch name
    const sanitizedAppId = appId.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    return `${timestamp}-${sanitizedAppId}`;
  }

  /**
   * Get active branch info for an app
   */
  getAppBranch(appId: string): AppBranchInfo | undefined {
    return this.appBranches.get(appId);
  }

  /**
   * Check if an app has an active feature branch
   */
  hasActiveBranch(appId: string): boolean {
    return this.appBranches.has(appId);
  }

  /**
   * Log git error silently (non-blocking to avoid disrupting agent flow)
   */
  private logGitError(appId: string, operation: string, error: Error | string): void {
    const errorMessage = error instanceof Error ? error.message : error;

    logger.warn('git_hook.error.silent', {
      appId,
      operation,
      error: errorMessage
    });
  }

  /**
   * Handle message start: check setup status, ensure correct branch, create feature branch.
   * Called at the start of EVERY message for an app.
   *
   * Workflow:
   * 1. Check setup status — if deferred setup pending, trigger and skip git ops
   * 2. Check current branch — if unexpected, warn and switch to main
   * 3. If on tracked feature branch, continue on it
   * 4. Create new feature branch for this message
   */
  async handleMessageStart(
    appId: string,
    conversationId?: string,
    socketId?: string,
    userPrompt?: string
  ): Promise<void> {
    try {
      const app = this.appRepository.findById(appId);
      if (!app) {
        this.logGitError(appId, 'handleMessageStart', 'App not found');
        return;
      }

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor) {
        this.logGitError(appId, 'handleMessageStart', 'DevSupervisor not available');
        return;
      }

      // Setup coordination: ensure nomad_setup.sh has run before git operations.
      // After Nomad reschedule, deferred setup may not have run yet.
      // Fire-and-forget: trigger setup but don't block (npm install can take minutes).
      // Skip git ops for this message; subsequent messages will find setup complete.
      try {
        const setupStatus = await devSupervisor.getSetupStatus();
        if (setupStatus.setup_deferred && !setupStatus.setup_executed) {
          if (setupStatus.setup_error) {
            // Setup failed permanently — don't retry, let user diagnose
            logger.warn('git_hook.message_start.setup_failed', {
              appId, error: setupStatus.setup_error
            });
          } else if (!setupStatus.setup_running) {
            // Trigger setup but don't block — npm install can take minutes.
            // executeSetup() is synchronous on the Go side (blocks until script
            // completes or 5-min mutex timeout). The detached promise keeps the
            // HTTP request open in the background; Go-side timeout bounds it.
            devSupervisor.executeSetup().catch(err =>
              logger.warn('git_hook.setup.trigger_failed', {
                appId,
                error: err instanceof Error ? err.message : String(err)
              })
            );
            logger.info('git_hook.message_start.setup_triggered', { appId });
          } else {
            logger.info('git_hook.message_start.setup_running', { appId });
          }
          return;
        }

        if (setupStatus.setup_deferred && setupStatus.setup_executed) {
          logger.debug('git_hook.message_start.setup_complete', { appId });
        }
      } catch (setupError) {
        // getSetupStatus failed (e.g., dev-supervisor not reachable).
        // Log and continue — this is non-fatal. Without dev-supervisor,
        // git operations will also fail, but handleMessageStart's outer
        // try/catch handles that gracefully.
        this.logGitError(appId, 'setupCoordination', setupError as Error);
      }

      const gitUtils = new GitUtils(devSupervisor);

      // Check if this is a git repository
      const isRepo = await gitUtils.isGitRepository(app.path);
      if (!isRepo) {
        logger.info('git_hook.not_a_repository', { appId });
        return;
      }

      // Check current branch
      const currentBranch = await gitUtils.getCurrentBranch(app.path);
      const trackedBranch = this.appBranches.get(appId);

      logger.info('git_hook.message_start.branch_check', {
        appId,
        socketId,
        currentBranch,
        trackedBranch: trackedBranch?.branchName || 'none'
      });

      // Branch safety check: if not on main and not our tracked branch, switch to main.
      // With nomad_setup.sh handling filesystem recovery and setup coordination above,
      // being on an unexpected branch is an edge case. Just switch — don't try to
      // preserve work via squash merge.
      if (currentBranch !== 'main') {
        const isExpectedBranch = trackedBranch && currentBranch === trackedBranch.branchName;

        if (!isExpectedBranch) {
          logger.warn('git_hook.unexpected_branch', {
            appId,
            currentBranch,
            expectedBranch: trackedBranch?.branchName || 'none'
          });
          // Reset before switching — working tree may be dirty from a crashed
          // tool call (process restart without Nomad reschedule means
          // nomad_setup.sh didn't run). git checkout refuses to switch with
          // conflicting uncommitted changes.
          await gitUtils.reset(app.path, { mode: 'hard' });
          await gitUtils.switchBranch(app.path, 'main');
          this.appBranches.delete(appId);
        } else {
          // We're on our expected feature branch - continue
          logger.debug('git_hook.message_start.on_feature_branch', {
            appId,
            branchName: currentBranch
          });

          if (userPrompt && trackedBranch && !trackedBranch.userPrompt) {
            trackedBranch.userPrompt = userPrompt;
            this.appBranches.set(appId, trackedBranch);
          }

          return; // Continue on existing branch
        }
      }

      // At this point we're on main (either we started here or recovery got us here)
      // Create new feature branch
      const branchName = this.generateBranchName(appId);

      try {
        await gitUtils.createBranch(app.path, branchName);

        // Track this branch for the app (with both conversationId and socketId)
        this.appBranches.set(appId, {
          appId,
          branchName,
          conversationId,
          socketId,
          userPrompt,
          createdAt: new Date()
        });

        logger.info('git_hook.feature_branch.created', {
          appId,
          conversationId,
          socketId,
          branchName
        });
      } catch (error) {
        this.logGitError(appId, 'createFeatureBranch', error as Error);
      }

    } catch (error) {
      this.logGitError(appId, 'handleMessageStart', error as Error);
    }
  }

  /**
   * Handle message completion: Final commit and squash merge to main
   *
   * Workflow:
   * 1. Check for any uncommitted changes
   * 2. Commit with "{timestamp}-end-of-session-{reason}" if needed
   * 3. Use user prompt directly as squash commit message (truncated to 72 chars)
   * 4. Checkout main and squash merge feature branch
   * 5. Clean up old branches if count > 50 (non-blocking, runs in background)
   * 6. Clean up tracking
   *
   * Note: Branch cleanup and git gc run asynchronously and don't block the workflow
   */
  async handleConnectionEnd(
    appId: string,
    reason: 'complete' | 'error' | 'disconnection',
    conversationId?: string,
    socketId?: string,
    userPrompt?: string
  ): Promise<string | null> {
    try {
      // Get tracked branch info
      const branchInfo = this.appBranches.get(appId);
      if (!branchInfo) {
        logger.debug('git_hook.connection_end.no_branch', {
          appId,
          socketId,
          reason
        });
        return null;
      }

      const { branchName } = branchInfo;
      const finalUserPrompt = userPrompt || branchInfo.userPrompt || 'Development session';

      const app = this.appRepository.findById(appId);
      if (!app) {
        this.logGitError(appId, 'handleConnectionEnd', 'App not found');
        this.appBranches.delete(appId);
        return null;
      }

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor) {
        this.logGitError(appId, 'handleConnectionEnd', 'DevSupervisor not available');
        this.appBranches.delete(appId);
        return null;
      }

      const gitUtils = new GitUtils(devSupervisor);

      // Check if this is a git repository
      const isRepo = await gitUtils.isGitRepository(app.path);
      if (!isRepo) {
        this.appBranches.delete(appId);
        return null;
      }

      // Get current branch (should be feature branch)
      const currentBranch = await gitUtils.getCurrentBranch(app.path);

      logger.info('git_hook.connection_end.start', {
        appId,
        conversationId: conversationId || branchInfo.conversationId,
        socketId,
        currentBranch,
        expectedBranch: branchName,
        reason
      });

      // If we're already on main, skip squash merge
      if (currentBranch === 'main') {
        logger.warn('git_hook.connection_end.already_on_main', {
          appId,
          socketId,
          reason
        });
        this.appBranches.delete(appId);
        return null;
      }

      // Step 1: Commit any remaining uncommitted changes
      const hasChanges = await gitUtils.hasUncommittedChanges(app.path);
      if (hasChanges) {
        const timestamp = this.generateTimestamp();
        const commitMessage = `${timestamp}-end-of-session-${reason}`;

        try {
          await gitUtils.addFiles(app.path, ['.']);
          await gitUtils.commit(app.path, commitMessage);

          logger.info('git_hook.connection_end.final_commit', {
            appId,
            socketId,
            commitMessage,
            reason
          });
        } catch (error) {
          this.logGitError(appId, 'finalCommit', error as Error);
        }
      }

      // Step 2: Use user prompt directly as commit message
      let squashMessage = finalUserPrompt;

      // Limit message length to 72 characters for git best practices
      if (squashMessage.length > 72) {
        squashMessage = squashMessage.substring(0, 69) + '...';
      }

      // Step 3: Squash merge to main
      try {
        await gitUtils.switchBranch(app.path, 'main');
        const mainHeadBefore = await gitUtils.getCommitHistory(app.path, 1);
        const mainHashBefore = mainHeadBefore[0]?.hash ?? null;

        await gitUtils.squashMerge(app.path, currentBranch, squashMessage);

        logger.info('git_hook.connection_end.squash_merged', {
          appId,
          socketId,
          featureBranch: currentBranch,
          squashMessage,
          reason
        });

        // Get the commit hash we just created
        const commitsAfter = await gitUtils.getCommitHistory(app.path, 1);
        const mainHashAfter = commitsAfter[0]?.hash ?? null;
        const commitHash =
          mainHashAfter && mainHashAfter !== mainHashBefore ? mainHashAfter : null;

        logger.info('git_hook.connection_end.commit_hash', {
          appId,
          commitHash: commitHash ? commitHash.substring(0, 7) : 'none',
          reason
        });

        // Step 4: Clean up old branches if needed (non-blocking)
        gitUtils.cleanupOldBranches(app.path).then(cleanupResult => {
          if (cleanupResult.needed) {
            logger.info('git_hook.connection_end.old_branches_cleaned', {
              appId,
              deleted: cleanupResult.deleted,
              failed: cleanupResult.failed.length,
              gcPerformed: cleanupResult.gcPerformed
            });
          }
        }).catch(cleanupError => {
          // Log but don't fail - cleanup is not critical
          this.logGitError(appId, 'cleanupOldBranches', cleanupError as Error);
        });

        // Clean up tracking
        this.appBranches.delete(appId);

        // Return the commit hash
        return commitHash;

      } catch (error) {
        this.logGitError(appId, 'squashMerge', error as Error);

        // Try to at least get back to main
        try {
          await gitUtils.switchBranch(app.path, 'main');
        } catch (switchError) {
          this.logGitError(appId, 'switchToMain', switchError as Error);
        }

        this.appBranches.delete(appId);
        return null;
      }

    } catch (error) {
      this.logGitError(appId, 'handleConnectionEnd', error as Error);
      this.appBranches.delete(appId);
      return null;
    }
  }

  /**
   * Update user prompt for an active app branch
   * Useful for capturing the initial prompt for commit message generation
   */
  updateUserPrompt(appId: string, userPrompt: string): void {
    const branchInfo = this.appBranches.get(appId);
    if (branchInfo && !branchInfo.userPrompt) {
      branchInfo.userPrompt = userPrompt;
      this.appBranches.set(appId, branchInfo);
    }
  }

  /**
   * Find appId by conversationId from active branches
   * Primary lookup method - more reliable than socketId
   */
  findAppIdByConversationId(conversationId: string): string | undefined {
    for (const [appId, branchInfo] of this.appBranches.entries()) {
      if (branchInfo.conversationId === conversationId) {
        return appId;
      }
    }
    return undefined;
  }

  /**
   * Find appId by socketId from active branches
   * Fallback lookup method when conversationId not available (e.g., on disconnection)
   */
  findAppIdBySocketId(socketId: string): string | undefined {
    for (const [appId, branchInfo] of this.appBranches.entries()) {
      if (branchInfo.socketId === socketId) {
        return appId;
      }
    }
    return undefined;
  }

  /**
   * Get all active app IDs with feature branches
   */
  getActiveAppIds(): string[] {
    return Array.from(this.appBranches.keys());
  }

  /**
   * Clear branch tracking for an app.
   * Called by the publish route after DefaultPublishStrategy merges the feature
   * branch to main — publish uses GitUtils directly and doesn't go through
   * handleConnectionEnd, so the stale tracking must be removed explicitly.
   */
  clearBranchTracking(appId: string): void {
    this.appBranches.delete(appId);
  }

  /**
   * Track an in-flight handleConnectionEnd promise so shutdown can await it.
   * The promise is removed from the set when it settles.
   */
  trackOperation(op: Promise<unknown>): void {
    this.inFlightOps.add(op);
    // Catch prevents unhandled rejection from the derived .finally() chain.
    // The original rejection is still observable via waitForInFlightOps/Promise.allSettled.
    op.catch(() => {}).finally(() => this.inFlightOps.delete(op));
  }

  /**
   * Wait for all in-flight git operations to complete.
   * Used during graceful shutdown to ensure disconnect-triggered
   * git commits finish before the process exits.
   */
  async waitForInFlightOps(): Promise<void> {
    if (this.inFlightOps.size > 0) {
      await Promise.allSettled(Array.from(this.inFlightOps));
    }
  }
}
