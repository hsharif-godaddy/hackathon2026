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
    vi.mocked(DevSupervisorClientFactory.createForApp).mockReturnValue({} as never);
  });

  /** Helper: set up git utils and run handleMessageStart for recovery scenarios */
  async function setupRecoveryScenario(opts: {
    currentBranch: string;
    featureTreeHash?: string;
    mainTreeHash?: string;
    commitTreeError?: boolean;
    resetErrors?: Array<Error | undefined>;
  }) {
    const featureTree = opts.featureTreeHash ?? 'feature-tree-hash';
    const mainTree = opts.mainTreeHash ?? 'main-tree-hash';

    const mockImpl = {
      isGitRepository: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue(opts.currentBranch),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      reset: vi.fn().mockResolvedValue(undefined),
      addFiles: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      switchBranch: vi.fn().mockResolvedValue(undefined),
      squashMerge: vi.fn().mockResolvedValue(undefined),
      getCurrentCommit: vi.fn().mockResolvedValue('mock-commit-hash'),
      getTreeHash: vi.fn().mockImplementation((_path: string, ref: string) => {
        if (ref === 'HEAD') return Promise.resolve(featureTree);
        if (ref === 'main') return Promise.resolve(mainTree);
        return Promise.resolve('unknown-tree');
      }),
      resolveCommitHash: vi.fn().mockResolvedValue('main-commit-hash'),
      commitTree: vi.fn().mockResolvedValue(
        opts.commitTreeError
          ? { success: false, stdout: '', stderr: 'commitTree failed' }
          : { success: true, stdout: 'new-commit-hash\n', stderr: '' }
      ),
      updateRef: vi.fn().mockResolvedValue(undefined),
      getCommitHistory: vi.fn().mockResolvedValue([]),
      cleanupOldBranches: vi.fn().mockResolvedValue({ needed: false, deleted: 0, failed: [], gcPerformed: false }),
    };

    if (opts.resetErrors) {
      let mock = mockImpl.reset;
      for (const err of opts.resetErrors) {
        if (err) {
          mock = mock.mockRejectedValueOnce(err);
        } else {
          mock = mock.mockResolvedValueOnce(undefined);
        }
      }
    }

    vi.mocked(GitUtils).mockImplementation(() => mockImpl as unknown as GitUtils);

    await service.handleMessageStart(TEST_APP_ID);

    return mockImpl;
  }

  describe('performRecovery', () => {
    it('calls reset --hard instead of git add', async () => {
      const mocks = await setupRecoveryScenario({
        currentBranch: 'some-feature-branch',
      });

      expect(mocks.reset).toHaveBeenCalledWith(TEST_APP_PATH, { mode: 'hard' });
      expect(mocks.addFiles).not.toHaveBeenCalled();
    });

    it('uses plumbing to squash merge after reset', async () => {
      const mocks = await setupRecoveryScenario({
        currentBranch: 'some-feature-branch',
      });

      // Should use plumbing instead of porcelain squashMerge
      expect(mocks.getTreeHash).toHaveBeenCalledWith(TEST_APP_PATH, 'HEAD');
      expect(mocks.getTreeHash).toHaveBeenCalledWith(TEST_APP_PATH, 'main');
      expect(mocks.resolveCommitHash).toHaveBeenCalledWith(TEST_APP_PATH, 'main');
      expect(mocks.commitTree).toHaveBeenCalledWith(
        TEST_APP_PATH, 'feature-tree-hash', 'Recovery from interrupted session',
        { parentHash: 'main-commit-hash' }
      );
      expect(mocks.updateRef).toHaveBeenCalledWith(
        TEST_APP_PATH, 'refs/heads/main', 'new-commit-hash', 'main-commit-hash'
      );
      expect(mocks.switchBranch).toHaveBeenCalledWith(TEST_APP_PATH, 'main');
      // Porcelain squashMerge should NOT be called
      expect(mocks.squashMerge).not.toHaveBeenCalled();
    });

    it('skips merge when feature tree matches main tree', async () => {
      const mocks = await setupRecoveryScenario({
        currentBranch: 'some-feature-branch',
        featureTreeHash: 'same-tree',
        mainTreeHash: 'same-tree',
      });

      // Should just switch to main without committing
      expect(mocks.switchBranch).toHaveBeenCalledWith(TEST_APP_PATH, 'main');
      expect(mocks.commitTree).not.toHaveBeenCalled();
      expect(mocks.updateRef).not.toHaveBeenCalled();
    });

    it('handles detached HEAD via plumbing (getTreeHash works with HEAD ref)', async () => {
      const mocks = await setupRecoveryScenario({
        currentBranch: 'HEAD',
      });

      // Plumbing approach uses getTreeHash('HEAD') which works for detached HEAD
      expect(mocks.getTreeHash).toHaveBeenCalledWith(TEST_APP_PATH, 'HEAD');
      expect(mocks.commitTree).toHaveBeenCalled();
    });

    it('fallback resets before switching branch on commitTree failure', async () => {
      const mocks = await setupRecoveryScenario({
        currentBranch: 'some-feature-branch',
        commitTreeError: true,
      });

      // reset called twice: once in main try block, once in catch fallback
      expect(mocks.reset).toHaveBeenCalledTimes(2);
      expect(mocks.reset).toHaveBeenNthCalledWith(1, TEST_APP_PATH, { mode: 'hard' });
      expect(mocks.reset).toHaveBeenNthCalledWith(2, TEST_APP_PATH, { mode: 'hard' });
    });

    it('fallback still switches branch if reset fails in catch block', async () => {
      const mocks = await setupRecoveryScenario({
        currentBranch: 'some-feature-branch',
        commitTreeError: true,
        resetErrors: [undefined, new Error('reset failed')], // first succeeds, second fails
      });

      // switchBranch should still be called in the fallback despite reset failure
      // With plumbing, switchBranch is only called once (in the fallback catch),
      // since commitTree throws before reaching switchBranch in the try block
      expect(mocks.switchBranch).toHaveBeenCalledTimes(1);
      expect(mocks.switchBranch).toHaveBeenCalledWith(TEST_APP_PATH, 'main');
    });
  });
});
