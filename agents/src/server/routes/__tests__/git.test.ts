import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js';

const mocks = vi.hoisted(() => {
  return {
    findById: vi.fn(),
    getCurrentBranch: vi.fn(),
    getStatus: vi.fn(),
    hasRemote: vi.fn(),
    amendCommitMessage: vi.fn(),
    getCurrentCommit: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    stashUncommittedChanges: vi.fn(),
    getCommitDiff: vi.fn(),
    getStashDiff: vi.fn(),
    getBranchTip: vi.fn(),
    getCommitFileStats: vi.fn(),
    forApp: vi.fn(),
    logError: vi.fn(),
    createForApp: vi.fn(),
    executeGitOperation: vi.fn(),
    getLatestForApp: vi.fn(),
    addMessage: vi.fn(),
  };
});

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: mocks.findById,
  }; }),
}));

vi.mock('../../../database/repositories/ConversationRepository.js', () => ({
  ConversationRepository: vi.fn().mockImplementation(function () { return {
    getLatestForApp: mocks.getLatestForApp,
  }; }),
}));

vi.mock('../../../memory/adapters/index.js', () => ({
  getMessageStore: () => ({
    addMessage: mocks.addMessage,
  }),
}));

vi.mock('../../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function () { return {
    getCurrentBranch: mocks.getCurrentBranch,
    getStatus: mocks.getStatus,
    hasRemote: mocks.hasRemote,
    amendCommitMessage: mocks.amendCommitMessage,
    getCurrentCommit: mocks.getCurrentCommit,
    hasUncommittedChanges: mocks.hasUncommittedChanges,
    stashUncommittedChanges: mocks.stashUncommittedChanges,
    getCommitDiff: mocks.getCommitDiff,
    getStashDiff: mocks.getStashDiff,
    getBranchTip: mocks.getBranchTip,
    getCommitFileStats: mocks.getCommitFileStats,
  }; }),
}));

vi.mock('../../../tools/git-tool.js', () => ({
  GitTool: vi.fn().mockImplementation(function () { return {
    executeGitOperation: mocks.executeGitOperation,
  }; }),
}));

vi.mock('../../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: mocks.createForApp,
  },
}));

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

vi.mock('../../../logging/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../logging/index.js')>();
  return {
    ...actual,
    log: {
      ...actual.log,
      forApp: mocks.forApp,
      error: mocks.logError,
    },
  };
});

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn(function (_req, _res, next) { return next(); }),
}));

import gitRouter from '../git.js';
import { createForWorkspace } from '../../../workspace/index.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(gitRouter);
  return app;
}

describe('git routes', function gitRouteTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();

    vi.mocked(createForWorkspace).mockReturnValue({ tasks: {}, files: createStubWorkspaceFiles({ readText: vi.fn().mockResolvedValue('') }) } as ReturnType<typeof createForWorkspace>);
    mocks.findById.mockReturnValue({ path: '/app' });
    mocks.getCurrentBranch.mockResolvedValue('main');
    mocks.getStatus.mockResolvedValue({ stagedFiles: 0 });
    mocks.hasRemote.mockResolvedValue(false);
    mocks.amendCommitMessage.mockResolvedValue({ success: true, stderr: '' });
    mocks.getCurrentCommit.mockResolvedValue('1234567890abcdef1234567890abcdef12345678');
    mocks.hasUncommittedChanges.mockResolvedValue(false);
    mocks.stashUncommittedChanges.mockResolvedValue({
      hasChanges: false,
      stashHash: null,
      diff: null,
      diffTruncated: false,
    });
    mocks.getCommitDiff.mockResolvedValue({
      diff: null,
      diffTruncated: false,
    });
    mocks.getStashDiff.mockResolvedValue({
      diff: null,
      diffTruncated: false,
    });
    mocks.getBranchTip.mockResolvedValue(null);
    mocks.getCommitFileStats.mockResolvedValue([]);
    mocks.forApp.mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
    mocks.createForApp.mockReturnValue(null);
    mocks.executeGitOperation.mockResolvedValue({ success: true });
    // Conversation persistence happens after the rewind action and is best-effort
    // (errors are swallowed). Default to "no conversation" so the route doesn't
    // touch the message store unless a test opts in.
    mocks.getLatestForApp.mockResolvedValue(null);
    mocks.addMessage.mockResolvedValue({
      id: 'msg-1',
      content: '',
      sender: 'user',
      createdAt: new Date().toISOString(),
      metadata: {},
    });
  });

  describe('PATCH /apps/:id/git/commit-message', function commitMessageTests() {
    it('should amend latest commit message and return new commit hash', async function amendCommitMessage() {
      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: '  Updated commit message  ' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        newCommitHash: '1234567890abcdef1234567890abcdef12345678',
      });
      expect(mocks.amendCommitMessage).toHaveBeenCalledWith('/app', 'Updated commit message');
    });

    it('should return 400 when message is missing', async function rejectMissingMessage() {
      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Commit message is required');
      expect(mocks.amendCommitMessage).not.toHaveBeenCalled();
    });

    it('should return 400 when message is empty string', async function rejectEmptyMessage() {
      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Commit message is required');
      expect(mocks.amendCommitMessage).not.toHaveBeenCalled();
    });

    it('should return 404 when app is not found', async function rejectAppNotFound() {
      mocks.findById.mockReturnValue(null);

      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'Updated commit message' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('App not found');
      expect(mocks.amendCommitMessage).not.toHaveBeenCalled();
    });

    it('should reject commit messages that exceed max length', async function rejectLongMessage() {
      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'a'.repeat(501) });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Commit message must be 500 characters or fewer');
      expect(mocks.amendCommitMessage).not.toHaveBeenCalled();
    });

    it('should reject amend when current branch is not main', async function rejectInvalidBranch() {
      mocks.getCurrentBranch.mockResolvedValue('feature/test');

      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'Updated commit message' });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Commit message can only be edited on the main branch');
      expect(response.body.currentBranch).toBe('feature/test');
      expect(mocks.amendCommitMessage).not.toHaveBeenCalled();
    });

    it('should reject amend when staged changes exist', async function rejectStagedChanges() {
      mocks.getStatus.mockResolvedValue({ stagedFiles: 2 });

      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'Updated commit message' });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Cannot edit commit message while staged changes exist');
      expect(mocks.amendCommitMessage).not.toHaveBeenCalled();
    });

    it('should reject amend when origin remote is configured', async function rejectRemoteTracked() {
      mocks.hasRemote.mockResolvedValue(true);

      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'Updated commit message' });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Cannot edit commit message when an origin remote is configured (amend rewrites history)');
      expect(mocks.amendCommitMessage).not.toHaveBeenCalled();
    });

    it('should reject amend when HEAD has moved from expectedHash', async function rejectStaleHead() {
      mocks.getCurrentCommit.mockResolvedValue('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'Updated commit message', expectedHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('HEAD has moved since editing started — another commit may have been created');
      expect(response.body.expectedHash).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      expect(response.body.actualHead).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(mocks.amendCommitMessage).not.toHaveBeenCalled();
    });

    it('should allow amend when expectedHash matches HEAD', async function allowMatchingHash() {
      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'Updated commit message', expectedHash: '1234567890abcdef1234567890abcdef12345678' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mocks.amendCommitMessage).toHaveBeenCalledWith('/app', 'Updated commit message');
    });

    it('should return 400 when amend operation fails', async function handleAmendFailure() {
      mocks.amendCommitMessage.mockResolvedValue({ success: false, stderr: 'fatal: amend failed' });

      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'Updated commit message' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Failed to edit commit message');
    });

    it('should return 500 when hash retrieval fails after amend', async function handleHashFailure() {
      mocks.getCurrentCommit.mockRejectedValue(new Error('git rev-parse failed'));

      const response = await request(createTestApp())
        .patch('/apps/app-123/git/commit-message')
        .send({ message: 'Updated commit message' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Amend succeeded but failed to retrieve new commit hash');
    });
  });

  describe('GET /apps/:id/git/status', function statusTests() {
    it('returns hasUncommittedChanges=true when the working tree is dirty', async function dirtyTree() {
      mocks.hasUncommittedChanges.mockResolvedValueOnce(true);

      const response = await request(createTestApp())
        .get('/apps/app-123/git/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, hasUncommittedChanges: true });
      expect(mocks.hasUncommittedChanges).toHaveBeenCalledWith('/app');
    });

    it('returns hasUncommittedChanges=false when the working tree is clean', async function cleanTree() {
      mocks.hasUncommittedChanges.mockResolvedValueOnce(false);

      const response = await request(createTestApp())
        .get('/apps/app-123/git/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, hasUncommittedChanges: false });
    });

    it('returns 404 when the app is not found', async function appNotFound() {
      mocks.findById.mockReturnValueOnce(null);

      const response = await request(createTestApp())
        .get('/apps/app-123/git/status');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('App not found');
      expect(mocks.hasUncommittedChanges).not.toHaveBeenCalled();
    });

    it('returns 500 when hasUncommittedChanges throws', async function statusError() {
      mocks.hasUncommittedChanges.mockRejectedValueOnce(new Error('git unreachable'));

      const response = await request(createTestApp())
        .get('/apps/app-123/git/status');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to read git status');
      expect(response.body.details).toBe('git unreachable');
    });
  });

  describe('POST /apps/:id/git/restore', function restoreTests() {
    it('stashes uncommitted work and runs the restore op when commitHash is provided', async function stashThenRestore() {
      mocks.stashUncommittedChanges.mockResolvedValueOnce({
        hasChanges: true,
        stashHash: 'stash-abc',
      });

      const response = await request(createTestApp())
        .post('/apps/app-123/git/restore')
        .send({ commitHash: 'abc1234' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.hasChanges).toBe(true);
      expect(response.body.stashHash).toBe('stash-abc');
      expect(mocks.stashUncommittedChanges).toHaveBeenCalledTimes(1);
      expect(mocks.executeGitOperation).toHaveBeenCalledWith(
        '/app',
        expect.objectContaining({ operation: 'restore', options: { hash: 'abc1234' } }),
      );
    });

    it('does a stash-only call when commitHash is omitted', async function stashOnly() {
      mocks.stashUncommittedChanges.mockResolvedValueOnce({
        hasChanges: true,
        stashHash: 'stash-only-hash',
      });

      const response = await request(createTestApp())
        .post('/apps/app-123/git/restore')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.stashHash).toBe('stash-only-hash');
      // Without a commitHash the route falls back to a `checkout main` so the
      // user lands on a clean main head — but it never runs the `restore` op.
      expect(mocks.executeGitOperation).not.toHaveBeenCalledWith(
        '/app',
        expect.objectContaining({ operation: 'restore' }),
      );
      expect(mocks.executeGitOperation).toHaveBeenCalledWith(
        '/app',
        expect.objectContaining({ operation: 'checkout', branch: 'main' }),
      );
    });

    it('returns 400 when the restore operation itself fails — and surfaces stashHash so the client can recover stashed work', async function restoreFails() {
      mocks.stashUncommittedChanges.mockResolvedValueOnce({
        hasChanges: true,
        stashHash: 'stash-after-fail',
      });
      mocks.executeGitOperation.mockImplementation(async function (_path: unknown, opts: any) {
        if (opts?.operation === 'restore') return { success: false, error: 'restore-failed' };
        return { success: true };
      });

      const response = await request(createTestApp())
        .post('/apps/app-123/git/restore')
        .send({ commitHash: 'abc1234' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Failed to restore files from commit');
      // Stash already happened before the failed restore op — the user's
      // working-tree changes are recoverable, so the hash must travel back.
      expect(response.body.stashHash).toBe('stash-after-fail');
    });

    it('returns 400 when the stash-only fallback `checkout main` fails — never a misleading 200', async function checkoutMainFails() {
      mocks.stashUncommittedChanges.mockResolvedValueOnce({
        hasChanges: true,
        stashHash: 'stash-pre-checkout',
      });
      mocks.executeGitOperation.mockImplementation(async function (_path: unknown, opts: any) {
        if (opts?.operation === 'checkout') return { success: false, error: 'checkout-failed' };
        return { success: true };
      });

      const response = await request(createTestApp())
        .post('/apps/app-123/git/restore')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Failed to checkout main branch');
      expect(response.body.stashHash).toBe('stash-pre-checkout');
      // Critical: the synthetic user-action notice MUST NOT be persisted with
      // a wrong-branch HEAD when the checkout fails — verify we bail out
      // before the persistence step would have fired.
      expect(mocks.addMessage).not.toHaveBeenCalled();
    });

    it('rejects an empty commitHash string', async function rejectsEmptyCommitHash() {
      const response = await request(createTestApp())
        .post('/apps/app-123/git/restore')
        .send({ commitHash: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/commitHash/);
      expect(mocks.stashUncommittedChanges).not.toHaveBeenCalled();
    });

    it('returns 404 when the app is not found', async function appNotFound() {
      mocks.findById.mockReturnValueOnce(null);

      const response = await request(createTestApp())
        .post('/apps/app-123/git/restore')
        .send({ commitHash: 'abc1234' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('App not found');
      expect(mocks.stashUncommittedChanges).not.toHaveBeenCalled();
    });

    it('returns the persisted notice row when a conversation exists', async function returnsNotice() {
      mocks.getLatestForApp.mockResolvedValueOnce({ id: 'conv-9' });
      const persistedAt = new Date('2026-05-18T12:00:00Z');
      // Mocked-out store mirrors the metadata shape the route asks it to
      // persist — `RestoreActionMetadata` from `@airo/shared/chat`
      // (`kind: 'restore'` plus the three rollback hashes).
      const persistedMetadata = {
        kind: 'restore',
        commitHash: 'abc1234',
        stashHash: null,
        restoredCommitHash: 'abc1234',
      };
      mocks.addMessage.mockResolvedValueOnce({
        id: 'msg-42',
        sender: 'user',
        content: '[system] The user performed a rollback.',
        createdAt: persistedAt,
        metadata: persistedMetadata,
      });

      const response = await request(createTestApp())
        .post('/apps/app-123/git/restore')
        .send({ commitHash: 'abc1234' });

      expect(response.status).toBe(200);
      expect(response.body.notice).toEqual({
        id: 'msg-42',
        sender: 'user',
        content: '[system] The user performed a rollback.',
        createdAt: persistedAt.toISOString(),
        metadata: persistedMetadata,
      });

      // Critical: the route must hand the message store the new
      // `RestoreActionMetadata` shape, not the legacy `{ kind: 'user-action',
      // action: 'restore' }` form. The UI's `isRestoreMetadata` guard
      // discriminates on `kind === 'restore'` — mismatched persistence here
      // would cause the synthetic notice to silently fall through to the
      // default JSON-dumping renderer.
      expect(mocks.addMessage).toHaveBeenCalledWith(
        'conv-9',
        'user',
        expect.any(String),
        expect.objectContaining({
          messageType: 'status',
          metadata: expect.objectContaining({
            kind: 'restore',
            // `commitHash` here is the post-operation HEAD; with no further
            // git mocking it falls through to `getCurrentCommit` → null when
            // the route did the restore op (the `didRestore` branch passes
            // `targetCommit` directly), but for the per-prompt restore path
            // the route forwards the requested target.
            commitHash: 'abc1234',
            restoredCommitHash: 'abc1234',
          }),
        })
      );
    });

    it('returns notice: null when there is no active conversation', async function noNotice() {
      // Default mock already returns null; assert the response shape so a
      // future regression that drops the field is caught.
      const response = await request(createTestApp())
        .post('/apps/app-123/git/restore')
        .send({ commitHash: 'abc1234' });

      expect(response.status).toBe(200);
      expect(response.body.notice).toBeNull();
      expect(mocks.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('GET /apps/:id/git/diff', function diffTests() {
    it('combines stash diff and commit diff in that order when both are provided', async function stashThenCommit() {
      mocks.getStashDiff.mockResolvedValueOnce({
        diff: 'diff --git a/wip b/wip\n+wip line',
        diffTruncated: false,
      });
      mocks.getCommitDiff.mockResolvedValueOnce({
        diff: 'diff --git a/foo b/foo\n+committed line',
        diffTruncated: false,
      });

      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ commitHash: 'abc1234', stashHash: 'fedcba9' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.diff).toBe(
        'diff --git a/wip b/wip\n+wip line\n' +
        'diff --git a/foo b/foo\n+committed line',
      );
      expect(response.body.diffTruncated).toBe(false);
      expect(mocks.getStashDiff).toHaveBeenCalledWith('/app', 'fedcba9');
      // Commit diff is computed against the commit's parent — the standard
      // `git show <commit>` form expressed via getCommitDiff(parent..commit).
      expect(mocks.getCommitDiff).toHaveBeenCalledWith('/app', 'abc1234^', 'abc1234');
    });

    it('returns just the stash diff when only stashHash is provided', async function stashOnly() {
      mocks.getStashDiff.mockResolvedValueOnce({
        diff: 'diff --git a/wip b/wip\n+wip',
        diffTruncated: false,
      });

      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ stashHash: 'fedcba9' });

      expect(response.status).toBe(200);
      expect(response.body.diff).toBe('diff --git a/wip b/wip\n+wip');
      expect(mocks.getCommitDiff).not.toHaveBeenCalled();
    });

    it('returns just the commit diff when only commitHash is provided', async function commitOnly() {
      mocks.getCommitDiff.mockResolvedValueOnce({
        diff: 'diff --git a/foo b/foo\n+committed line',
        diffTruncated: false,
      });

      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ commitHash: 'abc1234' });

      expect(response.status).toBe(200);
      expect(response.body.diff).toBe('diff --git a/foo b/foo\n+committed line');
      expect(mocks.getStashDiff).not.toHaveBeenCalled();
    });

    it('returns null diff when both helpers report no changes', async function noChanges() {
      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ commitHash: 'abc1234', stashHash: 'fedcba9' });

      expect(response.status).toBe(200);
      expect(response.body.diff).toBeNull();
      expect(response.body.diffTruncated).toBe(false);
    });

    it('propagates diffTruncated when either piece is truncated', async function propagatesTruncation() {
      mocks.getStashDiff.mockResolvedValueOnce({
        diff: 'big stash diff',
        diffTruncated: true,
      });
      mocks.getCommitDiff.mockResolvedValueOnce({
        diff: 'small commit diff',
        diffTruncated: false,
      });

      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ commitHash: 'abc1234', stashHash: 'fedcba9' });

      expect(response.status).toBe(200);
      expect(response.body.diffTruncated).toBe(true);
    });

    it('returns 400 when neither commitHash nor stashHash is provided', async function noHash() {
      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff');

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/commitHash or stashHash/);
      expect(mocks.getCommitDiff).not.toHaveBeenCalled();
      expect(mocks.getStashDiff).not.toHaveBeenCalled();
    });

    it('returns 400 when commitHash is not hex', async function rejectsNonHex() {
      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ commitHash: 'not-hex!' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Invalid hash/);
    });

    it('returns 400 when stashHash is too short', async function rejectsShortHash() {
      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ stashHash: 'abc' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Invalid hash/);
    });

    it('returns 404 when the app is not found', async function appNotFound() {
      mocks.findById.mockReturnValueOnce(null);

      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ commitHash: 'abc1234' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('App not found');
      expect(mocks.getCommitDiff).not.toHaveBeenCalled();
    });

    it('returns 500 when the diff helper throws', async function helperThrows() {
      mocks.getCommitDiff.mockRejectedValueOnce(new Error('git unreachable'));

      const response = await request(createTestApp())
        .get('/apps/app-123/git/diff')
        .query({ commitHash: 'abc1234' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to read diff');
      expect(response.body.details).toBe('git unreachable');
    });
  });

  describe('POST /apps/:id/git/checkout pageHint', function checkoutPageHintTests() {
    beforeEach(function configureCheckoutMocks() {
      // Default: every git op the route invokes succeeds. Tests override
      // individual ones (e.g. getCommitFileStats) to exercise specific paths.
      mocks.executeGitOperation.mockImplementation(async function (_path, opts) {
        if (opts?.operation === 'branch') return { success: true, currentBranch: 'main' };
        if (opts?.operation === 'status') return { success: true, status: { isClean: true, stagedFiles: 0, modifiedFiles: 0, untrackedFiles: 0 } };
        return { success: true };
      });
    });

    it('returns the highest-churn page route and modulePath when the target commit touches a page', async function targetCommitTouchesPage() {
      mocks.getCommitFileStats.mockResolvedValueOnce([
        { path: 'src/pages/about.tsx', added: 50, deleted: 10 },
        { path: 'src/components/Header.tsx', added: 5, deleted: 1 },
        { path: 'src/pages/index.tsx', added: 3, deleted: 1 },
      ]);

      const response = await request(createTestApp())
        .post('/apps/app-123/git/checkout')
        .send({ commitHash: 'abc1234' });

      expect(response.status).toBe(200);
      expect(response.body.pageHint).toBe('/about');
      expect(response.body.modulePath).toBe('src/pages/about.tsx');
      // Only the target commit needed inspection — no walk into ancestors.
      expect(mocks.getCommitFileStats).toHaveBeenCalledTimes(1);
    });

    it('walks up to 3 ancestors when the target commit only touched non-page files', async function walksAncestors() {
      // Target commit: only components, no page.
      mocks.getCommitFileStats.mockResolvedValueOnce([
        { path: 'src/components/Footer.tsx', added: 20, deleted: 5 },
      ]);
      // ~1: still no page.
      mocks.getCommitFileStats.mockResolvedValueOnce([
        { path: 'src/styles/globals.css', added: 4, deleted: 0 },
      ]);
      // ~2: page touched — should win.
      mocks.getCommitFileStats.mockResolvedValueOnce([
        { path: 'src/pages/contact.tsx', added: 12, deleted: 3 },
      ]);

      const response = await request(createTestApp())
        .post('/apps/app-123/git/checkout')
        .send({ commitHash: 'abc1234' });

      expect(response.status).toBe(200);
      expect(response.body.pageHint).toBe('/contact');
      expect(response.body.modulePath).toBe('src/pages/contact.tsx');
      expect(mocks.getCommitFileStats).toHaveBeenCalledTimes(3);
    });

    it('maps src/pages/<dir>/index.tsx to /<dir>', async function indexInDirectory() {
      mocks.getCommitFileStats.mockResolvedValueOnce([
        { path: 'src/pages/blog/index.tsx', added: 30, deleted: 0 },
      ]);

      const response = await request(createTestApp())
        .post('/apps/app-123/git/checkout')
        .send({ commitHash: 'abc1234' });

      expect(response.body.pageHint).toBe('/blog');
      expect(response.body.modulePath).toBe('src/pages/blog/index.tsx');
    });

    it('skips private/special pages (leading underscore) like _404.tsx', async function skipsPrivatePages() {
      mocks.getCommitFileStats.mockResolvedValueOnce([
        { path: 'src/pages/_404.tsx', added: 50, deleted: 0 },
        { path: 'src/pages/_app.tsx', added: 5, deleted: 0 },
        { path: 'src/components/Nav.tsx', added: 1, deleted: 0 },
      ]);
      // No further ancestors with pages.
      mocks.getCommitFileStats.mockResolvedValue([]);

      const response = await request(createTestApp())
        .post('/apps/app-123/git/checkout')
        .send({ commitHash: 'abc1234' });

      expect(response.body.pageHint).toBeNull();
      expect(response.body.modulePath).toBeNull();
    });

    it('returns null pageHint and modulePath when no candidate is found within the walk', async function noCandidateFound() {
      // None of the ancestors touched a page.
      mocks.getCommitFileStats.mockResolvedValue([
        { path: 'src/components/Header.tsx', added: 1, deleted: 1 },
      ]);

      const response = await request(createTestApp())
        .post('/apps/app-123/git/checkout')
        .send({ commitHash: 'abc1234' });

      expect(response.status).toBe(200);
      expect(response.body.pageHint).toBeNull();
      expect(response.body.modulePath).toBeNull();
    });

    it('does not fail the checkout when computePageHint throws', async function pageHintFailureNonFatal() {
      mocks.getCommitFileStats.mockRejectedValue(new Error('git unreachable'));

      const response = await request(createTestApp())
        .post('/apps/app-123/git/checkout')
        .send({ commitHash: 'abc1234' });

      // Checkout itself succeeded — page hint failure should not surface.
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.pageHint).toBeNull();
      expect(response.body.modulePath).toBeNull();
    });

    it('treats binary changes (0/0 numstat) as zero churn', async function binaryFiles() {
      mocks.getCommitFileStats.mockResolvedValueOnce([
        { path: 'src/pages/gallery.tsx', added: 0, deleted: 0 },
        { path: 'src/pages/about.tsx', added: 1, deleted: 0 },
      ]);

      const response = await request(createTestApp())
        .post('/apps/app-123/git/checkout')
        .send({ commitHash: 'abc1234' });

      // Highest churn wins; binary-only edits stay tied at 0 and the
      // single-line edit beats them.
      expect(response.body.pageHint).toBe('/about');
      expect(response.body.modulePath).toBe('src/pages/about.tsx');
    });
  });

  describe('workspace unavailable (503)', function workspaceUnavailableTests() {
    beforeEach(() => {
      vi.mocked(createForWorkspace).mockReturnValue(null);
    });

    it.each([
      ['GET', '/apps/app-123/git/history', undefined],
      ['PATCH', '/apps/app-123/git/commit-message', { message: 'test' }],
      ['GET', '/apps/app-123/git/status', undefined],
      ['GET', '/apps/app-123/git/diff?commitHash=abc1234', undefined],
      ['POST', '/apps/app-123/git/checkout', { commitHash: 'abc1234' }],
      ['POST', '/apps/app-123/git/return', {}],
      ['POST', '/apps/app-123/git/restore', {}],
    ])('%s %s returns 503 when workspace is null', async (method, pathWithQuery, body) => {
      const app = createTestApp();
      const [path, query] = pathWithQuery.split('?');
      let req;
      if (method === 'GET') {
        req = request(app).get(path);
        if (query) req = req.query(Object.fromEntries(new URLSearchParams(query)));
      } else if (method === 'PATCH') {
        req = request(app).patch(path).send(body);
      } else {
        req = request(app).post(path).send(body);
      }

      const response = await req;

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Preview container is not available');
    });
  });
});
