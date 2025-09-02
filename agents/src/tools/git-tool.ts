import { GitUtils, GitStatus as GitUtilsStatus } from '../utils/git.js';
import { logger } from '../logging/index.js';
import { toolGitEvents } from '../logging/events/index.js';
import { spawn } from 'child_process';

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
    | 'revert';
  /** Files to operate on (for add, diff, etc.) */
  files?: string[];
  /** Commit message (for commit operation, or to identify commit by message for revert) */
  message?: string;
  /** Branch name (for checkout, merge, etc.) */
  branch?: string;
  /** Operation-specific options */
  options?: {
    /** Include all files (for add, commit) */
    all?: boolean;
    /** Commit hash (for revert operation) */
    shorthash?: string;
    /** Amend last commit (for commit) */
    amend?: boolean;
    /** Force operation (for push, checkout) */
    force?: boolean;
    /** Hard reset (for reset) */
    hard?: boolean;
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
  };
  /** Diff output */
  diff?: string;
  /** Commit history */
  commits?: Array<{
    hash: string;
    shortHash: string;
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
  private gitUtils = new GitUtils();

  /**
   * Execute a Git operation
   */
  async executeGitOperation(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
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
      // Build git diff arguments array to avoid shell injection
      const args = ['diff'];
      
      if (options.options?.verbose) {
        args.push('--staged');
      }
      
      if (options.files && options.files.length > 0) {
        args.push(...options.files);
      }

      // Execute using child_process with direct git command
      const result = await new Promise<{ success: boolean; stdout: string; stderr: string }>(
        (resolve) => {
          let stdout = '';
          let stderr = '';

          const child = spawn('git', args, { cwd: appPath });

          child.stdout?.on('data', (data) => {
            stdout += data.toString();
          });

          child.stderr?.on('data', (data) => {
            stderr += data.toString();
          });

          child.on('close', (code) => {
            resolve({
              success: code === 0,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            });
          });
        }
      );

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
            `${commit.shortHash} - ${commit.message} (${commit.author}, ${commit.date.toDateString()})`
        )
        .join('\n');

      return {
        success: true,
        operation: 'log',
        commits: commits.map((commit) => ({
          hash: commit.hash,
          shortHash: commit.shortHash,
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
   * Handle other git operations (simplified implementations)
   */
  private async handleMerge(_appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('merge', 'Git merge operations are not yet supported');
  }

  private async handlePull(_appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('pull', 'Git pull operations are not yet supported');
  }

  private async handlePush(_appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('push', 'Git push operations are not yet supported');
  }

  private async handleStash(_appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('stash', 'Git stash operations are not yet supported');
  }

  private async handleReset(_appPath: string, _options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation(
      'reset',
      'Git reset operations are not yet supported for safety'
    );
  }

  /**
   * Handle git revert - reverts changes introduced by specified commit
   */
  private async handleRevert(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      let commitHash = options.options?.shorthash;

      if (!commitHash && options.options?.shorthash) {
        commitHash = options.options.shorthash;
      }
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
            'Commit hash or reference is required for revert operation. Please provide a commit hash through options.shorthash or options.options.shorthash, or specify the commit number with options.options.count.',
        };
      }

      // Create git revert command with appropriate options
      const args = ['revert', '--no-edit'];
      if (options.options?.force) {
        args.push('--no-gpg-sign');
      }
      args.push(commitHash);
      const result = await new Promise<{ success: boolean; stdout: string; stderr: string }>(
        (resolve) => {
          let stdout = '';
          let stderr = '';

          const child = spawn('git', args, { cwd: appPath });

          child.stdout?.on('data', (data) => {
            stdout += data.toString();
          });

          child.stderr?.on('data', (data) => {
            stderr += data.toString();
          });

          child.on('close', (code) => {
            resolve({
              success: code === 0,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            });
          });
        }
      );

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
        ...(options.options?.hard !== undefined && { hard: options.options.hard }),
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
    const lines: string[] = [];

    const statusIcon = result.success ? '✅' : '❌';
    lines.push(`${statusIcon} **Git ${result.operation}**`);

    if (result.error) {
      lines.push(`❌ **Error**: ${result.error}`);
    }

    if (result.warning) {
      lines.push(`⚠️ **Warning**: ${result.warning}`);
    }

    if (result.output) {
      lines.push('');
      lines.push('📤 **Output**:');
      lines.push('```');
      lines.push(result.output);
      lines.push('```');
    }

    if (result.diff) {
      lines.push('');
      lines.push('📝 **Diff**:');
      lines.push('```diff');
      lines.push(result.diff);
      lines.push('```');
    }

    if (result.commits && result.commits.length > 0) {
      lines.push('');
      lines.push('📜 **Commit History**:');
      result.commits.forEach((commit) => {
        lines.push(`- ${commit.shortHash} - ${commit.message}`);
        lines.push(`  By: ${commit.author} on ${new Date(commit.date).toLocaleDateString()}`);
      });
    }

    if (result.branches && result.branches.length > 0) {
      lines.push('');
      lines.push('🌳 **Branches**:');
      result.branches.forEach((branch) => {
        const marker = branch === result.currentBranch ? '* ' : '  ';
        lines.push(`${marker}${branch}`);
      });
    }

    return lines.join('\n');
  }
}
