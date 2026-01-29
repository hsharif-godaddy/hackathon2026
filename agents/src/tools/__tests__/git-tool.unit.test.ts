/**
 * Git Tool Unit Tests
 *
 * Tests for GitTool pattern validation and helper methods.
 * These tests focus on the PaaS vs AiroAppBuilder pattern detection logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitTool } from '../git-tool.js';

// Mock dependencies
vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(() => ({
    isGitRepository: vi.fn().mockResolvedValue(true),
    getStatus: vi.fn().mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      isClean: true,
      stagedFiles: 0,
      modifiedFiles: 0,
      untrackedFiles: 0
    }),
    hasRemote: vi.fn().mockResolvedValue(false),
    addRemote: vi.fn().mockResolvedValue({ success: true }),
    getRemoteUrl: vi.fn().mockResolvedValue('https://github.com/user/repo.git'),
    setRemoteUrl: vi.fn().mockResolvedValue({ success: true }),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    pull: vi.fn().mockResolvedValue({ success: true, stdout: 'Already up to date.' }),
    push: vi.fn().mockResolvedValue({ success: true, stdout: 'Everything up-to-date' })
  }))
}));

vi.mock('../../database/repositories/GitRemoteConfigRepository.js', () => ({
  GitRemoteConfigRepository: vi.fn().mockImplementation(() => ({
    findByAppAndRemote: vi.fn(),
    update: vi.fn()
  }))
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn()
  }))
}));

vi.mock('../../services/GitRemoteTokenManager.js', () => ({
  GitRemoteTokenManager: vi.fn().mockImplementation(() => ({
    configureGitCredentials: vi.fn().mockResolvedValue(undefined),
    cleanupGitCredentials: vi.fn().mockResolvedValue(undefined)
  }))
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}));

vi.mock('../../logging/events/index.js', () => ({
  toolGitEvents: {
    begin: vi.fn(),
    success: vi.fn(),
    failure: vi.fn()
  }
}));

// Create mock DevSupervisorClient
const createMockDevSupervisor = () => ({
  isAvailable: vi.fn().mockReturnValue(true),
  exec: vi.fn().mockResolvedValue({
    success: true,
    exit_code: 0,
    stdout: '',
    stderr: ''
  })
});

describe('GitTool', () => {
  let gitTool: GitTool;
  let mockDevSupervisor: ReturnType<typeof createMockDevSupervisor>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevSupervisor = createMockDevSupervisor();
    gitTool = new GitTool(mockDevSupervisor as any);
  });

  describe('Pattern Parameter Validation', () => {
    describe('push operation', () => {
      it('should return error when only token is provided without repoUrl', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'push',
          token: 'ghp_test_token'
          // repoUrl is missing
        });

        expect(result.success).toBe(false);
        expect(result.operation).toBe('push');
        expect(result.error).toContain('Incomplete PaaS parameters');
        expect(result.error).toContain("'token' was provided but 'repoUrl' is missing");
        expect(result.error).toContain('For PaaS pattern, both');
      });

      it('should return error when only repoUrl is provided without token', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'push',
          repoUrl: 'https://github.com/user/repo.git'
          // token is missing
        });

        expect(result.success).toBe(false);
        expect(result.operation).toBe('push');
        expect(result.error).toContain('Incomplete PaaS parameters');
        expect(result.error).toContain("'repoUrl' was provided but 'token' is missing");
        expect(result.error).toContain('For AiroAppBuilder pattern, omit both');
      });

      it('should proceed with PaaS pattern when both token and repoUrl are provided', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'push',
          token: 'ghp_test_token',
          repoUrl: 'https://github.com/user/repo.git'
        });

        // Should not fail with pattern validation error (error is undefined or doesn't contain the validation message)
        if (result.error) {
          expect(result.error).not.toContain('Incomplete PaaS parameters');
        }
      });

      it('should proceed with AAB pattern when neither token nor repoUrl are provided', async () => {
        // Mock the repository to return a config for AAB pattern
        const { GitRemoteConfigRepository } = await import('../../database/repositories/GitRemoteConfigRepository.js');
        const mockRepo = vi.mocked(GitRemoteConfigRepository).mock.results[0]?.value;
        if (mockRepo) {
          mockRepo.findByAppAndRemote.mockReturnValue({
            id: 1,
            appId: 'test-app-id',
            remoteName: 'origin',
            provider: 'github',
            repoUrl: 'https://github.com/user/repo.git',
            defaultBranch: 'main',
            syncEnabled: true
          });
        }

        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'push'
          // Neither token nor repoUrl provided - AAB pattern
        });

        // Should not fail with pattern validation error (error is undefined or doesn't contain the validation message)
        if (result.error) {
          expect(result.error).not.toContain('Incomplete PaaS parameters');
        }
      });
    });

    describe('pull operation', () => {
      it('should return error when only token is provided without repoUrl', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'pull',
          token: 'ghp_test_token'
          // repoUrl is missing
        });

        expect(result.success).toBe(false);
        expect(result.operation).toBe('pull');
        expect(result.error).toContain('Incomplete PaaS parameters');
        expect(result.error).toContain("'token' was provided but 'repoUrl' is missing");
      });

      it('should return error when only repoUrl is provided without token', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'pull',
          repoUrl: 'https://github.com/user/repo.git'
          // token is missing
        });

        expect(result.success).toBe(false);
        expect(result.operation).toBe('pull');
        expect(result.error).toContain('Incomplete PaaS parameters');
        expect(result.error).toContain("'repoUrl' was provided but 'token' is missing");
      });

      it('should proceed with PaaS pattern when both token and repoUrl are provided', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'pull',
          token: 'ghp_test_token',
          repoUrl: 'https://github.com/user/repo.git'
        });

        // Should not fail with pattern validation error (error is undefined or doesn't contain the validation message)
        if (result.error) {
          expect(result.error).not.toContain('Incomplete PaaS parameters');
        }
      });

      it('should proceed with AAB pattern when neither token nor repoUrl are provided', async () => {
        // Mock the repository to return a config for AAB pattern
        const { GitRemoteConfigRepository } = await import('../../database/repositories/GitRemoteConfigRepository.js');
        const mockRepo = vi.mocked(GitRemoteConfigRepository).mock.results[0]?.value;
        if (mockRepo) {
          mockRepo.findByAppAndRemote.mockReturnValue({
            id: 1,
            appId: 'test-app-id',
            remoteName: 'origin',
            provider: 'github',
            repoUrl: 'https://github.com/user/repo.git',
            defaultBranch: 'main',
            syncEnabled: true
          });
        }

        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'pull'
          // Neither token nor repoUrl provided - AAB pattern
        });

        // Should not fail with pattern validation error (error is undefined or doesn't contain the validation message)
        if (result.error) {
          expect(result.error).not.toContain('Incomplete PaaS parameters');
        }
      });
    });
  });

  describe('App ID Extraction', () => {
    it('should extract app ID from standard path format', async () => {
      const result = await gitTool.executeGitOperation('/tmp/apps/c95338db-9a67-4216-a286-cf202d169ad9/app', {
        operation: 'status'
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('status');
    });

    it('should return error when app ID cannot be extracted', async () => {
      const result = await gitTool.executeGitOperation('/invalid/path', {
        operation: 'push',
        token: 'ghp_test',
        repoUrl: 'https://github.com/user/repo.git'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not extract app ID from path');
    });
  });

  describe('Remote Configuration Error Messages', () => {
    it('should provide clear error message when remote not configured for AAB pattern', async () => {
      // Mock empty repository response
      const { GitRemoteConfigRepository } = await import('../../database/repositories/GitRemoteConfigRepository.js');
      const mockRepo = vi.mocked(GitRemoteConfigRepository).mock.results[0]?.value;
      if (mockRepo) {
        mockRepo.findByAppAndRemote.mockReturnValue(null);
      }

      const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'push'
        // AAB pattern - no token/repoUrl
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Remote 'origin' not configured");
      expect(result.error).toContain('configure-remote');
      expect(result.error).toContain("'repoUrl' and 'token'");
    });

    it('should provide clear error message when remote is disabled', async () => {
      // Mock disabled remote config
      const { GitRemoteConfigRepository } = await import('../../database/repositories/GitRemoteConfigRepository.js');
      const mockRepo = vi.mocked(GitRemoteConfigRepository).mock.results[0]?.value;
      if (mockRepo) {
        mockRepo.findByAppAndRemote.mockReturnValue({
          id: 1,
          appId: 'test-app-id',
          remoteName: 'origin',
          provider: 'github',
          repoUrl: 'https://github.com/user/repo.git',
          defaultBranch: 'main',
          syncEnabled: false // Disabled
        });
      }

      const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'pull'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Remote 'origin' is disabled");
    });
  });

  describe('DevSupervisor Dependency', () => {
    it('should return error when GitRemoteTokenManager is not available', async () => {
      // Create GitTool without DevSupervisor
      const gitToolWithoutDevSupervisor = new GitTool();

      const result = await gitToolWithoutDevSupervisor.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'push',
        token: 'ghp_test',
        repoUrl: 'https://github.com/user/repo.git'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Git remote token manager not available');
      expect(result.error).toContain('Dev-supervisor is required');
    });
  });

  describe('Pull Options (allowUnrelatedHistories and noRebase)', () => {
    it('should pass allowUnrelatedHistories and noRebase to gitUtils.pull when specified', async () => {
      // Get the mocked GitUtils
      const { GitUtils } = await import('../../utils/git.js');
      const mockGitUtils = vi.mocked(GitUtils).mock.results[0]?.value;

      await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'pull',
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
        allowUnrelatedHistories: true,
        noRebase: true
      });

      // Verify pull was called with both options
      expect(mockGitUtils.pull).toHaveBeenCalledWith(
        '/tmp/apps/test-app-id/app',
        'origin',
        'main',
        {},
        'theirs',
        true, // allowUnrelatedHistories
        true  // noRebase
      );
    });

    it('should pass undefined for options when not specified', async () => {
      // Get the mocked GitUtils
      const { GitUtils } = await import('../../utils/git.js');
      const mockGitUtils = vi.mocked(GitUtils).mock.results[0]?.value;

      await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'pull',
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git'
        // options not specified - defaults to undefined
      });

      // Verify pull was called with undefined options
      expect(mockGitUtils.pull).toHaveBeenCalledWith(
        '/tmp/apps/test-app-id/app',
        'origin',
        'main',
        {},
        'theirs',
        undefined, // allowUnrelatedHistories not specified
        undefined  // noRebase not specified
      );
    });

    it('should pass false explicitly when options set to false', async () => {
      // Get the mocked GitUtils
      const { GitUtils } = await import('../../utils/git.js');
      const mockGitUtils = vi.mocked(GitUtils).mock.results[0]?.value;

      await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'pull',
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
        allowUnrelatedHistories: false,
        noRebase: false
      });

      // Verify pull was called with false options
      expect(mockGitUtils.pull).toHaveBeenCalledWith(
        '/tmp/apps/test-app-id/app',
        'origin',
        'main',
        {},
        'theirs',
        false, // allowUnrelatedHistories explicitly false
        false  // noRebase explicitly false
      );
    });

    it('should work with AAB pattern and pull options', async () => {
      // Mock the repository to return a config for AAB pattern
      const { GitRemoteConfigRepository } = await import('../../database/repositories/GitRemoteConfigRepository.js');
      const mockRepo = vi.mocked(GitRemoteConfigRepository).mock.results[0]?.value;
      if (mockRepo) {
        mockRepo.findByAppAndRemote.mockReturnValue({
          id: 1,
          appId: 'test-app-id',
          remoteName: 'origin',
          provider: 'github',
          repoUrl: 'https://github.com/user/repo.git',
          defaultBranch: 'main',
          syncEnabled: true
        });
      }

      // Get the mocked GitUtils
      const { GitUtils } = await import('../../utils/git.js');
      const mockGitUtils = vi.mocked(GitUtils).mock.results[0]?.value;

      await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'pull',
        allowUnrelatedHistories: true,
        noRebase: true
        // AAB pattern - no token/repoUrl
      });

      // Verify pull was called with both options
      expect(mockGitUtils.pull).toHaveBeenCalledWith(
        '/tmp/apps/test-app-id/app',
        'origin',
        'main',
        {},
        'theirs',
        true, // allowUnrelatedHistories
        true  // noRebase
      );
    });
  });
});
