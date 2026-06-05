import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { WorkspaceTasks } from '../workspace/tasks.js';
import { logger } from '../logging/index.js';
import { buildShellCommand } from './shell-utils.js';

export interface GitCommandOptions {
  /** Working directory for the git command */
  cwd?: string;
  /** Timeout for the command in milliseconds */
  timeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
  /** Git add: Continue even if some files fail (--ignore-errors) */
  ignoreErrors?: boolean;
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

export interface ArchiveOptions extends GitCommandOptions {
  /**
   * Controls archive content strategy:
   * - `undefined` (default): Auto-detects based on dist/server.bundle.mjs presence
   * - `true`: Force full source (for apps without bundled server)
   * - `false`: Force dist-only (for apps with bundled server)
   *
   * Full source archive excludes: node_modules/, .git/, .env* files
   */
  includeSource?: boolean;
  /** Exclude git-untracked files from full source archives (default: false) */
  excludeUntracked?: boolean;
  /**
   * Include node_modules in full source archive (PaaS optimization).
   * When true, node_modules is NOT excluded from the archive, allowing
   * the publish container to skip npm install entirely.
   * Default: false (exclude node_modules)
   */
  includeNodeModules?: boolean;
}

/**
 * Git Utility Class
 * Provides convenient methods for common Git operations
 */
export class GitUtils {
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly tasks: WorkspaceTasks | null;

  constructor(tasks?: WorkspaceTasks) {
    this.tasks = tasks || null;
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
    const args = ['add'];
    if (options.ignoreErrors) {
      args.push('--ignore-errors');
    }
    args.push(...files);
    return this.executeGitCommand(args, repoPath, {
      ...options,
      timeout: options.timeout || 60000  // 1 minutes for large repos
    });
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
   * Amend the current HEAD commit message
   */
  async amendCommitMessage(
    repoPath: string,
    message: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['commit', '--amend', '-m', message], repoPath, options);
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
    offset: number = 0,
    options: GitCommandOptions = {}
  ): Promise<GitCommitInfo[]> {
    // Use custom format to get full hash and all commit information
    // Format: <full-hash>|<author-name>|<author-email>|<iso-date>|<commit-message>
    const skipFlag = offset > 0 ? `--skip=${offset}` : '';
    const gitArgs = ['log', 'main', `--pretty=format:%H|%an|%ae|%aI|%s`, `--max-count=${limit}`, skipFlag].filter(Boolean);
    const result = await this.executeGitCommand(
      gitArgs,
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
   * Restore the index and working tree to the contents of a specific commit.
   * Runs `git restore --source=<hash> --staged --worktree .` — does not rewrite
   * history or move the branch pointer. Goes through executeGitCommand so
   * concurrent `.git/index.lock` contention is handled by attemptGitRecovery.
   */
  async restoreFromCommit(
    repoPath: string,
    commitHash: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(
      ['restore', `--source=${commitHash}`, '--staged', '--worktree', '.'],
      repoPath,
      options
    );
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
          logger.warn('git.branch.cleanup.gc_failed', {
            error: gcError instanceof Error ? gcError.message : String(gcError),
          });
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
   * Stash uncommitted working-tree changes (including untracked files).
   *
   * Used by the chat undo button when the user bails on an in-flight or
   * stopped agent turn — preferred over a hard discard because the stash
   * is a recoverable git commit. The returned `stashHash` and `diff` are
   * stamped onto the synthetic 'undo' user-action notice so the transcript
   * can render what was rolled back.
   *
   * Returns `hasChanges: false` and no stash when the working tree is
   * already clean — the call is a no-op in that case, never an error.
   */
  async stashUncommittedChanges(
    repoPath: string,
    options: GitCommandOptions & { message?: string; } = {}
  ): Promise<{
    hasChanges: boolean;
    stashHash: string | null;
  }> {
    const { message, ...commandOptions } = options;

    const stashArgs = ['stash', 'push', '--include-untracked'];
    if (message) {
      stashArgs.push('-m', message);
    }
    const stashResult = await this.executeGitCommand(stashArgs, repoPath, commandOptions);
    if (!stashResult.success) {
      throw new Error(`Failed to stash uncommitted changes: ${stashResult.stderr}`);
    }

    // `git stash push` on a clean tree prints "No local changes to save" and
    // exits 0 — we treat that as a success no-op rather than an error.
    if (/no local changes to save/i.test(stashResult.stdout) || /no local changes to save/i.test(stashResult.stderr)) {
      return { hasChanges: false, stashHash: null };
    }

    const hashResult = await this.executeGitCommand(['rev-parse', 'stash@{0}'], repoPath, commandOptions);
    if (!hashResult.success) {
      // The stash apparently happened, but we can't resolve its hash. Surface
      // this so the caller can fall back without claiming a bogus reference.
      throw new Error(`Stashed changes but could not resolve stash hash: ${hashResult.stderr}`);
    }
    const stashHash = hashResult.stdout.trim();

    return { hasChanges: true, stashHash };
  }

  /**
   * Compute a unified diff between two commit refs and return the captured
   * text along with a truncation marker if the diff exceeds `diffMaxBytes`.
   *
   * Used by the restore route to record what changed when the user rolled
   * back to a previous commit, so the synthetic 'restore' notice can render
   * the diff just like undo does for stashes.
   *
   * Both refs must be resolvable; `null` is returned when the diff command
   * itself fails (e.g. invalid ref) so the caller can fall back to omitting
   * the diff rather than aborting the surrounding operation.
   */
  async getCommitDiff(
    repoPath: string,
    fromRef: string,
    toRef: string,
    options: GitCommandOptions & { diffMaxBytes?: number } = {}
  ): Promise<{ diff: string | null; diffTruncated: boolean }> {
    const { diffMaxBytes = 50_000, ...commandOptions } = options;

    // -M enables rename detection so renames render as renames instead of
    // delete + add pairs. The double-dot range form (`from..to`) is the
    // standard way to ask for the diff *between* two snapshots.
    const diffResult = await this.executeGitCommand(
      ['--no-pager', 'diff', '-R', '-M', `${fromRef}..${toRef}`],
      repoPath,
      commandOptions,
    );

    if (!diffResult.success) {
      return { diff: null, diffTruncated: false };
    }

    const raw = diffResult.stdout;
    if (Buffer.byteLength(raw, 'utf8') > diffMaxBytes) {
      return { diff: raw.slice(0, diffMaxBytes) + '\n\n... (diff truncated)', diffTruncated: true };
    }
    return { diff: raw, diffTruncated: false };
  }

  /**
   * Compute the diff captured in a stash. Wraps `git stash show -u -p <ref>`,
   * which emits a unified diff against the stash's first parent (the HEAD at
   * stash time) and includes untracked files when the stash was created with
   * `--include-untracked` (the `-u` flag is git 2.32+).
   *
   * Used by the user-action diff route to render what was rolled back when a
   * mid-stream / dirty-tree undo stashed in-flight changes. Returns
   * `{ diff: null }` instead of throwing when the ref can't be resolved, so
   * the surrounding endpoint can degrade gracefully without 500ing.
   */
  async getStashDiff(
    repoPath: string,
    stashHash: string,
    options: GitCommandOptions & { diffMaxBytes?: number } = {}
  ): Promise<{ diff: string | null; diffTruncated: boolean }> {
    const { diffMaxBytes = 50_000, ...commandOptions } = options;

    const result = await this.executeGitCommand(
      ['--no-pager', 'stash', 'show', '-u', '-R', '-p', stashHash],
      repoPath,
      commandOptions,
    );

    if (!result.success) {
      return { diff: null, diffTruncated: false };
    }

    const raw = result.stdout;
    if (Buffer.byteLength(raw, 'utf8') > diffMaxBytes) {
      return { diff: raw.slice(0, diffMaxBytes) + '\n\n... (diff truncated)', diffTruncated: true };
    }
    return { diff: raw, diffTruncated: false };
  }

  /**
   * Return the files touched by a single commit, each with its added/deleted
   * line counts. Wraps `git show --numstat --format= <hash>`. Files with
   * binary changes report `0/0` here (numstat emits `-/-`, which we coerce
   * to 0).
   *
   * Returns `[]` when the ref can't be resolved, so callers can degrade
   * gracefully without aborting the surrounding flow.
   */
  async getCommitFileStats(
    repoPath: string,
    commitHash: string,
    options: GitCommandOptions = {}
  ): Promise<Array<{ path: string; added: number; deleted: number }>> {
    const result = await this.executeGitCommand(
      ['--no-pager', 'show', '--numstat', '--format=', commitHash],
      repoPath,
      options,
    );

    if (!result.success) {
      // Could be an unresolved ref (~N walked past root), a corrupt repo, or
      // a transient supervisor error. Callers (e.g. `computePageHint`) treat
      // [] as "stop walking", which is the right behavior in all cases —
      // but silent failure makes "wrong page hint" tickets unfixable. Warn
      // once so the cause shows up in logs.
      logger.warn('git.getCommitFileStats.failed', {
        commitHash: commitHash.substring(0, 7),
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 500),
      });
      return [];
    }

    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // numstat lines: `<added>\t<deleted>\t<path>`. On renames git emits
        // the path either inline as `old/{a => b}` (no tab in the path field)
        // or as two tab-separated columns `<old>\t<new>` — `pathParts.join`
        // collapses the latter into a single string with a literal tab,
        // which is harmless for downstream filename matching.
        const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
        const added = Number.parseInt(addedRaw ?? '', 10);
        const deleted = Number.parseInt(deletedRaw ?? '', 10);
        return {
          path: pathParts.join('\t'),
          added: Number.isFinite(added) ? added : 0,
          deleted: Number.isFinite(deleted) ? deleted : 0,
        };
      })
      .filter(entry => entry.path.length > 0);
  }

  /**
   * Get the last commit info
   */
  async getLastCommit(repoPath: string, options: GitCommandOptions = {}): Promise<GitCommitInfo | null> {
    try {
      const commits = await this.getCommitHistory(repoPath, 1, 0, options);
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
   * Create a production archive tarball containing build artifacts and optionally source code.
   * Archives are created in {DIST_DIR}/{commitHash}.tar.gz
   * The output directory will be created if it doesn't exist.
   *
   * Archive strategy is auto-detected based on build output:
   * - If dist/server.bundle.mjs exists → dist/ only (fast path, requires dist/ folder)
   * - If dist/server.bundle.mjs missing → full source (fallback path, dist/ not required)
   *
   * Auto-detection can be overridden by explicitly setting includeSource option.
   *
   * @param repoPath - Path to the git repository
   * @param commitHash - The commit hash to archive (short or full)
   * @param outputDir - Directory to store the archive (default: DIST_DIR env var or '/publish/dist'). Will be created if it doesn't exist.
   * @param options - Archive options. If includeSource is undefined, auto-detects based on dist/server.bundle.mjs
   * @returns GitArchiveResult with the archive path and commit hash
   * @throws Error if dev-supervisor is not available, dist/ folder doesn't exist (for dist-only archives), or command fails
   */
  async createArchive(
    repoPath: string,
    commitHash: string,
    outputDir: string = process.env.DIST_DIR || '/publish/dist',
    options: ArchiveOptions = {}
  ): Promise<GitArchiveResult> {
    const { timeout = 60000 } = options;

    if (!this.isWorkspaceAvailable()) {
      throw new Error(
        'Archive creation requires a workspace connection for command execution.'
      );
    }

    // Validate commit hash format to prevent path traversal vulnerabilities
    if (!/^[a-f0-9]{7,40}$/i.test(commitHash)) {
      throw new Error(
        `Invalid commit hash format: "${commitHash}". Expected hexadecimal string between 7 and 40 characters.`
      );
    }

    const archivePath = `${outputDir}/${commitHash}.tar.gz`;

    // Determine archive strategy first: auto-detect or use explicit override
    const includeSource = await this.shouldIncludeSource(options.includeSource);

    // Only verify dist/ folder exists for dist-only archives
    // Full source archives include everything in /app, so dist/ is not required
    if (!includeSource) {
      const distCheckResult = await this.tasks!.runCommandSync({
        command: buildShellCommand(['test', '-d', 'dist']),
        workingDir: '/app',
        timeoutSeconds: 5,
      });
      if (distCheckResult.exitCode !== 0) {
        logger.error('git.archive.dist_check.failed', {
          message: 'dist/ folder not found - application must be built before publishing',
          commitHash,
          includeSource,
        });
        throw new Error('dist/ folder not found - application must be built before publishing');
      }
    }

    // Create archive using appropriate strategy
    if (includeSource) {
      await this.createFullSourceArchive(
        archivePath,
        outputDir,
        timeout,
        options.excludeUntracked === true,
        options.includeNodeModules === true
      );
    } else {
      await this.createDistOnlyArchive(archivePath, outputDir, timeout);
    }

    return {
      path: archivePath,
      commitHash: commitHash
    };
  }

  /**
   * Determine whether to include full source in archive.
   * Auto-detects based on dist/server.bundle.mjs presence if not explicitly specified.
   */
  private async shouldIncludeSource(explicitValue?: boolean): Promise<boolean> {
    if (explicitValue !== undefined) {
      return explicitValue;
    }

    // Auto-detect: include source if bundled server NOT found
    const bundleCheckResult = await this.tasks!.runCommandSync({
      command: buildShellCommand(['test', '-f', 'dist/server.bundle.mjs']),
      workingDir: '/app',
      timeoutSeconds: 5,
    });
    return bundleCheckResult.exitCode !== 0;
  }

  /**
   * Create archive containing only the dist/ folder.
   * Used for apps with bundled server (fast path).
   */
  private async createDistOnlyArchive(
    archivePath: string,
    outputDir: string,
    timeout: number
  ): Promise<void> {
    // Copy airo-media.json into dist/ if it exists
    const manifestCheckResult = await this.tasks!.runCommandSync({
      command: buildShellCommand(['test', '-f', 'airo-media.json']),
      workingDir: '/app',
      timeoutSeconds: 5,
    });
    if (manifestCheckResult.exitCode === 0) {
      const copyResult = await this.tasks!.runCommandSync({
        command: buildShellCommand(['cp', 'airo-media.json', 'dist/airo-media.json']),
        workingDir: '/app',
        timeoutSeconds: 5,
      });
      if (copyResult.exitCode !== 0) {
        throw new Error(`Failed to copy airo-media.json to dist/: ${copyResult.stderr || 'Unknown error'}`);
      }
      // Also copy to dist/client/ so the published Express server can serve
      // it as a static file at /airo-media.json (used by airo-video-slots.js)
      await this.tasks!.runCommandSync({
        command: buildShellCommand(['sh', '-c', 'test -d dist/client && cp airo-media.json dist/client/airo-media.json || true']),
        workingDir: '/app',
        timeoutSeconds: 5,
      });
    }

    // Create output directory
    const mkdirResult = await this.tasks!.runCommandSync({
      command: buildShellCommand(['mkdir', '-p', outputDir]),
      workingDir: '/app',
      timeoutSeconds: 10,
    });
    if (mkdirResult.exitCode !== 0) {
      throw new Error(`Failed to create output directory: ${mkdirResult.stderr || 'Unknown error'}`);
    }

    // Create tar.gz archive of dist/ folder
    const tarResult = await this.tasks!.runCommandSync({
      command: buildShellCommand(['tar', '-czf', archivePath, '-C', '/app', 'dist']),
      workingDir: '/app',
      timeoutSeconds: Math.floor(timeout / 1000),
    });
    if (tarResult.exitCode !== 0) {
      throw new Error(`Failed to create archive: ${tarResult.stderr || 'Unknown error'}`);
    }
  }

  /**
   * Create archive containing full source code.
   * Used for PaaS apps without bundled server (fallback path).
   * Always excludes: .git/
   * Conditionally excludes:
   *   - node_modules/ (unless includeNodeModules=true)
   *   - .ssl/ (only in local dev; local-control-plane bind-mounts /app/.ssl read-only
   *     into the publish container, so bundling those files causes tar extraction to
   *     fail with "Read-only file system". Nomad production deployments have no such
   *     mount, so the exclusion is skipped there.)
   */
  private async createFullSourceArchive(
    archivePath: string,
    outputDir: string,
    timeout: number,
    excludeUntracked: boolean,
    includeNodeModules: boolean = false
  ): Promise<void> {
    // Create output directory
    const mkdirResult = await this.tasks!.runCommandSync({
      command: buildShellCommand(['mkdir', '-p', outputDir]),
      workingDir: '/app',
      timeoutSeconds: 10,
    });
    if (mkdirResult.exitCode !== 0) {
      throw new Error(`Failed to create output directory: ${mkdirResult.stderr || 'Unknown error'}`);
    }

    const untrackedExclusions = !excludeUntracked
      ? []
      : await this.getUntrackedExclusions();

    const tarExclusions = ['--exclude=.git'];
    if (!includeNodeModules) {
      tarExclusions.push('--exclude=node_modules');
    }
    // Absence of NOMAD_ALLOC_DIR is the project's canonical "local dev" signal
    // (see DefaultPublishStrategy, publish route, AppRepository). The read-only
    // /app/.ssl bind-mount is specific to local-control-plane's publish container,
    // so bundling those files would make tar extraction fail there with
    // "Read-only file system". Nomad has no such mount, so the exclusion is a
    // no-op there and we skip it to keep prod archive contents unchanged.
    const isLocalDev = !process.env.NOMAD_ALLOC_DIR;
    if (isLocalDev) {
      tarExclusions.push('--exclude=.ssl');
    }

    logger.info('git.archive.create.start', {
      archivePath,
      includeNodeModules,
      exclusionCount: tarExclusions.length + untrackedExclusions.length,
    });

    // Create tar.gz archive with exclusions
    const tarArgs = [
      'tar', '-czf', archivePath,
      ...tarExclusions,
      ...untrackedExclusions.map(file => `--exclude=${file}`),
      '-C', '/app', '.'
    ];
    const tarResult = await this.tasks!.runCommandSync({
      command: buildShellCommand(tarArgs),
      workingDir: '/app',
      timeoutSeconds: Math.floor(timeout / 1000),
    });
    if (tarResult.exitCode !== 0) {
      throw new Error(`Failed to create archive: ${tarResult.stderr || 'Unknown error'}`);
    }

    // Emit a manifest of key entries so we can answer "did X ship?" without
    // re-fetching the tar. Deferred via setImmediate so zero work happens on
    // the caller's synchronous path; wrapped in .catch to guarantee no
    // unhandled rejection can escape. A manifest failure is never worth
    // failing the publish over.
    setImmediate(() => {
      this.emitArchiveManifest(archivePath).catch((error) => {
        logger.warn('git.archive.create.manifest.skip', {
          archivePath,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  /**
   * Log the presence of critical entries (`.airo/config.json`, `package.json`,
   * `node_modules/`) plus size + entry count for the archive just created.
   * Runs `tar -tzf` once in the container. All data comes from a single exec
   * call so the agent makes one round-trip.
   */
  private async emitArchiveManifest(archivePath: string): Promise<void> {
    // Cap entry listing so a huge node_modules doesn't push tens of thousands
    // of lines into the shell pipe. hasAiroConfig / hasPackageJson rely on
    // those entries appearing within the first ENTRY_LIMIT; when the cap is
    // reached we set entriesTruncated so queries can distinguish "genuinely
    // absent" from "possibly past the cap".
    const ENTRY_LIMIT = 20000;
    try {
      const manifestCmd =
        `{ stat -c '%s' "${archivePath}" 2>/dev/null || wc -c < "${archivePath}"; } ; ` +
        `echo '---entries---' ; ` +
        `tar -tzf "${archivePath}" 2>/dev/null | head -n ${ENTRY_LIMIT}`;
      const result = await this.tasks!.runCommandSync({
        command: manifestCmd,
        timeoutSeconds: 15,
      });

      if (result.exitCode !== 0) {
        logger.debug('git.archive.create.manifest.skip', {
          archivePath,
          stderr: result.stderr,
        });
        return;
      }

      const [sizeLine, entriesBlock = ''] = (result.stdout ?? '').split(
        '---entries---'
      );
      const sizeBytes = parseInt((sizeLine || '').trim(), 10);

      // Entries in tar listings are relative paths like "./.airo/config.json"
      // or "./package.json". Accept leading "./" or bare forms.
      const entries = entriesBlock.split('\n').filter((line) => line.length > 0);
      const has = (suffix: string): boolean =>
        entries.some((e) => {
          const normalized = e.startsWith('./') ? e.slice(2) : e;
          return normalized === suffix || normalized.startsWith(`${suffix}/`);
        });

      logger.info('git.archive.create.manifest', {
        archivePath,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
        hasAiroConfig: has('.airo/config.json'),
        hasPackageJson: has('package.json'),
        hasNodeModules: has('node_modules'),
        entryCount: entries.length,
        // Distinguishes "config is genuinely absent" from "listing was
        // truncated and the config may be past the 20k cap".
        entriesTruncated: entries.length === ENTRY_LIMIT,
      });
    } catch (error) {
      // Belt-and-suspenders — any throw here is non-fatal.
      logger.debug('git.archive.create.manifest.skip', {
        archivePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getUntrackedExclusions(): Promise<string[]> {
    const untrackedResult = await this.tasks!.runCommandSync({
      command: buildShellCommand(['git', '-C', '/app', 'ls-files', '-z', '--others', '--exclude-standard']),
      workingDir: '/app',
      timeoutSeconds: 5,
    });
    if (untrackedResult.exitCode !== 0) {
      logger.debug('git.archive.untracked.exclude.skip', {
        message: 'Failed to list untracked files; proceeding without untracked exclusions',
        stderr: untrackedResult.stderr,
      });
      return [];
    }
    return untrackedResult.stdout
      .split('\0')
      .map(file => file.replace(/\r?\n$/, ''))
      // Exceptions: files that should always be included even if untracked
      // - repo-root .env* files: customer environment variables needed for runtime
      //   (only root-level, e.g. .env, .env.local - nested like subdir/.env are still excluded)
      // - .airo/ directory: platform configuration (runtime commands for PaaS)
      .filter(file => !file.startsWith('.env'))
      .filter(file => !file.startsWith('.airo/') && file !== '.airo')
      .filter(file => file.length > 0);
  }

  /**
   * Check if a fast-forward merge is possible from source branch to current branch
   * A fast-forward is possible when the current branch is a direct ancestor of the source branch
   *
   * @param repoPath - Path to the git repository
   * @param sourceBranch - Name of the branch to merge from
   * @param options - Git command options
   * @returns True if fast-forward is possible, false otherwise
   */
  async canFastForwardMerge(
    repoPath: string,
    sourceBranch: string,
    options: GitCommandOptions = {}
  ): Promise<boolean> {
    // Use git merge-base to check if HEAD is ancestor of sourceBranch
    // If merge-base of HEAD and sourceBranch equals HEAD, then fast-forward is possible
    const mergeBaseResult = await this.executeGitCommand(
      ['merge-base', 'HEAD', sourceBranch],
      repoPath,
      options
    );

    if (!mergeBaseResult.success) {
      return false;
    }

    const mergeBase = mergeBaseResult.stdout.trim();

    // Get current HEAD hash
    const headResult = await this.executeGitCommand(
      ['rev-parse', 'HEAD'],
      repoPath,
      options
    );

    if (!headResult.success) {
      return false;
    }

    const head = headResult.stdout.trim();

    // If merge-base equals HEAD, then HEAD is ancestor of sourceBranch (fast-forward possible)
    return mergeBase === head;
  }

  /**
   * Perform a fast-forward merge from a branch into the current branch
   * Preserves all original commit messages from the source branch
   *
   * @param repoPath - Path to the git repository
   * @param branchName - Name of the branch to merge
   * @param options - Git command options
   * @returns GitCommandResult from the merge operation
   * @throws Error if merge fails or fast-forward is not possible
   */
  async fastForwardMerge(
    repoPath: string,
    branchName: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    // Execute fast-forward merge
    const mergeResult = await this.executeGitCommand(
      ['merge', '--ff-only', branchName],
      repoPath,
      options
    );

    if (!mergeResult.success) {
      throw new Error(`Failed to fast-forward merge branch '${branchName}': ${mergeResult.stderr}`);
    }

    return mergeResult;
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
    // Check if the branch has any commits that aren't in the current branch (main)
    // This prevents creating empty merge commits when the feature branch is identical to main
    const revListResult = await this.executeGitCommand(
      ['rev-list', '--count', `HEAD..${branchName}`],
      repoPath,
      options
    );

    if (revListResult.success) {
      const commitCount = parseInt(revListResult.stdout.trim(), 10);
      if (commitCount === 0) {
        // Feature branch has no commits that aren't in main - nothing to merge
        return {
          command: `git merge --squash ${branchName}`,
          workingDir: repoPath,
          success: true,
          stdout: 'No changes to commit - branch is already merged',
          stderr: '',
          exitCode: 0,
          executionTime: 0,
          timedOut: false
        };
      }
    }

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

  // ==================================================================================
  // Low-level Git Operations (for filtered push and similar workflows)
  // ==================================================================================

  /**
   * Remove files from git (git rm)
   * Generic method matching addFiles pattern with configurable options
   *
   * @param repoPath - Path to the git repository
   * @param files - Files or directories to remove (default: ['.'])
   * @param options - Git command options plus rm-specific options:
   *   - recursive: -r flag (remove directories recursively)
   *   - cached: --cached (only affects index, not working directory)
   *   - force: -f flag (override up-to-date check)
   *   - quiet: --quiet (suppress output)
   * @returns GitCommandResult
   */
  async removeFiles(
    repoPath: string,
    files: string[] = ['.'],
    options: GitCommandOptions & {
      recursive?: boolean;
      cached?: boolean;
      force?: boolean;
      quiet?: boolean;
    } = {}
  ): Promise<GitCommandResult> {
    const args = ['rm'];
    if (options.recursive) args.push('-r');
    if (options.cached) args.push('--cached');
    if (options.force) args.push('-f');
    if (options.quiet) args.push('--quiet');
    args.push(...files);
    return this.executeGitCommand(args, repoPath, {
      ...options,
      timeout: options.timeout || 30000
    });
  }

  /**
   * Create a tree object from the current index state
   * Uses `git write-tree` to create a tree SHA from staged files
   *
   * @param repoPath - Path to the git repository
   * @param options - Git command options
   * @returns GitCommandResult with tree hash in stdout
   */
  async writeTree(
    repoPath: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['write-tree'], repoPath, {
      ...options,
      timeout: options.timeout || 30000
    });
  }

  /**
   * Create a commit object from a tree hash
   * Uses `git commit-tree` to create a commit with an optional parent
   *
   * @param repoPath - Path to the git repository
   * @param treeHash - The tree SHA to create a commit from
   * @param message - Commit message
   * @param options - Git command options plus optional parentHash for non-orphan commits
   * @returns GitCommandResult with commit hash in stdout
   */
  async commitTree(
    repoPath: string,
    treeHash: string,
    message: string,
    options: GitCommandOptions & { parentHash?: string } = {}
  ): Promise<GitCommandResult> {
    const { parentHash, ...gitOptions } = options;
    const args = ['commit-tree', treeHash];
    if (parentHash) {
      args.push('-p', parentHash);
    }
    args.push('-m', message);
    return this.executeGitCommand(args, repoPath, {
      ...gitOptions,
      timeout: gitOptions.timeout || 30000
    });
  }

  /**
   * Get the tree hash for a given ref (commit, branch, HEAD, etc.)
   * Uses `git rev-parse <ref>^{tree}` to resolve to a tree object
   *
   * @param repoPath - Path to the git repository
   * @param ref - Git ref to resolve (e.g., 'HEAD', 'main', commit hash)
   * @param options - Git command options
   * @returns The tree hash string
   * @throws Error if the ref cannot be resolved
   */
  async getTreeHash(
    repoPath: string,
    ref: string,
    options: GitCommandOptions = {}
  ): Promise<string> {
    const result = await this.executeGitCommand(
      ['rev-parse', `${ref}^{tree}`],
      repoPath,
      options
    );
    if (!result.success) {
      throw new Error(`Failed to get tree hash for '${ref}': ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  /**
   * Update a git ref to point to a specific commit
   * Uses `git update-ref` to atomically update a ref without changing the working directory
   *
   * When oldValue is provided, acts as a compare-and-swap: the update only succeeds
   * if the ref currently points to oldValue, preventing silent overwrites from
   * concurrent changes.
   *
   * @param repoPath - Path to the git repository
   * @param ref - The ref to update (e.g., 'refs/heads/main')
   * @param commitHash - The commit hash to point the ref to
   * @param oldValue - Optional expected current value for atomic compare-and-swap
   * @param options - Git command options
   * @throws Error if the update fails
   */
  async updateRef(
    repoPath: string,
    ref: string,
    commitHash: string,
    oldValue?: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    const args = ['update-ref', ref, commitHash];
    if (oldValue !== undefined) {
      args.push(oldValue);
    }
    const result = await this.executeGitCommand(args, repoPath, {
      ...options,
      timeout: options.timeout || 30000
    });
    if (!result.success) {
      throw new Error(`Failed to update ref '${ref}': ${result.stderr}`);
    }
    return result;
  }

  /**
   * Reset the current HEAD to a specified state
   * Supports soft, mixed (default), and hard reset modes
   *
   * @param repoPath - Path to the git repository
   * @param options - Git command options plus reset-specific options:
   *   - mode: Reset mode ('soft', 'mixed', 'hard') - explicit mode selection
   *   - hard: If true, use --hard reset (legacy, prefer mode option)
   *   - target: The commit/ref to reset to (default: 'HEAD')
   * @returns GitCommandResult
   */
  async reset(
    repoPath: string,
    options: GitCommandOptions & {
      mode?: 'soft' | 'mixed' | 'hard';
      hard?: boolean;
      target?: string;
    } = {}
  ): Promise<GitCommandResult> {
    const args = ['reset'];
    // Support explicit mode or legacy hard boolean
    if (options.mode) {
      args.push(`--${options.mode}`);
    } else if (options.hard) {
      args.push('--hard');
    }
    if (options.target) {
      args.push(options.target);
    }
    return this.executeGitCommand(args, repoPath, {
      ...options,
      timeout: options.timeout || 30000
    });
  }

  private isWorkspaceAvailable(): boolean {
    return this.tasks !== null;
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

        if (this.isWorkspaceAvailable()) {
          // Check if lock file still exists after wait
          const checkLockResult = await this.tasks!.runCommandSync({
            command: buildShellCommand(['test', '-f', '.git/index.lock']),
            workingDir: '/app',
            timeoutSeconds: 5,
          });

          if (checkLockResult.exitCode === 0) {
            // Lock file still exists, remove it
            logger.info('git.util.recovery.lock.removing', { repoPath });

            const lockRemovalResult = await this.tasks!.runCommandSync({
              command: buildShellCommand(['rm', '-f', '.git/index.lock']),
              workingDir: '/app',
              timeoutSeconds: 10,
            });

            if (lockRemovalResult.exitCode === 0) {
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
        if (this.isWorkspaceAvailable()) {
          // Run git fsck to check and repair
          logger.info('git.util.recovery.corruption.fsck_running', { repoPath });

          const fsckResult = await this.tasks!.runCommandSync({
            command: buildShellCommand(['git', 'fsck', '--full']),
            workingDir: '/app',
            timeoutSeconds: 60,
          });

          if (fsckResult.exitCode === 0) {
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
    // Skip this check when using dev-supervisor since the path is inside the container
    if (errorLower.includes('not a git repository') || errorLower.includes('no such file or directory')) {
      if (!this.isWorkspaceAvailable()) {
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

    // Validate that the directory exists on host filesystem
    // Skip this check when using dev-supervisor since the path is inside the container
    const hostPath = resolve(cwd);
    if (!this.isWorkspaceAvailable() && !existsSync(hostPath)) {
      throw new Error(`Working directory does not exist: ${hostPath}`);
    }

    const command = buildShellCommand(['git', ...args]);
    const effectiveWorkingDir = this.isWorkspaceAvailable() ? '/app' : hostPath;

    const result: GitCommandResult = {
      command,
      workingDir: effectiveWorkingDir,
      exitCode: -1,
      stdout: '',
      stderr: '',
      success: false,
      executionTime: 0,
      timedOut: false,
    };

    try {
      if (!this.isWorkspaceAvailable()) {
        throw new Error(
          'Git operations require a workspace connection for command execution. ' +
          'All deployments are containerized and must have dev-supervisor installed.'
        );
      }

      // Always use /app as the working directory since all deployments are
      // containerized — the host-side path doesn't exist inside the container.
      const execResult = await this.tasks!.runCommandSync({
        command,
        workingDir: '/app',
        timeoutSeconds: Math.floor(timeout / 1000),
      });

      result.exitCode = execResult.exitCode;
      result.stdout = execResult.stdout;
      result.stderr = execResult.stderr;
      result.timedOut = execResult.timedOut;
      result.executionTime = Date.now() - startTime;
      result.success = execResult.exitCode === 0;

      // If command failed (but not timed out), attempt recovery
      if (!result.success && !result.timedOut && result.stderr) {
        const recovery = await this.attemptGitRecovery(result.stderr, effectiveWorkingDir, command);

        if (recovery.escalate) {
          logger.error('git.util.execute.escalate', {
            command,
            workingDir: effectiveWorkingDir,
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
            workingDir: effectiveWorkingDir,
            recovered: recovery.recovered
          });

          const retryResult = await this.tasks!.runCommandSync({
            command,
            workingDir: '/app',
            timeoutSeconds: Math.floor(timeout / 1000),
          });

          result.exitCode = retryResult.exitCode;
          result.stdout = retryResult.stdout;
          result.stderr = retryResult.stderr;
          result.success = retryResult.exitCode === 0;
          result.executionTime = Date.now() - startTime;

          if (retryResult.exitCode === 0) {
            logger.info('git.util.execute.retry_success', {
              command,
              workingDir: effectiveWorkingDir
            });
          } else {
            logger.warn('git.util.execute.retry_failed', {
              command,
              workingDir: effectiveWorkingDir,
              error: retryResult.stderr
            });
          }
        }
      }
    } catch (error) {
      result.stderr = error instanceof Error ? error.message : String(error);
      result.timedOut = true;
      result.executionTime = Date.now() - startTime;
      logger.error('git.util.execute.transport_failure', {
        command,
        workingDir: effectiveWorkingDir,
        error: result.stderr,
      });
    }

    return result;
  }

  // ==================================================================================
  // Git Remote Operations (for GitHub sync feature)
  // ==================================================================================

  /**
   * Add a remote to the repository
   *
   * @param repoPath - Path to the git repository
   * @param remoteName - Name of the remote (e.g., 'origin')
   * @param url - Remote URL
   * @param options - Git command options
   * @returns GitCommandResult
   */
  async addRemote(
    repoPath: string,
    remoteName: string,
    url: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['remote', 'add', remoteName, url], repoPath, options);
  }

  /**
   * Set the URL for an existing remote
   *
   * @param repoPath - Path to the git repository
   * @param remoteName - Name of the remote (e.g., 'origin')
   * @param url - New remote URL
   * @param options - Git command options
   * @returns GitCommandResult
   */
  async setRemoteUrl(
    repoPath: string,
    remoteName: string,
    url: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['remote', 'set-url', remoteName, url], repoPath, options);
  }

  /**
   * Get the URL for a remote
   *
   * @param repoPath - Path to the git repository
   * @param remoteName - Name of the remote (e.g., 'origin')
   * @param options - Git command options
   * @returns Remote URL or null if not found
   */
  async getRemoteUrl(
    repoPath: string,
    remoteName: string,
    options: GitCommandOptions = {}
  ): Promise<string | null> {
    try {
      const result = await this.executeGitCommand(
        ['remote', 'get-url', remoteName],
        repoPath,
        options
      );

      if (!result.success) {
        return null;
      }

      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a remote exists
   *
   * @param repoPath - Path to the git repository
   * @param remoteName - Name of the remote (e.g., 'origin')
   * @param options - Git command options
   * @returns True if remote exists, false otherwise
   */
  async hasRemote(
    repoPath: string,
    remoteName: string,
    options: GitCommandOptions = {}
  ): Promise<boolean> {
    try {
      const url = await this.getRemoteUrl(repoPath, remoteName, options);
      return url !== null;
    } catch {
      return false;
    }
  }

  /**
   * Push to a remote repository
   *
   * @param repoPath - Path to the git repository
   * @param remoteName - Name of the remote (e.g., 'origin')
   * @param branch - Branch name to push
   * @param options - Git command options
   * @param forcePush - Whether to force push (default: false)
   * @param setUpstream - Whether to set upstream tracking (default: false)
   * @returns GitCommandResult
   */
  async push(
    repoPath: string,
    remoteName: string,
    branch: string,
    options: GitCommandOptions = {},
    forcePush: boolean = false,
    setUpstream: boolean = false
  ): Promise<GitCommandResult> {
    const args = ['push'];

    if (setUpstream) {
      args.push('-u');
    }

    if (forcePush) {
      args.push('--force');
    }

    args.push(remoteName, branch);

    return this.executeGitCommand(args, repoPath, options);
  }

  /**
   * Pull from a remote repository
   *
   * @param repoPath - Path to the git repository
   * @param remoteName - Name of the remote (e.g., 'origin')
   * @param branch - Branch name to pull
   * @param options - Git command options
   * @param mergeStrategy - Merge strategy for conflicts: 'theirs' (prefer remote), 'ours' (prefer local), or undefined (no auto-resolution)
   * @returns GitCommandResult
   */
  async pull(
    repoPath: string,
    remoteName: string,
    branch: string,
    options: GitCommandOptions = {},
    mergeStrategy?: 'theirs' | 'ours',
    allowUnrelatedHistories?: boolean,
    noRebase?: boolean
  ): Promise<GitCommandResult> {
    const args = ['pull'];

    // --no-rebase tells git to use merge strategy (not rebase) for divergent branches
    if (noRebase) {
      args.push('--no-rebase');
    }

    // -X theirs/ours controls how conflicts are resolved during merge
    if (mergeStrategy) {
      args.push('-X', mergeStrategy);
    }

    if (allowUnrelatedHistories) {
      args.push('--allow-unrelated-histories');
    }

    args.push(remoteName, branch);

    return this.executeGitCommand(args, repoPath, options);
  }

  /**
   * Fetch from a remote repository
   *
   * @param repoPath - Path to the git repository
   * @param remoteName - Name of the remote (e.g., 'origin')
   * @param options - Git command options
   * @returns GitCommandResult
   */
  async fetch(
    repoPath: string,
    remoteName: string,
    options: GitCommandOptions = {}
  ): Promise<GitCommandResult> {
    return this.executeGitCommand(['fetch', remoteName], repoPath, options);
  }

  /**
   * Check whether the working tree has unmerged paths (i.e. a real merge/rebase
   * conflict). Uses `git ls-files --unmerged`, which lists index entries with
   * conflict stages. Locale-independent and works for both merge and rebase.
   *
   * @param repoPath - Path to the git repository
   * @param options - Git command options
   * @returns true if at least one unmerged path exists
   */
  async hasUnmergedFiles(
    repoPath: string,
    options: GitCommandOptions = {}
  ): Promise<boolean> {
    const result = await this.executeGitCommand(['ls-files', '--unmerged'], repoPath, options);
    if (!result.success) {
      return false;
    }
    return result.stdout.trim().length > 0;
  }

}
