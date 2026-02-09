import { describe, expect, it } from 'vitest';

import { getSubscriptionsShimBaseUrl } from './subscriptions-shim';

describe('subscriptions-shim', function subscriptionsShimTests() {
  describe('getSubscriptionsShimBaseUrl', function getBaseUrlTests() {
    it('should return prod URL for godaddy.com', function prodUrl() {
      const result = getSubscriptionsShimBaseUrl('godaddy.com');
      expect(result).toBe('https://subscriptions-shim-ext.cp.api.prod.godaddy.com');
    });

    it('should return test URL for test-godaddy.com', function testUrl() {
      const result = getSubscriptionsShimBaseUrl('test-godaddy.com');
      expect(result).toBe('https://subscriptions-shim-ext.cp.api.test.godaddy.com');
    });

    it('should return dev URL for dev-godaddy.com', function devUrl() {
      const result = getSubscriptionsShimBaseUrl('dev-godaddy.com');
      expect(result).toBe('https://subscriptions-shim-ext.cp.api.dev.godaddy.com');
    });

    it('should return prod URL for null domain', function nullDomain() {
      const result = getSubscriptionsShimBaseUrl(null);
      expect(result).toBe('https://subscriptions-shim-ext.cp.api.prod.godaddy.com');
    });

    it('should return prod URL for localhost', function localhost() {
      const result = getSubscriptionsShimBaseUrl('localhost');
      expect(result).toBe('https://subscriptions-shim-ext.cp.api.prod.godaddy.com');
    });

    it('should return prod URL for unknown domains', function unknownDomain() {
      const result = getSubscriptionsShimBaseUrl('unknown.com');
      expect(result).toBe('https://subscriptions-shim-ext.cp.api.prod.godaddy.com');
    });
  });
});
