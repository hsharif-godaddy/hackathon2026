import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => {
  return {
    findById: vi.fn(),
    getCurrentBranch: vi.fn(),
    getStatus: vi.fn(),
    hasRemote: vi.fn(),
    amendCommitMessage: vi.fn(),
    getCurrentCommit: vi.fn(),
    forApp: vi.fn(),
    logError: vi.fn(),
    createForApp: vi.fn(),
  };
});

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: mocks.findById,
  })),
}));

vi.mock('../../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(() => ({
    getCurrentBranch: mocks.getCurrentBranch,
    getStatus: mocks.getStatus,
    hasRemote: mocks.hasRemote,
    amendCommitMessage: mocks.amendCommitMessage,
    getCurrentCommit: mocks.getCurrentCommit,
  })),
}));

vi.mock('../../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: mocks.createForApp,
  },
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
  validateAppOwnership: vi.fn((_req, _res, next) => next()),
}));

import gitRouter from '../git.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(gitRouter);
  return app;
}

describe('git routes', function gitRouteTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();

    mocks.findById.mockReturnValue({ path: '/app' });
    mocks.getCurrentBranch.mockResolvedValue('main');
    mocks.getStatus.mockResolvedValue({ stagedFiles: 0 });
    mocks.hasRemote.mockResolvedValue(false);
    mocks.amendCommitMessage.mockResolvedValue({ success: true, stderr: '' });
    mocks.getCurrentCommit.mockResolvedValue('1234567890abcdef1234567890abcdef12345678');
    mocks.forApp.mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
    mocks.createForApp.mockReturnValue(null);
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
});
