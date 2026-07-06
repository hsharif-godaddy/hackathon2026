/**
 * GET /api/switchboard route tests
 *
 * Covers allow-list-based filtering of the Gasket switchboard tree into
 * `hivemind` (entries named by the `appbuilder-allowed-experiment-ids`
 * tree value) and `switchboard` (entries named by the
 * `appbuilder-allowed-switchboard-configs` tree value), plus error handling
 * when the upstream call fails.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthenticateCustomer, mockGetSwitchboardTree } = vi.hoisted(() => ({
  mockAuthenticateCustomer: vi.fn(),
  mockGetSwitchboardTree: vi.fn(),
}));

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn((handler) => async (request: NextRequest, ...args: unknown[]) => {
      const authContext = await mockAuthenticateCustomer(request);
      if (!authContext.isAuthenticated) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return handler(request, authContext, ...args);
    }),
  };
});

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/switchboard/server', () => ({
  getSwitchboardTree: mockGetSwitchboardTree,
}));

import { GET } from '../route';

const makeRequest = (): NextRequest =>
  new NextRequest('https://airo-builder.test-godaddy.com/api/switchboard', { method: 'GET' });

const AUTH_CONTEXT = {
  isAuthenticated: true,
  user: {
    shopperId: 'shopper-123',
    customerId: 'cust-123',
    accountId: 'acct-123',
    authType: 'basic',
    isE2S: false,
  },
  jwt: 'test-jwt',
};

describe('GET /api/switchboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateCustomer.mockResolvedValue(AUTH_CONTEXT);
  });

  describe('response filtering', () => {
    it('should return empty hivemind and switchboard when tree is empty', async () => {
      mockGetSwitchboardTree.mockResolvedValue({});

      const res = await GET(makeRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toStrictEqual({ hivemind: {}, switchboard: {} });
    });

    it('should filter out entries not in either allow-list', async () => {
      mockGetSwitchboardTree.mockResolvedValue({
        'appbuilder-share-links': true,
        'some-unlisted-experiment': { cohortId: 'variant-a' },
        'appbuilder-model-selector': false,
      });

      const res = await GET(makeRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toStrictEqual({ hivemind: {}, switchboard: {} });
    });

    it('should return entries named by the allow-list settings in the tree itself', async () => {
      mockGetSwitchboardTree.mockResolvedValue({
        'appbuilder-allowed-experiment-ids': ['airo-build-initial-agent'],
        'appbuilder-allowed-switchboard-configs': ['appbuilder-share-links'],
        'airo-build-initial-agent': { cohortId: 'variant-a' },
        'appbuilder-share-links': true,
        'appbuilder-model-selector': false,
      });

      const res = await GET(makeRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toStrictEqual({
        hivemind: { 'airo-build-initial-agent': { cohortId: 'variant-a' } },
        switchboard: { 'appbuilder-share-links': true },
      });
    });

    it('should ignore non-string entries in the allow-list settings', async () => {
      mockGetSwitchboardTree.mockResolvedValue({
        'appbuilder-allowed-experiment-ids': ['airo-build-initial-agent', 42, null],
        'airo-build-initial-agent': { cohortId: 'variant-a' },
      });

      const res = await GET(makeRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toStrictEqual({
        hivemind: { 'airo-build-initial-agent': { cohortId: 'variant-a' } },
        switchboard: {},
      });
    });
  });

  describe('error handling', () => {
    it('should return 500 when getSwitchboardTree throws', async () => {
      mockGetSwitchboardTree.mockRejectedValue(new Error('switchboard unavailable'));

      const res = await GET(makeRequest());
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toStrictEqual({ error: 'Failed to fetch experiments and configs' });
    });
  });

  describe('authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockAuthenticateCustomer.mockResolvedValue({ isAuthenticated: false });

      const res = await GET(makeRequest());

      expect(res.status).toBe(401);
    });

    it('should not call getSwitchboardTree when unauthenticated', async () => {
      mockAuthenticateCustomer.mockResolvedValue({ isAuthenticated: false });

      await GET(makeRequest());

      expect(mockGetSwitchboardTree).not.toHaveBeenCalled();
    });
  });
});
