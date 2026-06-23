import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { WorkspaceTasks } from '../workspace/tasks.js';
import { GitProviderFactory } from './git-providers/GitProviderFactory.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { getNomadAllocConfig } from '../utils/nomad-config.js';

const TOKEN_REFRESH_BUFFER_SECONDS = 300;

/**
 * Git Remote Token Manager
 *
 * Manages ephemeral git credentials for push/pull operations.
 *
 * TOKEN SOURCES (in priority order):
 * 1. Token passed directly in request (PaaS pattern)
 * 2. Token from /alloc/config.json via getNomadAllocConfig() (AiroAppBuilder pattern)
 *
 * SECURITY:
 * - Credentials created in /tmp/.git-credentials (ephemeral)
 * - MUST cleanup credentials in finally block after every operation
 */
export class GitRemoteTokenManager {
  private logger = Logger.create({ component: 'git-remote-token-manager' });

  constructor(private readonly tasks: WorkspaceTasks) {}

  /**
   * Configure git credentials for remote operations
   *
   * 1. Uses provided token OR reads from /alloc/config.json via getNomadAllocConfig()
   * 2. Creates /tmp/.git-credentials with provider-specific format
   * 3. Configures git to use credential helper
   *
   * @param appId - Application ID (for logging)
   * @param repoUrl - Repository URL (to detect provider)
   * @param token - Optional GitHub token (if provided, bypasses /alloc/config.json lookup - used by PaaS)
   * @throws Error if credential configuration fails
   */
  async configureGitCredentials(appId: string, repoUrl: string, token?: string): Promise<void> {
    this.logger.info('git-remote.credentials.configure.start', {
      appId,
      repoUrl,
      tokenSource: token ? 'request' : 'config'
    });

    try {
      const { credentialUrl, providerName } = this.resolveCredentialUrl(appId, repoUrl, token);
      const script = this.buildCredentialScript(providerName, credentialUrl);

      const execResult = await this.tasks.runCommandSync({
        command: script,
        workingDir: '/app',
        timeoutSeconds: 300,
      });

      if (execResult.exitCode !== 0) {
        throw new Error(
          `Credential configuration failed: ${execResult.stderr || execResult.stdout || 'Unknown error'}`
        );
      }

      this.logger.info('git-remote.credentials.configure.success', {
        appId,
        provider: providerName
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
   * Write credential file without configuring local git config.
   *
   * Use when .git doesn't exist yet (e.g., before git init).
   * Writes /tmp/.git-credentials with provider-specific format.
   * Call cleanupGitCredentials() in a finally block after the operation.
   */
  async writeCredentialFile(appId: string, repoUrl: string, token?: string): Promise<void> {
    this.logger.info('git-remote.credentials.write-file.start', {
      appId,
      repoUrl,
      tokenSource: token ? 'request' : 'config'
    });

    try {
      const { credentialUrl, providerName } = this.resolveCredentialUrl(appId, repoUrl, token);

      const script = `
        set -e
        echo "${credentialUrl}" > /tmp/.git-credentials
        chmod 600 /tmp/.git-credentials
      `;

      const execResult = await this.tasks.runCommandSync({
        command: script,
        workingDir: '/tmp',
        timeoutSeconds: 30,
      });

      if (execResult.exitCode !== 0) {
        throw new Error(
          `Credential file write failed: ${execResult.stderr || execResult.stdout || 'Unknown error'}`
        );
      }

      this.logger.info('git-remote.credentials.write-file.success', {
        appId,
        provider: providerName
      });
    } catch (error) {
      this.logger.error('git-remote.credentials.write-file.error', {
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

      const execResult = await this.tasks.runCommandSync({
        command: script,
        workingDir: '/app',
        timeoutSeconds: 300,
      });

      if (execResult.exitCode !== 0) {
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
   * Check whether the GitHub token for this app is expired (or about to expire).
   * Callable before creating a GitTool/workspace — no WorkspaceTasks needed.
   */
  static isTokenExpired(appId: string): boolean {
    const raw = GitRemoteTokenManager.readConfigValue(appId, 'GITHUB_TOKEN_EXPIRES_AT');
    if (!raw) return true;
    const expiresAt = Number(raw);
    if (Number.isNaN(expiresAt)) return true;
    return Math.floor(Date.now() / 1000) >= (expiresAt - TOKEN_REFRESH_BUFFER_SECONDS);
  }

  /**
   * Read a value from the alloc/local-dev config.
   * Production: getNomadAllocConfig()
   * Local dev: APPS_BASE_DIR/<appId>/local/preview/config.json
   */
  private static readConfigValue(appId: string, key: string): string | undefined {
    const nomadConfig = getNomadAllocConfig();
    const nomadVal = nomadConfig?.[key]?.VALUE;
    if (typeof nomadVal === 'number' && !Number.isNaN(nomadVal)) return String(nomadVal);
    if (typeof nomadVal === 'string' && nomadVal) return nomadVal;

    return GitRemoteTokenManager.readLocalDevConfigValue(appId, key);
  }

  private static readLocalDevConfigValue(appId: string, key: string): string | undefined {
    if (process.env.NOMAD_ALLOC_DIR) return undefined;
    if (/[/\\]|\.\./.test(appId)) return undefined;

    const configPath = join(
      process.env.APPS_BASE_DIR || '/tmp/airo-app-builder',
      appId, 'local', 'preview', 'config.json'
    );

    if (!existsSync(configPath)) return undefined;

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, { VALUE?: unknown }>;
      const v = config[key]?.VALUE;
      return typeof v === 'string' && v ? v : undefined;
    } catch {
      return undefined;
    }
  }

  private readLocalDevToken(appId: string): string | undefined {
    return GitRemoteTokenManager.readLocalDevConfigValue(appId, 'GITHUB_TOKEN');
  }

  /**
   * Resolve token from all sources and build the provider-specific credential URL.
   * Shared by both configureGitCredentials and writeCredentialFile.
   */
  private resolveCredentialUrl(appId: string, repoUrl: string, token?: string): { credentialUrl: string; providerName: string } {
    let effectiveToken = token;
    if (!effectiveToken) {
      const nomadConfig = getNomadAllocConfig();
      effectiveToken = nomadConfig?.GITHUB_TOKEN?.VALUE as string | undefined;
    }
    if (!effectiveToken && appId) {
      effectiveToken = this.readLocalDevToken(appId);
    }

    if (!effectiveToken) {
      throw new Error('GitHub token not provided in request and not found in config. Please provide token in request body or configure via secrets API.');
    }

    const provider = GitProviderFactory.getProvider(repoUrl);
    const hostname = provider.getHostname(repoUrl);
    const credentialUrl = this.buildCredentialUrl(provider.name, hostname, effectiveToken);

    return { credentialUrl, providerName: provider.name };
  }

  private buildCredentialScript(providerName: string, credentialUrl: string): string {
    return `
      set -e
      echo "${credentialUrl}" > /tmp/.git-credentials
      chmod 600 /tmp/.git-credentials
      git config --local credential.helper "store --file=/tmp/.git-credentials"
      echo "Git credentials configured for ${providerName}"
    `;
  }

  private buildCredentialUrl(providerName: string, hostname: string, token: string): string {
    switch (providerName) {
      case 'github':
        return `https://x-access-token:${token}@${hostname}`;
      case 'gitlab':
        return `https://oauth2:${token}@${hostname}`;
      case 'bitbucket':
        return `https://${token}@${hostname}`;
      default:
        throw new Error(`Unsupported provider: ${providerName}`);
    }
  }
}
