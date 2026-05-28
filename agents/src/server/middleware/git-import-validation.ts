/**
 * Git Sync Validation Middleware
 *
 * Validates Git sync parameters (repoUrl, token) before creating database entries
 * and starting expensive git operations. Provides fail-fast behavior by checking:
 * 1. Git URL format and security (SSH blocking, SSRF prevention)
 * 2. Access token validity via provider API
 * 3. Repository accessibility
 *
 * Credential validation behavior:
 * - If both repoUrl AND token are provided: validates credentials before proceeding
 * - If neither is provided: skips validation (credentials sourced elsewhere)
 * - If only one is provided: returns error (incomplete credentials)
 *
 * This prevents polluting the database with failed sync jobs that could have
 * been prevented with upfront validation.
 *
 * @example
 * router.post('/apps/:id/git/pull',
 *   requireGitRemoteSync,
 *   validateAppOwnership,
 *   validateGitSync,  // Validates before DB entry
 *   async (req, res) => {
 *     // Handler only executes if all validations pass
 *   }
 * );
 */

import { Request, Response, NextFunction } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, log } from '../../logging/index.js';
import { ValidationErrorKey, type ValidationError } from '../../types/import.js';
import type { WorkspaceTasks } from '../../workspace/tasks.js';

const logger = Logger.create({ component: 'git-sync-validation-middleware' });

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
 * Middleware to validate Git sync parameters before DB entry
 *
 * Credential validation behavior:
 * - If both repoUrl AND token are provided: validates credentials before proceeding
 * - If neither is provided: skips validation (credentials sourced elsewhere)
 * - If only one is provided: returns error (incomplete credentials)
 *
 * When credentials are provided, validates:
 * - Git URL must be HTTPS from supported providers (GitHub, GitLab, Bitbucket)
 * - Access token must be valid and have repository access
 *
 * @param req - Express request with body containing optional repoUrl, token
 * @param res - Express response
 * @param next - Express next function
 */
export async function validateGitSync(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { repoUrl, token } = req.body;
    const appId = req.params.id;

    // Skip validation if neither repoUrl nor token provided
    // Credentials will be sourced elsewhere (e.g., database config, secrets API)
    if (!repoUrl && !token) {
      next();
      return;
    }

    // If one is provided but not the other, that's an error
    if ((repoUrl && !token) || (!repoUrl && token)) {
      logger.warn('route.middleware.git-sync.incomplete-params', {
        appId,
        hasRepoUrl: !!repoUrl,
        hasToken: !!token,
      });
      res.status(400).json({
        success: false,
        error: 'Both repoUrl and token must be provided together, or neither',
      });
      return;
    }

    logger.info('route.middleware.git-sync.validation.start', {
      appId,
      repoUrl: repoUrl ? sanitizeGitUrl(repoUrl) : undefined,
      hasToken: !!token,
    });

    // Token format validation
    if (typeof token !== 'string' || token.trim().length === 0) {
      logger.warn('route.middleware.git-sync.invalid-token-format', {
        appId,
        tokenType: typeof token,
      });
      res.status(400).json({
        success: false,
        error: 'token must be a non-empty string',
      });
      return;
    }

    // Git URL validation (format, security, supported providers)
    const urlValidation = validateGitUrl(repoUrl);
    if (urlValidation) {
      logger.warn('route.middleware.git-sync.url-validation.failed', {
        appId,
        repoUrl: sanitizeGitUrl(repoUrl),
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

    // Token & repository access validation via provider API
    // This is the expensive check but still much faster than git clone
    const tokenValidation = await validateToken(repoUrl, token);
    if (!tokenValidation.valid) {
      logger.warn('route.middleware.git-sync.token-validation.failed', {
        appId,
        repoUrl: sanitizeGitUrl(repoUrl),
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
    logger.info('route.middleware.git-sync.validation.success', {
      appId,
      repoUrl: sanitizeGitUrl(repoUrl),
      hasRepoAccess: tokenValidation.hasRepoAccess,
    });

    next();
  } catch (error) {
    log.error(logger, 'route.middleware.git-sync.validation.error', error as Error, {
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

/**
 * Minimal package.json shape for build tool detection
 */
export interface PackageJsonDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Configuration for a supported build tool.
 * Add new build tools by creating a new config object.
 */
export interface BuildToolConfig {
  /** Display name for error messages */
  name: string;
  /** Config file names to detect (e.g., vite.config.ts, bunfig.toml) */
  configFiles: readonly string[];
  /** Package names to check in dependencies/devDependencies */
  packageNames: readonly string[];
}

/**
 * Node.js build tool configuration
 * Any Node.js project with package.json is supported - customers define their own start script.
 */
export const NODEJS_BUILD_TOOL: BuildToolConfig = {
  name: 'Node.js',
  configFiles: [], // No standard config file - any Node.js project is supported
  packageNames: [], // No specific packages required - any project with package.json
} as const;

/**
 * List of all supported build tools.
 * Currently only Node.js is supported - customers define their own start script in package.json.
 */
export const SUPPORTED_BUILD_TOOLS: readonly BuildToolConfig[] = [
  NODEJS_BUILD_TOOL,
] as const;

/**
 * Validates that a path is safe for shell interpolation.
 * Prevents command injection by rejecting paths with shell metacharacters.
 */
export function isValidShellPath(path: string): boolean {
  return /^[a-zA-Z0-9/_.-]+$/.test(path);
}

/**
 * Checks if package.json has any of the specified packages as dependency.
 * If packageNames is empty, returns true (any package.json is valid).
 */
export function hasDependency(packageJson: PackageJsonDeps, packageNames: readonly string[]): boolean {
  // Empty packageNames means "any package.json is valid"
  if (packageNames.length === 0) {
    return true;
  }
  return packageNames.some(pkg =>
    packageJson.dependencies?.[pkg] || packageJson.devDependencies?.[pkg]
  );
}

/**
 * Checks if any config files exist on the host filesystem.
 */
export function hasConfigFileOnHost(appPath: string, configFiles: readonly string[]): boolean {
  return configFiles.some(configFile => existsSync(join(appPath, configFile)));
}

/**
 * Checks if a project matches a build tool on the host filesystem.
 */
export function matchesBuildToolOnHost(appPath: string, buildTool: BuildToolConfig): boolean {
  if (buildTool.configFiles.length > 0 && hasConfigFileOnHost(appPath, buildTool.configFiles)) {
    return true;
  }

  const packageJsonPath = join(appPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      return hasDependency(packageJson, buildTool.packageNames);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Checks if a project matches any supported build tool on the host filesystem.
 */
export function isSupportedProjectOnHost(
  appPath: string,
  supportedTools: readonly BuildToolConfig[] = SUPPORTED_BUILD_TOOLS
): boolean {
  return supportedTools.some(tool => matchesBuildToolOnHost(appPath, tool));
}

/**
 * Checks for config files inside a container via dev-supervisor.
 *
 * @throws Error if projectRoot contains invalid characters
 */
export async function hasConfigFileInContainer(
  tasks: Pick<WorkspaceTasks, 'runCommandSync'>,
  projectRoot: string,
  configFiles: readonly string[]
): Promise<boolean> {
  if (!isValidShellPath(projectRoot)) {
    throw new Error('Invalid project root path: contains disallowed characters');
  }

  for (const configFile of configFiles) {
    const checkResult = await tasks.runCommandSync({
      command: `test -f "${projectRoot}/${configFile}" && echo "found" || echo "notfound"`,
      timeoutSeconds: 5,
    });
    if (checkResult.stdout?.trim() === 'found') {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a project matches a build tool inside a container.
 */
export async function matchesBuildToolInContainer(
  tasks: Pick<WorkspaceTasks, 'runCommandSync'>,
  projectRoot: string,
  packageJson: PackageJsonDeps,
  buildTool: BuildToolConfig
): Promise<boolean> {
  if (buildTool.configFiles.length > 0) {
    const hasConfig = await hasConfigFileInContainer(tasks, projectRoot, buildTool.configFiles);
    if (hasConfig) return true;
  }

  return hasDependency(packageJson, buildTool.packageNames);
}

/**
 * Checks if a project matches any supported build tool inside a container.
 *
 * @returns Object with match result and matched tool name (if any)
 */
export async function isSupportedProjectInContainer(
  tasks: Pick<WorkspaceTasks, 'runCommandSync'>,
  projectRoot: string,
  packageJson: PackageJsonDeps,
  supportedTools: readonly BuildToolConfig[] = SUPPORTED_BUILD_TOOLS
): Promise<{ supported: boolean; matchedTool?: string }> {
  for (const tool of supportedTools) {
    if (await matchesBuildToolInContainer(tasks, projectRoot, packageJson, tool)) {
      return { supported: true, matchedTool: tool.name };
    }
  }
  return { supported: false };
}
