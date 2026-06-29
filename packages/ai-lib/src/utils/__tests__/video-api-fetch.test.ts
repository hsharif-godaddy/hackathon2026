import { describe, it, expect, vi, beforeEach } from 'vitest';

import { llmMetadataContext } from '@airo/ai-common';

const mockGetS2SToken = vi.fn();
const mockFetch = vi.fn();
const mockGetCurrentUserId = vi.fn();
const mockHasGrants = vi.fn();
const mockAdvanceToNextGrant = vi.fn();
const mockRequestGrantRefreshAndWait = vi.fn();

vi.mock('../s2s-auth.js', () => ({
  getS2SToken: mockGetS2SToken,
  isS2SAuthEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock('@airo/ai-grants', () => ({
  grantSessionManager: {
    getCurrentUserId: mockGetCurrentUserId,
    hasGrants: mockHasGrants,
    advanceToNextGrant: mockAdvanceToNextGrant,
    requestGrantRefreshAndWait: mockRequestGrantRefreshAndWait,
  },
}));

describe('video-api-fetch', function packageTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetS2SToken.mockResolvedValue('token-abc');
    mockGetCurrentUserId.mockReturnValue(undefined);
    mockHasGrants.mockReturnValue(false);
    mockAdvanceToNextGrant.mockReturnValue(false);
    mockRequestGrantRefreshAndWait.mockResolvedValue(false);
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
  });

  it('prefers live grant user over stale metadata.user', async function liveGrantUser() {
    mockGetCurrentUserId.mockReturnValue('airo-builder:grant:grant-2');

    const { videoApiFetch } = await import('../video-api-fetch.js');
    const openaiClient = { baseURL: 'https://api.test/v1' };

    await llmMetadataContext.run(
      {
        user: 'airo-builder:grant:grant-1',
        tags: ['source:tool:video-generate'],
        _internal: { socketId: 'socket-1' },
      },
      async () => {
        await videoApiFetch(openaiClient as never, '/videos', { method: 'POST' });
      },
    );

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-budget-user-id']).toBe('airo-builder:grant:grant-2');
    expect(mockGetCurrentUserId).toHaveBeenCalledWith('socket-1');
  });

  it('uses grant budget user from llmMetadataContext', async function grantUser() {
    const { videoApiFetch } = await import('../video-api-fetch.js');
    const openaiClient = { baseURL: 'https://api.test/v1' };

    await llmMetadataContext.run(
      { user: 'budget-user-123', tags: ['source:tool:video-generate'] },
      async () => {
        await videoApiFetch(openaiClient as never, '/videos', { method: 'POST' });
      }
    );

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-budget-user-id']).toBe('budget-user-123');
    expect(headers['x-gocode-budget-id']).toBeUndefined();
  });

  it('uses BMS session from llmMetadataContext', async function bmsSession() {
    const { videoApiFetch } = await import('../video-api-fetch.js');
    const openaiClient = { baseURL: 'https://api.test/v1' };

    await llmMetadataContext.run(
      {
        user: 'airo-builder:sid:sub-1',
        tags: ['mode:bms'],
        budgetSessionId: 'session-456',
      },
      async () => {
        await videoApiFetch(openaiClient as never, '/videos', { method: 'POST' });
      }
    );

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-gocode-budget-service-name']).toBe('airo-app-builder');
    expect(headers['x-gocode-budget-id']).toBe('session-456');
    expect(headers['x-budget-user-id']).toBeUndefined();
  });

  it('retries with next grant on budget-exceeded response', async function grantFallback() {
    mockHasGrants.mockReturnValue(true);
    mockAdvanceToNextGrant.mockReturnValue(true);
    mockGetCurrentUserId
      .mockReturnValueOnce('airo-builder:grant:grant-1')
      .mockReturnValueOnce('airo-builder:grant:grant-2');

    mockFetch
      .mockResolvedValueOnce(new Response('exceededbudget', { status: 400 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const { videoApiFetch } = await import('../video-api-fetch.js');
    const openaiClient = { baseURL: 'https://api.test/v1' };

    const response = await llmMetadataContext.run(
      {
        user: 'airo-builder:grant:grant-1',
        tags: ['source:tool:video-generate'],
        _internal: { socketId: 'socket-1', customerId: 'cust-1' },
      },
      async () => videoApiFetch(openaiClient as never, '/videos', { method: 'POST' }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
    const retryHeaders = mockFetch.mock.calls[1][1].headers as Record<string, string>;
    expect(retryHeaders['x-budget-user-id']).toBe('airo-builder:grant:grant-2');
  });

  it('does not retry on budget-exceeded when BMS mode is enabled', async function bmsSkipFallback() {
    mockHasGrants.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(new Response('exceededbudget', { status: 400 }));

    const { videoApiFetch } = await import('../video-api-fetch.js');
    const openaiClient = { baseURL: 'https://api.test/v1' };

    const response = await llmMetadataContext.run(
      {
        user: 'airo-builder:grant:grant-1',
        tags: ['mode:bms'],
        budgetServiceEnabled: true,
        budgetSessionId: 'session-456',
        _internal: { socketId: 'socket-1', customerId: 'cust-1' },
      },
      async () => videoApiFetch(openaiClient as never, '/videos', { method: 'POST' }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
    expect(mockAdvanceToNextGrant).not.toHaveBeenCalled();
  });
});
