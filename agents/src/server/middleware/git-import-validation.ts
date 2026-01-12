/**
 * Git Import Validation Middleware
 *
 * Validates Git import parameters before creating database entries and starting
 * expensive import operations. Provides fail-fast behavior by checking:
 * 1. Git URL format and security (SSH blocking, SSRF prevention)
 * 2. Access token validity via provider API
 * 3. Repository accessibility
 *
 * This prevents polluting the database with failed import jobs that could have
 * been prevented with upfront validation.
 *
 * @example
 * router.post('/apps/:id/git/replace',
 *   requireZipImportFeature,
 *   validateAppOwnership,
 *   validateGitImport,  // Validates before DB entry
 *   async (req, res) => {
 *     // Handler only executes if all validations pass
 *   }
 * );
 */

import { Request, Response, NextFunction } from 'express';
import { Logger, log } from '../../logging/index.js';
import { ValidationErrorKey, type ValidationError } from '../../types/import.js';

const logger = Logger.create({ service: 'git-import-validation-middleware' });

/**
 * Validate Git URL format and security
 * Only HTTPS URLs are supported (SSH requires SSH keys, not tokens)
 *
 * @param url - Git repository URL
 * @returns ValidationError if invalid, null if valid
 */
export function validateGitUrl(url: string): ValidationError | null {
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
 * Extract repository information from HTTPS Git URL
 *
 * @param gitUrl - HTTPS Git repository URL
 * @returns Parsed repo info or null if unable to parse
 */
function extractRepoInfo(gitUrl: string): { provider: string; owner: string; repo: string } | null {
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
 * Validate Git token by checking repository access via GitHub/GitLab API
 * This provides fast-fail validation before attempting expensive clone operation
 *
 * @param gitUrl - Repository URL
 * @param gitToken - Access token
 * @returns Validation result
 */
export async function validateToken(
  gitUrl: string,
  gitToken: string
): Promise<{ valid: boolean; hasRepoAccess?: boolean; error?: ValidationError }> {
  try {
    // Extract owner/repo from URL
    const repoInfo = extractRepoInfo(gitUrl);
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

    logger.info('route.middleware.git-import.token-validation.api-check', {
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
        logger.warn('route.middleware.git-import.token-validation.unexpected-status', {
          status: response.status,
        });
        return { valid: true };
      }
    } catch (fetchError) {
      clearTimeout(timeout);

      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        // Timeout - skip validation
        logger.warn('route.middleware.git-import.token-validation.timeout', {});
        return { valid: true };
      }

      // Network error - skip validation
      logger.warn('route.middleware.git-import.token-validation.network-error', {
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      });
      return { valid: true };
    }
  } catch (error) {
    // Any parsing/validation error - skip validation and let git clone handle it
    logger.warn('route.middleware.git-import.token-validation.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { valid: true };
  }
}

/**
 * Middleware to validate Git import parameters before DB entry
 *
 * Only validates if content-type is application/json (Git import).
 * For multipart/form-data (zip upload), skips validation and calls next().
 *
 * Requirements:
 * - Request body must have gitUrl and gitToken fields
 * - Git URL must be HTTPS from supported providers (GitHub, GitLab, Bitbucket)
 * - Access token must be valid and have repository access
 *
 * @param req - Express request with body containing gitUrl, gitToken, gitBranch
 * @param res - Express response
 * @param next - Express next function
 */
export async function validateGitImport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {

    // Skip validation for non-Git imports (e.g., zip uploads)
    if (importType(req) !== 'git') {
      next();
      return;
    }

    const { gitUrl, gitToken, gitBranch } = req.body;
    const appId = req.params.id;

    logger.info('route.middleware.git-import.validation.start', {
      appId,
      gitUrl: gitUrl ? sanitizeGitUrl(gitUrl) : undefined,
      hasToken: !!gitToken,
      gitBranch: gitBranch || 'default',
    });

    // 1. Basic presence checks
    if (!gitUrl || !gitToken) {
      logger.warn('route.middleware.git-import.missing-params', {
        appId,
        hasGitUrl: !!gitUrl,
        hasGitToken: !!gitToken,
      });
      res.status(400).json({
        success: false,
        error: 'gitUrl and gitToken are required for git import',
      });
      return;
    }

    // 2. Token format validation
    if (typeof gitToken !== 'string' || gitToken.trim().length === 0) {
      logger.warn('route.middleware.git-import.invalid-token-format', {
        appId,
        tokenType: typeof gitToken,
      });
      res.status(400).json({
        success: false,
        error: 'gitToken must be a non-empty string',
      });
      return;
    }

    // 3. Git URL validation (format, security, supported providers)
    const urlValidation = validateGitUrl(gitUrl);
    if (urlValidation) {
      logger.warn('route.middleware.git-import.url-validation.failed', {
        appId,
        gitUrl: sanitizeGitUrl(gitUrl),
        errorKey: urlValidation.key,
        errorMessage: urlValidation.message,
      });
      res.status(400).json({
        success: false,
        error: urlValidation.message,
        validationErrors: [
          {
            key: urlValidation.key,
            message: urlValidation.message,
          },
        ],
      });
      return;
    }

    // 4. Token & repository access validation via provider API
    // This is the expensive check but still much faster than git clone
    const tokenValidation = await validateToken(gitUrl, gitToken);
    if (!tokenValidation.valid) {
      logger.warn('route.middleware.git-import.token-validation.failed', {
        appId,
        gitUrl: sanitizeGitUrl(gitUrl),
        errorKey: tokenValidation.error?.key,
        errorMessage: tokenValidation.error?.message,
      });
      res.status(400).json({
        success: false,
        error: tokenValidation.error?.message || 'Token validation failed',
        validationErrors: tokenValidation.error
          ? [
              {
                key: tokenValidation.error.key,
                message: tokenValidation.error.message,
              },
            ]
          : [],
      });
      return;
    }

    // All validations passed
    logger.info('route.middleware.git-import.validation.success', {
      appId,
      gitUrl: sanitizeGitUrl(gitUrl),
      hasRepoAccess: tokenValidation.hasRepoAccess,
    });

    next();
  } catch (error) {
    log.error(logger, 'route.middleware.git-import.validation.error', error as Error, {
      appId: req.params.id,
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error during validation',
    });
  }
}

/**
 * Remove sensitive information from Git URL for logging
 *
 * @param url - Git URL that may contain credentials
 * @returns Sanitized URL safe for logging
 */
function sanitizeGitUrl(url: string): string {
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

export function importType(req: Request): string | null {
  const contentType = (req.headers['content-type'] || '').toLowerCase();

  return contentType.startsWith('application/json')
    ? 'git'
    : contentType.startsWith('multipart/form-data')
      ? 'zip'
      : null;
}
