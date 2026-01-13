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
 * - Recovery check and feature branch creation at message start
 * - Automatic commits after each tool call
 * - Squash merge to main at message completion
 * 
 * All operations are transparent to the LLM and designed to never block execution.
 * Tracks branches per appId since git operations are per-repository.
 */
export class GitHookService {
  private appRepository: AppRepository;
  private gitErrorsMap: Map<string, string[]>;
  private appBranches: Map<string, AppBranchInfo>;

  constructor() {
    this.appRepository = new AppRepository();
    this.gitErrorsMap = new Map();
    this.appBranches = new Map();
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
   * Log git error silently and accumulate for later reporting
   */
  private logGitError(appId: string, operation: string, error: Error | string): void {
    const errorMessage = error instanceof Error ? error.message : error;
    
    if (!this.gitErrorsMap.has(appId)) {
      this.gitErrorsMap.set(appId, []);
    }
    
    this.gitErrorsMap.get(appId)!.push(`[${operation}] ${errorMessage}`);
    
    logger.warn('git_hook.error.silent', {
      appId,
      operation,
      error: errorMessage
    });
  }

  /**
   * Get accumulated git errors for an app (if any)
   */
  getGitErrors(appId: string): string[] {
    return this.gitErrorsMap.get(appId) || [];
  }

  /**
   * Clear accumulated git errors for an app
   */
  clearGitErrors(appId: string): void {
    this.gitErrorsMap.delete(appId);
  }

  /**
   * Handle message start: ALWAYS check git state and ensure we're on correct branch
   * Called at the start of EVERY message for an app
   * 
   * CRITICAL: This ensures that if a previous squash merge failed (due to crash, error, etc.),
   * we recover before processing the new request.
   * 
   * Workflow:
   * 1. Check current branch (if not main, recovery needed)
   * 2. If recovery needed:
   *    - Commit any uncommitted changes with recovery marker
   *    - Get diff from main to generate commit message
   *    - Squash merge to main with generated/fallback message
   * 3. Create new feature branch for this message
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

      // If not on main, perform recovery
      if (currentBranch !== 'main') {
        // Check if this is our expected feature branch
        const isExpectedBranch = trackedBranch && currentBranch === trackedBranch.branchName;
        
        if (!isExpectedBranch) {
          // CRITICAL: We're on an unexpected branch - perform recovery
          logger.warn('git_hook.message_start.recovery_needed', {
            appId,
            currentBranch,
            expectedBranch: trackedBranch?.branchName || 'none',
            reason: 'Not on main and not on expected feature branch'
          });
          
          await this.performRecovery(appId, app.path, gitUtils, currentBranch);
          
          // Clear any stale tracking after recovery
          this.appBranches.delete(appId);
        } else {
          // We're on our expected feature branch - continue
          logger.debug('git_hook.message_start.on_feature_branch', {
            appId,
            branchName: currentBranch
          });
          
          // Update user prompt if provided
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
   * Perform git recovery when starting on non-main branch
   */
  private async performRecovery(
    appId: string,
    appPath: string,
    gitUtils: GitUtils,
    currentBranch: string
  ): Promise<void> {
    logger.info('git_hook.recovery.start', {
      appId,
      currentBranch
    });

    try {
      // Step 1: Commit any uncommitted changes
      const hasUncommitted = await gitUtils.hasUncommittedChanges(appPath);
      if (hasUncommitted) {
        const timestamp = this.generateTimestamp();
        await gitUtils.addFiles(appPath, ['.']);
        await gitUtils.commit(appPath, `${timestamp}-recovery-uncommitted`);
        
        logger.info('git_hook.recovery.uncommitted_committed', {
          appId,
          currentBranch
        });
      }

      // Step 2: Use simple recovery commit message
      const recoveryMessage = 'Recovery from interrupted session';
      
      // Step 3: Squash merge to main
      await gitUtils.switchBranch(appPath, 'main');
      await gitUtils.squashMerge(appPath, currentBranch, recoveryMessage);
      
      logger.info('git_hook.recovery.complete', {
        appId,
        previousBranch: currentBranch,
        commitMessage: recoveryMessage
      });

    } catch (error) {
      this.logGitError(appId, 'performRecovery', error as Error);
      
      // If recovery fails completely, try to at least get back to main
      try {
        await gitUtils.switchBranch(appPath, 'main');
      } catch (switchError) {
        this.logGitError(appId, 'recoveryFallback', switchError as Error);
      }
    }
  }

  /**
   * Handle tool call completion: Check for changes and commit if needed
   * 
   * Workflow:
   * 1. Check git status for changes
   * 2. If changes exist: git add . && git commit -m "{timestamp}-{toolName}"
   * 3. Log silently on errors (don't block execution)
   */
  async handleToolCallComplete(appId: string, toolName: string): Promise<void> {
    try {
      const app = this.appRepository.findById(appId);
      if (!app) {
        this.logGitError(appId, 'handleToolCallComplete', 'App not found');
        return;
      }

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor) {
        this.logGitError(appId, 'handleToolCallComplete', 'DevSupervisor not available');
        return;
      }

      const gitUtils = new GitUtils(devSupervisor);

      // Check if this is a git repository
      const isRepo = await gitUtils.isGitRepository(app.path);
      if (!isRepo) {
        return;
      }

      // Check for changes
      const hasChanges = await gitUtils.hasUncommittedChanges(app.path);
      
      if (!hasChanges) {
        logger.debug('git_hook.tool_call.no_changes', {
          appId,
          toolName
        });
        return;
      }

      // Commit changes with timestamp-toolName format
      const timestamp = this.generateTimestamp();
      const commitMessage = `${timestamp}-${toolName}`;
      
      try {
        await gitUtils.addFiles(app.path, ['.']);
        await gitUtils.commit(app.path, commitMessage);
        
        logger.info('git_hook.tool_call.committed', {
          appId,
          toolName,
          commitMessage
        });
      } catch (error) {
        this.logGitError(appId, 'toolCallCommit', error as Error);
      }

    } catch (error) {
      this.logGitError(appId, 'handleToolCallComplete', error as Error);
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
        await gitUtils.squashMerge(app.path, currentBranch, squashMessage);

        logger.info('git_hook.connection_end.squash_merged', {
          appId,
          socketId,
          featureBranch: currentBranch,
          squashMessage,
          reason
        });

        // Get the commit hash we just created
        const commits = await gitUtils.getCommitHistory(app.path, 1);
        const commitHash = commits[0]?.hash || null;

        logger.info('git_hook.connection_end.commit_hash', {
          appId,
          commitHash: commitHash ? commitHash.substring(0, 7) : 'unknown',
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
}

