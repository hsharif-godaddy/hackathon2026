/**
 * GitCloneService
 *
 * Handles Git repository cloning for project import via dev-supervisor.
 * Validates Git URLs and executes clone operations inside containers.
 */

import { Logger } from '../logging/index.js';
import type { WorkspaceTasks } from '../workspace/tasks.js';
import { ValidationErrorKey, type ValidationError } from '../types/import.js';

const CLONE_TIMEOUT = parseInt(process.env.GIT_CLONE_TIMEOUT || '300', 10); // 5 minutes default
const MAX_REPO_SIZE = parseInt(process.env.GIT_MAX_REPO_SIZE || '524288000', 10); // 500MB default

export interface GitCloneParams {
  appId: string;
  gitUrl: string;
  gitToken: string;
  gitBranch?: string | undefined;
}

export interface GitCloneResult {
  success: boolean;
  clonePath?: string;
  commitHash?: string | undefined;
  error?: string;
  validationErrors?: ValidationError[];
}

export class GitCloneService {
  private logger = Logger.create({ component: 'git-clone' });

  /**
   * Clone a Git repository inside the container
   *
   * @param tasks - Workspace tasks for executing commands in container
   * @param params - Clone parameters
   * @returns Clone result with path and commit hash
   */
  async cloneRepository(
    tasks: WorkspaceTasks,
    params: GitCloneParams
  ): Promise<GitCloneResult> {
    const { appId, gitUrl, gitToken, gitBranch } = params;

    try {
      this.logger.info('git-clone.start', {
        appId,
        gitUrl: this.sanitizeGitUrl(gitUrl),
        branch: gitBranch || 'default',
      });

      // Generate unique clone path
      const cloneId = `git-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const clonePath = `/app/.import-${cloneId}`;

      this.logger.info('git-clone.prepare', {
        appId,
        clonePath,
      });

      // Create clone directory
      const mkdirResult = await tasks.runCommandSync({
        command: `mkdir -p "${clonePath}"`,
        timeoutSeconds: 10,
      });

      if (mkdirResult.exitCode !== 0) {
        return {
          success: false,
          error: 'Failed to create clone directory',
          validationErrors: [{
            key: ValidationErrorKey.GIT_CLONE_FAILED,
            message: 'Failed to create clone directory',
            details: { stderr: mkdirResult.stderr },
          }],
        };
      }

      // Prepare Git URL with authentication
      const authenticatedUrl = this.injectToken(gitUrl, gitToken);

      // Build git clone command
      const branchFlag = gitBranch ? `--branch "${gitBranch}"` : '';
      const cloneCommand = `git clone --depth 1 --single-branch ${branchFlag} "${authenticatedUrl}" "${clonePath}"`;

      this.logger.info('git-clone.execute', {
        appId,
        clonePath,
        branch: gitBranch || 'default',
      });

      // Execute clone
      const cloneResult = await tasks.runCommandSync({
        command: cloneCommand,
        timeoutSeconds: CLONE_TIMEOUT,
      });

      if (cloneResult.exitCode !== 0) {
        const error = this.parseCloneError(cloneResult.stderr || '');

        this.logger.error('git-clone.failed', {
          appId,
          gitUrl: this.sanitizeGitUrl(gitUrl),
          error: error.message,
          exitCode: cloneResult.exitCode,
        });

        return {
          success: false,
          error: error.message,
          validationErrors: [error],
        };
      }

      // Get cloned commit hash
      const hashResult = await tasks.runCommandSync({
        command: `cd "${clonePath}" && git rev-parse HEAD`,
        timeoutSeconds: 5,
      });

      const commitHash = hashResult.exitCode === 0 ? hashResult.stdout?.trim() : undefined;

      this.logger.info('git-clone.success', {
        appId,
        clonePath,
        commitHash: commitHash?.substring(0, 7),
      });

      return {
        success: true,
        clonePath,
        commitHash,
      };

    } catch (error) {
      this.logger.error('git-clone.error', {
        appId,
        gitUrl: this.sanitizeGitUrl(params.gitUrl),
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Git clone failed unexpectedly',
        validationErrors: [{
          key: ValidationErrorKey.GIT_CLONE_FAILED,
          message: error instanceof Error ? error.message : 'Git clone failed unexpectedly',
        }],
      };
    }
  }


  /**
   * Inject authentication token into HTTPS Git URL
   *
   * @param url - Original HTTPS Git URL
   * @param token - GitHub/GitLab/Bitbucket access token
   * @returns URL with embedded authentication
   */
  private injectToken(url: string, token: string): string {
    // Inject token as username in HTTPS URL
    // https://github.com/user/repo.git -> https://token@github.com/user/repo.git
    const urlObj = new URL(url);
    urlObj.username = token;
    return urlObj.toString();
  }

  /**
   * Parse git clone error messages into structured errors
   *
   * @param stderr - Git command stderr output
   * @returns Structured validation error
   */
  private parseCloneError(stderr: string): ValidationError {
    const stderrLower = stderr.toLowerCase();

    if (stderrLower.includes('authentication failed') || stderrLower.includes('invalid credentials')) {
      return {
        key: ValidationErrorKey.GIT_AUTH_FAILED,
        message: 'Git authentication failed. Please check your access token.',
      };
    }

    if (stderrLower.includes('repository not found') || stderrLower.includes('could not read from remote')) {
      return {
        key: ValidationErrorKey.GIT_REPO_NOT_FOUND,
        message: 'Repository not found. Please check the URL and your access permissions.',
      };
    }

    if (stderrLower.includes('timeout') || stderrLower.includes('timed out')) {
      return {
        key: ValidationErrorKey.GIT_CLONE_TIMEOUT,
        message: `Git clone timed out after ${CLONE_TIMEOUT} seconds. Repository may be too large.`,
      };
    }

    if (stderrLower.includes('branch') && stderrLower.includes('not found')) {
      return {
        key: ValidationErrorKey.GIT_CLONE_FAILED,
        message: 'Branch not found in repository.',
      };
    }

    // Generic error
    return {
      key: ValidationErrorKey.GIT_CLONE_FAILED,
      message: 'Git clone failed. Please check the repository URL and your access permissions.',
      details: { stderr },
    };
  }


  /**
   * Remove sensitive information from HTTPS Git URL for logging
   *
   * @param url - HTTPS Git URL that may contain token
   * @returns Sanitized URL safe for logging
   */
  private sanitizeGitUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      if (urlObj.username || urlObj.password) {
        urlObj.username = '***';
        urlObj.password = '';
      }
      return urlObj.toString();
    } catch {
      // Fallback: mask any credentials in URL
      return url.replace(/\/\/[^@]+@/, '//***@');
    }
  }
}

// Export singleton instance
export const gitCloneService = new GitCloneService();
