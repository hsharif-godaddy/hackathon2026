import { describe, expect, it } from 'vitest';

import {
  isRetriableMediaFetchStatus,
  isTransientMediaFetchError,
  MediaFetchHttpError,
  mediaFetchRetry,
  resolveBaseAgentUrl,
  throwIfMediaFetchNotOk,
} from './media-fetch-utils';

describe('media-fetch-utils', function mediaFetchUtilsTests() {
  describe('#resolveBaseAgentUrl', function resolveBaseAgentUrlTests() {
    it('strips app path suffix from agent URL', function stripsAppPath() {
      expect(resolveBaseAgentUrl('https://agent.example.com/apps/app-123', 'app-123'))
        .toBe('https://agent.example.com');
    });

    it('leaves base agent URL unchanged', function leavesBaseUrl() {
      expect(resolveBaseAgentUrl('https://agent.example.com', 'app-123'))
        .toBe('https://agent.example.com');
    });
  });

  describe('#isTransientMediaFetchError', function isTransientTests() {
    it('detects network-level fetch failures', function detectsFetchFailure() {
      expect(isTransientMediaFetchError(new Error('Failed to fetch'))).toBe(true);
    });

    it('detects agent readiness errors', function detectsAgentNotReady() {
      expect(isTransientMediaFetchError(new Error('Agent URL not available'))).toBe(true);
      expect(isTransientMediaFetchError(new Error('Site abc agent is not ready yet'))).toBe(true);
    });

    it('ignores slot-not-found errors', function ignoresNotFound() {
      expect(isTransientMediaFetchError(new Error('Slot not found: pages/home/hero'))).toBe(false);
    });

    it('retries dev-supervisor 503 plain-text errors', function retries503() {
      expect(isTransientMediaFetchError(new MediaFetchHttpError('Service temporarily unavailable', 503))).toBe(true);
    });

    it('retries 502, 503, and 504 startup errors', function retriesStartupStatuses() {
      expect(isRetriableMediaFetchStatus(502)).toBe(true);
      expect(isRetriableMediaFetchStatus(503)).toBe(true);
      expect(isRetriableMediaFetchStatus(504)).toBe(true);
    });

    it('does not retry permanent 5xx errors', function skipsPermanent5xx() {
      expect(isRetriableMediaFetchStatus(500)).toBe(false);
      expect(isRetriableMediaFetchStatus(501)).toBe(false);
      expect(isRetriableMediaFetchStatus(505)).toBe(false);
    });

    it('retries 408, 425, and 429', function retriesRateLimitStatuses() {
      expect(isRetriableMediaFetchStatus(408)).toBe(true);
      expect(isRetriableMediaFetchStatus(425)).toBe(true);
      expect(isRetriableMediaFetchStatus(429)).toBe(true);
    });

    it('does not retry 404', function skips404() {
      expect(isTransientMediaFetchError(new MediaFetchHttpError('Not found', 404))).toBe(false);
    });

    it('does not retry Unknown error without status', function skipsUnknown() {
      expect(isTransientMediaFetchError(new Error('Unknown error'))).toBe(false);
    });
  });

  describe('#throwIfMediaFetchNotOk', function throwIfNotOkTests() {
    it('throws MediaFetchHttpError with plain-text dev-supervisor body', async function plainText503() {
      const response = new Response('Service temporarily unavailable', { status: 503 });

      await expect(throwIfMediaFetchNotOk(response, 'slot')).rejects.toMatchObject({
        message: 'Service temporarily unavailable',
        status: 503,
      });
    });

    it('does not throw for ok responses', async function okResponse() {
      const response = new Response('{}', { status: 200 });
      await expect(throwIfMediaFetchNotOk(response, 'slot')).resolves.toBeUndefined();
    });
  });

  describe('#mediaFetchRetry', function mediaFetchRetryTests() {
    it('retries transient errors up to the max attempts', function retriesTransient() {
      expect(mediaFetchRetry(0, new Error('Failed to fetch'))).toBe(true);
      expect(mediaFetchRetry(3, new Error('Failed to fetch'))).toBe(true);
      expect(mediaFetchRetry(4, new Error('Failed to fetch'))).toBe(false);
    });

    it('does not retry non-transient errors', function skipsNonTransient() {
      expect(mediaFetchRetry(0, new Error('Slot not found: hero'))).toBe(false);
    });
  });
});
