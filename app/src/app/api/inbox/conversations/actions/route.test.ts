import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: (...args: unknown[]) => unknown) => handler,
}));
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/utils/api-errors', () => ({
  ApiErrorCode: { AUTH_REQUIRED: 'AUTH_REQUIRED' },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.stubEnv('ENVIRONMENT_NAME', 'development');

const { PUT } = await import('./route');

describe('PUT /api/inbox/conversations/actions', () => {
  const BRAND_ID = '550e8400-e29b-41d4-a716-446655440000';
  const createAuthContext = (jwt?: string) => ({ jwt });

  function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/inbox/conversations/actions', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 when JWT is missing', async () => {
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['1'], action: 'resolve' });
      const response = await PUT(request, createAuthContext());
      expect(response.status).toBe(401);
    });
  });

  describe('validation', () => {
    it('returns 400 when body is invalid JSON', async () => {
      const request = new NextRequest('http://localhost/api/inbox/conversations/actions', {
        method: 'PUT',
        body: 'not json',
      });
      const response = await PUT(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(400);
    });

    it('returns 400 when brandId is missing', async () => {
      const request = makeRequest({ conversationIds: ['1'], action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('brandId');
    });

    it('returns 400 when brandId is not a valid UUID', async () => {
      const request = makeRequest({ brandId: 'bad', conversationIds: ['1'], action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(400);
    });

    it('returns 400 when conversationIds is empty', async () => {
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: [], action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('conversationIds');
    });

    it('returns 400 when conversationIds is not an array', async () => {
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: '1', action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(400);
    });

    it('returns 400 when conversationIds contains non-string elements', async () => {
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: [123, null], action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('conversationIds');
    });

    it('returns 400 when conversationIds contains empty strings', async () => {
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['1', ''], action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(400);
    });

    it('returns 400 when action is not in allowlist', async () => {
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['1'], action: 'delete' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('resolve');
      expect(data.error).toContain('unresolve');
    });

    it('returns 400 when action is missing', async () => {
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['1'] });
      const response = await PUT(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(400);
    });

    it('returns 400 when conversationIds exceeds 100 items', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => String(i + 1));
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ids, action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('100');
    });
  });

  describe('Reamaze proxy', () => {
    it('sends correct request to Reamaze bulk endpoint', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['123', '456'], action: 'resolve' });
      await PUT(request, createAuthContext('jwt-token'));

      expect(mockFetch).toHaveBeenCalledWith(
        `https://${BRAND_ID}.reamaze.dev-godaddy.com/api/v2/conversations/bulk`,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Authorization': 'sso-jwt jwt-token',
            'Content-Type': 'application/json',
          }),
        }),
      );

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody).toEqual({
        conversation_ids: ['123', '456'],
        bulk_action: 'resolve',
      });
    });

    it('sends correct unresolve payload to Reamaze', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['789'], action: 'unresolve' });
      await PUT(request, createAuthContext('jwt-token'));

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody).toEqual({
        conversation_ids: ['789'],
        bulk_action: 'unresolve',
      });
    });

    it('returns success on 200 response', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ conversations: [] }), { status: 200 }));
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['1'], action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('returns 502 when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['1'], action: 'unresolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(502);
    });

    it('forwards error status from Reamaze', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }));
      const request = makeRequest({ brandId: BRAND_ID, conversationIds: ['1'], action: 'resolve' });
      const response = await PUT(request, createAuthContext('jwt-token'));
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Not found');
    });
  });
});
