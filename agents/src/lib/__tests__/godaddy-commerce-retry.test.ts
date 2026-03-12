import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking
const { fetchWithRetry } = await import('../godaddy-commerce.js');

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('should return response on first successful attempt', async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.resolve({ data: 'test' }) };
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
    expect(result).toBe(mockResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on 503 and succeed on second attempt', async () => {
    const failResponse = { ok: false, status: 503, json: () => Promise.resolve({}) };
    const successResponse = { ok: true, status: 200, json: () => Promise.resolve({ data: 'ok' }) };
    mockFetch.mockResolvedValueOnce(failResponse).mockResolvedValueOnce(successResponse);

    const promise = fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(result).toBe(successResponse);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on 429, 500, 502, 503, 504', async () => {
    const retryStatuses = [429, 500, 502, 503, 504];
    for (const status of retryStatuses) {
      vi.clearAllMocks();
      const failResponse = { ok: false, status, json: () => Promise.resolve({}) };
      const successResponse = { ok: true, status: 200, json: () => Promise.resolve({}) };
      mockFetch.mockResolvedValueOnce(failResponse).mockResolvedValueOnce(successResponse);

      const promise = fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
      await vi.advanceTimersByTimeAsync(1500);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    }
  });

  it('should NOT retry on 400, 401, 403, 404', async () => {
    const nonRetryStatuses = [400, 401, 403, 404];
    for (const status of nonRetryStatuses) {
      vi.clearAllMocks();
      const failResponse = { ok: false, status, json: () => Promise.resolve({}) };
      mockFetch.mockResolvedValueOnce(failResponse);

      const result = await fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
      expect(result).toBe(failResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail after 3 attempts', async () => {
    const failResponse = { ok: false, status: 503, json: () => Promise.resolve({}) };
    mockFetch.mockResolvedValue(failResponse);

    const promise = fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff with jitter', async () => {
    const failResponse = { ok: false, status: 503, json: () => Promise.resolve({}) };
    const successResponse = { ok: true, status: 200, json: () => Promise.resolve({}) };
    mockFetch
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(successResponse);

    const promise = fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
    // First retry after ~1s, second after ~2s
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
