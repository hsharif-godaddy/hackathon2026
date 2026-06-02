import { describe, it, expect, beforeEach, vi } from 'vitest';

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
});
