import { ProviderType } from '../../types/git-provider.js';

/**
 * Interface for git providers (GitHub, GitLab, Bitbucket)
 *
 * Provides abstraction for provider-specific operations like:
 * - Credential URL formatting
 * - Token validation
 * - API access
 */
export interface IGitProvider {
  /**
   * Provider type identifier
   */
  name: ProviderType;

  /**
   * Format credential URL for git credential helper
   *
   * @param hostname - Git provider hostname (e.g., 'github.com')
   * @param token - Authentication token
   * @returns Formatted credential URL
   *
   * @example
   * GitHub: https://TOKEN@github.com
   * GitLab: https://oauth2:TOKEN@gitlab.com
   * Bitbucket: https://USERNAME:APP_PASSWORD@bitbucket.org
   */
  formatCredentialUrl(hostname: string, token: string): string;

  /**
   * Validate token via provider API
   *
   * @param token - Authentication token to validate
   * @returns Promise resolving to true if valid, false otherwise
   */
  validateToken(token: string): Promise<boolean>;

  /**
   * Get API base URL for the provider
   *
   * @returns API base URL
   *
   * @example
   * GitHub: https://api.github.com
   * GitLab: https://gitlab.com/api/v4
   * Bitbucket: https://api.bitbucket.org/2.0
   */
  getApiBaseUrl(): string;

  /**
   * Extract hostname from repository URL
   *
   * @param repoUrl - Repository URL
   * @returns Hostname
   *
   * @example
   * https://github.com/user/repo.git -> github.com
   */
  getHostname(repoUrl: string): string;
}
