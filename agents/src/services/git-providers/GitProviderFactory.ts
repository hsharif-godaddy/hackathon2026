import { IGitProvider } from './IGitProvider.js';
import { GitHubProvider } from './GitHubProvider.js';
import { ProviderType } from '../../types/git-provider.js';

/**
 * Factory for creating git provider instances
 *
 * Detects provider from repository URL and returns appropriate implementation.
 * Currently supports:
 * - GitHub (implemented)
 * - GitLab (future)
 * - Bitbucket (future)
 */
export class GitProviderFactory {
  /**
   * Get provider instance based on repository URL
   *
   * @param repoUrl - Repository URL (e.g., https://github.com/user/repo.git)
   * @returns Provider instance implementing IGitProvider
   * @throws Error if provider is not supported
   */
  static getProvider(repoUrl: string): IGitProvider {
    const providerType = this.detectProvider(repoUrl);

    switch (providerType) {
      case ProviderType.GITHUB:
        return new GitHubProvider();

      case ProviderType.GITLAB:
        throw new Error(
          'GitLab support is not yet implemented. Coming in future release.'
        );

      case ProviderType.BITBUCKET:
        throw new Error(
          'Bitbucket support is not yet implemented. Coming in future release.'
        );

      default:
        throw new Error(`Unsupported git provider: ${repoUrl}`);
    }
  }

  /**
   * Detect provider type from repository URL
   *
   * @param repoUrl - Repository URL
   * @returns Provider type
   * @throws Error if provider cannot be detected
   */
  static detectProvider(repoUrl: string): ProviderType {
    try {
      const url = new URL(repoUrl);
      const hostname = url.hostname.toLowerCase();

      if (hostname === 'github.com' || hostname === 'www.github.com') {
        return ProviderType.GITHUB;
      }

      if (hostname === 'gitlab.com' || hostname === 'www.gitlab.com') {
        return ProviderType.GITLAB;
      }

      if (hostname === 'bitbucket.org' || hostname === 'www.bitbucket.org') {
        return ProviderType.BITBUCKET;
      }

      throw new Error(`Unsupported git provider: ${hostname}`);
    } catch (error) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
  }
}
