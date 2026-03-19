import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies — factories cannot reference outer variables (hoisted)
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
  })),
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn(),
  },
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(() => ({
    isGitRepository: vi.fn(),
    getCurrentBranch: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    reset: vi.fn(),
    addFiles: vi.fn(),
    commit: vi.fn(),
    createBranch: vi.fn(),
    switchBranch: vi.fn(),
    squashMerge: vi.fn(),
    getCurrentCommit: vi.fn(),
    getTreeHash: vi.fn(),
    resolveCommitHash: vi.fn(),
    commitTree: vi.fn(),
    updateRef: vi.fn(),
    getCommitHistory: vi.fn(),
    cleanupOldBranches: vi.fn(),
  })),
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { GitHookService } from '../git-hook-service.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { GitUtils } from '../../utils/git.js';

const TEST_APP_ID = 'test-app-1';
const TEST_APP_PATH = '/app';
const TEST_APP = { id: TEST_APP_ID, path: TEST_APP_PATH };

describe('GitHookService', () => {
  let service: GitHookService;
  let appRepoMock: { findById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitHookService();

    // Set up AppRepository mock
    appRepoMock = vi.mocked(AppRepository).mock.results.at(-1)?.value as typeof appRepoMock;
    appRepoMock.findById.mockReturnValue(TEST_APP);

    // Set up DevSupervisorClientFactory mock
    // Default: setup already complete (most tests don't care about setup coordination)
    vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue({
      getSetupStatus: vi.fn().mockResolvedValue({
        setup_configured: true,
        setup_deferred: false,
        setup_executed: true,
        setup_running: false,
        setup_error: null,
      }),
      executeSetup: vi.fn().mockResolvedValue({ status: 'already_executed' }),
    } as never);
  });

  describe('branch safety check', () => {
    function createDevSupervisorMock() {
      const mock = {
        getSetupStatus: vi.fn().mockResolvedValue({
          setup_configured: true,
          setup_deferred: false,
          setup_executed: true,
          setup_running: false,
          setup_error: null,
        }),
        executeSetup: vi.fn().mockResolvedValue({ status: 'already_executed' }),
      };
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mock as never);
      return mock;
    }

    function createGitMock(currentBranch: string) {
      const mockImpl = {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getCurrentBranch: vi.fn().mockResolvedValue(currentBranch),
        hasUncommittedChanges: vi.fn().mockResolvedValue(false),
        reset: vi.fn().mockResolvedValue(undefined),
        addFiles: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        switchBranch: vi.fn().mockResolvedValue(undefined),
        squashMerge: vi.fn().mockResolvedValue(undefined),
        getCurrentCommit: vi.fn().mockResolvedValue('mock-commit-hash'),
        getCommitHistory: vi.fn().mockResolvedValue([]),
        cleanupOldBranches: vi.fn().mockResolvedValue({ needed: false, deleted: 0, failed: [], gcPerformed: false }),
      };
      vi.mocked(GitUtils).mockImplementation(() => mockImpl as unknown as GitUtils);
      return mockImpl;
    }

    it('switches to main when on unexpected branch', async () => {
      createDevSupervisorMock();
      const gitMock = createGitMock('some-leftover-branch');

      await service.handleMessageStart(TEST_APP_ID);

      expect(gitMock.switchBranch).toHaveBeenCalledWith(TEST_APP_PATH, 'main');
      // Should still create feature branch after switching
      expect(gitMock.createBranch).toHaveBeenCalled();
      // Should track the new branch (stale tracking cleared, new branch set)
      const branchInfo = service.getAppBranch(TEST_APP_ID);
      expect(branchInfo).toBeDefined();
      expect(branchInfo!.branchName).not.toBe('some-leftover-branch');
    });

    it('resets working tree before switching from unexpected branch', async () => {
      createDevSupervisorMock();
      const gitMock = createGitMock('some-leftover-branch');

      await service.handleMessageStart(TEST_APP_ID);

      // Must reset --hard before switchBranch — dirty working tree from
      // a crashed tool call would cause git checkout to refuse
      expect(gitMock.reset).toHaveBeenCalledWith(TEST_APP_PATH, { mode: 'hard' });

      // Verify ordering: reset before switch
      const resetOrder = gitMock.reset.mock.invocationCallOrder[0];
      const switchOrder = gitMock.switchBranch.mock.invocationCallOrder[0];
      expect(resetOrder).toBeLessThan(switchOrder);
    });

    it('does not switch when already on main', async () => {
      createDevSupervisorMock();
      const gitMock = createGitMock('main');

      await service.handleMessageStart(TEST_APP_ID);

      // Should not switch branches — already on main
      expect(gitMock.switchBranch).not.toHaveBeenCalled();
      // Should create feature branch
      expect(gitMock.createBranch).toHaveBeenCalled();
    });

    it('continues on tracked feature branch without switching', async () => {
      createDevSupervisorMock();
      const gitMock = createGitMock('main');

      // First call: creates feature branch
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1');

      // Get the branch name that was created
      const branchInfo = service.getAppBranch(TEST_APP_ID);
      expect(branchInfo).toBeDefined();

      // Mock getCurrentBranch to return the tracked branch
      gitMock.getCurrentBranch.mockResolvedValue(branchInfo!.branchName);

      // Second call: should continue on existing branch
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1', 'user prompt');

      // Should not switch or create a new branch
      expect(gitMock.createBranch).toHaveBeenCalledTimes(1); // Only from first call
    });
  });

  describe('setup coordination', () => {
    function createDevSupervisorMock(setupStatus: {
      setup_configured?: boolean;
      setup_deferred?: boolean;
      setup_executed?: boolean;
      setup_running?: boolean;
      setup_error?: string | null;
    }) {
      const mock = {
        getSetupStatus: vi.fn().mockResolvedValue({
          setup_configured: setupStatus.setup_configured ?? true,
          setup_deferred: setupStatus.setup_deferred ?? false,
          setup_executed: setupStatus.setup_executed ?? true,
          setup_running: setupStatus.setup_running ?? false,
          setup_error: setupStatus.setup_error ?? null,
        }),
        executeSetup: vi.fn().mockResolvedValue({ status: 'executed' }),
      };
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mock as never);
      return mock;
    }

    function createGitMock(currentBranch = 'main') {
      const mockImpl = {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getCurrentBranch: vi.fn().mockResolvedValue(currentBranch),
        hasUncommittedChanges: vi.fn().mockResolvedValue(false),
        reset: vi.fn().mockResolvedValue(undefined),
        addFiles: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        createBranch: vi.fn().mockResolvedValue(undefined),
        switchBranch: vi.fn().mockResolvedValue(undefined),
        squashMerge: vi.fn().mockResolvedValue(undefined),
        getCurrentCommit: vi.fn().mockResolvedValue('mock-commit-hash'),
        getTreeHash: vi.fn().mockResolvedValue('tree-hash'),
        resolveCommitHash: vi.fn().mockResolvedValue('commit-hash'),
        commitTree: vi.fn().mockResolvedValue({ success: true, stdout: 'hash\n', stderr: '' }),
        updateRef: vi.fn().mockResolvedValue(undefined),
        getCommitHistory: vi.fn().mockResolvedValue([]),
        cleanupOldBranches: vi.fn().mockResolvedValue({ needed: false, deleted: 0, failed: [], gcPerformed: false }),
      };
      vi.mocked(GitUtils).mockImplementation(() => mockImpl as unknown as GitUtils);
      return mockImpl;
    }

    it('triggers setup and skips git ops when setup is deferred and not executed', async () => {
      const dsMock = createDevSupervisorMock({
        setup_deferred: true,
        setup_executed: false,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(dsMock.getSetupStatus).toHaveBeenCalled();
      expect(dsMock.executeSetup).toHaveBeenCalled();
      // Git ops should be skipped
      expect(gitMock.isGitRepository).not.toHaveBeenCalled();
      expect(gitMock.createBranch).not.toHaveBeenCalled();
    });

    it('skips triggering setup when setup is already running', async () => {
      const dsMock = createDevSupervisorMock({
        setup_deferred: true,
        setup_executed: false,
        setup_running: true,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(dsMock.getSetupStatus).toHaveBeenCalled();
      expect(dsMock.executeSetup).not.toHaveBeenCalled();
      // Git ops should still be skipped
      expect(gitMock.isGitRepository).not.toHaveBeenCalled();
    });

    it('does not retry setup when setup_error is set', async () => {
      const dsMock = createDevSupervisorMock({
        setup_deferred: true,
        setup_executed: false,
        setup_error: 'npm install failed',
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(dsMock.getSetupStatus).toHaveBeenCalled();
      expect(dsMock.executeSetup).not.toHaveBeenCalled();
      // Git ops should still be skipped
      expect(gitMock.isGitRepository).not.toHaveBeenCalled();
    });

    it('proceeds with git ops when setup is not deferred', async () => {
      createDevSupervisorMock({
        setup_deferred: false,
        setup_executed: true,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(gitMock.isGitRepository).toHaveBeenCalled();
      expect(gitMock.createBranch).toHaveBeenCalled();
    });

    it('proceeds with git ops when deferred setup has already executed', async () => {
      createDevSupervisorMock({
        setup_deferred: true,
        setup_executed: true,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(gitMock.isGitRepository).toHaveBeenCalled();
      expect(gitMock.createBranch).toHaveBeenCalled();
    });

    it('proceeds with git ops when setup is not configured', async () => {
      createDevSupervisorMock({
        setup_configured: false,
        setup_deferred: false,
        setup_executed: false,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(gitMock.isGitRepository).toHaveBeenCalled();
      expect(gitMock.createBranch).toHaveBeenCalled();
    });

    it('falls through to git ops if getSetupStatus throws', async () => {
      const mock = {
        getSetupStatus: vi.fn().mockRejectedValue(new Error('connection refused')),
        executeSetup: vi.fn(),
      };
      vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue(mock as never);
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      // Inner try/catch around getSetupStatus catches the error and falls through.
      // Git ops should proceed normally.
      expect(mock.executeSetup).not.toHaveBeenCalled();
      expect(gitMock.isGitRepository).toHaveBeenCalled();
    });
  });
});
