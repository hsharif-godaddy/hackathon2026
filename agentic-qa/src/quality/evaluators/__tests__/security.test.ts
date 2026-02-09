import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate } from '../security.js';
import { MockPage } from './mock-page.js';

describe('security', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should give high score for secure HTTPS page with no issues', async function secure() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          [],    // mixedContent
          [],    // exposedSecrets
        ],
        requestGet: async () => ({
          headers: () => ({
            'x-frame-options': 'SAMEORIGIN',
            'content-security-policy': "default-src 'self'",
            'x-content-type-options': 'nosniff',
            'strict-transport-security': 'max-age=31536000',
          }),
        }),
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(100);
      assume(result.data!.isHttps).is.true();
      assume(result.data!.mixedContent).has.length(0);
      assume(result.data!.securityHeaders.contentSecurityPolicy).is.true();
      assume(result.data!.securityHeaders.strictTransportSecurity).is.true();
    });

    it('should heavily penalize HTTP pages', async function httpPenalty() {
      const page = new MockPage({
        url: 'http://example.com',
        evaluateReturns: [
          [],    // mixedContent
          [],    // exposedSecrets
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.isHttps).is.false();
      // -40 for HTTP, -20 for missing headers (4 * 5)
      assume(result.data!.score).equals(40);
    });

    it('should penalize mixed content', async function mixedContent() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          ['http://cdn.example.com/style.css', 'http://cdn.example.com/img.png'],
          [],
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.mixedContent).has.length(2);
      // -10 for 2 mixed content (2*5), -20 for missing headers
      assume(result.data!.score).equals(70);
    });

    it('should cap mixed content penalty at 20', async function mixedContentCap() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          Array.from({ length: 10 }, (_, i) => `http://cdn.example.com/file${i}.css`),
          [],
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // -20 for mixed content (capped), -20 for missing headers
      assume(result.data!.score).equals(60);
    });

    it('should penalize missing security headers', async function missingHeaders() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [[], []],
        requestGet: async () => ({
          headers: () => ({
            'x-frame-options': 'DENY',
            // Missing: content-security-policy, x-content-type-options, strict-transport-security
          }),
        }),
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.securityHeaders.xFrameOptions).is.true();
      assume(result.data!.securityHeaders.contentSecurityPolicy).is.false();
      // -15 for 3 missing headers (3*5)
      assume(result.data!.score).equals(85);
    });

    it('should penalize exposed secrets', async function exposedSecrets() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          [],
          ['api_key', 'secret_key'],
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // -40 for 2 exposed secrets (2*20), -20 for missing headers
      assume(result.data!.score).equals(40);
    });

    it('should cap exposed secrets penalty at 40', async function secretsCap() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          [],
          ['api_key', 'secret_key', 'password', 'bearer'],
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // -40 for secrets (capped at 40), -20 for missing headers
      assume(result.data!.score).equals(40);
    });

    it('should floor score at 0', async function scoreFloor() {
      const page = new MockPage({
        url: 'http://example.com',
        evaluateReturns: [
          Array.from({ length: 10 }, (_, i) => `http://bad.com/${i}`),
          ['api_key', 'secret_key', 'password'],
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(0);
    });

    it('should limit mixed content to 10 items', async function limitMixedContent() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          Array.from({ length: 20 }, (_, i) => `http://bad.com/${i}`),
          [],
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.mixedContent.length).is.most(10);
    });

    it('should handle errors gracefully', async function errorHandling() {
      const page = new MockPage();
      page.url = () => { throw new Error('Page destroyed'); };

      const result = await evaluate(page.asPage());
      assume(result.success).is.false();
      assume(result.error).includes('Page destroyed');
    });

    it('should handle header request failure gracefully', async function headerFailure() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [[], []],
        requestGet: async () => { throw new Error('Network error'); },
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // Headers default to false when request fails
      assume(result.data!.securityHeaders.contentSecurityPolicy).is.false();
    });
  });
});
