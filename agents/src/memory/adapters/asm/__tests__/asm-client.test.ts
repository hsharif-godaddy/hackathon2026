import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsmClientWrapper } from '../asm-client-wrapper.js';

describe('AsmClientWrapper', function wrapperTests() {
  let mockAsmClient: {
    createConversation: ReturnType<typeof vi.fn>;
    getConversation: ReturnType<typeof vi.fn>;
    addConversationMessages: ReturnType<typeof vi.fn>;
    closeConversation: ReturnType<typeof vi.fn>;
    updateConversationLabels: ReturnType<typeof vi.fn>;
    searchConversationsV2: ReturnType<typeof vi.fn>;
  };
  let wrapper: AsmClientWrapper;

  beforeEach(function setup() {
    mockAsmClient = {
      createConversation: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
      getConversation: vi.fn().mockResolvedValue({ id: 'c1', status: 'ACTIVE' }),
      addConversationMessages: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
      closeConversation: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
      updateConversationLabels: vi.fn().mockResolvedValue({ success: true, id: 'c1' }),
      searchConversationsV2: vi.fn().mockResolvedValue({ conversationIds: ['c1'], pageInfo: {} }),
    };
    wrapper = new AsmClientWrapper(mockAsmClient as never);
  });

  it('should delegate createConversation to underlying client', async function delegateCreate() {
    const input = { id: 'c1', labels: {}, participants: [], messages: [] };
    const result = await wrapper.createConversation(input as never);
    expect(result).toEqual({ success: true, id: 'c1' });
    expect(mockAsmClient.createConversation).toHaveBeenCalledWith(input);
  });

  it('should delegate getConversation with pagination options', async function delegateGet() {
    await wrapper.getConversation('c1', { first: 10, after: 'after-cursor', last: 5, before: 'before-cursor' });
    expect(mockAsmClient.getConversation).toHaveBeenCalledWith('c1', 10, 'after-cursor', 5, 'before-cursor');
  });

  it('should delegate getConversation without pagination', async function delegateGetNoPagination() {
    await wrapper.getConversation('c1');
    expect(mockAsmClient.getConversation).toHaveBeenCalledWith('c1', undefined, undefined, undefined, undefined);
  });

  it('should delegate addMessages to addConversationMessages', async function delegateAdd() {
    const messages = [{ id: 'm1', contents: [], participant: { withAgent: { id: 'a1', name: 'a1' } } }];
    await wrapper.addMessages('c1', messages as never);
    expect(mockAsmClient.addConversationMessages).toHaveBeenCalledWith('c1', messages);
  });

  it('should delegate searchConversations to searchConversationsV2', async function delegateSearch() {
    const filter = { matchAll: [] };
    await wrapper.searchConversations(filter as never, { first: 50, after: 'after-cursor' });
    expect(mockAsmClient.searchConversationsV2).toHaveBeenCalledWith(filter, 50, undefined, 'after-cursor', undefined);
  });

  it('should retry on 429 status', async function retry429() {
    const error429 = Object.assign(new Error('rate limited'), { statusCode: 429 });
    mockAsmClient.getConversation
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce({ id: 'c1' });

    const result = await wrapper.getConversation('c1');
    expect(result).toEqual({ id: 'c1' });
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(2);
  });

  it('should retry on 5xx status', async function retry5xx() {
    const error500 = Object.assign(new Error('server error'), { statusCode: 500 });
    mockAsmClient.getConversation
      .mockRejectedValueOnce(error500)
      .mockResolvedValueOnce({ id: 'c1' });

    const result = await wrapper.getConversation('c1');
    expect(result).toEqual({ id: 'c1' });
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(2);
  });

  it('should retry on network errors', async function retryNetwork() {
    const netError = Object.assign(new Error('fetch failed'), { networkError: {} });
    mockAsmClient.getConversation
      .mockRejectedValueOnce(netError)
      .mockResolvedValueOnce({ id: 'c1' });

    const result = await wrapper.getConversation('c1');
    expect(result).toEqual({ id: 'c1' });
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(2);
  });

  it('should not retry on 4xx (non-429) errors', async function noRetry4xx() {
    const error403 = Object.assign(new Error('forbidden'), { statusCode: 403 });
    mockAsmClient.getConversation.mockRejectedValue(error403);
    await expect(wrapper.getConversation('c1')).rejects.toThrow('forbidden');
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(1);
  });

  it('should exhaust retries and throw last error', async function exhaustRetries() {
    const error500 = Object.assign(new Error('server error'), { statusCode: 500 });
    mockAsmClient.getConversation.mockRejectedValue(error500);
    await expect(wrapper.getConversation('c1')).rejects.toThrow('server error');
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(3);
  });

  it('should not retry Apollo HTTP errors with networkError.statusCode', async function noRetryApolloHttp() {
    // Apollo wraps HTTP failures with a networkError property containing the statusCode.
    // A 404 should NOT be classified as a retryable network error.
    const apollo404 = Object.assign(new Error('Response not successful: Received status code 404'), {
      networkError: { statusCode: 404, name: 'ServerError' },
    });
    mockAsmClient.getConversation.mockRejectedValue(apollo404);
    await expect(wrapper.getConversation('c1')).rejects.toThrow('Received status code 404');
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(1);
  });

  it('should retry Apollo errors with networkError but no statusCode (true connectivity failure)', async function retryApolloNetworkNoStatus() {
    const apolloNetErr = Object.assign(new Error('Network request failed'), {
      networkError: { name: 'TypeError', message: 'Failed to fetch' },
    });
    mockAsmClient.getConversation
      .mockRejectedValueOnce(apolloNetErr)
      .mockResolvedValueOnce({ id: 'c1' });

    const result = await wrapper.getConversation('c1');
    expect(result).toEqual({ id: 'c1' });
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(2);
  });

  it('should retry on 5xx from Apollo networkError.statusCode', async function retry5xxApollo() {
    const apollo502 = Object.assign(new Error('Response not successful: Received status code 502'), {
      networkError: { statusCode: 502, name: 'ServerError' },
    });
    mockAsmClient.getConversation
      .mockRejectedValueOnce(apollo502)
      .mockResolvedValueOnce({ id: 'c1' });

    const result = await wrapper.getConversation('c1');
    expect(result).toEqual({ id: 'c1' });
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(2);
  });

  it('should extract status from graphQLErrors extensions', async function gqlErrorExtraction() {
    const gqlError = Object.assign(new Error('GraphQL error'), {
      graphQLErrors: [{ extensions: { status: '503' } }],
    });
    mockAsmClient.getConversation
      .mockRejectedValueOnce(gqlError)
      .mockResolvedValueOnce({ id: 'c1' });

    const result = await wrapper.getConversation('c1');
    expect(result).toEqual({ id: 'c1' });
    expect(mockAsmClient.getConversation).toHaveBeenCalledTimes(2);
  });
});
