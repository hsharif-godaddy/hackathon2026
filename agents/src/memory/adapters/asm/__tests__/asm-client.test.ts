import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsmClient, AsmApiError, AsmGraphQLError } from '../asm-client.js';

describe('AsmClient', function clientTests() {
  const mockToken = 'test-token';
  let client: AsmClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(function setup() {
    client = new AsmClient({
      baseUrl: 'https://asm.example.com',
      getAuthToken: () => mockToken,
    });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(function teardown() {
    vi.unstubAllGlobals();
  });

  function mockGraphQLResponse(data: unknown): Response {
    return new Response(JSON.stringify({ data }));
  }

  it('should send POST to /v1/conversation/graphql with bearer token', async function endpoint() {
    fetchSpy.mockResolvedValue(mockGraphQLResponse({ createConversation: { success: true, id: 'c1' } }));
    await client.createConversation({ labels: {}, participants: [] });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://asm.example.com/v1/conversation/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'sso-jwt test-token' }),
      })
    );
  });

  it('should send query and variables in request body', async function body() {
    fetchSpy.mockResolvedValue(mockGraphQLResponse({ conversation: null }));
    await client.getConversation('conv-1', { first: 10 });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.query).toContain('GetConversation');
    expect(body.variables.id).toBe('conv-1');
    expect(body.variables.first).toBe(10);
  });

  it('should throw AsmGraphQLError when response contains errors', async function gqlErrors() {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      errors: [{ message: 'Not authorized' }],
    })));
    await expect(client.getConversation('conv-1')).rejects.toThrow(AsmGraphQLError);
  });

  it('should throw AsmApiError on non-retryable HTTP failure', async function nonRetryable() {
    fetchSpy.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    await expect(client.getConversation('conv-1')).rejects.toThrow(AsmApiError);
  });

  it('should retry on 429 and 5xx', async function retries() {
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(mockGraphQLResponse({ conversation: { id: 'c1' } }));
    const result = await client.getConversation('c1');
    expect(result).toEqual({ id: 'c1' });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('should strip trailing slash from baseUrl', async function trailingSlash() {
    const c = new AsmClient({ baseUrl: 'https://asm.example.com/', getAuthToken: () => 'tok' });
    fetchSpy.mockResolvedValue(mockGraphQLResponse({ closeConversation: { success: true } }));
    await c.closeConversation('c1');
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe('https://asm.example.com/v1/conversation/graphql');
  });
});
