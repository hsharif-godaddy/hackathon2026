import { DevSupervisorClient } from './DevSupervisorClient.js';
import { GitProviderFactory } from './git-providers/GitProviderFactory.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { getNomadAllocConfig } from '../utils/nomad-config.js';

/**
 * Git Remote Token Manager
 *
 * Manages ephemeral git credentials for push/pull operations.
 *
 * SECURITY:
 * - Token read from /alloc/config.json via getNomadAllocConfig()
 * - Credentials created in /tmp/.git-credentials (ephemeral)
 * - MUST cleanup credentials in finally block after every operation
 */
export class GitRemoteTokenManager {
  private logger = Logger.create({ service: 'git-remote-token-manager' });

  constructor(private devSupervisor: DevSupervisorClient) {}

  /**
   * Configure git credentials for remote operations
   *
   * 1. Reads token from /alloc/config.json via getNomadAllocConfig()
   * 2. Creates /tmp/.git-credentials with provider-specific format
   * 3. Configures git to use credential helper
   *
   * @param appId - Application ID (for logging)
   * @param repoUrl - Repository URL (to detect provider)
   * @throws Error if credential configuration fails
   */
  async configureGitCredentials(appId: string, repoUrl: string): Promise<void> {
    this.logger.info('git-remote.credentials.configure.start', {
      appId,
      repoUrl
    });

    try {
      // Read token from shared config
      const nomadConfig = getNomadAllocConfig();
      const token = nomadConfig?.GITHUB_TOKEN?.VALUE as string | undefined;

      if (!token) {
        throw new Error('GITHUB_TOKEN not found in config. Please configure GitHub token via secrets API first.');
      }

      // Detect provider to get correct credential format
      const provider = GitProviderFactory.getProvider(repoUrl);
      const hostname = provider.getHostname(repoUrl);

      // Build bash script with token
      const script = this.buildCredentialScript(provider.name, hostname, token);

      // Execute script inside container via dev-supervisor
      const execResult = await this.devSupervisor.exec({
        command: script,
        working_dir: '/app',
        timeout: 300,
        capture_output: true
      });

      if (execResult.exit_code !== 0) {
        throw new Error(
          `Credential configuration failed: ${execResult.stderr || execResult.stdout || 'Unknown error'}`
        );
      }

      this.logger.info('git-remote.credentials.configure.success', {
        appId,
        provider: provider.name
      });
    } catch (error) {
      this.logger.error('git-remote.credentials.configure.error', {
        appId,
        repoUrl,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Cleanup git credentials after operation
   *
   * Deletes /tmp/.git-credentials inside container
   * MUST be called in finally block after every push/pull operation
   *
   * @param appId - Application ID (for logging)
   */
  async cleanupGitCredentials(appId: string): Promise<void> {
    this.logger.info('git-remote.credentials.cleanup.start', { appId });

    try {
      const script = `
        # Remove credential file
        rm -f /tmp/.git-credentials

        # Unset git credential helper
        git config --local --unset credential.helper || true
      `;

      const execResult = await this.devSupervisor.exec({
        command: script,
        working_dir: '/app',
        timeout: 300,
        capture_output: true
      });

      if (execResult.exit_code !== 0) {
        // Log warning but don't throw - cleanup failures shouldn't break operation
        this.logger.warn('git-remote.credentials.cleanup.warning', {
          appId,
          stderr: execResult.stderr
        });
      } else {
        this.logger.info('git-remote.credentials.cleanup.success', { appId });
      }
    } catch (error) {
      // Log error but don't throw - cleanup failures shouldn't break operation
      this.logger.error('git-remote.credentials.cleanup.error', {
        appId,
        error: getErrorMessage(error)
      });
    }
  }

  /**
   * Build provider-specific credential configuration script
   *
   * @param providerName - Provider type (github, gitlab, bitbucket)
   * @param hostname - Provider hostname (github.com, gitlab.com, etc.)
   * @param token - Git authentication token
   * @returns Bash script to execute inside container
   */
  private buildCredentialScript(
    providerName: string,
    hostname: string,
    token: string
  ): string {
    // Get provider-specific credential URL
    const credentialUrl = this.getProviderCredentialUrl(providerName, hostname, token);

    return `
      set -e  # Exit on error

      # Create credential file with provider-specific format
      echo "${credentialUrl}" > /tmp/.git-credentials

      # Secure the credential file
      chmod 600 /tmp/.git-credentials

      # Configure git to use credential helper
      git config --local credential.helper "store --file=/tmp/.git-credentials"

      echo "Git credentials configured successfully"
    `;
  }

  /**
   * Get provider-specific credential URL
   *
   * @param providerName - Provider type
   * @param hostname - Provider hostname
   * @param token - Authentication token
   * @returns Credential URL with token embedded
   */
  private getProviderCredentialUrl(
    providerName: string,
    hostname: string,
    token: string
  ): string {
    switch (providerName) {
      case 'github':
        // GitHub format: https://x-access-token:TOKEN@github.com
        return `https://x-access-token:${token}@${hostname}`;

      case 'gitlab':
        // GitLab format: https://oauth2:TOKEN@gitlab.com
        return `https://oauth2:${token}@${hostname}`;

      case 'bitbucket':
        // Bitbucket format: https://USERNAME:APP_PASSWORD@bitbucket.org
        return `https://${token}@${hostname}`;

      default:
        throw new Error(`Unsupported provider: ${providerName}`);
    }
  }
}
