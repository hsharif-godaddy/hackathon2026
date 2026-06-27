import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies — factories cannot reference outer variables (hoisted)
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn(),
  }; }),
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function () { return {
    isGitRepository: vi.fn(),
    getCurrentBranch: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    reset: vi.fn(),
    addFiles: vi.fn(),
    commit: vi.fn(),
    createBranch: vi.fn(),
    switchBranch: vi.fn(),
    squashMerge: vi.fn(),
    mergeNoFf: vi.fn(),
    getCurrentCommit: vi.fn(),
    getTreeHash: vi.fn(),
    resolveCommitHash: vi.fn(),
    commitTree: vi.fn(),
    updateRef: vi.fn(),
    getCommitHistory: vi.fn(),
    cleanupOldBranches: vi.fn(),
  }; }),
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockSetup = {
  getStatus: vi.fn(),
  execute: vi.fn(),
};

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: () => ({ tasks: {}, setup: mockSetup }),
}));

vi.mock('../../memory/adapters/index.js', () => ({
  getKvMemoryStore: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ success: true, exists: false }),
  }),
}));

vi.mock('../../memory/interfaces/scope.js', () => ({
  workspaceScopeFromAppId: vi.fn().mockReturnValue({ appId: 'test-app-1' }),
}));

// Import after mocks
import { GitHookService } from '../git-hook-service.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
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

    // Default: setup already complete (most tests don't care about setup coordination)
    mockSetup.getStatus.mockResolvedValue({
      configured: true,
      deferred: false,
      executed: true,
      running: false,
      error: null,
    });
    mockSetup.execute.mockResolvedValue('already_executed');
  });

  describe('branch safety check', () => {
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
        mergeNoFf: vi.fn().mockResolvedValue(undefined),
        getCurrentCommit: vi.fn().mockResolvedValue('mock-commit-hash'),
        getCommitHistory: vi.fn().mockResolvedValue([]),
        cleanupOldBranches: vi.fn().mockResolvedValue({ needed: false, deleted: 0, failed: [], gcPerformed: false }),
      };
      vi.mocked(GitUtils).mockImplementation(function () { return mockImpl as unknown as GitUtils; });
      return mockImpl;
    }

    it('switches to main when on unexpected branch', async () => {
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
      const gitMock = createGitMock('main');

      await service.handleMessageStart(TEST_APP_ID);

      // Should not switch branches — already on main
      expect(gitMock.switchBranch).not.toHaveBeenCalled();
      // Should create feature branch
      expect(gitMock.createBranch).toHaveBeenCalled();
    });

    it('continues on tracked feature branch without switching', async () => {
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
    function configureSetup(setupStatus: {
      configured?: boolean;
      deferred?: boolean;
      executed?: boolean;
      running?: boolean;
      error?: string | null;
    }) {
      mockSetup.getStatus.mockResolvedValue({
        configured: setupStatus.configured ?? true,
        deferred: setupStatus.deferred ?? false,
        executed: setupStatus.executed ?? true,
        running: setupStatus.running ?? false,
        error: setupStatus.error ?? null,
      });
      mockSetup.execute.mockResolvedValue('executed');
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
        mergeNoFf: vi.fn().mockResolvedValue(undefined),
        getCurrentCommit: vi.fn().mockResolvedValue('mock-commit-hash'),
        getTreeHash: vi.fn().mockResolvedValue('tree-hash'),
        resolveCommitHash: vi.fn().mockResolvedValue('commit-hash'),
        commitTree: vi.fn().mockResolvedValue({ success: true, stdout: 'hash\n', stderr: '' }),
        updateRef: vi.fn().mockResolvedValue(undefined),
        getCommitHistory: vi.fn().mockResolvedValue([]),
        cleanupOldBranches: vi.fn().mockResolvedValue({ needed: false, deleted: 0, failed: [], gcPerformed: false }),
      };
      vi.mocked(GitUtils).mockImplementation(function () { return mockImpl as unknown as GitUtils; });
      return mockImpl;
    }

    it('triggers setup and skips git ops when setup is deferred and not executed', async () => {
      configureSetup({
        deferred: true,
        executed: false,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(mockSetup.getStatus).toHaveBeenCalled();
      expect(mockSetup.execute).toHaveBeenCalled();
      // Git ops should be skipped
      expect(gitMock.isGitRepository).not.toHaveBeenCalled();
      expect(gitMock.createBranch).not.toHaveBeenCalled();
    });

    it('skips triggering setup when setup is already running', async () => {
      configureSetup({
        deferred: true,
        executed: false,
        running: true,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(mockSetup.getStatus).toHaveBeenCalled();
      expect(mockSetup.execute).not.toHaveBeenCalled();
      // Git ops should still be skipped
      expect(gitMock.isGitRepository).not.toHaveBeenCalled();
    });

    it('does not retry setup when error is set', async () => {
      configureSetup({
        deferred: true,
        executed: false,
        error: 'npm install failed',
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(mockSetup.getStatus).toHaveBeenCalled();
      expect(mockSetup.execute).not.toHaveBeenCalled();
      // Git ops should still be skipped
      expect(gitMock.isGitRepository).not.toHaveBeenCalled();
    });

    it('proceeds with git ops when setup is not deferred', async () => {
      configureSetup({
        deferred: false,
        executed: true,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(gitMock.isGitRepository).toHaveBeenCalled();
      expect(gitMock.createBranch).toHaveBeenCalled();
    });

    it('proceeds with git ops when deferred setup has already executed', async () => {
      configureSetup({
        deferred: true,
        executed: true,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(gitMock.isGitRepository).toHaveBeenCalled();
      expect(gitMock.createBranch).toHaveBeenCalled();
    });

    it('proceeds with git ops when setup is not configured', async () => {
      configureSetup({
        configured: false,
        deferred: false,
        executed: false,
      });
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      expect(gitMock.isGitRepository).toHaveBeenCalled();
      expect(gitMock.createBranch).toHaveBeenCalled();
    });

    it('falls through to git ops if getStatus throws', async () => {
      mockSetup.getStatus.mockRejectedValue(new Error('connection refused'));
      const gitMock = createGitMock();

      await service.handleMessageStart(TEST_APP_ID);

      // Inner try/catch around getStatus catches the error and falls through.
      // Git ops should proceed normally.
      expect(mockSetup.execute).not.toHaveBeenCalled();
      expect(gitMock.isGitRepository).toHaveBeenCalled();
    });
  });

  describe('publish interaction', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function createGitMock(currentBranch = 'main') {
      const mockImpl = {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getCurrentBranch: vi.fn().mockResolvedValue(currentBranch),
        hasUncommittedChanges: vi.fn().mockResolvedValue(false),
        reset: vi.fn().mockResolvedValue(undefined),
        addFiles: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue({ success: true }),
        createBranch: vi.fn().mockResolvedValue({ success: true }),
        switchBranch: vi.fn().mockResolvedValue({ success: true }),
        squashMerge: vi.fn().mockResolvedValue({ success: true }),
        mergeNoFf: vi.fn().mockResolvedValue({ success: true }),
        getCurrentCommit: vi.fn().mockResolvedValue('mock-commit-hash'),
        getCommitHistory: vi.fn().mockResolvedValue([{ hash: 'abc1234' }]),
        cleanupOldBranches: vi.fn().mockResolvedValue({ needed: false, deleted: 0, failed: [], gcPerformed: false }),
      };
      vi.mocked(GitUtils).mockImplementation(function () { return mockImpl as unknown as GitUtils; });
      return mockImpl;
    }

    it('creates new branch after publish switches to main during active conversation', async () => {
      vi.useFakeTimers();
      const gitMock = createGitMock('main');

      // Conversation starts: creates feature branch A
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1', 'initial prompt');
      const branchA = service.getAppBranch(TEST_APP_ID)!.branchName;
      expect(branchA).toBeDefined();

      // Simulate publish: switches to main (publish calls git directly, not GitHookService)
      // Now getCurrentBranch returns 'main' because publish switched us
      gitMock.getCurrentBranch.mockResolvedValue('main');

      // Advance time so the next branch gets a different timestamp
      vi.advanceTimersByTime(2000);

      // Next message in same conversation triggers handleMessageStart
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1', 'post-publish prompt');

      // Should have created a NEW feature branch (different from A)
      const branchB = service.getAppBranch(TEST_APP_ID)!.branchName;
      expect(branchB).toBeDefined();
      expect(branchB).not.toBe(branchA);
      expect(gitMock.createBranch).toHaveBeenCalledTimes(2);
    });

    it('handleConnectionEnd returns null when publish already moved to main', async () => {
      // Start on main so handleMessageStart creates a feature branch
      const gitMock = createGitMock('main');

      // handleMessageStart creates feature branch (getCurrentBranch returns 'main')
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1');
      const branchInfo = service.getAppBranch(TEST_APP_ID);
      expect(branchInfo).toBeDefined();

      // Simulate being on the feature branch (normal state after branch creation)
      gitMock.getCurrentBranch.mockResolvedValue(branchInfo!.branchName);

      // Now simulate publish: switches repo back to main without notifying GitHookService
      gitMock.getCurrentBranch.mockResolvedValue('main');

      // Connection ends - should detect we're on main and return null
      const result = await service.handleConnectionEnd(TEST_APP_ID, 'complete', 'conv-1', 'sock-1');

      expect(result).toBeNull();
      // Should NOT attempt squash merge since we're already on main
      expect(gitMock.squashMerge).not.toHaveBeenCalled();
      // Tracking should be cleaned up
      expect(service.hasActiveBranch(TEST_APP_ID)).toBe(false);
    });

    it('full cycle: conversation → merge → publish → new conversation works', async () => {
      vi.useFakeTimers();
      const gitMock = createGitMock('main');

      // === Conversation 1 ===
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1', 'first prompt');
      const branchA = service.getAppBranch(TEST_APP_ID)!.branchName;

      // Simulate being on feature branch A for connection end
      gitMock.getCurrentBranch.mockResolvedValue(branchA);
      gitMock.getCommitHistory
        .mockResolvedValueOnce([{ hash: 'before-merge' }])
        .mockResolvedValueOnce([{ hash: 'after-merge' }]);

      const commitHash1 = await service.handleConnectionEnd(TEST_APP_ID, 'complete', 'conv-1', 'sock-1');
      expect(commitHash1).toBe('after-merge');
      expect(service.hasActiveBranch(TEST_APP_ID)).toBe(false);

      // === Publish happens (we're on main after merge) ===
      gitMock.getCurrentBranch.mockResolvedValue('main');

      // Advance time for unique branch name
      vi.advanceTimersByTime(2000);

      // === Conversation 2 ===
      await service.handleMessageStart(TEST_APP_ID, 'conv-2', 'sock-2', 'second prompt');
      const branchB = service.getAppBranch(TEST_APP_ID)!.branchName;
      expect(branchB).toBeDefined();
      expect(branchB).not.toBe(branchA);

      // Simulate being on branch B
      gitMock.getCurrentBranch.mockResolvedValue(branchB);
      gitMock.getCommitHistory
        .mockResolvedValueOnce([{ hash: 'before-merge-2' }])
        .mockResolvedValueOnce([{ hash: 'after-merge-2' }]);

      const commitHash2 = await service.handleConnectionEnd(TEST_APP_ID, 'complete', 'conv-2', 'sock-2');
      expect(commitHash2).toBe('after-merge-2');
      expect(gitMock.squashMerge).toHaveBeenCalledWith(
        TEST_APP_PATH,
        branchB,
        expect.any(String)
      );
    });

    it('new branch creation works after publish deleted the previous feature branch', async () => {
      vi.useFakeTimers();
      const gitMock = createGitMock('main');

      // Create feature branch A
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1');
      const branchA = service.getAppBranch(TEST_APP_ID)!.branchName;

      // Publish: merge to main and delete branch A
      // GitHookService is NOT notified (publish uses GitUtils directly)
      gitMock.getCurrentBranch.mockResolvedValue('main');
      // Branch A no longer exists in git (publish deleted it)

      // Advance time for unique branch name
      vi.advanceTimersByTime(2000);

      // New conversation starts
      await service.handleMessageStart(TEST_APP_ID, 'conv-2', 'sock-2');

      const branchB = service.getAppBranch(TEST_APP_ID)!.branchName;
      expect(branchB).toBeDefined();
      expect(branchB).not.toBe(branchA);

      // Simulate being on branch B for connection end
      gitMock.getCurrentBranch.mockResolvedValue(branchB);
      gitMock.hasUncommittedChanges.mockResolvedValue(true);
      gitMock.getCommitHistory
        .mockResolvedValueOnce([{ hash: 'h1' }])
        .mockResolvedValueOnce([{ hash: 'h2' }]);

      const result = await service.handleConnectionEnd(TEST_APP_ID, 'complete', 'conv-2', 'sock-2');
      expect(result).toBe('h2');
      expect(gitMock.addFiles).toHaveBeenCalled();
      expect(gitMock.commit).toHaveBeenCalled();
      expect(gitMock.squashMerge).toHaveBeenCalledWith(TEST_APP_PATH, branchB, expect.any(String));
    });

    it('edits after publish in same conversation get committed on new branch', async () => {
      vi.useFakeTimers();
      const gitMock = createGitMock('main');

      // Conversation starts, creates branch A
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1', 'build something');

      // Publish switches to main (GitHookService not notified)
      gitMock.getCurrentBranch.mockResolvedValue('main');

      // Advance time for unique branch name
      vi.advanceTimersByTime(2000);

      // New message in same conversation triggers handleMessageStart
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1', 'edit after publish');
      const branchB = service.getAppBranch(TEST_APP_ID)!.branchName;

      // Simulate edits happening on branch B (user edits files, batchCommitChanges runs)
      gitMock.getCurrentBranch.mockResolvedValue(branchB);
      gitMock.hasUncommittedChanges.mockResolvedValue(true);
      gitMock.getCommitHistory
        .mockResolvedValueOnce([{ hash: 'main-head' }])
        .mockResolvedValueOnce([{ hash: 'new-commit' }]);

      // Connection ends — should merge branch B to main
      const commitHash = await service.handleConnectionEnd(
        TEST_APP_ID, 'complete', 'conv-1', 'sock-1', 'edit after publish'
      );

      expect(commitHash).toBe('new-commit');
      // Verify the full commit flow ran
      expect(gitMock.addFiles).toHaveBeenCalledWith(TEST_APP_PATH, ['.']);
      expect(gitMock.commit).toHaveBeenCalled();
      expect(gitMock.switchBranch).toHaveBeenCalledWith(TEST_APP_PATH, 'main');
      expect(gitMock.squashMerge).toHaveBeenCalledWith(TEST_APP_PATH, branchB, expect.any(String));

    });

    it('clearBranchTracking removes stale tracking after publish', async () => {
      const gitMock = createGitMock('main');

      // Create feature branch
      await service.handleMessageStart(TEST_APP_ID, 'conv-1', 'sock-1');
      expect(service.hasActiveBranch(TEST_APP_ID)).toBe(true);

      // Simulate publish clearing tracking (as the publish route now does)
      service.clearBranchTracking(TEST_APP_ID);

      expect(service.hasActiveBranch(TEST_APP_ID)).toBe(false);
      expect(service.getAppBranch(TEST_APP_ID)).toBeUndefined();
    });
  });

  describe('merge mode selection (deep-build no-ff)', () => {
    function createGitMockForMerge(currentBranch = 'feature-branch') {
      const mockImpl = {
        isGitRepository: vi.fn().mockResolvedValue(true),
        getCurrentBranch: vi.fn().mockResolvedValue(currentBranch),
        hasUncommittedChanges: vi.fn().mockResolvedValue(false),
        reset: vi.fn().mockResolvedValue(undefined),
        addFiles: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue({ success: true }),
        createBranch: vi.fn().mockResolvedValue({ success: true }),
        switchBranch: vi.fn().mockResolvedValue({ success: true }),
        squashMerge: vi.fn().mockResolvedValue({ success: true }),
        mergeNoFf: vi.fn().mockResolvedValue({ success: true }),
        getCurrentCommit: vi.fn().mockResolvedValue('mock-commit-hash'),
        getCommitHistory: vi.fn().mockResolvedValue([{ hash: 'abc1234' }]),
        cleanupOldBranches: vi.fn().mockResolvedValue({ needed: false, deleted: 0, failed: [], gcPerformed: false }),
      };
      vi.mocked(GitUtils).mockImplementation(function () { return mockImpl as unknown as GitUtils; });
      return mockImpl;
    }

    it('uses mergeNoFf when app.agent_mode is deep-build', async () => {
      const { getKvMemoryStore } = await import('../../memory/adapters/index.js');
      vi.mocked(getKvMemoryStore).mockReturnValue({
        get: vi.fn().mockResolvedValue({ success: true, exists: true, value: { mode: 'deep-build' } }),
      } as any);

      const gitMock = createGitMockForMerge('test-feature');
      // Return different hashes before/after merge so the service detects the new commit
      gitMock.getCommitHistory
        .mockResolvedValueOnce([{ hash: 'before-hash' }])
        .mockResolvedValueOnce([{ hash: 'after-merge-hash' }]);

      // Ensure AppRepository mock returns the test app
      const repoInstance = vi.mocked(AppRepository).mock.results.at(-1)?.value as { findById: ReturnType<typeof vi.fn> };
      if (repoInstance) repoInstance.findById.mockReturnValue(TEST_APP);

      // Manually set up branch tracking (bypass handleMessageStart complexity)
      (service as any).appBranches.set(TEST_APP_ID, {
        appId: TEST_APP_ID,
        branchName: 'test-feature',
        createdAt: new Date(),
        userPrompt: 'build homepage',
      });

      const commitHash: string | null = await service.handleConnectionEnd(TEST_APP_ID, 'complete');

      expect(gitMock.mergeNoFf).toHaveBeenCalledWith(TEST_APP_PATH, 'test-feature', expect.any(String));
      expect(gitMock.squashMerge).not.toHaveBeenCalled();
      expect(commitHash).toBe('after-merge-hash');
    });

    it('uses squashMerge when app.agent_mode is not set', async () => {
      const { getKvMemoryStore } = await import('../../memory/adapters/index.js');
      vi.mocked(getKvMemoryStore).mockReturnValue({
        get: vi.fn().mockResolvedValue({ success: true, exists: false }),
      } as any);

      const gitMock = createGitMockForMerge('test-feature');
      const repoInstance = vi.mocked(AppRepository).mock.results.at(-1)?.value as { findById: ReturnType<typeof vi.fn> };
      if (repoInstance) repoInstance.findById.mockReturnValue(TEST_APP);

      (service as any).appBranches.set(TEST_APP_ID, {
        appId: TEST_APP_ID,
        branchName: 'test-feature',
        createdAt: new Date(),
        userPrompt: 'fix typo',
      });

      await service.handleConnectionEnd(TEST_APP_ID, 'complete');

      expect(gitMock.squashMerge).toHaveBeenCalledWith(TEST_APP_PATH, 'test-feature', expect.any(String));
      expect(gitMock.mergeNoFf).not.toHaveBeenCalled();
    });

    it('falls back to squash when KV lookup fails', async () => {
      const { getKvMemoryStore } = await import('../../memory/adapters/index.js');
      vi.mocked(getKvMemoryStore).mockReturnValue({
        get: vi.fn().mockRejectedValue(new Error('db error')),
      } as any);

      const gitMock = createGitMockForMerge('test-feature');
      const repoInstance = vi.mocked(AppRepository).mock.results.at(-1)?.value as { findById: ReturnType<typeof vi.fn> };
      if (repoInstance) repoInstance.findById.mockReturnValue(TEST_APP);

      (service as any).appBranches.set(TEST_APP_ID, {
        appId: TEST_APP_ID,
        branchName: 'test-feature',
        createdAt: new Date(),
        userPrompt: 'build page',
      });

      await service.handleConnectionEnd(TEST_APP_ID, 'complete');

      expect(gitMock.squashMerge).toHaveBeenCalled();
      expect(gitMock.mergeNoFf).not.toHaveBeenCalled();
    });
  });
});
