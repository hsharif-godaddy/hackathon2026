import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { DevSupervisorClient } from '../services/DevSupervisorClient.js';
import { logger } from '../logging/index.js';
import { buildShellCommand } from './shell-utils.js';

export interface GitCommandOptions {
  /** Working directory for the git command */
  cwd?: string;
  /** Timeout for the command in milliseconds */
  timeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
}

export interface GitCommandResult {
  /** The git command that was executed */
  command: string;
  /** Working directory where it was executed */
  workingDir: string;
  /** Exit code of the command */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether the command succeeded */
  success: boolean;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Whether the command timed out */
  timedOut: boolean;
}

export interface GitStatus {
  /** Current branch name */
  branch: string;
  /** Whether there are uncommitted changes */
  hasChanges: boolean;
  /** Number of files staged for commit */
  stagedFiles: number;
  /** Number of modified files */
  modifiedFiles: number;
  /** Number of untracked files */
  untrackedFiles: number;
  /** Number of commits ahead of remote */
  ahead: number;
  /** Number of commits behind remote */
  behind: number;
  /** Whether the working directory is clean */
  isClean: boolean;
}

export interface GitCommitInfo {
  /** Commit hash */
  hash: string;
  /** Commit message */
  message: string;
  /** Author name */
  author: string;
  /** Author email */
  email: string;
  /** Commit date */
  date: Date;
}

export interface GitArchiveResult {
  /** Path to the created archive file */
  path: string;
  /** Commit hash that was archived */
  commitHash: string;
}

/**
 * Git Utility Class
 * Provides convenient methods for common Git operations
 */
export class GitUtils {
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private devSupervisor: DevSupervisorClient | null;

  constructor(devSupervisor?: DevSupervisorClient) {
    this.devSupervisor = devSupervisor || null;
  }

  /**
   * Initialize a new Git repository with "main" as the default branch
   */
  async initRepository(repoPath: string, options: GitCommandOptions = {}): Promise<GitCommandResult> {
    return this.executeGitCommand(['init', '--initial-branch=main'], repoPath, options);
  }

  /**
   * Check if a directory is a Git repository
   */
  async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      const result = await this.executeGitCommand(['rev-parse', '--git-dir'], repoPath);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Get the current Git status
   */
  async getStatus(repoPath: string, options: GitCommandOptions = {}): Promise<GitStatus> {
    const [statusResult, branchResult] = await Promise.all([
      this.executeGitCommand(['status', '--porcelain'], repoPath, options),
      this.executeGitCommand(['branch', '--show-current'], repoPath, options),
    ]);

    if (!statusResult.success) {
      throw new Error(`Failed to get git status: ${statusResult.stderr}`);
    }

    const statusLines = statusResult.stdout.split('\n').filter(line => line.trim());
    const branch = branchResult.stdout.trim() || 'HEAD';

    const stagedFiles = statusLines.filter(line => line[0] !== ' ' && line[0] !== '?').length;
    const modifiedFiles = statusLines.filter(line => line[1] === 'M' || line[0] === 'M').length;
    const untrackedFiles = statusLines.filter(line => line.startsWith('??')).length;

    // Get ahead/behind info
    let ahead = 0;
    let behind = 0;
    try {
      // First check if remote tracking branch exists
      const remoteCheckResult = await this.executeGitCommand(
        ['rev-parse', '--verify', '--quiet', `origin/${branch}`],
        repoPath,
        options
      );
      
      // Only attempt comparison if remote branch exists
      if (remoteCheckResult.success) {
        const trackingResult = await this.executeGitCommand(
          ['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`],
          repoPath,
          options
        );
        if (trackingResult.success && trackingResult.stdout.trim()) {
          const [behindStr, aheadStr] = trackingResult.stdout.trim().split('\t');
          ahead = parseInt(aheadStr || '0') || 0;
          behind = parseInt(behindStr || '0') || 0;
        }
      }
    } catch {
      // Remote tracking might not be set up
    }

    return {
      branch,
      hasChanges: statusLines.length > 0,
      stagedFiles,
      modifiedFiles,
      untrackedFiles,
      ahead,
      behind,
      isClean: statusLines.length === 0,
    };
  }

  /**
   * Add files to staging area
   */
  async addFiles(repoPath: string, files: string[] = ['.'], options: GitCommandOptions = {}): Promise<GitCommandResult> {
    return this.executeGitCommand(['add', ...files], repoPath, options);
  }

  /**
   * Commit changes
   */
  async commit(
    repoPath: string,
    message: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['commit', '-m', message], repoPath, options);
  }

  /**
   * Create and commit initial commit with all files
   */
  async createInitialCommit(
    repoPath: string,
    message: string = 'Initial commit',
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    // First add all files
    const addResult = await this.addFiles(repoPath, ['.'], options);
    if (!addResult.success) {
      throw new Error(`Failed to add files: ${addResult.stderr}`);
    }

    // Then commit
    return this.commit(repoPath, message, options);
  }

  /**
   * Get commit history with full hashes
   */
  async getCommitHistory(
    repoPath: string,
    limit: number = 10,
    options: GitCommandOptions = {}
  ): Promise<GitCommitInfo[]> {
    // Use custom format to get full hash and all commit information
    // Format: <full-hash>|<author-name>|<author-email>|<iso-date>|<commit-message>
    const result = await this.executeGitCommand(
      ['log', 'main', `--pretty=format:%H|%an|%ae|%aI|%s`, `--max-count=${limit}`],
      repoPath,
      options
    );

    if (!result.success) {
      throw new Error(`Failed to get commit history: ${result.stderr}`);
    }

    return result.stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        // Parse custom format: "<full-hash>|<author>|<email>|<date>|<message>"
        const parts = line.trim().split('|');
        if (parts.length >= 5) {
          const [hash, author, email, dateStr, ...messageParts] = parts;
          // Join message parts back in case the message contained pipes
          const message = messageParts.join('|');
          return {
            hash: hash || '',
            message: message || '',
            author: author || 'Unknown',
            email: email || '',
            date: dateStr ? new Date(dateStr) : new Date(),
          };
        }
        // Fallback for unexpected format
        return {
          hash: '',
          message: line.trim(),
          author: 'Unknown',
          email: '',
          date: new Date(),
        };
      });
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(repoPath: string, options: GitCommandOptions = {}): Promise<string> {
    const result = await this.executeGitCommand(['branch', '--show-current'], repoPath, options);
    if (!result.success) {
      throw new Error(`Failed to get current branch: ${result.stderr}`);
    }
    return result.stdout.trim() || 'HEAD';
  }

  /**
   * Create a new branch
   */
  async createBranch(
    repoPath: string,
    branchName: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['checkout', '-b', branchName], repoPath, options);
  }

  /**
   * Switch to a branch
   */
  async switchBranch(
    repoPath: string,
    branchName: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['checkout', branchName], repoPath, options);
  }

  /**
   * Delete a branch
   * Uses -D flag to force delete (even if not fully merged, since we've already squash merged)
   * 
   * @throws {Error} If attempting to delete main or master branch
   */
  async deleteBranch(
    repoPath: string,
    branchName: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    if (branchName === 'main') {
      return {
        command: `git branch -D ${branchName}`,
        workingDir: repoPath,
        success: false,
        stdout: '',
        stderr: `Cannot delete protected branch '${branchName}'.`,
        exitCode: 1,
        executionTime: 0,
        timedOut: false
      };
    }
    return this.executeGitCommand(['branch', '-D', branchName], repoPath, options);
  }

  /**
   * Run git garbage collection to optimize repository
   * Uses --auto flag for automatic optimization decisions
   */
  async garbageCollect(
    repoPath: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['gc', '--auto'], repoPath, options);
  }

  /**
   * Get branches sorted by commit date (oldest first)
   * Returns branch names excluding main and master
   */
  async getBranchesSortedByDate(
    repoPath: string,
    options: GitCommandOptions = {}
  ): Promise<string[]> {
    // Get branches with commit date, sorted by date (oldest first)
    // Using git for-each-ref is more efficient than calling listBranches + sorting
    const result = await this.executeGitCommand(
      ['for-each-ref', '--sort=committerdate', '--format=%(refname:short)', 'refs/heads/'],
      repoPath,
      options
    );

    if (!result.success) {
      throw new Error(`Failed to list branches by date: ${result.stderr}`);
    }

    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(branch => branch && branch !== 'main');
  }

  /**
   * Check branch count and clean up old branches if needed
   * If branch count > 50, deletes oldest 25 branches (excluding main)
   * 
   * @returns Object with cleanup stats
   */
  async cleanupOldBranches(
    repoPath: string,
    options: GitCommandOptions = {}
  ): Promise<{ needed: boolean; deleted: number; failed: string[]; gcPerformed: boolean }> {
    try {
      // Get all branches sorted by date
      const branches = await this.getBranchesSortedByDate(repoPath, options);
      
      // Check if cleanup is needed
      if (branches.length <= 50) {
        return { needed: false, deleted: 0, failed: [], gcPerformed: false };
      }

      // Delete oldest 25 branches
      const branchesToDelete = branches.slice(0, 25);
      const failed: string[] = [];
      let deleted = 0;

      for (const branchName of branchesToDelete) {
        try {
          const result = await this.deleteBranch(repoPath, branchName, options);
          if (result.success) {
            deleted++;
          } else {
            failed.push(branchName);
          }
        } catch (error) {
          failed.push(branchName);
        }
      }

      // Run garbage collection after deleting branches
      let gcPerformed = false;
      if (deleted > 0) {
        try {
          const gcResult = await this.garbageCollect(repoPath, options);
          gcPerformed = gcResult.success;
        } catch (gcError) {
          // Log but don't fail - GC is optional optimization
        }
      }

      return {
        needed: true,
        deleted,
        failed,
        gcPerformed
      };
    } catch (error) {
      throw new Error(`Failed to cleanup old branches: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List all branches
   */
  async listBranches(repoPath: string, options: GitCommandOptions = {}): Promise<string[]> {
    const result = await this.executeGitCommand(['branch'], repoPath, options);
    if (!result.success) {
      throw new Error(`Failed to list branches: ${result.stderr}`);
    }

    return result.stdout
      .split('\n')
      .map(line => line.replace(/^\*?\s*/, '').trim())
      .filter(line => line);
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(repoPath: string, options: GitCommandOptions = {}): Promise<boolean> {
    const status = await this.getStatus(repoPath, options);
    return status.hasChanges;
  }

  /**
   * Get the last commit info
   */
  async getLastCommit(repoPath: string, options: GitCommandOptions = {}): Promise<GitCommitInfo | null> {
    try {
      const commits = await this.getCommitHistory(repoPath, 1, options);
      return commits[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Get the currently checked out commit hash
   * Returns the full SHA-1 hash (40 characters) of HEAD
   */
  async getCurrentCommit(repoPath: string, options: GitCommandOptions = {}): Promise<string> {
    const result = await this.executeGitCommand(['rev-parse', 'HEAD'], repoPath, options);
    if (!result.success) {
      throw new Error(`Failed to get current commit: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  /**
   * Configure Git user information for the repository
   */
  async configureUser(
    repoPath: string,
    name: string,
    email: string,
    options: GitCommandOptions = {}
  ): Promise<void> {
    const nameResult = await this.executeGitCommand(['config', 'user.name', name], repoPath, options);
    const emailResult = await this.executeGitCommand(['config', 'user.email', email], repoPath, options);

    if (!nameResult.success) {
      throw new Error(`Failed to set git user name: ${nameResult.stderr}`);
    }
    if (!emailResult.success) {
      throw new Error(`Failed to set git user email: ${emailResult.stderr}`);
    }
  }

 /**
   * Resolve a commit reference (short hash, tag, branch) to its full SHA
   *
   * @param repoPath - Path to the git repository
   * @param commitRef - The commit reference to resolve (short hash, tag, branch, etc.)
   * @param options - Git command options
   * @returns The full SHA-1 hash (40 characters)
   * @throws Error if the commit reference cannot be resolved
   */
  async resolveCommitHash(
    repoPath: string,
    commitRef: string,
    options: GitCommandOptions = {}
  ): Promise<string> {
    const result = await this.executeGitCommand(
      ['rev-parse', commitRef],
      repoPath,
      options
    );

    if (!result.success) {
      throw new Error(
        `Failed to resolve commit reference '${commitRef}': ${result.stderr || 'Unknown error'}`
      );
    }

    const fullHash = result.stdout.trim();

    // Validate that we got a valid SHA (40 hex characters)
    if (!/^[0-9a-f]{40}$/i.test(fullHash)) {
      throw new Error(
        `Invalid commit hash returned: ${fullHash}`
      );
    }

    return fullHash;
  }

  /**
   * Create a git archive tarball of the repository at a specific commit
   * Archives are created in {DIST_DIR}/{commitHash}.tar.gz
   * The output directory will be created if it doesn't exist.
   *
   * This method uses a multi-stage process to include both Git-tracked files
   * and build artifacts (dist/ folder) in the final archive:
   * 1. Extract Git-tracked files to temporary directory
   * 2. Copy dist/ folder (if exists) into temporary directory
   * 3. Create final tar.gz from complete directory
   * 4. Clean up temporary directory
   *
   * @param repoPath - Path to the git repository
   * @param commitHash - The commit hash to archive (short or full)
   * @param outputDir - Directory to store the archive (default: DIST_DIR env var or '/publish/dist'). Will be created if it doesn't exist.
   * @param options - Git command options
   * @returns GitArchiveResult with the archive path and commit hash
   * @throws Error if dev-supervisor is not available or command fails
   */
  async createArchive(
    repoPath: string,
    commitHash: string,
    outputDir: string = process.env.DIST_DIR || '/publish/dist',
    options: GitCommandOptions = {}
  ): Promise<GitArchiveResult> {
    const timeout = options.timeout || 60000; // 60 seconds for large repos

    if (!this.isDevSupervisorAvailable()) {
      throw new Error(
        'Git archive requires dev-supervisor to be available for command execution.'
      );
    }

    // Validate commit hash format to prevent path traversal vulnerabilities
    // Git hashes are hexadecimal strings between 7 (short hash) and 40 (full SHA-1) characters
    if (!/^[a-f0-9]{7,40}$/i.test(commitHash)) {
      throw new Error(
        `Invalid commit hash format: "${commitHash}". Expected hexadecimal string between 7 and 40 characters.`
      );
    }

    // Create archive filename and path
    const archiveFilename = `${commitHash}.tar.gz`;
    const archivePath = `${outputDir}/${archiveFilename}`;
    const tempDir = `.publish/archive-${commitHash}`;

    // Multi-stage archive creation using sequential commands
    // Dev-supervisor doesn't allow complex shell features (&&, |, if), so we execute each step separately

    // Stage 1: Create temp directory
    const mkdirResult = await this.devSupervisor!.exec({
      command: buildShellCommand(['mkdir', '-p', tempDir]),
      working_dir: '/app',
      timeout: 10,
      capture_output: true
    });
    if (!mkdirResult.success) {
      throw new Error(`Failed to create temp directory: ${mkdirResult.stderr || 'Unknown error'}`);
    }

    // Stage 2: Extract git-tracked files to temp directory
    const extractResult = await this.devSupervisor!.exec({
      command: buildShellCommand(['git', 'archive', commitHash, '-o', `${tempDir}/archive.tar`]),
      working_dir: '/app',
      timeout: 30,
      capture_output: true
    });
    if (!extractResult.success) {
      throw new Error(`Failed to create git archive: ${extractResult.stderr || 'Unknown error'}`);
    }

    // Stage 3: Extract the tar in temp directory
    const untarResult = await this.devSupervisor!.exec({
      command: buildShellCommand(['tar', '-xf', `${tempDir}/archive.tar`, '-C', tempDir]),
      working_dir: '/app',
      timeout: 30,
      capture_output: true
    });
    if (!untarResult.success) {
      throw new Error(`Failed to extract archive: ${untarResult.stderr || 'Unknown error'}`);
    }

    // Stage 4: Remove intermediate tar file
    await this.devSupervisor!.exec({
      command: buildShellCommand(['rm', `${tempDir}/archive.tar`]),
      working_dir: '/app',
      timeout: 10,
      capture_output: true
    });

    // Stage 5: Copy dist/ folder if it exists (best effort, ignore failures)
    await this.devSupervisor!.exec({
      command: buildShellCommand(['cp', '-r', 'dist', `${tempDir}/dist`]),
      working_dir: '/app',
      timeout: 30,
      capture_output: true
    });
    // Don't check success - dist/ might not exist, which is OK

    // Stage 6: Create output directory
    const mkdirOutResult = await this.devSupervisor!.exec({
      command: buildShellCommand(['mkdir', '-p', outputDir]),
      working_dir: '/app',
      timeout: 10,
      capture_output: true
    });
    if (!mkdirOutResult.success) {
      throw new Error(`Failed to create output directory: ${mkdirOutResult.stderr || 'Unknown error'}`);
    }

    // Stage 7: Create final tar.gz
    const tarResult = await this.devSupervisor!.exec({
      command: buildShellCommand(['tar', '-czf', archivePath, '-C', tempDir, '.']),
      working_dir: '/app',
      timeout: Math.floor(timeout / 1000),
      capture_output: true
    });
    if (!tarResult.success) {
      throw new Error(`Failed to create final archive: ${tarResult.stderr || 'Unknown error'}`);
    }

    // Stage 8: Clean up temp directory
    await this.devSupervisor!.exec({
      command: buildShellCommand(['rm', '-rf', tempDir]),
      working_dir: '/app',
      timeout: 10,
      capture_output: true
    });
    // Don't check success - cleanup is best effort

    return {
      path: archivePath,
      commitHash: commitHash
    };
  }

  /**
   * Perform a squash merge from a branch into the current branch
   *
   * @param repoPath - Path to the git repository
   * @param branchName - Name of the branch to squash merge
   * @param commitMessage - Commit message for the squash merge
   * @param options - Git command options
   * @returns GitCommandResult from the commit operation
   * @throws Error if merge or commit fails
   */
  async squashMerge(
    repoPath: string,
    branchName: string,
    commitMessage: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    // Execute squash merge
    const mergeResult = await this.executeGitCommand(
      ['merge', '--squash', branchName],
      repoPath,
      options
    );

    if (!mergeResult.success) {
      throw new Error(`Failed to squash merge branch '${branchName}': ${mergeResult.stderr}`);
    }

    // Commit the squashed changes
    const commitResult = await this.commit(repoPath, commitMessage, options);

    if (!commitResult.success) {
      throw new Error(`Failed to commit squash merge: ${commitResult.stderr}`);
    }

    return commitResult;
  }

  /**
   * Get diff between current branch and target branch
   *
   * @param repoPath - Path to the git repository
   * @param targetBranch - Branch to compare against (e.g., 'main')
   * @param options - Git command options
   * @returns Diff output as string
   * @throws Error if diff command fails
   */
  async getDiffFromBranch(
    repoPath: string,
    targetBranch: string,
    options: GitCommandOptions = {}
  ): Promise<string> {
    const result = await this.executeGitCommand(
      ['diff', targetBranch],
      repoPath,
      options
    );

    if (!result.success) {
      throw new Error(`Failed to get diff from branch '${targetBranch}': ${result.stderr}`);
    }

    return result.stdout;
  }

  /**
   * Check if dev-supervisor is available for command execution
   */
  private isDevSupervisorAvailable(): boolean {
    return this.devSupervisor !== null && this.devSupervisor !== undefined && this.devSupervisor.isAvailable();
  }

  /**
   * Attempt to recover from a git command failure
   * Implements the error recovery workflow from git-operations-architecture.md
   *
   * @param error - The error that occurred
   * @param repoPath - Path to the repository
   * @param command - The git command that failed
   * @returns Object indicating if recovery was attempted and if retry should happen
   */
  private async attemptGitRecovery(
    error: string,
    repoPath: string,
    command: string
  ): Promise<{ recovered: boolean; shouldRetry: boolean; escalate: boolean }> {
    const errorLower = error.toLowerCase();

    logger.info('git.util.recovery.begin', {
      repoPath,
      command,
      error: error.substring(0, 200)
    });

    // Check for lock file error
    if (errorLower.includes('index.lock') || errorLower.includes('.lock')) {
      logger.info('git.util.recovery.lock.detected', { repoPath });

      try {
        // Wait 2 seconds to allow any in-progress git operation to complete
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (this.isDevSupervisorAvailable()) {
          // Check if lock file still exists after wait
          const checkLockResult = await this.devSupervisor!.exec({
            command: buildShellCommand(['test', '-f', '.git/index.lock']),
            working_dir: '/app',
            timeout: 5,
            capture_output: true
          });

          if (checkLockResult.success) {
            // Lock file still exists, remove it
            logger.info('git.util.recovery.lock.removing', { repoPath });
            
            const lockRemovalResult = await this.devSupervisor!.exec({
              command: buildShellCommand(['rm', '-f', '.git/index.lock']),
              working_dir: '/app',
              timeout: 10,
              capture_output: true
            });

            if (lockRemovalResult.success) {
              logger.info('git.util.recovery.lock.removed', { repoPath });
              return { recovered: true, shouldRetry: true, escalate: false };
            } else {
              logger.warn('git.util.recovery.lock.removal_failed', {
                repoPath,
                stderr: lockRemovalResult.stderr
              });
            }
          } else {
            // Lock file was auto-removed during wait, can retry
            logger.info('git.util.recovery.lock.auto_removed', { repoPath });
            return { recovered: true, shouldRetry: true, escalate: false };
          }
        }
      } catch (lockError) {
        logger.warn('git.util.recovery.lock.error', {
          repoPath,
          error: lockError instanceof Error ? lockError.message : String(lockError)
        });
      }
    }

    // Check for configuration error
    if (errorLower.includes('user.name') || errorLower.includes('user.email') || 
        errorLower.includes('config') || errorLower.includes('author identity')) {
      logger.info('git.util.recovery.config.detected', { repoPath });

      try {
        // Set default git configuration
        await this.configureUser(repoPath, 'Airo Agent', 'agent@airo.platform');
        logger.info('git.util.recovery.config.set', { repoPath });
        return { recovered: true, shouldRetry: true, escalate: false };
      } catch (configError) {
        logger.warn('git.util.recovery.config.failed', {
          repoPath,
          error: configError instanceof Error ? configError.message : String(configError)
        });
      }
    }

    // Check for repository corruption
    if (errorLower.includes('corrupt') || errorLower.includes('broken') || 
        errorLower.includes('damaged') || errorLower.includes('invalid object')) {
      logger.warn('git.util.recovery.corruption.detected', { repoPath });

      try {
        if (this.isDevSupervisorAvailable()) {
          // Run git fsck to check and repair
          logger.info('git.util.recovery.corruption.fsck_running', { repoPath });
          
          const fsckResult = await this.devSupervisor!.exec({
            command: buildShellCommand(['git', 'fsck', '--full']),
            working_dir: '/app',
            timeout: 60,
            capture_output: true
          });

          if (fsckResult.success) {
            logger.info('git.util.recovery.corruption.fsck_success', { repoPath });
            return { recovered: true, shouldRetry: true, escalate: false };
          } else {
            logger.error('git.util.recovery.corruption.fsck_failed', {
              repoPath,
              stderr: fsckResult.stderr
            });
          }
        }

        // If fsck fails, escalate for backup restoration
        logger.error('git.util.recovery.corruption.escalate', { repoPath });
        return { recovered: false, shouldRetry: false, escalate: true };
      } catch (corruptError) {
        logger.error('git.util.recovery.corruption.error', {
          repoPath,
          error: corruptError instanceof Error ? corruptError.message : String(corruptError)
        });
        return { recovered: false, shouldRetry: false, escalate: true };
      }
    }

    // Check for missing .git directory
    if (errorLower.includes('not a git repository') || errorLower.includes('no such file or directory')) {
      const gitDirPath = resolve(repoPath, '.git');
      if (!existsSync(gitDirPath)) {
        // Critical error - missing .git directory requires escalation
        logger.error('git.util.recovery.missing_git_dir.escalate', {
          repoPath,
          gitDirPath
        });
        return { recovered: false, shouldRetry: false, escalate: true };
      }
    }

    // Unknown error - no recovery attempted
    logger.warn('git.util.recovery.unknown_error', {
      repoPath,
      error: error.substring(0, 200)
    });
    return { recovered: false, shouldRetry: false, escalate: false };
  }

  /**
   * Execute a git command with automatic error recovery
   */
  private async executeGitCommand(
    args: string[],
    cwd: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    const startTime = Date.now();
    const {
      timeout = this.DEFAULT_TIMEOUT,
    } = options;

    // Validate that the directory exists
    const workingDir = resolve(cwd);
    if (!existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }

    const command = buildShellCommand(['git', ...args]);

    const result: GitCommandResult = {
      command,
      workingDir,
      exitCode: -1,
      stdout: '',
      stderr: '',
      success: false,
      executionTime: 0,
      timedOut: false,
    };

    try {
      if (!this.isDevSupervisorAvailable()) {
        throw new Error(
          'Git operations require dev-supervisor to be available for command execution. ' +
          'All deployments are containerized and must have dev-supervisor installed.'
        );
      }

      // Use dev-supervisor for command execution
      // Always use /app as the working directory since all deployments are containerized
      const execResult = await this.devSupervisor!.exec({
        command,
        working_dir: '/app',
        timeout: Math.floor(timeout / 1000),
        capture_output: true
      });

      result.exitCode = execResult.exit_code;
      result.stdout = execResult.stdout;
      result.stderr = execResult.stderr;
      result.timedOut = false; // dev-supervisor handles timeout internally
      result.executionTime = Date.now() - startTime;
      result.success = execResult.success;

      // If command failed, attempt recovery
      if (!result.success && result.stderr) {
        const recovery = await this.attemptGitRecovery(result.stderr, workingDir, command);

        if (recovery.escalate) {
          logger.error('git.util.execute.escalate', {
            command,
            workingDir,
            error: result.stderr
          });
          throw new Error(
            `Critical git error requiring escalation: ${result.stderr}\n` +
            'This issue requires manual intervention. Please contact support.'
          );
        }

        if (recovery.shouldRetry) {
          // Retry the command after recovery
          logger.info('git.util.execute.retry', {
            command,
            workingDir,
            recovered: recovery.recovered
          });

          const retryResult = await this.devSupervisor!.exec({
            command,
            working_dir: '/app',
            timeout: Math.floor(timeout / 1000),
            capture_output: true
          });

          result.exitCode = retryResult.exit_code;
          result.stdout = retryResult.stdout;
          result.stderr = retryResult.stderr;
          result.success = retryResult.success;
          result.executionTime = Date.now() - startTime;

          if (retryResult.success) {
            logger.info('git.util.execute.retry_success', {
              command,
              workingDir
            });
          } else {
            logger.warn('git.util.execute.retry_failed', {
              command,
              workingDir,
              error: retryResult.stderr
            });
          }
        }
      }
    } catch (error) {
      result.stderr = error instanceof Error ? error.message : String(error);
      result.executionTime = Date.now() - startTime;
    }

    return result;
  }

}
