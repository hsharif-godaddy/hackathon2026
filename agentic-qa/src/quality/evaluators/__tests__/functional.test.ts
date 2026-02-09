import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate, evaluateQuick } from '../functional.js';
import { MockPage } from './mock-page.js';

describe('functional', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should return perfect score for clean page', async function clean() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          { links: [], brokenImages: [], visibleErrors: [], totalImages: 5 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(100);
      assume(result.data!.jsErrors).has.length(0);
      assume(result.data!.brokenLinks).has.length(0);
      assume(result.data!.failedResources).has.length(0);
      assume(result.data!.brokenImages).has.length(0);
    });

    it('should capture console errors via onWait', async function consoleErrors() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          { links: [], brokenImages: [], visibleErrors: [], totalImages: 0 },
        ],
      });

      page.onWait = () => {
        page.emit('console', { type: () => 'error', text: () => 'TypeError: undefined' });
      };

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.jsErrors).includes('TypeError: undefined');
      assume(result.data!.score).is.below(100);
    });

    it('should filter out favicon errors', async function filterFavicon() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          { links: [], brokenImages: [], visibleErrors: [], totalImages: 0 },
        ],
      });

      page.onWait = () => {
        page.emit('console', { type: () => 'error', text: () => 'Failed to load favicon.ico' });
      };

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.jsErrors).has.length(0);
    });

    it('should ignore non-error console messages', async function nonErrors() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          { links: [], brokenImages: [], visibleErrors: [], totalImages: 0 },
        ],
      });

      page.onWait = () => {
        page.emit('console', { type: () => 'log', text: () => 'Debug info' });
        page.emit('console', { type: () => 'warning', text: () => 'Deprecation warning' });
      };

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.jsErrors).has.length(0);
    });

    it('should capture failed requests', async function failedRequests() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          { links: [], brokenImages: [], visibleErrors: [], totalImages: 0 },
        ],
      });

      page.onWait = () => {
        page.emit('requestfailed', {
          url: () => 'https://example.com/api/data',
          resourceType: () => 'xhr',
        });
      };

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.failedResources.length).equals(1);
      assume(result.data!.failedResources[0]).includes('xhr');
    });

    it('should filter out analytics/tracking failed requests', async function filterAnalytics() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          { links: [], brokenImages: [], visibleErrors: [], totalImages: 0 },
        ],
      });

      page.onWait = () => {
        page.emit('requestfailed', {
          url: () => 'https://analytics.google.com/collect',
          resourceType: () => 'xhr',
        });
        page.emit('requestfailed', {
          url: () => 'https://tracking.example.com/pixel',
          resourceType: () => 'image',
        });
      };

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.failedResources).has.length(0);
    });

    it('should penalize broken images', async function brokenImages() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          {
            links: [],
            brokenImages: ['https://example.com/img1.png', 'https://example.com/img2.png'],
            visibleErrors: [],
            totalImages: 5,
          },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.brokenImages).has.length(2);
      // 2 broken images * 5 penalty = 10
      assume(result.data!.score).equals(90);
    });

    it('should detect broken internal links', async function brokenLinks() {
      const page = new MockPage({
        url: 'https://example.com/page',
        evaluateReturns: [
          {
            links: [
              { href: '/about', isExternal: false, text: 'About' },
              { href: '/contact', isExternal: false, text: 'Contact' },
            ],
            brokenImages: [],
            visibleErrors: [],
            totalImages: 0,
          },
        ],
        requestHead: async () => ({ ok: () => false, status: () => 404 }),
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.brokenLinks.length).equals(2);
      // 2 broken links * 10 penalty = 20
      assume(result.data!.score).equals(80);
    });

    it('should cap JS error penalty at 60', async function jsErrorCap() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          { links: [], brokenImages: [], visibleErrors: [], totalImages: 0 },
        ],
      });

      page.onWait = () => {
        for (let i = 0; i < 10; i++) {
          page.emit('console', { type: () => 'error', text: () => `Error ${i}` });
        }
      };

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // 10 errors * 20 = 200, but capped at 60
      assume(result.data!.score).equals(40); // 100 - 60
    });

    it('should cap broken link penalty at 40', async function brokenLinkCap() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          {
            links: Array.from({ length: 10 }, (_, i) => ({
              href: `/page${i}`, isExternal: false, text: `Page ${i}`,
            })),
            brokenImages: [],
            visibleErrors: [],
            totalImages: 0,
          },
        ],
        requestHead: async () => ({ ok: () => false, status: () => 404 }),
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // 10 broken * 10 = 100, but capped at 40
      assume(result.data!.score).equals(60); // 100 - 40
    });

    it('should limit reported items to 10', async function limitItems() {
      const page = new MockPage({
        url: 'https://example.com',
        evaluateReturns: [
          {
            links: [],
            brokenImages: Array.from({ length: 15 }, (_, i) => `img${i}.png`),
            visibleErrors: [],
            totalImages: 15,
          },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.brokenImages.length).is.most(10);
    });

    it('should handle errors gracefully', async function errorHandling() {
      const page = new MockPage();
      page.evaluate = async () => { throw new Error('Navigation failed'); };

      const result = await evaluate(page.asPage());
      assume(result.success).is.false();
      assume(result.error).includes('Navigation failed');
    });
  });

  describe('#evaluateQuick', function evaluateQuickTests() {
    it('should return perfect score for clean page', async function clean() {
      const page = new MockPage({
        evaluateReturns: [
          { brokenImages: [], totalLinks: 5, totalImages: 3, hasVisibleErrors: false },
        ],
      });

      const result = await evaluateQuick(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(100);
    });

    it('should penalize broken images', async function brokenImages() {
      const page = new MockPage({
        evaluateReturns: [
          { brokenImages: ['img1.png', 'img2.png'], totalLinks: 5, totalImages: 5, hasVisibleErrors: false },
        ],
      });

      const result = await evaluateQuick(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(80); // 100 - (2*10)
    });

    it('should penalize visible errors', async function visibleErrors() {
      const page = new MockPage({
        evaluateReturns: [
          { brokenImages: [], totalLinks: 5, totalImages: 3, hasVisibleErrors: true },
        ],
      });

      const result = await evaluateQuick(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(80); // 100 - 20
    });

    it('should handle errors gracefully', async function errorHandling() {
      const page = new MockPage();
      page.evaluate = async () => { throw new Error('Crash'); };

      const result = await evaluateQuick(page.asPage());
      assume(result.success).is.false();
      assume(result.error).includes('Crash');
    });
  });
});
