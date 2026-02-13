import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { GitOpsService } from '../GitOpsService.js';
import { ImportJobStatus } from '../../types/import.js';

// Mock dependencies
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
  })),
}));

vi.mock('../../database/repositories/ImportJobRepository.js', () => ({
  ImportJobRepository: vi.fn().mockImplementation(() => ({
    findByAppId: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  })),
}));

vi.mock('../../tools/git-tool.js', () => ({
  GitTool: vi.fn().mockImplementation(() => ({
    executeGitOperation: vi.fn(),
  })),
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn(),
  },
}));

vi.mock('../../server/middleware/git-import-validation.js', () => ({
  isSupportedProjectOnHost: vi.fn(),
  matchesBuildToolOnHost: vi.fn(),
  SUPPORTED_BUILD_TOOLS: [{ name: 'vite' }, { name: 'nodejs' }],
}));

vi.mock('../AppRestartService.js', () => ({
  appRestartService: {
    performFullRestartCycle: vi.fn(),
  },
}));

vi.mock('../CodeSyncFileCleanupService.js', () => ({
  codeSyncFileCleanupService: {
    deleteCleanablePatterns: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../ViteConfigModifier.js', () => ({
  modifyViteConfig: vi.fn().mockResolvedValue({ modified: false }),
}));

vi.mock('../ExpressPortInjector.js', () => ({
  injectPortHandling: vi.fn().mockResolvedValue({ modified: false }),
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

// Import after mocks
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { ImportJobRepository } from '../../database/repositories/ImportJobRepository.js';
import { GitTool } from '../../tools/git-tool.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { isSupportedProjectOnHost, matchesBuildToolOnHost } from '../../server/middleware/git-import-validation.js';
import { appRestartService } from '../AppRestartService.js';

describe('GitOpsService', () => {
  let service: GitOpsService;
  let mockAppRepo: {
    findById: Mock;
  };
  let mockImportJobRepo: {
    findByAppId: Mock;
    findById: Mock;
    create: Mock;
    updateStatus: Mock;
    markCompleted: Mock;
    markFailed: Mock;
  };
  let mockGitTool: {
    executeGitOperation: Mock;
  };
  let mockDevSupervisor: {
    isAvailable: Mock;
  };

  const testAppId = 'test-app-123';
  const testAppPath = '/tmp/apps/test-app-123/app';
  const testJobId = 'job-456';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock instances
    mockAppRepo = {
      findById: vi.fn(),
    };

    mockImportJobRepo = {
      findByAppId: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
    };

    mockGitTool = {
      executeGitOperation: vi.fn(),
    };

    mockDevSupervisor = {
      isAvailable: vi.fn().mockReturnValue(true),
    };

    // Setup constructor mocks
    vi.mocked(AppRepository).mockImplementation(() => mockAppRepo as any);
    vi.mocked(ImportJobRepository).mockImplementation(() => mockImportJobRepo as any);
    vi.mocked(GitTool).mockImplementation(() => mockGitTool as any);
    vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mockDevSupervisor as any);

    // Default: app exists
    mockAppRepo.findById.mockReturnValue({ id: testAppId, path: testAppPath });

    // Default: no existing job
    mockImportJobRepo.findByAppId.mockResolvedValue(null);

    // Default: create job returns job object
    mockImportJobRepo.create.mockResolvedValue({
      id: testJobId,
      appId: testAppId,
      status: ImportJobStatus.PENDING,
    });

    // Default: project is supported (matchesBuildToolOnHost returns true for the first tool)
    vi.mocked(isSupportedProjectOnHost).mockReturnValue(true);
    vi.mocked(matchesBuildToolOnHost).mockReturnValue(true);

    service = new GitOpsService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('startPull', () => {
    it('should return error when app is not found', async () => {
      mockAppRepo.findById.mockReturnValue(null);

      const result = await service.startPull({ appId: testAppId });

      expect(result.success).toBe(false);
      expect(result.error).toBe('App not found');
      expect(result.errorCode).toBe('APP_NOT_FOUND');
    });

    it('should return error when container is not available', async () => {
      mockDevSupervisor.isAvailable.mockReturnValue(false);

      const result = await service.startPull({ appId: testAppId });

      expect(result.success).toBe(false);
      expect(result.error).toBe('App container is not available');
      expect(result.errorCode).toBe('CONTAINER_UNAVAILABLE');
    });

    it('should return error when job is already in progress', async () => {
      mockImportJobRepo.findByAppId.mockResolvedValue({
        id: 'existing-job',
        status: ImportJobStatus.PULLING,
      });

      const result = await service.startPull({ appId: testAppId });

      expect(result.success).toBe(false);
      expect(result.error).toBe('An import or sync operation is already in progress');
      expect(result.errorCode).toBe('JOB_IN_PROGRESS');
      expect(result.existingJobId).toBe('existing-job');
    });

    it('should return error when token provided without repoUrl', async () => {
      const result = await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Provide both token and repoUrl');
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    });

    it('should return error when repoUrl provided without token', async () => {
      const result = await service.startPull({
        appId: testAppId,
        repoUrl: 'https://github.com/user/repo.git',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Provide both token and repoUrl');
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    });

    it('should successfully start pull and return job ID', async () => {
      const result = await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      expect(result.success).toBe(true);
      expect(result.jobId).toBe(testJobId);
      expect(result.status).toBe(ImportJobStatus.PENDING);
      expect(mockImportJobRepo.create).toHaveBeenCalledWith({
        appId: testAppId,
        sourceType: 'git_pull',
        gitBranch: undefined,
      });
    });
  });

  describe('executePullInBackground - commit after restart', () => {
    beforeEach(() => {
      // Setup successful pull
      mockGitTool.executeGitOperation.mockResolvedValue({
        success: true,
        output: 'Pull successful',
      });

      // Setup successful restart
      vi.mocked(appRestartService.performFullRestartCycle).mockResolvedValue({
        success: true,
        phases: { install: true, build: true, restart: true },
      });
    });

    it('should commit changes after successful restart', async () => {
      // Start pull to trigger background execution
      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      // Run setImmediate callbacks
      await vi.runAllTimersAsync();

      // Verify git operations were called
      const gitCalls = mockGitTool.executeGitOperation.mock.calls;

      // Should have: pull, add, commit
      expect(gitCalls.length).toBeGreaterThanOrEqual(3);

      // Verify pull was called
      const pullCall = gitCalls.find((call) => call[1].operation === 'pull');
      expect(pullCall).toBeDefined();
      expect(pullCall[1].allowUnrelatedHistories).toBe(true);
      expect(pullCall[1].noRebase).toBe(true);

      // Verify add was called with '.'
      const addCall = gitCalls.find((call) => call[1].operation === 'add');
      expect(addCall).toBeDefined();
      expect(addCall[1].files).toEqual(['.']);

      // Verify commit was called with correct message
      const commitCall = gitCalls.find((call) => call[1].operation === 'commit');
      expect(commitCall).toBeDefined();
      expect(commitCall[1].message).toBe('Post-pull state commit');
    });

    it('should NOT commit when restart fails and should mark job as FAILED', async () => {
      // Setup failed restart
      vi.mocked(appRestartService.performFullRestartCycle).mockResolvedValue({
        success: false,
        error: 'npm install failed: ENOENT',
        phases: { install: false, build: false, restart: false },
      });

      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      await vi.runAllTimersAsync();

      // Verify git operations
      const gitCalls = mockGitTool.executeGitOperation.mock.calls;

      // Should only have pull, NOT add or commit
      const pullCall = gitCalls.find((call) => call[1].operation === 'pull');
      expect(pullCall).toBeDefined();

      const addCall = gitCalls.find((call) => call[1].operation === 'add');
      expect(addCall).toBeUndefined();

      const commitCall = gitCalls.find((call) => call[1].operation === 'commit');
      expect(commitCall).toBeUndefined();

      // CRITICAL: Verify job is marked as FAILED, not COMPLETED
      expect(mockImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        'npm install failed: ENOENT',
        'restarting'
      );
      expect(mockImportJobRepo.markCompleted).not.toHaveBeenCalled();
    });

    it('should use fallback error message when restart fails without error details', async () => {
      // Setup failed restart without error message
      vi.mocked(appRestartService.performFullRestartCycle).mockResolvedValue({
        success: false,
        // No error message provided
        phases: { install: true, build: false, restart: false },
      });

      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      await vi.runAllTimersAsync();

      // Verify job is marked as FAILED with fallback message
      expect(mockImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        'Restart failed after git pull',
        'restarting'
      );
      expect(mockImportJobRepo.markCompleted).not.toHaveBeenCalled();
    });

    it('should NOT commit when pull fails', async () => {
      // Setup failed pull
      mockGitTool.executeGitOperation.mockResolvedValue({
        success: false,
        error: 'Pull failed - merge conflict',
      });

      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      await vi.runAllTimersAsync();

      // Verify restart was NOT called
      expect(appRestartService.performFullRestartCycle).not.toHaveBeenCalled();

      // Verify job was marked as failed
      expect(mockImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        'Pull failed - merge conflict',
        'pulling'
      );
    });

    it('should handle git add failure gracefully', async () => {
      // Setup: pull succeeds, restart succeeds, add fails
      mockGitTool.executeGitOperation
        .mockResolvedValueOnce({ success: true, output: 'Pull successful' }) // pull
        .mockResolvedValueOnce({ success: false, error: 'Add failed' }); // add

      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      await vi.runAllTimersAsync();

      // Should still complete successfully (add failure is not critical)
      expect(mockImportJobRepo.markCompleted).toHaveBeenCalledWith(testJobId);

      // Commit should NOT be called since add failed
      const gitCalls = mockGitTool.executeGitOperation.mock.calls;
      const commitCall = gitCalls.find((call) => call[1].operation === 'commit');
      expect(commitCall).toBeUndefined();
    });

    it('should handle commit failure gracefully (nothing to commit)', async () => {
      // Setup: pull succeeds, restart succeeds, add succeeds, commit fails
      mockGitTool.executeGitOperation
        .mockResolvedValueOnce({ success: true, output: 'Pull successful' }) // pull
        .mockResolvedValueOnce({ success: true, output: 'Add successful' }) // add
        .mockResolvedValueOnce({ success: false, error: 'nothing to commit, working tree clean' }); // commit

      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      await vi.runAllTimersAsync();

      // Should still complete successfully (commit failure due to no changes is expected)
      expect(mockImportJobRepo.markCompleted).toHaveBeenCalledWith(testJobId);
    });

    it('should handle unexpected exceptions in commit gracefully (non-blocking)', async () => {
      // Setup: pull succeeds, restart succeeds, add throws exception
      mockGitTool.executeGitOperation
        .mockResolvedValueOnce({ success: true, output: 'Pull successful' }) // pull
        .mockRejectedValueOnce(new Error('Unexpected git error')); // add throws

      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      await vi.runAllTimersAsync();

      // Should still complete successfully - commit errors are non-blocking
      expect(mockImportJobRepo.markCompleted).toHaveBeenCalledWith(testJobId);
    });

    it('should handle git user configuration errors gracefully', async () => {
      // Setup: pull succeeds, restart succeeds, add succeeds, commit fails with git config error
      // This tests the scenario where git user.name/user.email is not configured in the container
      mockGitTool.executeGitOperation
        .mockResolvedValueOnce({ success: true, output: 'Pull successful' }) // pull
        .mockResolvedValueOnce({ success: true, output: 'Add successful' }) // add
        .mockResolvedValueOnce({
          success: false,
          error: "Author identity unknown: Please tell me who you are. Run git config --global user.email 'you@example.com' git config --global user.name 'Your Name'",
        }); // commit fails with config error

      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      await vi.runAllTimersAsync();

      // Should still complete successfully - commit failure due to config is non-blocking
      // The GitUtils.attemptGitRecovery handles this internally and the commit method
      // in commitPostPulledChanges treats failures gracefully
      expect(mockImportJobRepo.markCompleted).toHaveBeenCalledWith(testJobId);
    });

    it('should rollback and fail when project is unsupported', async () => {
      vi.mocked(matchesBuildToolOnHost).mockReturnValue(false);

      // Setup reset for rollback
      mockGitTool.executeGitOperation
        .mockResolvedValueOnce({ success: true, output: 'Pull successful' }) // pull
        .mockResolvedValueOnce({ success: true, output: 'Reset successful' }); // reset (rollback)

      await service.startPull({
        appId: testAppId,
        token: 'ghp_test_token',
        repoUrl: 'https://github.com/user/repo.git',
      });

      await vi.runAllTimersAsync();

      // Verify rollback was called
      const gitCalls = mockGitTool.executeGitOperation.mock.calls;
      const resetCall = gitCalls.find((call) => call[1].operation === 'reset');
      expect(resetCall).toBeDefined();
      expect(resetCall[1].options).toEqual({ mode: 'hard', hash: 'ORIG_HEAD' });

      // Verify job was marked as failed
      expect(mockImportJobRepo.markFailed).toHaveBeenCalledWith(
        testJobId,
        expect.stringContaining('Unsupported project'),
        'pulling'
      );

      // Verify restart was NOT called
      expect(appRestartService.performFullRestartCycle).not.toHaveBeenCalled();
    });
  });

  describe('getJobStatus', () => {
    it('should return job status successfully', async () => {
      const mockJob = {
        id: testJobId,
        appId: testAppId,
        status: ImportJobStatus.COMPLETED,
        sourceType: 'git_pull',
      };
      mockImportJobRepo.findById.mockResolvedValue(mockJob);

      const result = await service.getJobStatus(testAppId, testJobId);

      expect(result.success).toBe(true);
      expect(result.job).toEqual(mockJob);
    });

    it('should return error when job is not found', async () => {
      mockImportJobRepo.findById.mockResolvedValue(null);

      const result = await service.getJobStatus(testAppId, testJobId);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('JOB_NOT_FOUND');
    });

    it('should return error when job belongs to different app', async () => {
      mockImportJobRepo.findById.mockResolvedValue({
        id: testJobId,
        appId: 'different-app-id',
        status: ImportJobStatus.COMPLETED,
      });

      const result = await service.getJobStatus(testAppId, testJobId);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORBIDDEN');
    });
  });
});
