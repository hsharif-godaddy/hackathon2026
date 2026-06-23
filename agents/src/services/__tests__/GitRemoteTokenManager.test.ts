import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(function () { return false; }),
  readFileSync: vi.fn(function () { return '{}'; }),
}));

vi.mock('../git-providers/GitProviderFactory.js', () => ({
  GitProviderFactory: {
    getProvider: vi.fn(function () { return {
      name: 'github',
      getHostname: () => 'github.com',
    }; }),
  },
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../../utils/error.js', () => ({
  getErrorMessage: vi.fn(function (err: unknown) { return err instanceof Error ? err.message : String(err); }),
}));

vi.mock('../../utils/nomad-config.js', () => ({
  getNomadAllocConfig: vi.fn(function () { return null; }),
}));

import { existsSync, readFileSync } from 'node:fs';

import { getNomadAllocConfig } from '../../utils/nomad-config.js';
import { GitRemoteTokenManager } from '../GitRemoteTokenManager.js';

describe('GitRemoteTokenManager', () => {
  let manager: GitRemoteTokenManager;
  let mockTasks: { runCommandSync: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTasks = {
      runCommandSync: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'Git credentials configured successfully',
        stderr: '',
        timedOut: false,
        executionTimeMs: 50,
        taskId: 'test-task',
      }),
    };
    manager = new GitRemoteTokenManager(mockTasks as any);
  });

  describe('configureGitCredentials', () => {
    it('should pass workingDir /app to runCommandSync', async () => {
      await manager.configureGitCredentials('app-1', 'https://github.com/user/repo.git', 'ghp_token123');

      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(1);
      expect(mockTasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDir: '/app',
          timeoutSeconds: 300,
        })
      );
    });
  });

  describe('cleanupGitCredentials', () => {
    it('should pass workingDir /app to runCommandSync', async () => {
      await manager.cleanupGitCredentials('app-1');

      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(1);
      expect(mockTasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDir: '/app',
          timeoutSeconds: 300,
        })
      );
    });
  });

  describe('local dev token fallback', function localDevTokenTests() {
    const repoUrl = 'https://github.com/user/repo.git';

    afterEach(() => {
      delete process.env.NOMAD_ALLOC_DIR;
      delete process.env.APPS_BASE_DIR;
    });

    it('reads token from local config when no token and no nomad config', async function readsLocal() {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        GITHUB_TOKEN: { VALUE: 'local-dev-token' },
      }));

      await manager.configureGitCredentials('app-1', repoUrl);

      expect(existsSync).toHaveBeenCalledWith(
        expect.stringContaining('app-1/local/preview/config.json')
      );
      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(1);
    });

    it('skips local config when NOMAD_ALLOC_DIR is set', async function skipsNomad() {
      process.env.NOMAD_ALLOC_DIR = '/alloc';

      await expect(
        manager.configureGitCredentials('app-1', repoUrl)
      ).rejects.toThrow('GitHub token not provided');

      expect(existsSync).not.toHaveBeenCalled();
    });

    it('rejects appId with forward slash', async function rejectsSlash() {
      await expect(
        manager.configureGitCredentials('../etc/passwd', repoUrl)
      ).rejects.toThrow('GitHub token not provided');

      expect(existsSync).not.toHaveBeenCalled();
    });

    it('rejects appId with backslash', async function rejectsBackslash() {
      await expect(
        manager.configureGitCredentials('app\\evil', repoUrl)
      ).rejects.toThrow('GitHub token not provided');

      expect(existsSync).not.toHaveBeenCalled();
    });

    it('rejects appId with dot-dot traversal', async function rejectsDotDot() {
      await expect(
        manager.configureGitCredentials('..', repoUrl)
      ).rejects.toThrow('GitHub token not provided');

      expect(existsSync).not.toHaveBeenCalled();
    });

    it('returns undefined when config file does not exist', async function noFile() {
      vi.mocked(existsSync).mockReturnValue(false);

      await expect(
        manager.configureGitCredentials('app-1', repoUrl)
      ).rejects.toThrow('GitHub token not provided');
    });

    it('returns undefined when config JSON is malformed', async function malformed() {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('not json');

      await expect(
        manager.configureGitCredentials('app-1', repoUrl)
      ).rejects.toThrow('GitHub token not provided');
    });

    it('returns undefined when GITHUB_TOKEN.VALUE is not a string', async function notString() {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        GITHUB_TOKEN: { VALUE: 12345 },
      }));

      await expect(
        manager.configureGitCredentials('app-1', repoUrl)
      ).rejects.toThrow('GitHub token not provided');
    });

    it('returns undefined when GITHUB_TOKEN.VALUE is empty string', async function emptyString() {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        GITHUB_TOKEN: { VALUE: '' },
      }));

      await expect(
        manager.configureGitCredentials('app-1', repoUrl)
      ).rejects.toThrow('GitHub token not provided');
    });

    it('uses APPS_BASE_DIR env var when set', async function usesBaseDir() {
      process.env.APPS_BASE_DIR = '/custom/base';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        GITHUB_TOKEN: { VALUE: 'custom-base-token' },
      }));

      await manager.configureGitCredentials('app-1', repoUrl);

      expect(existsSync).toHaveBeenCalledWith(
        '/custom/base/app-1/local/preview/config.json'
      );
    });
  });

  describe('writeCredentialFile', () => {
    it('writes credential file to /tmp with workingDir /tmp', async () => {
      await manager.writeCredentialFile('app-1', 'https://github.com/user/repo.git', 'ghp_token123');

      expect(mockTasks.runCommandSync).toHaveBeenCalledTimes(1);
      expect(mockTasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDir: '/tmp',
          timeoutSeconds: 30,
        })
      );
    });

    it('uses the same token resolution as configureGitCredentials', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        GITHUB_TOKEN: { VALUE: 'local-dev-token' },
      }));

      await manager.writeCredentialFile('app-1', 'https://github.com/user/repo.git');

      const command = mockTasks.runCommandSync.mock.calls[0][0].command as string;
      expect(command).toContain('local-dev-token');
    });

    it('prefers directly provided token over config sources', async () => {
      vi.mocked(getNomadAllocConfig).mockReturnValue({
        GITHUB_TOKEN: { VALUE: 'nomad-token' },
      });

      await manager.writeCredentialFile('app-1', 'https://github.com/user/repo.git', 'direct-token');

      const command = mockTasks.runCommandSync.mock.calls[0][0].command as string;
      expect(command).toContain('direct-token');
      expect(command).not.toContain('nomad-token');
    });

    it('throws when no token is available', async () => {
      vi.mocked(getNomadAllocConfig).mockReturnValue(null);
      vi.mocked(existsSync).mockReturnValue(false);

      await expect(
        manager.writeCredentialFile('app-1', 'https://github.com/user/repo.git')
      ).rejects.toThrow('GitHub token not provided');
    });

    it('throws when command fails', async () => {
      mockTasks.runCommandSync.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'permission denied',
        timedOut: false,
        executionTimeMs: 10,
        taskId: 'test-task',
      });

      await expect(
        manager.writeCredentialFile('app-1', 'https://github.com/user/repo.git', 'ghp_token')
      ).rejects.toThrow('Credential file write failed: permission denied');
    });

    it('does not run git config --local (no .git required)', async () => {
      await manager.writeCredentialFile('app-1', 'https://github.com/user/repo.git', 'ghp_token');

      const command = mockTasks.runCommandSync.mock.calls[0][0].command as string;
      expect(command).not.toContain('git config');
    });
  });

  describe('isTokenExpired', function expiryTests() {
    afterEach(() => {
      delete process.env.NOMAD_ALLOC_DIR;
    });

    it('returns true when no expiry value exists', function noExpiry() {
      vi.mocked(getNomadAllocConfig).mockReturnValue(null);
      vi.mocked(existsSync).mockReturnValue(false);

      expect(GitRemoteTokenManager.isTokenExpired('app-1')).toBe(true);
    });

    it('returns true when expiry value is NaN', function nanExpiry() {
      vi.mocked(getNomadAllocConfig).mockReturnValue({
        GITHUB_TOKEN_EXPIRES_AT: { VALUE: 'not-a-number' },
      });

      expect(GitRemoteTokenManager.isTokenExpired('app-1')).toBe(true);
    });

    it('returns false when token is still valid beyond buffer', function valid() {
      const futureEpoch = Math.floor(Date.now() / 1000) + 600;
      vi.mocked(getNomadAllocConfig).mockReturnValue({
        GITHUB_TOKEN_EXPIRES_AT: { VALUE: String(futureEpoch) },
      });

      expect(GitRemoteTokenManager.isTokenExpired('app-1')).toBe(false);
    });

    it('returns true when token expires within 300s buffer', function withinBuffer() {
      const nearFuture = Math.floor(Date.now() / 1000) + 100;
      vi.mocked(getNomadAllocConfig).mockReturnValue({
        GITHUB_TOKEN_EXPIRES_AT: { VALUE: String(nearFuture) },
      });

      expect(GitRemoteTokenManager.isTokenExpired('app-1')).toBe(true);
    });

    it('handles numeric VALUE from nomad config', function numericValue() {
      const futureEpoch = Math.floor(Date.now() / 1000) + 600;
      vi.mocked(getNomadAllocConfig).mockReturnValue({
        GITHUB_TOKEN_EXPIRES_AT: { VALUE: futureEpoch as unknown as string },
      });

      expect(GitRemoteTokenManager.isTokenExpired('app-1')).toBe(false);
    });

    it('reads from local dev config when nomad config returns null', function localDev() {
      vi.mocked(getNomadAllocConfig).mockReturnValue(null);
      vi.mocked(existsSync).mockReturnValue(true);
      const futureEpoch = Math.floor(Date.now() / 1000) + 600;
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        GITHUB_TOKEN_EXPIRES_AT: { VALUE: String(futureEpoch) },
      }));

      expect(GitRemoteTokenManager.isTokenExpired('app-1')).toBe(false);
    });
  });
});
