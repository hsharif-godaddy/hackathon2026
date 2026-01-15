import { GitUtils, GitStatus as GitUtilsStatus } from '../utils/git.js';
import { logger } from '../logging/index.js';
import { toolGitEvents } from '../logging/events/index.js';
import { DevSupervisorClient } from '../services/DevSupervisorClient.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { buildShellCommand } from '../utils/shell-utils.js';
import { GitRemoteTokenManager } from '../services/GitRemoteTokenManager.js';
import { GitRemoteConfigRepository } from '../database/repositories/GitRemoteConfigRepository.js';
import { GitProviderFactory } from '../services/git-providers/GitProviderFactory.js';
import { getErrorMessage } from '../utils/error.js';

// Constants for business logic clarity
const MAX_COMMITS_FOR_INITIAL_BUILD = 2; // Allow for initial + first real commit

export interface GitToolOptions {
  /** The git operation to perform */
  operation:
    | 'status'
    | 'add'
    | 'commit'
    | 'diff'
    | 'log'
    | 'branch'
    | 'checkout'
    | 'merge'
    | 'pull'
    | 'push'
    | 'stash'
    | 'reset'
    | 'revert'
    | 'restore'
    | 'clean'
    | 'configure-remote';
  /** Files to operate on (for add, diff, etc.) */
  files?: string[];
  /** Commit message (for commit operation, or to identify commit by message for revert) */
  message?: string;
  /** Branch name (for checkout, merge, etc.) */
  branch?: string;
  /** Repository URL (for configure-remote operation) */
  repoUrl?: string;
  /** Remote name (for configure-remote, push, pull operations, default: 'origin') */
  remoteName?: string;
  /** Remote name alias (for push, pull operations) */
  remote?: string;
  /** Force push (for push operation) */
  forcePush?: boolean;
  /** Operation-specific options */
  options?: {
    /** Include all files (for add, commit) */
    all?: boolean;
    /** Commit hash (for revert/restore operation, reset target) */
    hash?: string;
    /** Amend last commit (for commit) */
    amend?: boolean;
    /** Force operation (for push, checkout) */
    force?: boolean;
    /** Reset mode (for reset operation) */
    mode?: 'soft' | 'mixed' | 'hard';
    /** Number of commits (for log, reset) */
    count?: number;
    /** Create new branch (for checkout) */
    createBranch?: boolean;
    /** Include untracked files (for stash) */
    includeUntracked?: boolean;
    /** Verbose output */
    verbose?: boolean;
  };
  /** Auto-generate commit message from recent file changes */
  autoMessage?: boolean;
  /** Preview operation without executing */
  dryRun?: boolean;
}

export interface GitToolResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The operation that was performed */
  operation: string;
  /** Output message */
  output?: string;
  /** Git status information */
  status?: {
    branch?: string;
    ahead?: number;
    behind?: number;
    isClean?: boolean;
    stagedFiles?: number;
    modifiedFiles?: number;
    untrackedFiles?: number;
  };
  /** Diff output */
  diff?: string;
  /** Commit history */
  commits?: Array<{
    hash: string;
    author: string;
    date: string;
    message: string;
  }>;
  /** Branch information */
  branches?: string[];
  /** Current branch */
  currentBranch?: string;
  /** Error message if operation failed */
  error?: string;
  /** Warning message */
  warning?: string;
}

/**
 * Git Tool
 * Provides comprehensive Git operations with intelligent features
 */
export class GitTool {
  private gitUtils: GitUtils;
  private devSupervisor: DevSupervisorClient | null;
  private gitRemoteTokenManager: GitRemoteTokenManager | null;
  private gitRemoteConfigRepo: GitRemoteConfigRepository;

  constructor(devSupervisor?: DevSupervisorClient) {
    this.devSupervisor = devSupervisor || null;
    this.gitUtils = new GitUtils(devSupervisor);
    this.gitRemoteTokenManager = devSupervisor ? new GitRemoteTokenManager(devSupervisor) : null;
    this.gitRemoteConfigRepo = new GitRemoteConfigRepository();
  }

  // Per-repository operation queues to prevent concurrent git operations
  private static operationQueues = new Map<string, Promise<any>>();

  /**
   * Queue a git operation for a specific repository to prevent concurrent operations
   */
  private async queueGitOperation<T>(appPath: string, operation: () => Promise<T>): Promise<T> {
    // Normalize the path to use as key
    const repoKey = appPath.replace(/\\/g, '/');

    // Get or create a promise chain for this repository
    const currentQueue = GitTool.operationQueues.get(repoKey) || Promise.resolve();

    // Chain the new operation after the current queue
    const newQueue = currentQueue
      .catch(() => {
        // Ignore errors from previous operations - they shouldn't affect new ones
      })
      .then(() => operation());

    // Update the queue
    GitTool.operationQueues.set(repoKey, newQueue);

    // Clean up completed operations
    newQueue.finally(() => {
      // Only clean up if this is still the current queue
      if (GitTool.operationQueues.get(repoKey) === newQueue) {
        GitTool.operationQueues.delete(repoKey);
      }
    });

    return newQueue;
  }

  /**
   * Extract app ID from app path
   * App paths are typically in format: /tmp/apps/{appId}/app or {customerDataDir}/{appId}/app
   */
  private extractAppIdFromPath(appPath: string): string | null {
    try {
      // Handle both development and production paths
      // Development: /tmp/apps/{appId}/app
      // Production: /customer-data/{appId}/app or similar
      const pathParts = appPath.split('/').filter(part => part.length > 0);

      // If path ends with '/app', the app ID is the second-to-last part
      // e.g., /tmp/apps/c95338db-9a67-4216-a286-cf202d169ad9/app -> c95338db-9a67-4216-a286-cf202d169ad9
      const lastPart = pathParts[pathParts.length - 1];
      const potentialAppId = lastPart === 'app' && pathParts.length >= 2
        ? pathParts[pathParts.length - 2]
        : lastPart;

      // Basic validation - app IDs are typically UUIDs or similar identifiers
      if (potentialAppId && potentialAppId.length > 5) {
        return potentialAppId;
      }

      return null;
    } catch (error) {
      logger.warn('Failed to extract app ID from path', { appPath, error });
      return null;
    }
  }

  /**
   * Execute a Git operation
   */
  async executeGitOperation(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    // Queue the operation to prevent concurrent git operations on the same repository
    return this.queueGitOperation(appPath, async () => {
      return this.executeGitOperationInternal(appPath, options);
    });
  }

  /**
   * Internal git operation execution (called within the queue)
   */
  private async executeGitOperationInternal(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    const startTime = Date.now();

    // Build logging data once to avoid duplication
    const logData = this.buildLogData(options, appPath);

    // Log operation begin
    toolGitEvents.begin(logger, logData);

    try {
      // Check if we're in a git repository (except for status which can show this)
      if (options.operation !== 'status') {
        const isRepo = await this.gitUtils.isGitRepository(appPath);
        if (!isRepo) {
          return {
            success: false,
            operation: options.operation,
            error: 'Not in a git repository. The repository should be automatically initialized.',
          };
        }
      }

      // Route to appropriate handler
      let result: GitToolResult;
      switch (options.operation) {
        case 'status':
          result = await this.handleStatus(appPath, options);
          break;
        case 'add':
          result = await this.handleAdd(appPath, options);
          break;
        case 'commit':
          result = await this.handleCommit(appPath, options);
          break;
        case 'diff':
          result = await this.handleDiff(appPath, options);
          break;
        case 'log':
          result = await this.handleLog(appPath, options);
          break;
        case 'branch':
          result = await this.handleBranch(appPath, options);
          break;
        case 'checkout':
          result = await this.handleCheckout(appPath, options);
          break;
        case 'merge':
          result = await this.handleMerge(appPath, options);
          break;
        case 'pull':
          result = await this.handlePull(appPath, options);
          break;
        case 'push':
          result = await this.handlePush(appPath, options);
          break;
        case 'stash':
          result = await this.handleStash(appPath, options);
          break;
        case 'reset':
          result = await this.handleReset(appPath, options);
          break;
        case 'revert':
          result = await this.handleRevert(appPath, options);
          break;
        case 'restore':
          result = await this.handleRestore(appPath, options);
          break;
        case 'clean':
          result = await this.handleClean(appPath, options);
          break;
        case 'configure-remote':
          result = await this.handleConfigureRemote(appPath, options);
          break;
        default:
          throw new Error(`Unknown git operation: ${options.operation}`);
      }

      const executionTime = Date.now() - startTime;

      // Log operation success or failure
      if (result.success) {
        toolGitEvents.success(logger, {
          ...logData,
          resultStats: {
            success: result.success,
            filesAffected: options.files?.length || 0,
            ...(result.branches?.length !== undefined && { branchesCount: result.branches.length }),
            ...(result.commits?.length !== undefined && { commitsCount: result.commits.length }),
            executionTime,
          },
        });
      } else {
        // Log operation failure for unsuccessful operations that don't throw
        toolGitEvents.failure(logger, new Error(result.error || 'Git operation failed'), logData);
      }

      return result;
    } catch (error) {
      // Log operation failure
      toolGitEvents.failure(logger, error as Error, logData);

      return {
        success: false,
        operation: options.operation,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git status
   */
  private async handleStatus(appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    try {
      const isRepo = await this.gitUtils.isGitRepository(appPath);
      if (!isRepo) {
        return {
          success: true,
          operation: 'status',
          output: 'Not a git repository',
          status: {
            branch: 'none',
            ahead: 0,
            behind: 0,
            isClean: true,
          },
        };
      }

      const status = await this.gitUtils.getStatus(appPath);

      return {
        success: true,
        operation: 'status',
        status: {
          branch: status.branch,
          ahead: status.ahead,
          behind: status.behind,
          isClean: status.isClean,
          stagedFiles: status.stagedFiles,
          modifiedFiles: status.modifiedFiles,
          untrackedFiles: status.untrackedFiles,
        },
        output: this.formatStatus(status),
      };
    } catch (error) {
      return {
        success: false,
        operation: 'status',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git add
   */
  private async handleAdd(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      const files = options.files || ['.'];
      const result = await this.gitUtils.addFiles(appPath, files);

      const toolResult: GitToolResult = {
        success: result.success,
        operation: 'add',
        output: result.success ? `Added files: ${files.join(', ')}` : result.stderr,
      };

      if (!result.success) {
        toolResult.error = result.stderr;
      }

      return toolResult;
    } catch (error) {
      return {
        success: false,
        operation: 'add',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git commit
   */
  private async handleCommit(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      let message = options.message;

      // Auto-generate commit message if requested
      if (options.autoMessage && !message) {
        message = await this.generateCommitMessage(appPath, options.files);
      }

      if (!message) {
        return {
          success: false,
          operation: 'commit',
          error: 'Commit message is required',
        };
      }

      const result = await this.gitUtils.commit(appPath, message);

      // If commit was successful, check if this marks the initial build completion
      if (result.success) {
        const appId = this.extractAppIdFromPath(appPath);
        if (appId) {
          try {
            // Check if the app exists and if initial build is not yet marked complete
            const appRepository = new AppRepository();
            const app = appRepository.findById(appId);
            if (app && !app.initialBuildComplete) {
              // Check if this might be the first real commit (not just initial setup)
              // Look for commits that aren't just "Initial commit" or template setup
              try {
                const commits = await this.gitUtils.getCommitHistory(appPath, MAX_COMMITS_FOR_INITIAL_BUILD);
                const commitCount = commits.length;
                const isFirstRealCommit = commitCount <= MAX_COMMITS_FOR_INITIAL_BUILD;

                if (isFirstRealCommit) {
                  appRepository.markInitialBuildComplete(appId);
                  logger.info('Initial build marked as complete after first commit', {
                    appId,
                    commitMessage: message,
                    commitCount
                  });
                }
              } catch (gitError) {
                // If we can't get git history, assume it's a first commit
                logger.warn('Could not get git history, assuming first commit', {
                  appId,
                  error: gitError instanceof Error ? gitError.message : String(gitError)
                });
                appRepository.markInitialBuildComplete(appId);
              }
            }
          } catch (error) {
            // Don't fail the commit if we can't update the initial build flag
            logger.warn('Failed to mark initial build complete', {
              appId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      const toolResult: GitToolResult = {
        success: result.success,
        operation: 'commit',
        output: result.success ? `Committed: ${message}` : result.stderr,
      };

      if (!result.success) {
        toolResult.error = result.stderr;
      }

      return toolResult;
    } catch (error) {
      return {
        success: false,
        operation: 'commit',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git diff
   */
  private async handleDiff(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      // Check if dev-supervisor is available
      if (!this.devSupervisor?.isAvailable()) {
        throw new Error(
          'Git diff requires dev-supervisor to be available for command execution. ' +
          'This typically means the system is not running in a containerized environment with dev-supervisor installed, ' +
          'or the dev-supervisor socket is not accessible.'
        );
      }

      // Build git diff command
      const args = ['git', 'diff'];

      if (options.options?.verbose) {
        args.push('--staged');
      }

      if (options.files && options.files.length > 0) {
        args.push(...options.files);
      }

      // Execute using dev-supervisor with properly escaped command
      // Always use /app as the working directory since all deployments are containerized
      const execResult = await this.devSupervisor!.exec({
        command: buildShellCommand(args),
        working_dir: '/app',
        timeout: 30,
        capture_output: true
      });

      const result = {
        success: execResult.success,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      };

      const toolResult: GitToolResult = {
        success: result.success,
        operation: 'diff',
        diff: result.stdout || 'No differences found',
        output: result.stdout || 'No differences found',
      };

      if (!result.success) {
        toolResult.error = result.stderr;
      }

      return toolResult;
    } catch (error) {
      return {
        success: false,
        operation: 'diff',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git log
   */
  private async handleLog(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      const count = options.options?.count || 10;
      // Pass options explicitly to ensure we get all commits
      const commits = await this.gitUtils.getCommitHistory(appPath, count);

      const output = commits
        .map(
          (commit) =>
            `${commit.hash.substring(0, 7)} - ${commit.message} (${commit.author}, ${commit.date.toDateString()})`
        )
        .join('\n');

      return {
        success: true,
        operation: 'log',
        commits: commits.map((commit) => ({
          hash: commit.hash,
          author: commit.author,
          date: commit.date.toISOString(),
          message: commit.message,
        })),
        output,
      };
    } catch (error) {
      return {
        success: false,
        operation: 'log',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git branch
   */
  private async handleBranch(appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    try {
      const branches = await this.gitUtils.listBranches(appPath);
      const currentBranch = await this.gitUtils.getCurrentBranch(appPath);

      return {
        success: true,
        operation: 'branch',
        branches,
        currentBranch,
        output: branches
          .map((branch) => (branch === currentBranch ? `* ${branch}` : `  ${branch}`))
          .join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        operation: 'branch',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git checkout
   */
  private async handleCheckout(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      if (!options.branch) {
        return {
          success: false,
          operation: 'checkout',
          error: 'Branch name is required for checkout',
        };
      }

      let result;
      if (options.options?.createBranch) {
        result = await this.gitUtils.createBranch(appPath, options.branch);
      } else {
        result = await this.gitUtils.switchBranch(appPath, options.branch);
      }

      const toolResult: GitToolResult = {
        success: result.success,
        operation: 'checkout',
        output: result.success ? `Switched to branch: ${options.branch}` : result.stderr,
      };

      if (!result.success) {
        toolResult.error = result.stderr;
      }

      return toolResult;
    } catch (error) {
      return {
        success: false,
        operation: 'checkout',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle configure remote operation
   * Sets up git remote and stores configuration in database
   */
  private async handleConfigureRemote(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      // Extract app ID from path
      const appId = this.extractAppIdFromPath(appPath);
      if (!appId) {
        return {
          success: false,
          operation: 'configure-remote',
          error: 'Could not extract app ID from path'
        };
      }

      // Validate required parameters
      if (!options.repoUrl) {
        return {
          success: false,
          operation: 'configure-remote',
          error: 'Repository URL is required'
        };
      }

      const remoteName = options.remoteName || 'origin';
      const defaultBranch = options.branch || 'main';

      // Detect provider from URL
      let provider: string;
      try {
        const providerInstance = GitProviderFactory.getProvider(options.repoUrl);
        provider = providerInstance.name;
      } catch (error) {
        return {
          success: false,
          operation: 'configure-remote',
          error: `Failed to detect provider: ${getErrorMessage(error)}`
        };
      }

      // Check if remote already exists in git
      const hasRemote = await this.gitUtils.hasRemote(appPath, remoteName);

      if (hasRemote) {
        // Update existing remote URL
        const setUrlResult = await this.gitUtils.setRemoteUrl(appPath, remoteName, options.repoUrl);

        if (!setUrlResult.success) {
          return {
            success: false,
            operation: 'configure-remote',
            error: `Failed to update remote URL: ${setUrlResult.stderr}`
          };
        }
      } else {
        // Add new remote
        const addResult = await this.gitUtils.addRemote(appPath, remoteName, options.repoUrl);

        if (!addResult.success) {
          return {
            success: false,
            operation: 'configure-remote',
            error: `Failed to add remote: ${addResult.stderr}`
          };
        }
      }

      // Store configuration in database
      try {
        this.gitRemoteConfigRepo.upsert({
          appId,
          remoteName,
          provider,
          repoUrl: options.repoUrl,
          defaultBranch,
          syncEnabled: true
        });
      } catch (error) {
        return {
          success: false,
          operation: 'configure-remote',
          error: `Failed to store configuration: ${getErrorMessage(error)}`,
          warning: 'Git remote was added successfully but database storage failed'
        };
      }

      return {
        success: true,
        operation: 'configure-remote',
        output: `Remote '${remoteName}' configured successfully\nProvider: ${provider}\nURL: ${options.repoUrl}\nDefault branch: ${defaultBranch}`
      };
    } catch (error) {
      return {
        success: false,
        operation: 'configure-remote',
        error: `Configure remote operation failed: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Handle other git operations (simplified implementations)
   */
  private async handleMerge(_appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('merge', 'Git merge operations are not yet supported');
  }

  /**
   * Handle pull from remote repository
   * Requires git remote to be configured via configure-remote operation
   */
  private async handlePull(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      // Extract app ID from path
      const appId = this.extractAppIdFromPath(appPath);
      if (!appId) {
        return {
          success: false,
          operation: 'pull',
          error: 'Could not extract app ID from path'
        };
      }

      // Get remote name (default: 'origin')
      const remoteName = options.remoteName || options.remote || 'origin';

      // Get remote config from database
      const remoteConfig = this.gitRemoteConfigRepo.findByAppAndRemote(appId, remoteName);
      if (!remoteConfig) {
        return {
          success: false,
          operation: 'pull',
          error: `Remote '${remoteName}' not configured. Please run configure-remote first.`
        };
      }

      if (!remoteConfig.syncEnabled) {
        return {
          success: false,
          operation: 'pull',
          error: `Remote '${remoteName}' is disabled`
        };
      }

      // Get current branch or use default branch from config
      const branch = options.branch || remoteConfig.defaultBranch;

      // Validate dependencies
      if (!this.gitRemoteTokenManager) {
        return {
          success: false,
          operation: 'pull',
          error: 'Git remote token manager not available. Dev-supervisor is required.'
        };
      }

      try {
        // Configure credentials (inside container)
        await this.gitRemoteTokenManager.configureGitCredentials(appId, remoteConfig.repoUrl);

        // Execute pull with 'theirs' merge strategy to prefer remote changes
        const pullResult = await this.gitUtils.pull(appPath, remoteName, branch, {}, 'theirs');

        if (!pullResult.success) {
          const stderr = (pullResult.stderr || '').toLowerCase();

          // Check for merge conflicts
          if (stderr.includes('conflict') || stderr.includes('merge')) {
            return {
              success: false,
              operation: 'pull',
              error: 'Merge conflicts detected. Manual resolution may be required.',
              warning: 'Run git status to see conflicting files',
              output: pullResult.stdout
            };
          }

          // Check for authentication failures
          if (stderr.includes('authentication failed') || stderr.includes('403') || stderr.includes('401') || stderr.includes('invalid credentials')) {
            return {
              success: false,
              operation: 'pull',
              error: 'GitHub authentication failed. Token may be expired or invalid. Please reconfigure the GitHub token.',
              output: pullResult.stdout
            };
          }

          // Check for network errors
          if (stderr.includes('could not resolve host') || stderr.includes('network') || stderr.includes('connection')) {
            return {
              success: false,
              operation: 'pull',
              error: 'Network error: Unable to connect to remote repository. Please check your network connection.',
              output: pullResult.stdout
            };
          }

          // Generic error
          return {
            success: false,
            operation: 'pull',
            error: `Pull failed: ${pullResult.stderr || pullResult.stdout}`,
            output: pullResult.stdout
          };
        }

        // Update last sync timestamp
        this.gitRemoteConfigRepo.update(remoteConfig.id, {
          lastSyncAt: Date.now()
        });

        return {
          success: true,
          operation: 'pull',
          output: `Successfully pulled from ${remoteName}/${branch}\n${pullResult.stdout}`
        };
      } finally {
        // ALWAYS cleanup credentials
        await this.gitRemoteTokenManager.cleanupGitCredentials(appId);
      }
    } catch (error) {
      return {
        success: false,
        operation: 'pull',
        error: `Pull operation failed: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Handle push to remote repository
   * Requires git remote to be configured via configure-remote operation
   */
  private async handlePush(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      // Extract app ID from path
      const appId = this.extractAppIdFromPath(appPath);
      if (!appId) {
        return {
          success: false,
          operation: 'push',
          error: 'Could not extract app ID from path'
        };
      }

      // Get remote name (default: 'origin')
      const remoteName = options.remoteName || options.remote || 'origin';

      // Get remote config from database
      const remoteConfig = this.gitRemoteConfigRepo.findByAppAndRemote(appId, remoteName);
      if (!remoteConfig) {
        return {
          success: false,
          operation: 'push',
          error: `Remote '${remoteName}' not configured. Please run configure-remote first.`
        };
      }

      if (!remoteConfig.syncEnabled) {
        return {
          success: false,
          operation: 'push',
          error: `Remote '${remoteName}' is disabled`
        };
      }

      // Get current branch or use default branch from config
      const branch = options.branch || await this.gitUtils.getCurrentBranch(appPath);

      // Check force push flag
      const forcePush = options.forcePush || options.options?.force || false;

      // Validate dependencies
      if (!this.gitRemoteTokenManager) {
        return {
          success: false,
          operation: 'push',
          error: 'Git remote token manager not available. Dev-supervisor is required.'
        };
      }

      try {
        // Configure credentials (inside container)
        await this.gitRemoteTokenManager.configureGitCredentials(appId, remoteConfig.repoUrl);

        // Execute push with setUpstream=true to track remote branch
        const pushResult = await this.gitUtils.push(appPath, remoteName, branch, {}, forcePush, true);

        if (!pushResult.success) {
          const stderr = (pushResult.stderr || '').toLowerCase();

          // Check for authentication failures
          if (stderr.includes('authentication failed') || stderr.includes('403') || stderr.includes('401') || stderr.includes('invalid credentials')) {
            return {
              success: false,
              operation: 'push',
              error: 'GitHub authentication failed. Token may be expired or invalid. Please reconfigure the GitHub token.',
              output: pushResult.stdout
            };
          }

          // Check for network errors
          if (stderr.includes('could not resolve host') || stderr.includes('network') || stderr.includes('connection')) {
            return {
              success: false,
              operation: 'push',
              error: 'Network error: Unable to connect to remote repository. Please check your network connection.',
              output: pushResult.stdout
            };
          }

          // Check for non-fast-forward (need to pull first)
          if (stderr.includes('non-fast-forward') || stderr.includes('fetch first') || stderr.includes('rejected')) {
            return {
              success: false,
              operation: 'push',
              error: 'Push rejected: Remote has changes that are not in local. Pull the latest changes first, or use force push.',
              warning: 'Consider running pull before push, or use forcePush option',
              output: pushResult.stdout
            };
          }

          // Check for permission errors
          if (stderr.includes('permission denied') || stderr.includes('403')) {
            return {
              success: false,
              operation: 'push',
              error: 'Permission denied: The token does not have write access to this repository.',
              output: pushResult.stdout
            };
          }

          // Generic error
          return {
            success: false,
            operation: 'push',
            error: `Push failed: ${pushResult.stderr || pushResult.stdout}`,
            output: pushResult.stdout
          };
        }

        // Update last sync timestamp
        this.gitRemoteConfigRepo.update(remoteConfig.id, {
          lastSyncAt: Date.now()
        });

        return {
          success: true,
          operation: 'push',
          output: `Successfully pushed to ${remoteName}/${branch}\n${pushResult.stdout}`
        };
      } finally {
        // ALWAYS cleanup credentials
        await this.gitRemoteTokenManager.cleanupGitCredentials(appId);
      }
    } catch (error) {
      return {
        success: false,
        operation: 'push',
        error: `Push operation failed: ${getErrorMessage(error)}`
      };
    }
  }

  private async handleStash(_appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('stash', 'Git stash operations are not yet supported');
  }

  /**
   * Handle git reset - reset current HEAD to specified state
   * Supports soft, mixed (default), and hard reset modes
   */
  private async handleReset(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      // Default to HEAD if no commit specified
      const target = options.options?.hash || 'HEAD';
      const mode = options.options?.mode || 'mixed';

      // Validate mode
      if (!['soft', 'mixed', 'hard'].includes(mode)) {
        return {
          success: false,
          operation: 'reset',
          error: `Invalid reset mode: ${mode}. Must be 'soft', 'mixed', or 'hard'`,
        };
      }

      // Check if dev-supervisor is available for containerized environments
      if (!this.devSupervisor?.isAvailable()) {
        throw new Error(
          'Git reset requires dev-supervisor to be available for command execution. ' +
          'This typically means the system is not running in a containerized environment with dev-supervisor installed, ' +
          'or the dev-supervisor socket is not accessible.'
        );
      }

      // Build git reset command
      const args = ['git', 'reset', `--${mode}`, target];

      // Execute via dev-supervisor
      // Always use /app as the working directory since all deployments are containerized
      const execResult = await this.devSupervisor!.exec({
        command: buildShellCommand(args),
        working_dir: '/app',
        timeout: 30,
        capture_output: true,
      });

      const toolResult: GitToolResult = {
        success: execResult.success,
        operation: 'reset',
        output: execResult.success
          ? `Successfully reset to ${target} (${mode} mode)`
          : execResult.stderr,
      };

      if (!execResult.success) {
        toolResult.error = execResult.stderr;
      }

      return toolResult;
    } catch (error) {
      return {
        success: false,
        operation: 'reset',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git clean - remove untracked files and directories
   */
  private async handleClean(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      // Check if dev-supervisor is available
      if (!this.devSupervisor?.isAvailable()) {
        throw new Error(
          'Git clean requires dev-supervisor to be available for command execution. ' +
          'This typically means the system is not running in a containerized environment with dev-supervisor installed, ' +
          'or the dev-supervisor socket is not accessible.'
        );
      }

      // Build git clean command
      // -f: force, -d: directories
      const args = ['git', 'clean', '-fd'];

      if (options.dryRun) {
        args.push('-n'); // dry run
      }

      // Execute via dev-supervisor
      // Always use /app as the working directory since all deployments are containerized
      const execResult = await this.devSupervisor!.exec({
        command: buildShellCommand(args),
        working_dir: '/app',
        timeout: 30,
        capture_output: true,
      });

      const toolResult: GitToolResult = {
        success: execResult.success,
        operation: 'clean',
        output: execResult.success
          ? execResult.stdout || 'Successfully removed untracked files'
          : execResult.stderr,
      };

      if (!execResult.success) {
        toolResult.error = execResult.stderr;
      }

      return toolResult;
    } catch (error) {
      return {
        success: false,
        operation: 'clean',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git revert - reverts changes introduced by specified commit
   */
  private async handleRevert(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      let commitHash = options.options?.hash;

      if (!commitHash && options.options?.count) {
        try {
          const count = options.options.count;
          const commits = await this.gitUtils.getCommitHistory(appPath, count);

          if (commits.length > 0) {
            const targetCommit = commits[commits.length - 1];
            if (targetCommit) {
              commitHash = targetCommit.hash;
            } else {
              return {
                success: false,
                operation: 'revert',
                error: 'Could not access target commit',
              };
            }
          } else {
            return {
              success: false,
              operation: 'revert',
              error: 'No commits found in repository',
            };
          }
        } catch (error) {
          return {
            success: false,
            operation: 'revert',
            error: `Failed to get commit history: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (!commitHash) {
        return {
          success: false,
          operation: 'revert',
          error:
            'Commit hash is required for revert operation. Please provide a commit hash through options.hash, or specify the commit number with options.count.',
        };
      }

      // Check if dev-supervisor is available
      if (!this.devSupervisor?.isAvailable()) {
        throw new Error(
          'Git revert requires dev-supervisor to be available for command execution. ' +
          'This typically means the system is not running in a containerized environment with dev-supervisor installed, ' +
          'or the dev-supervisor socket is not accessible.'
        );
      }

      // Create git revert command with appropriate options
      const args = ['git', 'revert', '--no-edit'];
      if (options.options?.force) {
        args.push('--no-gpg-sign');
      }
      args.push(commitHash);

      // Always use /app as the working directory since all deployments are containerized
      const execResult = await this.devSupervisor!.exec({
        command: buildShellCommand(args),
        working_dir: '/app',
        timeout: 30,
        capture_output: true
      });

      const result = {
        success: execResult.success,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      };

      // Get updated status after revert
      const status = result.success ? await this.gitUtils.getStatus(appPath) : null;

      const toolResult: GitToolResult = {
        success: result.success,
        operation: 'revert',
        output: result.success ? `Successfully reverted commit: ${commitHash}` : result.stderr,
      };

      if (status) {
        toolResult.status = {
          branch: status.branch,
          ahead: status.ahead,
          behind: status.behind,
          isClean: status.isClean,
        };
      }

      if (!result.success) {
        toolResult.error = result.stderr;
      }

      return toolResult;
    } catch (error) {
      return {
        success: false,
        operation: 'revert',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle git restore - restore files from a specific commit
   */
  private async handleRestore(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      const commitHash = options.options?.hash;

      if (!commitHash) {
        return {
          success: false,
          operation: 'restore',
          error: 'Commit hash is required for restore operation. Please provide a commit hash through options.hash.',
        };
      }

      // Check if dev-supervisor is available
      if (!this.devSupervisor?.isAvailable()) {
        throw new Error(
          'Git restore requires dev-supervisor to be available for command execution. ' +
          'This typically means the system is not running in a containerized environment with dev-supervisor installed, ' +
          'or the dev-supervisor socket is not accessible.'
        );
      }

      // First, checkout main branch to ensure we're not on a detached HEAD
      // Always use /app as the working directory since all deployments are containerized
      const checkoutResult = await this.devSupervisor!.exec({
        command: 'git checkout main',
        working_dir: '/app',
        timeout: 30,
        capture_output: true
      });

      if (!checkoutResult.success) {
        return {
          success: false,
          operation: 'restore',
          error: `Failed to checkout main branch: ${checkoutResult.stderr}`,
        };
      }

      // Create git restore command with appropriate options
      const args = ['git', 'restore', `--source=${commitHash}`, '--staged', '--worktree', '.'];

      // Execute the git restore command
      // Always use /app as the working directory since all deployments are containerized
      const result = await this.devSupervisor!.exec({
        command: buildShellCommand(args),
        working_dir: '/app',
        timeout: 30,
        capture_output: true
      });

      if (!result.success) {
        return {
          success: false,
          operation: 'restore',
          error: result.stderr || 'Failed to restore files',
        };
      }

      // Auto-commit changes if restore was successful
      const commitMessage = `Restore: Changes from commit ${commitHash.substring(0, 7).toUpperCase()}`;
      const commitResult = await this.handleCommit(appPath, {
        operation: 'commit',
        message: commitMessage
      });

      // Return success with information about both operations
      return {
        success: true,
        operation: 'restore',
        output: `Successfully restored files from commit ${commitHash.substring(0, 7)} and created a new commit.\n\nRestore output: ${result.stdout || 'No output'}\n\nCommit: ${commitResult.output || 'Committed successfully'}`,
      };
    } catch (error) {
      return {
        success: false,
        operation: 'restore',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private handleUnsupportedOperation(operation: string, message: string): GitToolResult {
    return {
      success: false,
      operation,
      error: message,
    };
  }

  /**
   * Generate a commit message based on recent changes
   */
  private async generateCommitMessage(appPath: string, _files?: string[]): Promise<string> {
    try {
      const status = await this.gitUtils.getStatus(appPath);

      if (status.isClean) {
        return 'No changes to commit';
      }

      // Simple commit message generation
      const modifiedCount = status.modifiedFiles;
      const addedCount = status.stagedFiles;
      const totalChanges = modifiedCount + addedCount;

      if (totalChanges === 1) {
        return 'Update file';
      } else if (totalChanges <= 3) {
        return `Update ${totalChanges} files`;
      } else {
        return `Update multiple files (${totalChanges} changes)`;
      }
    } catch {
      return 'Update files';
    }
  }

  /**
   * Format git status for display
   */
  private formatStatus(status: GitUtilsStatus): string {
    const lines: string[] = [];

    lines.push(`On branch ${status.branch}`);

    if (status.ahead > 0) {
      lines.push(`Your branch is ahead of 'origin/${status.branch}' by ${status.ahead} commit(s).`);
    }

    if (status.behind > 0) {
      lines.push(`Your branch is behind 'origin/${status.branch}' by ${status.behind} commit(s).`);
    }

    if (status.isClean) {
      lines.push('Working tree clean');
    } else {
      if (status.stagedFiles > 0) {
        lines.push(`Changes to be committed: ${status.stagedFiles} file(s)`);
      }

      if (status.modifiedFiles > 0) {
        lines.push(`Changes not staged for commit: ${status.modifiedFiles} file(s)`);
      }

      if (status.untrackedFiles > 0) {
        lines.push(`Untracked files: ${status.untrackedFiles} file(s)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Build common logging data to avoid duplication
   */
  private buildLogData(options: GitToolOptions, appPath: string) {
    return {
      toolName: 'git' as const,
      operation: options.operation,
      appPath,
      options: {
        ...(options.files && { files: options.files }),
        ...(options.message && { message: options.message }),
        ...(options.branch && { branch: options.branch }),
        ...(options.options?.all !== undefined && { all: options.options.all }),
        ...(options.options?.amend !== undefined && { amend: options.options.amend }),
        ...(options.options?.force !== undefined && { force: options.options.force }),
        ...(options.options?.count !== undefined && { count: options.options.count }),
        ...(options.options?.createBranch !== undefined && {
          createBranch: options.options.createBranch,
        }),
        ...(options.options?.includeUntracked !== undefined && {
          includeUntracked: options.options.includeUntracked,
        }),
        ...(options.options?.verbose !== undefined && { verbose: options.options.verbose }),
        ...(options.autoMessage !== undefined && { autoMessage: options.autoMessage }),
        ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
      },
    };
  }

  /**
   * Format the git result for display
   */
  formatResult(result: GitToolResult): string {
    // Return JSON for easier parsing in custom renderers
    return JSON.stringify({
      success: result.success,
      operation: result.operation,
      output: result.output,
      status: result.status,
      diff: result.diff,
      commits: result.commits,
      branches: result.branches,
      currentBranch: result.currentBranch,
      error: result.error,
      warning: result.warning
    }, null, 2);
  }
}
