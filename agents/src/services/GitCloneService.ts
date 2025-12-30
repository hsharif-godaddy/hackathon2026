/**
 * GitCloneService
 *
 * Handles Git repository cloning for project import via dev-supervisor.
 * Validates Git URLs and executes clone operations inside containers.
 */

import { Logger } from '../logging/index.js';
import { DevSupervisorClient } from './DevSupervisorClient.js';
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
  private logger = Logger.create({ service: 'git-clone' });

  /**
   * Clone a Git repository inside the container
   *
   * @param devSupervisor - Client to execute commands in container
   * @param params - Clone parameters
   * @returns Clone result with path and commit hash
   */
  async cloneRepository(
    devSupervisor: DevSupervisorClient,
    params: GitCloneParams
  ): Promise<GitCloneResult> {
    const { appId, gitUrl, gitToken, gitBranch } = params;

    try {
      this.logger.info('git-clone.start', {
        appId,
        gitUrl: this.sanitizeGitUrl(gitUrl),
        branch: gitBranch || 'default',
      });

      // Validate Git URL
      const urlValidation = this.validateGitUrl(gitUrl);
      if (urlValidation) {
        this.logger.warn('git-clone.url-validation.failed', {
          appId,
          gitUrl: this.sanitizeGitUrl(gitUrl),
          reason: urlValidation.message,
        });
        return {
          success: false,
          validationErrors: [urlValidation],
        };
      }

      // Validate token BEFORE attempting clone
      const tokenValidation = await this.validateToken(gitUrl, gitToken);
      if (!tokenValidation.valid) {
        this.logger.warn('git-clone.token-validation.failed', {
          appId,
          gitUrl: this.sanitizeGitUrl(gitUrl),
          reason: tokenValidation.error?.message,
        });
        return {
          success: false,
          error: tokenValidation.error?.message || 'Token validation failed',
          validationErrors: tokenValidation.error ? [tokenValidation.error] : [],
        };
      }

      this.logger.info('git-clone.token-validation.success', {
        appId,
        hasRepoAccess: tokenValidation.hasRepoAccess,
      });

      // Generate unique clone path
      const cloneId = `git-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const clonePath = `/app/.import-${cloneId}`;

      this.logger.info('git-clone.prepare', {
        appId,
        clonePath,
      });

      // Create clone directory
      const mkdirResult = await devSupervisor.exec({
        command: `mkdir -p "${clonePath}"`,
        timeout: 10,
      });

      if (!mkdirResult.success) {
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
      const cloneResult = await devSupervisor.exec({
        command: cloneCommand,
        timeout: CLONE_TIMEOUT,
      });

      if (!cloneResult.success) {
        const error = this.parseCloneError(cloneResult.stderr || '');

        this.logger.error('git-clone.failed', {
          appId,
          gitUrl: this.sanitizeGitUrl(gitUrl),
          error: error.message,
          exitCode: cloneResult.exit_code,
        });

        return {
          success: false,
          error: error.message,
          validationErrors: [error],
        };
      }

      // Get cloned commit hash
      const hashResult = await devSupervisor.exec({
        command: `cd "${clonePath}" && git rev-parse HEAD`,
        timeout: 5,
      });

      const commitHash = hashResult.success ? hashResult.stdout?.trim() : undefined;

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
   * Validate Git URL format and security
   * Only HTTPS URLs are supported (SSH requires SSH keys, not tokens)
   *
   * @param url - Git repository URL
   * @returns ValidationError if invalid, null if valid
   */
  private validateGitUrl(url: string): ValidationError | null {
    // Block SSH URLs (tokens don't work with SSH)
    if (url.startsWith('git@')) {
      return {
        key: ValidationErrorKey.GIT_URL_INVALID,
        message: 'SSH URLs are not supported. Please use HTTPS format (https://github.com/...) with your access token.',
      };
    }

    // Blocked patterns (security)
    const blockedPatterns = [
      { pattern: /^file:\/\//i, message: 'file:// URLs are not allowed' },
      { pattern: /\.\./, message: 'Path traversal is not allowed' },
      { pattern: /^\/[^/]/, message: 'Local file paths are not allowed' },
      { pattern: /localhost|127\.0\.0\.1|0\.0\.0\.0/i, message: 'Localhost URLs are not allowed' },
    ];

    for (const { pattern, message } of blockedPatterns) {
      if (pattern.test(url)) {
        return {
          key: ValidationErrorKey.GIT_URL_INVALID,
          message,
        };
      }
    }

    // Only allow HTTPS URLs from supported providers
    const allowedPatterns = [
      /^https:\/\/github\.com\/.+\.git$/,
      /^https:\/\/github\.com\/.+$/,  // GitHub allows .git to be optional
      /^https:\/\/gitlab\.com\/.+\.git$/,
      /^https:\/\/gitlab\.com\/.+$/,
      /^https:\/\/bitbucket\.org\/.+\.git$/,
      /^https:\/\/bitbucket\.org\/.+$/,
    ];

    const isAllowed = allowedPatterns.some(pattern => pattern.test(url));

    if (!isAllowed) {
      return {
        key: ValidationErrorKey.GIT_URL_UNSUPPORTED,
        message: 'Only HTTPS URLs from GitHub, GitLab, and Bitbucket are supported',
      };
    }

    return null;
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
   * Validate Git token by checking repository access via GitHub/GitLab API
   * This provides fast-fail validation before attempting expensive clone operation
   *
   * @param gitUrl - Repository URL
   * @param gitToken - Access token
   * @returns Validation result
   */
  private async validateToken(
    gitUrl: string,
    gitToken: string
  ): Promise<{ valid: boolean; hasRepoAccess?: boolean; error?: ValidationError }> {
    try {
      // Extract owner/repo from URL
      const repoInfo = this.extractRepoInfo(gitUrl);
      if (!repoInfo) {
        // If we can't parse the URL, skip validation and let git clone handle it
        return { valid: true };
      }

      const { provider, owner, repo } = repoInfo;

      // Build API URL based on provider
      let apiUrl: string;
      let headers: Record<string, string>;

      if (provider === 'github') {
        apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
        headers = {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${gitToken}`,
          'User-Agent': 'Airo-App-Builder',
        };
      } else if (provider === 'gitlab') {
        // For GitLab, encode the project path
        const projectPath = encodeURIComponent(`${owner}/${repo}`);
        apiUrl = `https://gitlab.com/api/v4/projects/${projectPath}`;
        headers = {
          'Authorization': `Bearer ${gitToken}`,
        };
      } else if (provider === 'bitbucket') {
        apiUrl = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}`;
        headers = {
          'Authorization': `Bearer ${gitToken}`,
        };
      } else {
        // Unknown provider, skip validation
        return { valid: true };
      }

      this.logger.info('git-clone.token-validation.api-check', {
        provider,
        owner,
        repo: repo.replace('.git', ''),
      });

      // Make API request with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch(apiUrl, {
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        // Check response status
        if (response.status === 200) {
          // Token is valid and has access to repo
          return { valid: true, hasRepoAccess: true };
        } else if (response.status === 401) {
          // Invalid or expired token
          return {
            valid: false,
            error: {
              key: ValidationErrorKey.GIT_AUTH_FAILED,
              message: 'Invalid or expired access token. Please check your credentials.',
            },
          };
        } else if (response.status === 404) {
          // Repo not found OR no access (ambiguous for private repos)
          return {
            valid: false,
            error: {
              key: ValidationErrorKey.GIT_REPO_NOT_FOUND,
              message: 'Repository not found or you do not have access. Please check the URL and your permissions.',
            },
          };
        } else if (response.status === 403) {
          // Token valid but insufficient permissions
          return {
            valid: false,
            error: {
              key: ValidationErrorKey.GIT_AUTH_FAILED,
              message: 'Access token does not have sufficient permissions for this repository.',
            },
          };
        } else {
          // Other error - let git clone handle it
          this.logger.warn('git-clone.token-validation.unexpected-status', {
            status: response.status,
          });
          return { valid: true };
        }
      } catch (fetchError) {
        clearTimeout(timeout);

        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          // Timeout - skip validation
          this.logger.warn('git-clone.token-validation.timeout', {});
          return { valid: true };
        }

        // Network error - skip validation
        this.logger.warn('git-clone.token-validation.network-error', {
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        });
        return { valid: true };
      }
    } catch (error) {
      // Any parsing/validation error - skip validation and let git clone handle it
      this.logger.warn('git-clone.token-validation.error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { valid: true };
    }
  }

  /**
   * Extract repository information from HTTPS Git URL
   *
   * @param gitUrl - HTTPS Git repository URL
   * @returns Parsed repo info or null if unable to parse
   */
  private extractRepoInfo(gitUrl: string): { provider: string; owner: string; repo: string } | null {
    try {
      // Only handle HTTPS URLs (SSH is blocked at validation)
      if (!gitUrl.startsWith('https://')) {
        return null;
      }

      const urlObj = new URL(gitUrl);
      const hostname = urlObj.hostname;
      const pathParts = urlObj.pathname.split('/').filter(Boolean);

      if (pathParts.length < 2) {
        return null;
      }

      let provider: string;
      if (hostname === 'github.com') {
        provider = 'github';
      } else if (hostname === 'gitlab.com') {
        provider = 'gitlab';
      } else if (hostname === 'bitbucket.org') {
        provider = 'bitbucket';
      } else {
        return null;
      }

      const owner = pathParts[0];
      const repo = pathParts[1];

      if (!owner || !repo) {
        return null;
      }

      return {
        provider,
        owner,
        repo: repo.endsWith('.git') ? repo.slice(0, -4) : repo,
      };
    } catch {
      return null;
    }
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
