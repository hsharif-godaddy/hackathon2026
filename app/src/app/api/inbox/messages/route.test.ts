import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let capturedAuthOpts: unknown;
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any, opts: unknown) => {
    capturedAuthOpts = opts;
    return handler;
  },
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

const { GET, POST } = await import('./route');

describe('GET /api/inbox/messages', () => {
  const createAuthContext = (jwt?: string) => ({ jwt });

  function makeRequest(searchParams: Record<string, string>): NextRequest {
    const url = new URL('http://localhost/api/inbox/messages');
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return new NextRequest(url);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 when JWT is missing', async () => {
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      const response = await GET(request, createAuthContext());
      expect(response.status).toBe(401);
    });

    it('uses withCustomerAuth with level 3', () => {
      expect(capturedAuthOpts).toEqual({ level: 3 });
    });
  });

  describe('validation', () => {
    it('returns 400 when brandId is missing', async () => {
      const request = makeRequest({ conversationId: '123' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('brandId');
    });

    it('returns 400 when brandId is not a valid UUID', async () => {
      const request = makeRequest({ brandId: 'not-a-uuid', conversationId: '123' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('UUID');
    });

    it('returns 400 when neither conversationId nor parentMessageId provided', async () => {
      const request = makeRequest({ brandId: '550e8400-e29b-41d4-a716-446655440000' });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('Either conversationId or parentMessageId');
    });

    it('returns 400 when both conversationId and parentMessageId provided', async () => {
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
        parentMessageId: '456',
      });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('Cannot specify both');
    });

    it('returns 400 when conversationId contains path traversal characters', async () => {
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123/../456',
      });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('conversationId must be a numeric ID');
    });

    it('returns 400 when conversationId is not numeric', async () => {
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: 'abc123',
      });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('conversationId must be a numeric ID');
    });

    it('returns 400 when parentMessageId contains path traversal characters', async () => {
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        parentMessageId: '123/../../something',
      });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('parentMessageId must be a numeric ID');
    });

    it('returns 400 when parentMessageId is not numeric', async () => {
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        parentMessageId: 'xyz789',
      });
      const response = await GET(request, createAuthContext('jwt-token'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('parentMessageId must be a numeric ID');
    });
  });

  describe('URL construction for conversation messages', () => {
    it('builds correct Reamaze URL for conversation messages', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '12345',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('550e8400-e29b-41d4-a716-446655440000.reamaze.dev-godaddy.com');
      expect(url).toContain('/api/v2/conversations/12345/messages');
    });

    it('includes before_timestamp param when provided', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '12345',
        before_timestamp: '2024-01-01T00:00:00Z',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('before_timestamp=2024-01-01T00%3A00%3A00Z');
    });
  });

  describe('URL construction for message children', () => {
    it('builds correct Reamaze URL for message children', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        parentMessageId: '67890',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('550e8400-e29b-41d4-a716-446655440000.reamaze.dev-godaddy.com');
      expect(url).toContain('/api/v2/messages/67890/children');
    });

    it('includes before_timestamp param for children request', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        parentMessageId: '67890',
        before_timestamp: '2024-01-01T00:00:00Z',
      });
      await GET(request, createAuthContext('jwt-token'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('before_timestamp=2024-01-01T00%3A00%3A00Z');
    });
  });

  describe('upstream proxy', () => {
    it('forwards JWT as sso-jwt Authorization header', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      await GET(request, createAuthContext('my-jwt-token'));
      const headers = mockFetch.mock.calls[0][1]?.headers;
      expect(headers.Authorization).toBe('sso-jwt my-jwt-token');
      expect(headers.Accept).toBe('application/json');
    });

    it('returns message data on success', async () => {
      const upstreamData = {
        messages: [{ id: 1, body: 'Hello' }],
        total_count: 1,
      };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamData), { status: 200 }));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data).toEqual(upstreamData);
    });

    it('returns error response with upstream status on failure', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 })
      );
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.error).toContain('Conversation not found');
    });

    it('returns 502 when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const request = makeRequest({
        brandId: '550e8400-e29b-41d4-a716-446655440000',
        conversationId: '123',
      });
      const response = await GET(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(502);
      expect(data.error).toContain('Failed to fetch messages');
    });
  });
});

describe('POST /api/inbox/messages', () => {
  const createAuthContext = (jwt?: string) => ({ jwt });
  const BRAND_ID = '550e8400-e29b-41d4-a716-446655440000';

  function makePostRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/inbox/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 when JWT is missing', async () => {
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hello' });
      const response = await POST(request, createAuthContext());
      expect(response.status).toBe(401);
    });
  });

  describe('validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const request = new NextRequest('http://localhost/api/inbox/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{{{',
      });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid JSON');
    });

    it('returns 400 when brandId is missing', async () => {
      const request = makePostRequest({ conversationId: '123', body: 'hello' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('brandId');
    });

    it('returns 400 when brandId is not a valid UUID', async () => {
      const request = makePostRequest({ brandId: 'invalid', conversationId: '123', body: 'hello' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('brandId');
    });

    it('returns 400 when conversationId is missing', async () => {
      const request = makePostRequest({ brandId: BRAND_ID, body: 'hello' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('conversationId');
    });

    it('returns 400 when conversationId is non-numeric', async () => {
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: 'abc', body: 'hello' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('conversationId');
    });

    it('returns 400 when neither body nor attachments provided', async () => {
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('body or attachments');
    });

    it('returns 400 when body is empty string', async () => {
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: '   ' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('body or attachments');
    });

    it('returns 400 when parentMessageId is non-numeric', async () => {
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi', parentMessageId: 'abc' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toContain('parentMessageId');
    });
  });

  describe('upstream request', () => {
    const remoteMessage = {
      id: 999,
      body: 'hello',
      attachments: [],
      conversation_id: 123,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      origin: 0,
      origin_id: 'abc-123',
      original_body: null,
      read_by: [],
      user: { id: 1, name: 'Agent', email: 'agent@test.com', is_bot: false },
      visibility: 0,
    };

    it('builds correct Reamaze URL', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '456', body: 'hello' });
      await POST(request, createAuthContext('jwt'));
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe(`https://${BRAND_ID}.reamaze.dev-godaddy.com/api/v2/conversations/456/messages`);
    });

    it('sends correct headers', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi' });
      await POST(request, createAuthContext('my-jwt'));
      const opts = mockFetch.mock.calls[0][1] as RequestInit;
      expect(opts.method).toBe('POST');
      const headers = opts.headers as Record<string, string>;
      expect(headers.Authorization).toBe('sso-jwt my-jwt');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends body text trimmed', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: '  hello world  ' });
      await POST(request, createAuthContext('jwt'));
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(sentBody.message.body).toBe('hello world');
    });

    it('maps isInternalNote to visibility 1', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'note', isInternalNote: true });
      await POST(request, createAuthContext('jwt'));
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(sentBody.message.visibility).toBe(1);
    });

    it('defaults visibility to 0', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi' });
      await POST(request, createAuthContext('jwt'));
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(sentBody.message.visibility).toBe(0);
    });

    it('sends parentMessageId as number', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi', parentMessageId: '789' });
      await POST(request, createAuthContext('jwt'));
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(sentBody.message.parent_message_id).toBe(789);
    });

    it('includes external_ref_id from clientId', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const clientId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi', clientId });
      await POST(request, createAuthContext('jwt'));
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(sentBody.message.external_ref_id).toBe(clientId);
    });

    it('generates external_ref_id when clientId not provided', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi' });
      await POST(request, createAuthContext('jwt'));
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(sentBody.message.external_ref_id).toBeDefined();
      expect(typeof sentBody.message.external_ref_id).toBe('string');
    });

    it('accepts attachments without body', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', attachments: [{ id: 42 }] });
      await POST(request, createAuthContext('jwt'));
      const sentBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(sentBody.message.attachments).toEqual([{ id: 42 }]);
      expect(sentBody.message.body).toBeUndefined();
    });
  });

  describe('response handling', () => {
    const remoteMessage = {
      id: 999,
      body: 'hello',
      attachments: [],
      conversation_id: 123,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      origin: 0,
      origin_id: 'abc-123',
      original_body: null,
      read_by: [],
      user: { id: 1, name: 'Agent', email: 'agent@test.com', is_bot: false },
      visibility: 0,
    };

    it('returns transformed message on success', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ message: remoteMessage }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hello' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.message).toBeDefined();
      expect(data.message.id).toBe('999');
      expect(data.message.conversationId).toBe('123');
    });

    it('forwards upstream error status', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 }),
      );
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(429);
      expect(data.error).toContain('Rate limited');
    });

    it('returns 502 when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(502);
      expect(data.error).toContain('Failed to send message');
    });

    it('returns 502 when response has no message field', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(502);
      expect(data.error).toContain('Invalid response');
    });

    it('returns 502 when convertMessage throws on malformed message', async () => {
      const malformedMessage = { id: 999, body: 'hi', conversation_id: 123 };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ message: malformedMessage }), { status: 200 }),
      );
      const request = makePostRequest({ brandId: BRAND_ID, conversationId: '123', body: 'hi' });
      const response = await POST(request, createAuthContext('jwt'));
      const data = await response.json();
      expect(response.status).toBe(502);
      expect(data.error).toContain('Invalid response');
    });
  });
});
