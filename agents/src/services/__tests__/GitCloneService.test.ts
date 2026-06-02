import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitCloneService } from '../GitCloneService.js';
import { makeRunCommandResult } from '../../workspace/__tests__/mock-helpers.js';
import type { WorkspaceTasks } from '../../workspace/tasks.js';
import { ValidationErrorKey } from '../../types/import.js';

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () { return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }; }),
  },
}));

describe('GitCloneService', () => {
  let service: GitCloneService;
  let mockTasks: WorkspaceTasks;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitCloneService();
    mockTasks = {
      runCommandSync: vi.fn(),
    } as unknown as WorkspaceTasks;
  });

  describe('cloneRepository', () => {
    const baseParams = {
      appId: 'test-app',
      gitUrl: 'https://github.com/user/repo.git',
      gitToken: 'ghp_test_token_123',
    };

    it('should clone successfully and return commit hash', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      // mkdir
      mock.mockResolvedValueOnce(makeRunCommandResult());
      // git clone
      mock.mockResolvedValueOnce(makeRunCommandResult());
      // git rev-parse HEAD
      mock.mockResolvedValueOnce(makeRunCommandResult({ stdout: 'abc1234def5678\n' }));

      const result = await service.cloneRepository(mockTasks, baseParams);

      expect(result.success).toBe(true);
      expect(result.clonePath).toContain('/app/.import-git-');
      expect(result.commitHash).toBe('abc1234def5678');
    });

    it('should pass branch flag when gitBranch is specified', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult({ stdout: 'abc1234\n' }));

      await service.cloneRepository(mockTasks, { ...baseParams, gitBranch: 'develop' });

      const cloneCall = mock.mock.calls[1][0];
      expect(cloneCall.command).toContain('--branch "develop"');
    });

    it('should inject token into git URL', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult({ stdout: 'abc1234\n' }));

      await service.cloneRepository(mockTasks, baseParams);

      const cloneCall = mock.mock.calls[1][0];
      expect(cloneCall.command).toContain('ghp_test_token_123@github.com');
    });

    it('should return error when mkdir fails', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult({ exitCode: 1, stderr: 'Permission denied' }));

      const result = await service.cloneRepository(mockTasks, baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('create clone directory');
      expect(result.validationErrors?.[0]?.key).toBe(ValidationErrorKey.GIT_CLONE_FAILED);
    });

    it('should return auth error when clone fails with authentication error', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult({
        exitCode: 128,
        stderr: 'fatal: Authentication failed for https://github.com/user/repo.git',
      }));

      const result = await service.cloneRepository(mockTasks, baseParams);

      expect(result.success).toBe(false);
      expect(result.validationErrors?.[0]?.key).toBe(ValidationErrorKey.GIT_AUTH_FAILED);
    });

    it('should return repo-not-found error when repository does not exist', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult({
        exitCode: 128,
        stderr: 'fatal: repository not found',
      }));

      const result = await service.cloneRepository(mockTasks, baseParams);

      expect(result.success).toBe(false);
      expect(result.validationErrors?.[0]?.key).toBe(ValidationErrorKey.GIT_REPO_NOT_FOUND);
    });

    it('should return timeout error when clone times out', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult({
        exitCode: 1,
        stderr: 'fatal: unable to access: Operation timed out',
      }));

      const result = await service.cloneRepository(mockTasks, baseParams);

      expect(result.success).toBe(false);
      expect(result.validationErrors?.[0]?.key).toBe(ValidationErrorKey.GIT_CLONE_TIMEOUT);
    });

    it('should succeed even when rev-parse fails (commit hash is optional)', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult());
      // rev-parse fails
      mock.mockResolvedValueOnce(makeRunCommandResult({ exitCode: 1, stderr: 'not a git repo' }));

      const result = await service.cloneRepository(mockTasks, baseParams);

      expect(result.success).toBe(true);
      expect(result.commitHash).toBeUndefined();
    });

    it('should handle unexpected exceptions gracefully', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await service.cloneRepository(mockTasks, baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection lost');
      expect(result.validationErrors?.[0]?.key).toBe(ValidationErrorKey.GIT_CLONE_FAILED);
    });

    it('should use shallow clone (--depth 1 --single-branch)', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult({ stdout: 'abc\n' }));

      await service.cloneRepository(mockTasks, baseParams);

      const cloneCall = mock.mock.calls[1][0];
      expect(cloneCall.command).toContain('--depth 1');
      expect(cloneCall.command).toContain('--single-branch');
    });

    it('should return branch-not-found error when branch does not exist', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());
      mock.mockResolvedValueOnce(makeRunCommandResult({
        exitCode: 128,
        stderr: "fatal: Remote branch 'nonexistent' not found in upstream origin",
      }));

      const result = await service.cloneRepository(mockTasks, {
        ...baseParams,
        gitBranch: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Branch not found in repository.');
      expect(result.validationErrors?.[0]?.key).toBe(ValidationErrorKey.GIT_CLONE_FAILED);
    });

    it('should throw on SSH-form URLs (injectToken requires HTTPS)', async () => {
      const mock = mockTasks.runCommandSync as ReturnType<typeof vi.fn>;
      mock.mockResolvedValueOnce(makeRunCommandResult());

      const result = await service.cloneRepository(mockTasks, {
        ...baseParams,
        gitUrl: 'git@github.com:user/repo.git',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
      expect(result.validationErrors?.[0]?.key).toBe(ValidationErrorKey.GIT_CLONE_FAILED);
    });
  });
});
