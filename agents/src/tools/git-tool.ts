import { GitUtils, GitStatus as GitUtilsStatus, GitCommitInfo } from '../utils/git.js';

export interface GitToolOptions {
  /** The git operation to perform */
  operation: 'status' | 'add' | 'commit' | 'diff' | 'log' | 'branch' | 'checkout' | 'merge' | 'pull' | 'push' | 'stash' | 'reset' | 'revert';
  /** Files to operate on (for add, diff, etc.) */
  files?: string[];
  /** Commit message (for commit operation) */
  message?: string;
  /** Branch name (for checkout, merge, etc.) */
  branch?: string;
  /** Operation-specific options */
  options?: {
    /** Include all files (for add, commit) */
    all?: boolean;
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
    modified: string[];
    added: string[];
    deleted: string[];
    untracked: string[];
    staged: string[];
    branch: string;
    ahead: number;
    behind: number;
    isClean: boolean;
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
      switch (options.operation) {
        case 'status':
          return await this.handleStatus(appPath, options);
        case 'add':
          return await this.handleAdd(appPath, options);
        case 'commit':
          return await this.handleCommit(appPath, options);
        case 'diff':
          return await this.handleDiff(appPath, options);
        case 'log':
          return await this.handleLog(appPath, options);
        case 'branch':
          return await this.handleBranch(appPath, options);
        case 'checkout':
          return await this.handleCheckout(appPath, options);
        case 'merge':
          return await this.handleMerge(appPath, options);
        case 'pull':
          return await this.handlePull(appPath, options);
        case 'push':
          return await this.handlePush(appPath, options);
        case 'stash':
          return await this.handleStash(appPath, options);
        case 'reset':
          return await this.handleReset(appPath, options);
        case 'revert':
          return await this.handleRevert(appPath, options);
        default:
          throw new Error(`Unknown git operation: ${options.operation}`);
      }
    } catch (error) {
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
  private async handleStatus(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      const isRepo = await this.gitUtils.isGitRepository(appPath);
      if (!isRepo) {
        return {
          success: true,
          operation: 'status',
          output: 'Not a git repository',
          status: {
            modified: [],
            added: [],
            deleted: [],
            untracked: [],
            staged: [],
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
          modified: [], // Will be populated by parsing status
          added: [],
          deleted: [],
          untracked: [],
          staged: [],
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
      // Create git diff command
      let command = 'git diff';
      if (options.files && options.files.length > 0) {
        command += ` ${options.files.join(' ')}`;
      }
      if (options.options?.verbose) {
        command += ' --staged';
      }
      
      // Execute using child_process
      const { spawn } = await import('child_process');
      const result = await new Promise<{success: boolean; stdout: string; stderr: string}>((resolve) => {
        let stdout = '';
        let stderr = '';
        
        const child = spawn('sh', ['-c', command], { cwd: appPath });
        
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
      });
      
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
      
      const output = commits.map(commit => 
        `${commit.shortHash} - ${commit.message} (${commit.author}, ${commit.date.toDateString()})`
      ).join('\n');
      
      return {
        success: true,
        operation: 'log',
        commits: commits.map(commit => ({
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
  private async handleBranch(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    try {
      const branches = await this.gitUtils.listBranches(appPath);
      const currentBranch = await this.gitUtils.getCurrentBranch(appPath);
      
      return {
        success: true,
        operation: 'branch',
        branches,
        currentBranch,
        output: branches.map(branch => 
          branch === currentBranch ? `* ${branch}` : `  ${branch}`
        ).join('\n'),
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
  private async handleMerge(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('merge', 'Git merge operations are not yet supported');
  }

  private async handlePull(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('pull', 'Git pull operations are not yet supported');
  }

  private async handlePush(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('push', 'Git push operations are not yet supported');
  }

  private async handleStash(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('stash', 'Git stash operations are not yet supported');
  }

  private async handleReset(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('reset', 'Git reset operations are not yet supported for safety');
  }

  private async handleRevert(appPath: string, options: GitToolOptions): Promise<GitToolResult> {
    return this.handleUnsupportedOperation('revert', 'Git revert operations are not yet supported');
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
  private async generateCommitMessage(appPath: string, files?: string[]): Promise<string> {
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
      result.commits.forEach(commit => {
        lines.push(`- ${commit.shortHash} - ${commit.message}`);
        lines.push(`  By: ${commit.author} on ${new Date(commit.date).toLocaleDateString()}`);
      });
    }
    
    if (result.branches && result.branches.length > 0) {
      lines.push('');
      lines.push('🌳 **Branches**:');
      result.branches.forEach(branch => {
        const marker = branch === result.currentBranch ? '* ' : '  ';
        lines.push(`${marker}${branch}`);
      });
    }
    
    return lines.join('\n');
  }
}
