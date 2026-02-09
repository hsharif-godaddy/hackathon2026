/**
 * Git Tool Unit Tests
 *
 * Tests for GitTool parameter resolution and helper methods.
 * Tests the priority-based resolution: options first, then database fallback.
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

  describe('Parameter Resolution (options first, then database fallback)', () => {
    describe('push operation', () => {
      it('should use token from options when provided (without repoUrl falls back to DB)', async () => {
        // When only token is provided, repoUrl comes from database
        const { GitRemoteConfigRepository } = await import('../../database/repositories/GitRemoteConfigRepository.js');
        const mockRepo = vi.mocked(GitRemoteConfigRepository).mock.results[0]?.value;
        if (mockRepo) {
          mockRepo.findByAppAndRemote.mockReturnValue(null); // No DB config
        }

        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'push',
          token: 'ghp_test_token'
          // repoUrl not provided - falls back to DB (which returns null)
        });

        // Should fail because no repoUrl in options AND no DB config
        expect(result.success).toBe(false);
        expect(result.operation).toBe('push');
        expect(result.error).toContain("Remote 'origin' not configured");
      });

      it('should use repoUrl from options and token from config when only repoUrl provided', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'push',
          repoUrl: 'https://github.com/user/repo.git'
          // token not provided - falls back to /alloc/config.json via GitRemoteTokenManager
        });

        // Should proceed (token resolved from config.json by GitRemoteTokenManager)
        // The actual push may fail if config.json doesn't have token, but validation passes
        expect(result.operation).toBe('push');
      });

      it('should use both token and repoUrl from options when provided', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'push',
          token: 'ghp_test_token',
          repoUrl: 'https://github.com/user/repo.git'
        });

        // Should proceed without DB lookup
        expect(result.operation).toBe('push');
      });

      it('should fall back to database config when neither token nor repoUrl provided', async () => {
        // Mock the repository to return a config
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
          // Neither token nor repoUrl provided - uses database
        });

        expect(result.operation).toBe('push');
      });
    });

    describe('pull operation', () => {
      it('should use token from options when provided (without repoUrl falls back to DB)', async () => {
        // When only token is provided, repoUrl comes from database
        const { GitRemoteConfigRepository } = await import('../../database/repositories/GitRemoteConfigRepository.js');
        const mockRepo = vi.mocked(GitRemoteConfigRepository).mock.results[0]?.value;
        if (mockRepo) {
          mockRepo.findByAppAndRemote.mockReturnValue(null); // No DB config
        }

        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'pull',
          token: 'ghp_test_token'
          // repoUrl not provided - falls back to DB (which returns null)
        });

        // Should fail because no repoUrl in options AND no DB config
        expect(result.success).toBe(false);
        expect(result.operation).toBe('pull');
        expect(result.error).toContain("Remote 'origin' not configured");
      });

      it('should use repoUrl from options and token from config when only repoUrl provided', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'pull',
          repoUrl: 'https://github.com/user/repo.git'
          // token not provided - falls back to /alloc/config.json via GitRemoteTokenManager
        });

        // Should proceed (token resolved from config.json by GitRemoteTokenManager)
        expect(result.operation).toBe('pull');
      });

      it('should use both token and repoUrl from options when provided', async () => {
        const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
          operation: 'pull',
          token: 'ghp_test_token',
          repoUrl: 'https://github.com/user/repo.git'
        });

        // Should proceed without DB lookup
        expect(result.operation).toBe('pull');
      });

      it('should fall back to database config when neither token nor repoUrl provided', async () => {
        // Mock the repository to return a config
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
          // Neither token nor repoUrl provided - uses database
        });

        expect(result.operation).toBe('pull');
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
    it('should provide clear error message when remote not configured and no repoUrl provided', async () => {
      // Mock empty repository response
      const { GitRemoteConfigRepository } = await import('../../database/repositories/GitRemoteConfigRepository.js');
      const mockRepo = vi.mocked(GitRemoteConfigRepository).mock.results[0]?.value;
      if (mockRepo) {
        mockRepo.findByAppAndRemote.mockReturnValue(null);
      }

      const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'push'
        // No repoUrl provided - must fall back to DB which returns null
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Remote 'origin' not configured");
      expect(result.error).toContain('configure-remote');
      expect(result.error).toContain("'repoUrl'");
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

  describe('Commit Operation - Clean Working Tree', () => {
    it('should return success when working tree is clean (idempotent commit)', async () => {
      // Default mock already returns isClean: true
      const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'commit',
        message: 'Test commit message'
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('commit');
      expect(result.output).toBe('Nothing to commit, working tree clean');
    });

    it('should proceed with commit when working tree has changes', async () => {
      // Get the mocked GitUtils and override getStatus to return dirty state
      const { GitUtils } = await import('../../utils/git.js');
      const mockGitUtils = vi.mocked(GitUtils).mock.results[0]?.value;

      // Mock dirty working tree
      mockGitUtils.getStatus.mockResolvedValueOnce({
        branch: 'main',
        ahead: 0,
        behind: 0,
        isClean: false,
        hasChanges: true,
        stagedFiles: 1,
        modifiedFiles: 1,
        untrackedFiles: 0
      });

      // Mock successful commit
      mockGitUtils.commit = vi.fn().mockResolvedValueOnce({
        success: true,
        stdout: '[main abc1234] Test commit message',
        stderr: ''
      });

      const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'commit',
        message: 'Test commit message'
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('commit');
      expect(result.output).toBe('Committed: Test commit message');
      expect(mockGitUtils.commit).toHaveBeenCalledWith('/tmp/apps/test-app-id/app', 'Test commit message');
    });

    it('should return error when commit message is missing', async () => {
      const result = await gitTool.executeGitOperation('/tmp/apps/test-app-id/app', {
        operation: 'commit'
        // No message provided
      });

      expect(result.success).toBe(false);
      expect(result.operation).toBe('commit');
      expect(result.error).toBe('Commit message is required');
    });
  });
});
