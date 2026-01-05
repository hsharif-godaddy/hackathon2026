import { resolve } from 'path';
import { existsSync } from 'fs';
import { DevSupervisorClient } from '../services/DevSupervisorClient.js';
import { buildShellCommand, escapeShellArg } from './shell-utils.js';

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
   * Archives are created in /publish/dist/{commitHash}.tar.gz
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
   * @param outputDir - Directory to store the archive (default: '/publish/dist'). Will be created if it doesn't exist.
   * @param options - Git command options
   * @returns GitArchiveResult with the archive path and commit hash
   * @throws Error if dev-supervisor is not available or command fails
   */
  async createArchive(
    repoPath: string,
    commitHash: string,
    outputDir: string = '/publish/dist',
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
   * Check if dev-supervisor is available for command execution
   */
  private isDevSupervisorAvailable(): boolean {
    return this.devSupervisor !== null && this.devSupervisor !== undefined && this.devSupervisor.isAvailable();
  }

  /**
   * Execute a git command
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
    } catch (error) {
      result.stderr = error instanceof Error ? error.message : String(error);
      result.executionTime = Date.now() - startTime;
    }

    return result;
  }

}
