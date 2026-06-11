import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock must be declared before the vi.mock() call to avoid hoisting issues
const mockFindByAppAndPlatform = vi.fn();

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
      // Use function to avoid TDZ error - captures mockFindByAppAndPlatform at construction time
      findByAppAndPlatform(...args: unknown[]) {
        return mockFindByAppAndPlatform(...args);
      }
    },
  };
});

import { checkConnectionTool, fetchReviewsTool } from '../index.js';
import { GOOGLE_REVIEWS_READY } from '../../../../types/social.js';

function runCheckConnection(context?: Record<string, unknown>) {
  return checkConnectionTool.execute({}, context);
}

function runFetchReviews(context?: Record<string, unknown>) {
  return fetchReviewsTool.execute({}, context);
}

describe('google-reviews tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByAppAndPlatform.mockReset();
  });

  describe('#checkConnectionTool', () => {
    describe('execute', () => {
      it('returns error when appId is missing', async () => {
        const result = await runCheckConnection({ metadata: {} });

        expect(result).toMatchObject({
          success: false,
          error: 'App ID is required',
          recoverable: false,
        });
      });

      it('returns requiresConnection when no GBP associations found', async () => {
        mockFindByAppAndPlatform.mockReturnValue([]);

        const result = await runCheckConnection({
          metadata: { appId: 'test-app-123' },
        });

        expect(result).toMatchObject({
          action: 'requiresConnection',
          success: false,
          workflowPending: true,
        });
        expect(result.message).toContain('social-platform__socialConnect');
      });

      it('returns connected when GBP association exists', async () => {
        mockFindByAppAndPlatform.mockReturnValue([
          { socialId: 'gbp-123' },
        ]);

        const result = await runCheckConnection({
          metadata: { appId: 'test-app-456' },
        });

        expect(result).toMatchObject({
          connected: true,
          success: true,
          socialId: 'gbp-123',
          locationCount: 1,
        });
      });

      it('returns first association when multiple locations exist', async () => {
        mockFindByAppAndPlatform.mockReturnValue([
          { socialId: 'gbp-first' },
          { socialId: 'gbp-second' },
          { socialId: 'gbp-third' },
        ]);

        const result = await runCheckConnection({
          metadata: { appId: 'test-app' },
        });

        expect(result).toMatchObject({
          connected: true,
          socialId: 'gbp-first',
          locationCount: 3,
        });
      });

      it('returns error on repository exception', async () => {
        mockFindByAppAndPlatform.mockImplementation(() => {
          throw new Error('Database connection failed');
        });

        const result = await runCheckConnection({
          metadata: { appId: 'test-app' },
        });

        expect(result).toMatchObject({
          success: false,
          error: 'Database connection failed',
          recoverable: true,
        });
      });
    });

    describe('computeState', () => {
      it('returns error state when output has error', () => {
        const state = checkConnectionTool.computeState?.(
          {},
          { error: 'Network timeout', recoverable: true }
        );

        expect(state).toMatchObject({
          workflowState: 'connection-check-failed',
          lastError: 'Network timeout',
          nextStep: 'retry-connection-check',
        });
        expect(state?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('returns pending state when OAuth needed', () => {
        const state = checkConnectionTool.computeState?.(
          {},
          { action: 'requiresConnection', workflowPending: true }
        );

        expect(state).toMatchObject({
          workflowState: 'pending-gbp-connection',
          nextStep: 'fetch-reviews-and-install',
          lastError: null,
        });
        expect(state?.updatedAt).toBeDefined();
      });

      it('returns connected state with socialId', () => {
        const state = checkConnectionTool.computeState?.(
          {},
          { connected: true, socialId: 'gbp-789', locationCount: 2 }
        );

        expect(state).toMatchObject({
          workflowState: 'connected',
          socialId: 'gbp-789',
          locationCount: 2,
          nextStep: 'fetch-reviews',
          lastError: null,
        });
        expect(state?.updatedAt).toBeDefined();
      });

      it('returns null for unexpected output', () => {
        const state = checkConnectionTool.computeState?.(
          {},
          { unexpected: 'output' }
        );

        expect(state).toBeNull();
      });

      it('clears lastError on successful connection', () => {
        const state = checkConnectionTool.computeState?.(
          {},
          { connected: true, socialId: 'gbp-123', locationCount: 1 }
        );

        expect(state?.lastError).toBeNull();
      });

      it('clears lastError when OAuth initiated', () => {
        const state = checkConnectionTool.computeState?.(
          {},
          { workflowPending: true }
        );

        expect(state?.lastError).toBeNull();
      });
    });

    describe('parameter schema validation', () => {
      it('accepts empty parameters object', () => {
        expect(() => checkConnectionTool.parameters.parse({})).not.toThrow();
      });

      it('accepts and ignores extra parameters (passthrough)', () => {
        // Zod schemas are passthrough by default - extra params don't cause errors
        const result = checkConnectionTool.parameters.parse({ extra: 'param' });
        expect(result).toBeDefined();
      });
    });
  });

  describe('#fetchReviewsTool', () => {
    describe('execute', () => {
      it('returns error when appId is missing', async () => {
        const result = await runFetchReviews({ metadata: {} });

        expect(result).toMatchObject({
          success: false,
          error: 'App ID is required',
          reviews: [],
        });
      });

      it('returns reviews from context attachment (pass 2)', async () => {
        const mockReviews = [
          {
            reviewId: 'rev1',
            reviewer: { displayName: 'John Doe' },
            starRating: 5,
            comment: 'Great service!',
          },
          {
            reviewId: 'rev2',
            reviewer: { displayName: 'Jane Smith' },
            starRating: 4,
            comment: 'Good experience',
          },
        ];

        const result = await runFetchReviews({
          metadata: { appId: 'test-app' },
          contextAttachments: [
            {
              type: GOOGLE_REVIEWS_READY,
              data: {
                reviews: mockReviews,
                averageRating: 4.5,
                totalReviewCount: 2,
              },
            },
          ],
        });

        expect(result).toMatchObject({
          success: true,
          reviews: mockReviews,
          averageRating: 4.5,
          totalReviewCount: 2,
        });
      });

      it('returns fetchReviews signal when no context attachment (pass 1)', async () => {
        mockFindByAppAndPlatform.mockReturnValue([
          { socialId: 'gbp-123' },
        ]);

        const result = await runFetchReviews({
          metadata: { appId: 'test-app' },
          contextAttachments: [],
        });

        expect(result).toMatchObject({
          action: 'fetchReviews',
          success: true,
          appId: 'test-app',
          socialId: 'gbp-123',
          locationCount: 1,
        });
      });

      it('returns error when GBP not connected', async () => {
        mockFindByAppAndPlatform.mockReturnValue([]);

        const result = await runFetchReviews({
          metadata: { appId: 'test-app' },
        });

        expect(result).toMatchObject({
          success: false,
          reviews: [],
        });
        expect(result.error).toContain('No Google Business Profile connection');
      });

      it('uses first association when multiple locations exist', async () => {
        mockFindByAppAndPlatform.mockReturnValue([
          { socialId: 'gbp-first' },
          { socialId: 'gbp-second' },
        ]);

        const result = await runFetchReviews({
          metadata: { appId: 'test-app' },
        });

        expect(result).toMatchObject({
          socialId: 'gbp-first',
          locationCount: 2,
        });
      });

      it('returns error on repository exception', async () => {
        mockFindByAppAndPlatform.mockImplementation(() => {
          throw new Error('Database failure');
        });

        const result = await runFetchReviews({
          metadata: { appId: 'test-app' },
        });

        expect(result).toMatchObject({
          success: false,
          error: 'Database failure',
          reviews: [],
        });
      });
    });

    describe('computeState', () => {
      it('returns fetching state on pass 1 signal', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          { action: 'fetchReviews', socialId: 'gbp-123' }
        );

        expect(state).toMatchObject({
          workflowState: 'fetching-reviews',
          nextStep: 'wait-for-context-attachment',
          lastError: null,
        });
        expect(state?.updatedAt).toBeDefined();
      });

      it('returns fetch-failed state with reconnect when needsReconnect flag is true', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          { error: 'Token expired', success: false, reviews: [], needsReconnect: true }
        );

        expect(state).toMatchObject({
          workflowState: 'fetch-failed',
          lastError: 'Token expired',
          nextStep: 'reconnect-gbp',
        });
      });

      it('returns fetch-failed state with retry when needsReconnect flag is false', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          { error: 'API rate limit exceeded', success: false, reviews: [], needsReconnect: false }
        );

        expect(state).toMatchObject({
          workflowState: 'fetch-failed',
          lastError: 'API rate limit exceeded',
          nextStep: 'retry-fetch',
        });
      });

      it('defaults to retry when needsReconnect flag is absent', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          { error: 'Network error', success: false, reviews: [] }
        );

        expect(state?.nextStep).toBe('retry-fetch');
      });

      it('returns reviews-fetched state with review count', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          {
            success: true,
            reviews: [{ id: '1' }, { id: '2' }, { id: '3' }],
            averageRating: 4.2,
          }
        );

        expect(state).toMatchObject({
          workflowState: 'reviews-fetched',
          reviewCount: 3,
          averageRating: 4.2,
          nextStep: 'install-component',
          lastError: null,
        });
      });

      it('returns no-reviews-found state for empty array', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          { success: true, reviews: [] }
        );

        expect(state).toMatchObject({
          workflowState: 'no-reviews-found',
          nextStep: 'inform-user',
          lastError: null,
        });
      });

      it('returns null for success without reviews property', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          { success: true } as any // Invalid output shape - should return null
        );

        expect(state).toBeNull();
      });

      it('returns null for unexpected output', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          { unexpected: 'output' }
        );

        expect(state).toBeNull();
      });

      it('clears lastError on successful fetch', () => {
        const state = fetchReviewsTool.computeState?.(
          {},
          { success: true, reviews: [{ id: '1' }] }
        );

        expect(state?.lastError).toBeNull();
      });

      it('uses single updatedAt timestamp across all states', () => {
        const states = [
          fetchReviewsTool.computeState?.({}, { action: 'fetchReviews' }),
          fetchReviewsTool.computeState?.({}, { error: 'Failed' }),
          fetchReviewsTool.computeState?.({}, { success: true, reviews: [] }),
        ];

        for (const state of states) {
          expect(state).toHaveProperty('updatedAt');
          expect(state).not.toHaveProperty('fetchInitiatedAt');
          expect(state).not.toHaveProperty('lastAttempt');
          expect(state).not.toHaveProperty('lastCheckedAt');
          expect(state).not.toHaveProperty('lastFetchedAt');
        }
      });
    });

    describe('parameter schema validation', () => {
      it('accepts empty parameters object', () => {
        expect(() => fetchReviewsTool.parameters.parse({})).not.toThrow();
      });

      it('accepts and ignores extra parameters (passthrough)', () => {
        // Zod schemas are passthrough by default - extra params don't cause errors
        const result = fetchReviewsTool.parameters.parse({ socialId: 'gbp-123' });
        expect(result).toBeDefined();
      });
    });
  });
});
