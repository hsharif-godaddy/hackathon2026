import { IGitProvider } from './IGitProvider.js';
import { ProviderType } from '../../types/git-provider.js';

/**
 * GitHub provider implementation
 *
 * Handles GitHub-specific operations:
 * - Token authentication via https://x-access-token:TOKEN@github.com
 * - API access via api.github.com
 */
export class GitHubProvider implements IGitProvider {
  name = ProviderType.GITHUB;

  /**
   * Format credential URL for GitHub
   *
   * GitHub uses: https://x-access-token:TOKEN@github.com
   * The x-access-token username is the standard format for GitHub PATs
   *
   * @param hostname - GitHub hostname (github.com)
   * @param token - GitHub Personal Access Token
   * @returns Formatted credential URL
   */
  formatCredentialUrl(hostname: string, token: string): string {
    return `https://x-access-token:${token}@${hostname}`;
  }

  /**
   * Validate GitHub token (placeholder for future implementation)
   *
   * Future implementation will call:
   * GET https://api.github.com/user
   * Authorization: token {token}
   *
   * @param _token - GitHub token to validate
   * @returns Promise resolving to true (placeholder)
   */
  async validateToken(_token: string): Promise<boolean> {
    // TODO: Implement GitHub API validation in future phase
    // const response = await fetch('https://api.github.com/user', {
    //   headers: { Authorization: `token ${token}` }
    // });
    // return response.ok;

    return true;
  }

  /**
   * Get GitHub API base URL
   *
   * @returns GitHub API base URL
   */
  getApiBaseUrl(): string {
    return 'https://api.github.com';
  }

  /**
   * Extract hostname from GitHub repository URL
   *
   * @param _repoUrl - Repository URL
   * @returns GitHub hostname
   */
  getHostname(_repoUrl: string): string {
    return 'github.com';
  }
}
