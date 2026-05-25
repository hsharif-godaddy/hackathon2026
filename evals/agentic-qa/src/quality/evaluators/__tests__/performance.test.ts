import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate, evaluateWithNavigationTiming } from '../performance.js';
import { MockPage } from './mock-page.js';

describe('performance', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should fail without chromePort', async function noChromePort() {
      const result = await evaluate('https://example.com');
      assume(result.success).is.false();
      assume(result.error).includes('Chrome debugging port required');
    });
  });

  describe('#evaluateWithNavigationTiming', function navigationTimingTests() {
    it('should score well for fast metrics', async function fastMetrics() {
      const page = new MockPage({
        evaluateReturns: [{
          fcp: 1000,       // good (< 1800)
          lcp: 2000,       // good (< 2500)
          cls: 0.05,       // good (< 0.1)
          loadTime: 2000,
          domInteractive: 800,
          domContentLoaded: 1200,
        }],
      });

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).is.above(80);
      assume(result.data!.lcp.rating).equals('good');
      assume(result.data!.fcp.rating).equals('good');
      assume(result.data!.cls.rating).equals('good');
    });

    it('should score poorly for slow metrics', async function slowMetrics() {
      const page = new MockPage({
        evaluateReturns: [{
          fcp: 4000,      // poor (> 3000)
          lcp: 5000,      // poor (> 4000)
          cls: 0.3,       // poor (> 0.25)
          loadTime: 8000,
          domInteractive: 3000,
          domContentLoaded: 5000,
        }],
      });

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).is.below(60);
      assume(result.data!.lcp.rating).equals('poor');
      assume(result.data!.fcp.rating).equals('poor');
      assume(result.data!.cls.rating).equals('poor');
    });

    it('should rate intermediate metrics as needs-improvement', async function needsImprovement() {
      const page = new MockPage({
        evaluateReturns: [{
          fcp: 2500,      // needs-improvement (1800 < x <= 3000)
          lcp: 3000,      // needs-improvement (2500 < x <= 4000)
          cls: 0.15,      // needs-improvement (0.1 < x <= 0.25)
          loadTime: 4000,
          domInteractive: 1500,
          domContentLoaded: 2000,
        }],
      });

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.lcp.rating).equals('needs-improvement');
      assume(result.data!.fcp.rating).equals('needs-improvement');
      assume(result.data!.cls.rating).equals('needs-improvement');
    });

    it('should handle zero LCP value gracefully', async function lcpZero() {
      // LCP estimation (lcp || loadTime * 0.7) runs inside page.evaluate browser context.
      // Mock returns pre-computed values, so test the scoring path for LCP=0.
      const page = new MockPage({
        evaluateReturns: [{
          fcp: 1000,
          lcp: 0,
          cls: 0.05,
          loadTime: 3000,
          domInteractive: 800,
          domContentLoaded: 1200,
        }],
      });

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.lcp.value).equals(0);
      assume(result.data!.lcp.rating).equals('good'); // 0 < 2500
    });

    it('should estimate TBT from available metrics', async function tbtEstimate() {
      const page = new MockPage({
        evaluateReturns: [{
          fcp: 1000,
          lcp: 2000,
          cls: 0.05,
          loadTime: 3000,
          domInteractive: 800,
          domContentLoaded: 2000, // domContentLoaded - fcp - 200 = 800
        }],
      });

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.true();
      // TBT estimate = max(0, 2000 - 1000 - 200) = 800
      assume(result.data!.tbt.value).equals(800);
      assume(result.data!.tbt.rating).equals('poor'); // > 600
    });

    it('should cap TBT estimate at 0', async function tbtFloor() {
      const page = new MockPage({
        evaluateReturns: [{
          fcp: 2000,
          lcp: 2000,
          cls: 0.05,
          loadTime: 3000,
          domInteractive: 800,
          domContentLoaded: 1500, // 1500 - 2000 - 200 = -700, capped at 0
        }],
      });

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.tbt.value).equals(0);
      assume(result.data!.tbt.rating).equals('good');
    });

    it('should cap score at 100', async function scoreCap() {
      const page = new MockPage({
        evaluateReturns: [{
          fcp: 500,
          lcp: 1000,
          cls: 0.01,
          loadTime: 1000,
          domInteractive: 300,
          domContentLoaded: 500,
        }],
      });

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).is.most(100);
    });

    it('should set INP to 0 (not measurable without interaction)', async function inpZero() {
      const page = new MockPage({
        evaluateReturns: [{
          fcp: 1000, lcp: 2000, cls: 0.05, loadTime: 2000,
          domInteractive: 800, domContentLoaded: 1200,
        }],
      });

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.inp.value).equals(0);
      assume(result.data!.inp.rating).equals('good');
    });

    it('should handle errors gracefully', async function errorHandling() {
      const page = new MockPage();
      page.evaluate = async () => { throw new Error('Page not loaded'); };

      const result = await evaluateWithNavigationTiming(page.asPage());
      assume(result.success).is.false();
      assume(result.error).includes('Page not loaded');
      assume(result.duration).is.a('number');
    });
  });
});
