/**
 * Events API Endpoint Tests
 *
 * Tests the POST /api/apps/[id]/events endpoint for:
 * - Authentication and authorization
 * - Request body validation (Zod schema)
 * - Site existence and metadata checks
 * - Event recording via mgmt-airo client
 * - Error handling and edge cases
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const { mockControlPlaneAdapter, mockAuthenticateCustomer, mockAiroMgmtClient, mockLogger } = vi.hoisted(() => {
  return {
    mockControlPlaneAdapter: {
      getSite: vi.fn(),
    },
    mockAuthenticateCustomer: vi.fn(),
    mockAiroMgmtClient: {
      recordEvent: vi.fn(),
    },
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn().mockReturnValue(mockControlPlaneAdapter),
}));

vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  return {
    ...actual,
    AiroMgmtClient: vi.fn().mockImplementation(function () { return mockAiroMgmtClient; }),
  };
});

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn(function (handler) {
      return async (request: NextRequest, ...args: unknown[]) => {
        const authContext = await mockAuthenticateCustomer(request);

        if (!authContext.isAuthenticated) {
          return new Response(
            JSON.stringify({ error: 'Unauthorized', message: authContext.error, requiresAuth: true }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return handler(request, authContext, ...args);
      };
    }),
    customerHasAccount: vi.fn(function (user) {
      return !!user.accountId;
    }),
    createCustomerAuthError: vi.fn(function (message: string, status: number) {
      return new Response(
        JSON.stringify({ error: message }),
        { status, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  };
});

const MOCK_SITE_ID = 'site-123';
const MOCK_SUBSCRIPTION_ID = 'subscription-789';
const MOCK_SYSTEM_ID = 'system-012';

const MOCK_USER = {
  shopperId: 'shopper-789',
  customerId: 'customer-789',
  accountId: 'account-456',
  authType: 'sso',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

const MOCK_V2_SITE = {
  id: MOCK_SITE_ID,
  account_id: 'account-456',
  name: 'Test Site',
  status: 'running' as const,
  agent_url: 'https://agent.example.com',
  preview_url: 'https://preview.example.com',
  subscription_id: MOCK_SUBSCRIPTION_ID,
  system_id: MOCK_SYSTEM_ID,
  created_at: new Date(),
  updated_at: new Date(),
};

const MOCK_SITE_MISSING_IDS = {
  id: MOCK_SITE_ID,
  account_id: 'account-456',
  name: 'Legacy Site',
  status: 'running' as const,
  agent_url: 'https://agent.example.com',
  preview_url: 'https://preview.example.com',
  created_at: new Date(),
  updated_at: new Date(),
};

const MOCK_EVENT_BODY = {
  eventType: 'build.initial_build_completed',
  occurredAt: '2026-01-15T10:00:00Z',
  idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
};

const MOCK_EVENT_RESPONSE = {
  id: 'evt-123',
  appId: MOCK_SITE_ID,
  eventType: 'build.initial_build_completed',
  occurredAt: '2026-01-15T10:00:00Z',
};

function createPostRequest(siteId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/apps/${siteId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('events API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAiroMgmtClient.recordEvent.mockResolvedValue(MOCK_EVENT_RESPONSE);
  });

  describe('#POST', () => {
    describe('authentication', () => {
      it('should return 401 when user is not authenticated', async () => {
        mockAuthenticateCustomer.mockResolvedValue({ isAuthenticated: false, error: 'Invalid token' });

        const request = createPostRequest(MOCK_SITE_ID, MOCK_EVENT_BODY);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 401 when JWT token is missing', async () => {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: null,
        });

        const request = createPostRequest(MOCK_SITE_ID, MOCK_EVENT_BODY);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe('Authentication token required');
      });

      it('should return 403 when user has no account', async () => {
        const userWithoutAccount = { ...MOCK_USER, accountId: undefined };
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: userWithoutAccount,
          jwt: 'user-jwt-token',
        });

        const request = createPostRequest(MOCK_SITE_ID, MOCK_EVENT_BODY);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.error).toBe('You must have an account to record events');
      });
    });

    describe('request body validation', () => {
      beforeEach(() => {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token',
        });
        mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      });

      it('should return 400 when body is invalid JSON', async () => {
        const request = new NextRequest(`http://localhost:3000/api/apps/${MOCK_SITE_ID}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not valid json{',
        });

        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Invalid request body');
      });

      it('should return 400 when eventType is missing', async () => {
        const { eventType: _, ...bodyWithoutEventType } = MOCK_EVENT_BODY;

        const request = createPostRequest(MOCK_SITE_ID, bodyWithoutEventType);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Invalid request body');
      });

      it('should return 400 when occurredAt is missing', async () => {
        const { occurredAt: _, ...bodyWithoutOccurredAt } = MOCK_EVENT_BODY;

        const request = createPostRequest(MOCK_SITE_ID, bodyWithoutOccurredAt);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Invalid request body');
      });

      it('should return 400 when idempotencyKey is missing', async () => {
        const { idempotencyKey: _, ...bodyWithoutIdempotencyKey } = MOCK_EVENT_BODY;

        const request = createPostRequest(MOCK_SITE_ID, bodyWithoutIdempotencyKey);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Invalid request body');
      });

      it('should accept optional metadata field', async () => {
        const bodyWithMetadata = {
          ...MOCK_EVENT_BODY,
          metadata: { source: 'websocket', buildDuration: 42 },
        };

        const request = createPostRequest(MOCK_SITE_ID, bodyWithMetadata);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });

        expect(response.status).toBe(200);
        expect(mockAiroMgmtClient.recordEvent).toHaveBeenCalledWith(
          MOCK_SUBSCRIPTION_ID,
          MOCK_SYSTEM_ID,
          MOCK_SITE_ID,
          expect.objectContaining({ metadata: { source: 'websocket', buildDuration: 42 } }),
        );
      });
    });

    describe('site validation', () => {
      beforeEach(() => {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token',
        });
      });

      it('should return 404 when site is not found', async () => {
        mockControlPlaneAdapter.getSite.mockResolvedValue(null);

        const request = createPostRequest(MOCK_SITE_ID, MOCK_EVENT_BODY);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe('Site not found');
      });

      it('should return 400 when site is missing subscription_id', async () => {
        mockControlPlaneAdapter.getSite.mockResolvedValue({
          ...MOCK_SITE_MISSING_IDS,
          system_id: MOCK_SYSTEM_ID,
        });

        const request = createPostRequest(MOCK_SITE_ID, MOCK_EVENT_BODY);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Site missing required metadata (subscription_id or system_id)');
      });

      it('should return 400 when site is missing system_id', async () => {
        mockControlPlaneAdapter.getSite.mockResolvedValue({
          ...MOCK_SITE_MISSING_IDS,
          subscription_id: MOCK_SUBSCRIPTION_ID,
        });

        const request = createPostRequest(MOCK_SITE_ID, MOCK_EVENT_BODY);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Site missing required metadata (subscription_id or system_id)');
      });
    });

    describe('event recording', () => {
      beforeEach(() => {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: MOCK_USER,
          jwt: 'user-jwt-token',
        });
        mockControlPlaneAdapter.getSite.mockResolvedValue(MOCK_V2_SITE);
      });

      it('should record the event and return the mgmt-airo response', async () => {
        const request = createPostRequest(MOCK_SITE_ID, MOCK_EVENT_BODY);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual(MOCK_EVENT_RESPONSE);
        expect(mockAiroMgmtClient.recordEvent).toHaveBeenCalledWith(
          MOCK_SUBSCRIPTION_ID,
          MOCK_SYSTEM_ID,
          MOCK_SITE_ID,
          MOCK_EVENT_BODY,
        );
      });

      it('should return 502 when recordEvent throws', async () => {
        mockAiroMgmtClient.recordEvent.mockRejectedValue(new Error('upstream error'));

        const request = createPostRequest(MOCK_SITE_ID, MOCK_EVENT_BODY);
        const response = await POST(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
        const data = await response.json();

        expect(response.status).toBe(502);
        expect(data.error).toBe('Upstream event recording failed');
        expect(data.message).toBe('upstream error');
      });
    });
  });
});
