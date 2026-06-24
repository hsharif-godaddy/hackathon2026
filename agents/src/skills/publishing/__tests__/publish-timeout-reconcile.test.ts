import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../logging/index.js';
import {
  commitsMatch,
  isPublishTimeoutError,
  reconcilePublishAfterTimeout,
} from '../publish-timeout-reconcile.js';
import {
  PUBLISH_CLIENT_ACTION_TIMEOUT_MS,
  PUBLISH_CONFIRMATION_TIMEOUT_MS,
  PUBLISH_RECONCILE_POLL_TIMEOUT_MS,
  PUBLISH_SKILL_TOOL_TIMEOUT_MS,
} from '../publish-timeouts.js';

vi.mock('../../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => instance,
  };
  return {
    logger: instance,
    Logger: { create: () => instance },
  };
});

const mockStatus = vi.fn();
const mockGetCurrentCommit = vi.fn();

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn((_appId: string, variant: string) => {
    if (variant === 'publish') {
      return { deployments: { status: mockStatus } };
    }
    if (variant === 'preview') {
      return { tasks: {} };
    }
    return null;
  }),
}));

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return {
      findById: vi.fn().mockReturnValue({ path: '/app/path' }),
    };
  }),
}));

vi.mock('../../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function () {
    return {
      getCurrentCommit: mockGetCurrentCommit,
    };
  }),
}));

describe('publish-timeout-reconcile', function packageTests() {
  beforeEach(function setup() {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockGetCurrentCommit.mockResolvedValue('deadbeef1234567890abcdef1234567890abcd');
    mockStatus.mockResolvedValue({
      version: 'deadbeef1234567890abcdef1234567890abcd',
      health: { status: 'healthy', message: 'ok' },
      process: { state: 'running' },
    });
  });

  afterEach(function teardown() {
    vi.useRealTimers();
  });

  describe('publish-timeouts', function timeoutConstants() {
    it('reserves reconcile headroom in the skill tool race', function skillToolBudget() {
      expect(PUBLISH_SKILL_TOOL_TIMEOUT_MS).toBe(
        PUBLISH_CONFIRMATION_TIMEOUT_MS +
        PUBLISH_CLIENT_ACTION_TIMEOUT_MS +
        PUBLISH_RECONCILE_POLL_TIMEOUT_MS
      );
    });
  });

  describe('#isPublishTimeoutError', function timeoutErrorTests() {
    it('detects execution timeout messages', function executionTimeout() {
      expect(isPublishTimeoutError('Tool publishing__publish execution timeout')).toBe(true);
      expect(isPublishTimeoutError(`Request timeout after ${PUBLISH_CLIENT_ACTION_TIMEOUT_MS}ms`)).toBe(true);
    });

    it('ignores unrelated errors', function unrelated() {
      expect(isPublishTimeoutError('Build failed with exit code 1')).toBe(false);
    });
  });

  describe('#commitsMatch', function commitMatchTests() {
    it('matches full and short hashes', function shortHash() {
      expect(commitsMatch('deadbeef', 'deadbeef1234567890')).toBe(true);
      expect(commitsMatch('deadbeef1234567890', 'deadbeef')).toBe(true);
    });

    it('rejects null and undefined versions', function nullVersion() {
      expect(commitsMatch('deadbeef', null)).toBe(false);
      expect(commitsMatch('deadbeef', undefined)).toBe(false);
    });
  });

  describe('#reconcilePublishAfterTimeout', function reconcileTests() {
    it('returns verified when production is healthy on expected commit', async function verified() {
      const result = await reconcilePublishAfterTimeout({ appId: 'app-1' });

      expect(result).toEqual({
        verified: true,
        commitHash: 'deadbeef1234567890abcdef1234567890abcd',
      });
      expect(mockStatus).toHaveBeenCalled();
    });

    it('returns unverified when version does not match', async function versionMismatch() {
      vi.useFakeTimers();
      mockStatus.mockResolvedValue({
        version: '0000000000000000000000000000000000000000',
        health: { status: 'healthy', message: 'ok' },
        process: { state: 'running' },
      });

      const promise = reconcilePublishAfterTimeout({
        appId: 'app-1',
        pollTimeoutMs: 1,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.verified).toBe(false);
    });

    it('returns unverified when production process is in error state', async function processError() {
      mockStatus.mockResolvedValue({
        version: 'deadbeef1234567890abcdef1234567890abcd',
        health: { status: 'unhealthy', message: 'build failed' },
        process: { state: 'error' },
      });

      const result = await reconcilePublishAfterTimeout({ appId: 'app-1' });

      expect(result).toEqual({
        verified: false,
        reason: 'build failed',
      });
    });

    it('logs when git commit resolution fails', async function gitResolveFailed() {
      mockGetCurrentCommit.mockRejectedValue(new Error('not a git repo'));

      const result = await reconcilePublishAfterTimeout({ appId: 'app-1' });

      expect(result.verified).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'skill.publishing.publish.timeout_reconcile.commit_resolve_failed',
        expect.objectContaining({ appId: 'app-1', error: 'not a git repo' })
      );
    });
  });
});
