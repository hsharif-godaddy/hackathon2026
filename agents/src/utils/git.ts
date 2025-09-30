import { resolve } from 'path';
import { existsSync } from 'fs';
import { DevSupervisorClient } from '../services/DevSupervisorClient.js';
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
  /** Short commit hash */
  shortHash: string;
  /** Commit message */
  message: string;
  /** Author name */
  author: string;
  /** Author email */
  email: string;
  /** Commit date */
  date: Date;
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
   * Get commit history
   */
  async getCommitHistory(
    repoPath: string,
    limit: number = 10,
    options: GitCommandOptions = {}
  ): Promise<GitCommitInfo[]> {
    // Use simpler git log command to avoid dev-supervisor validation issues
    // Execute the log command with basic options only
    const result = await this.executeGitCommand(
      ['log', '--oneline', `--max-count=${limit}`],
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
        // Parse --oneline format: "<short-hash> <commit-message>"
        const match = line.trim().match(/^([a-f0-9]+)\s+(.+)$/);
        if (match) {
          const [, shortHash, message] = match;
          return {
            hash: shortHash || '', // We only have short hash from --oneline
            shortHash: shortHash || '',
            message: message || '',
            author: 'Unknown', // Not available in --oneline format
            email: '',
            date: new Date(), // Not available in --oneline format
          };
        }
        // Fallback for unexpected format
        return {
          hash: '',
          shortHash: '',
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
