import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFindByAppAndPlatform = vi.fn();
const mockGetActionService = vi.fn();

vi.mock('../../../../logging/index.js', () => {
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

vi.mock('../../../../database/repositories/SocialAssociationRepository.js', () => {
  return {
    SocialAssociationRepository: class {
      findByAppAndPlatform(...args: unknown[]) {
        return mockFindByAppAndPlatform(...args);
      }
    },
  };
});

vi.mock('../../../../server/agent-runtime.js', () => ({
  getActionService: (...args: unknown[]) => mockGetActionService(...args),
}));

import { executeWorkflowTool } from '../index.js';

function runExecuteWorkflow(context?: Record<string, unknown>, input: Record<string, unknown> = {}) {
  return executeWorkflowTool.execute(input, context);
}

describe('google-reviews executeWorkflow tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByAppAndPlatform.mockReset();
    mockGetActionService.mockReset();
  });

  describe('execute', () => {
    it('returns error when appId is missing', async () => {
      const result = await runExecuteWorkflow({ metadata: {} });

      expect(result).toMatchObject({
        phase: 'error',
        success: false,
        error: 'App ID is required',
        recoverable: false,
      });
    });

    it('returns awaiting-oauth when no GBP associations found', async () => {
      mockFindByAppAndPlatform.mockReturnValue([]);

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app-123' },
        socketId: 'socket-1',
      });

      expect(result).toMatchObject({
        phase: 'awaiting-oauth',
        action: 'connect',
        platform: 'GOOGLE_BUSINESS_PROFILE',
      });
      expect(result.message).toContain('not connected');
    });

    it('does not require clientActionService for OAuth path', async () => {
      mockFindByAppAndPlatform.mockReturnValue([]);

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
      });

      expect(result).toMatchObject({ phase: 'awaiting-oauth' });
      expect(mockGetActionService).not.toHaveBeenCalled();
    });

    it('returns error when clientActionService is unavailable for connected path', async () => {
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-123' }]);
      mockGetActionService.mockReturnValue(null);

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
        socketId: 'socket-1',
      });

      expect(result).toMatchObject({
        phase: 'error',
        success: false,
        error: 'Client action service unavailable',
        recoverable: true,
      });
    });

    it('returns error when socketId is missing for connected path', async () => {
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-123' }]);

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
      });

      expect(result).toMatchObject({
        phase: 'error',
        success: false,
        error: 'Client action service unavailable',
        recoverable: true,
      });
    });

    it('fetches reviews via clientActionService and returns complete result', async () => {
      const mockReviews = [
        { reviewId: 'rev1', reviewer: { displayName: 'John' }, starRating: 5, comment: 'Great!' },
        { reviewId: 'rev2', reviewer: { displayName: 'Jane' }, starRating: 4, comment: 'Good' },
      ];
      const mockClientAction = {
        executeAction: vi.fn().mockResolvedValue({
          success: true,
          result: { reviews: mockReviews, averageRating: 4.5, totalReviewCount: 2 },
        }),
      };
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-456' }]);
      mockGetActionService.mockReturnValue(mockClientAction);

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
        socketId: 'socket-1',
      });

      expect(result).toMatchObject({
        phase: 'complete',
        success: true,
        reviews: mockReviews,
        averageRating: 4.5,
        totalReviewCount: 2,
        installSkill: true,
      });
      expect(mockClientAction.executeAction).toHaveBeenCalledWith({
        action: 'fetch_google_reviews',
        params: { socialId: 'gbp-456', appId: 'test-app' },
        timeoutMs: 30000,
      });
    });

    it('returns no-reviews result when fetch succeeds but reviews are empty', async () => {
      const mockClientAction = {
        executeAction: vi.fn().mockResolvedValue({
          success: true,
          result: { reviews: [], averageRating: undefined, totalReviewCount: 0 },
        }),
      };
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-789' }]);
      mockGetActionService.mockReturnValue(mockClientAction);

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
        socketId: 'socket-1',
      });

      expect(result).toMatchObject({
        phase: 'complete',
        success: true,
        reviews: [],
        totalReviewCount: 0,
        installSkill: false,
      });
      expect(result.message).toContain('no reviews');
    });

    it('returns error when clientActionService fetch fails', async () => {
      const mockClientAction = {
        executeAction: vi.fn().mockResolvedValue({
          success: false,
          error: 'Token expired',
        }),
      };
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-123' }]);
      mockGetActionService.mockReturnValue(mockClientAction);

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
        socketId: 'socket-1',
      });

      expect(result).toMatchObject({
        phase: 'awaiting-oauth',
        action: 'connect',
        platform: 'GOOGLE_BUSINESS_PROFILE',
        message: expect.stringContaining('Token expired'),
      });
    });

    it('uses first association when multiple locations exist', async () => {
      const mockClientAction = {
        executeAction: vi.fn().mockResolvedValue({
          success: true,
          result: { reviews: [{ reviewId: 'r1' }], averageRating: 5.0, totalReviewCount: 1 },
        }),
      };
      mockFindByAppAndPlatform.mockReturnValue([
        { socialId: 'gbp-first' },
        { socialId: 'gbp-second' },
        { socialId: 'gbp-third' },
      ]);
      mockGetActionService.mockReturnValue(mockClientAction);

      await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
        socketId: 'socket-1',
      });

      expect(mockClientAction.executeAction).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ socialId: 'gbp-first' }) }),
      );
    });

    it('returns awaiting-oauth when forceReconnect is true even if already connected', async () => {
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-existing' }]);

      const result = await runExecuteWorkflow(
        { metadata: { appId: 'test-app' }, socketId: 'socket-1' },
        { forceReconnect: true },
      );

      expect(result).toMatchObject({
        phase: 'awaiting-oauth',
        action: 'connect',
        platform: 'GOOGLE_BUSINESS_PROFILE',
      });
      expect(result.message).toContain('different business');
      expect(mockGetActionService).not.toHaveBeenCalled();
    });

    it('returns error on repository exception', async () => {
      mockFindByAppAndPlatform.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
        socketId: 'socket-1',
      });

      expect(result).toMatchObject({
        phase: 'error',
        success: false,
        error: 'Database connection failed',
        recoverable: true,
      });
    });

    it('handles missing result data gracefully', async () => {
      const mockClientAction = {
        executeAction: vi.fn().mockResolvedValue({ success: true, result: undefined }),
      };
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-123' }]);
      mockGetActionService.mockReturnValue(mockClientAction);

      const result = await runExecuteWorkflow({
        metadata: { appId: 'test-app' },
        socketId: 'socket-1',
      });

      expect(result).toMatchObject({
        phase: 'complete',
        success: true,
        reviews: [],
        installSkill: false,
      });
    });
  });

  describe('computeState', () => {
    it('returns error state on failure', () => {
      const state = executeWorkflowTool.computeState?.(
        {},
        { phase: 'error', success: false, error: 'Network timeout', recoverable: true },
      );

      expect(state).toMatchObject({
        phase: 'error',
        lastError: 'Network timeout',
      });
      expect(state?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns awaiting-oauth state', () => {
      const state = executeWorkflowTool.computeState?.(
        {},
        { phase: 'awaiting-oauth', action: 'connect', platform: 'GOOGLE_BUSINESS_PROFILE', message: '' },
      );

      expect(state).toMatchObject({
        phase: 'awaiting-oauth',
        lastError: null,
      });
      expect(state?.updatedAt).toBeDefined();
    });

    it('returns complete state with review count', () => {
      const state = executeWorkflowTool.computeState?.(
        {},
        { phase: 'complete', success: true, reviews: [{ id: '1' }, { id: '2' }], averageRating: 4.5, installSkill: true },
      );

      expect(state).toMatchObject({
        phase: 'complete',
        reviewCount: 2,
        averageRating: 4.5,
        lastError: null,
      });
      expect(state?.updatedAt).toBeDefined();
    });

    it('returns complete state with zero reviews', () => {
      const state = executeWorkflowTool.computeState?.(
        {},
        { phase: 'complete', success: true, reviews: [], installSkill: false, message: 'No reviews' },
      );

      expect(state).toMatchObject({
        phase: 'complete',
        reviewCount: 0,
        lastError: null,
      });
    });

    it('returns null for unexpected output', () => {
      const state = executeWorkflowTool.computeState?.(
        {},
        { unexpected: 'output' },
      );

      expect(state).toBeNull();
    });
  });

  describe('parameter schema', () => {
    it('accepts empty parameters object', () => {
      expect(() => executeWorkflowTool.parameters.parse({})).not.toThrow();
    });

    it('accepts forceReconnect parameter', () => {
      expect(() => executeWorkflowTool.parameters.parse({ forceReconnect: true })).not.toThrow();
    });
  });
});
