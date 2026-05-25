import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate } from '../accessibility.js';
import { MockPage } from './mock-page.js';

/**
 * Creates a mock page for accessibility testing.
 * axe-core IS installed so AxeBuilder runs first but fails with mock pages.
 * The fallback evaluateBasic then calls page.evaluate().
 * We use a single-value evaluate that always returns the same data
 * regardless of how many times AxeBuilder calls evaluate before failing.
 */
function createAccessibilityMock(data: {
  issues: Array<{ id: string; impact: string; description: string; nodes: number }>;
  passedChecks: number;
}): MockPage {
  const page = new MockPage({});
  page.evaluate = async () => data as never;
  return page;
}

describe('accessibility', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should return score from basic fallback when axe-core fails with mock', async function fallback() {
      const page = createAccessibilityMock({ issues: [], passedChecks: 10 });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data).is.not.undefined();
      assume(result.data!.score).is.a('number');
    });

    it('should detect images without alt text in basic fallback', async function missingAlt() {
      const page = createAccessibilityMock({
        issues: [
          { id: 'image-alt', impact: 'critical', description: 'Images must have alt text', nodes: 3 },
        ],
        passedChecks: 9,
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.violations.critical).equals(1);
      assume(result.data!.details.some(d => d.id === 'image-alt')).is.true();
    });

    it('should detect form inputs without labels', async function missingLabels() {
      const page = createAccessibilityMock({
        issues: [
          { id: 'label', impact: 'serious', description: 'Form inputs must have labels', nodes: 2 },
        ],
        passedChecks: 9,
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.violations.serious).equals(1);
    });

    it('should detect missing HTML lang attribute', async function missingLang() {
      const page = createAccessibilityMock({
        issues: [
          { id: 'html-lang', impact: 'serious', description: 'HTML must have lang', nodes: 1 },
        ],
        passedChecks: 9,
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.details.some(d => d.id === 'html-lang')).is.true();
    });

    it('should apply correct penalty weights', async function penaltyWeights() {
      const page = createAccessibilityMock({
        issues: [
          { id: 'image-alt', impact: 'critical', description: '', nodes: 1 },  // -25
          { id: 'label', impact: 'serious', description: '', nodes: 1 },       // -15
          { id: 'heading-order', impact: 'moderate', description: '', nodes: 1 }, // -5
          { id: 'minor-issue', impact: 'minor', description: '', nodes: 1 },   // -1
        ],
        passedChecks: 6,
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // 100 - 25 - 15 - 5 - 1 = 54
      assume(result.data!.score).equals(54);
    });

    it('should floor score at 0', async function scoreFloor() {
      const page = createAccessibilityMock({
        issues: [
          { id: 'img1', impact: 'critical', description: '', nodes: 1 },
          { id: 'img2', impact: 'critical', description: '', nodes: 1 },
          { id: 'img3', impact: 'critical', description: '', nodes: 1 },
          { id: 'img4', impact: 'critical', description: '', nodes: 1 },
          { id: 'img5', impact: 'critical', description: '', nodes: 1 },
        ],
        passedChecks: 0,
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // 5 critical * 25 = 125, capped at 0
      assume(result.data!.score).equals(0);
    });

    it('should count violations by severity', async function countBySeverity() {
      const page = createAccessibilityMock({
        issues: [
          { id: 'a', impact: 'critical', description: '', nodes: 1 },
          { id: 'b', impact: 'critical', description: '', nodes: 1 },
          { id: 'c', impact: 'serious', description: '', nodes: 1 },
          { id: 'd', impact: 'moderate', description: '', nodes: 1 },
          { id: 'e', impact: 'moderate', description: '', nodes: 1 },
          { id: 'f', impact: 'moderate', description: '', nodes: 1 },
        ],
        passedChecks: 4,
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.violations.critical).equals(2);
      assume(result.data!.violations.serious).equals(1);
      assume(result.data!.violations.moderate).equals(3);
      assume(result.data!.violations.minor).equals(0);
    });

    it('should generate help URLs for each violation', async function helpUrls() {
      const page = createAccessibilityMock({
        issues: [
          { id: 'image-alt', impact: 'critical', description: 'Images must have alt', nodes: 1 },
        ],
        passedChecks: 9,
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.details[0].helpUrl).includes('dequeuniversity.com');
      assume(result.data!.details[0].helpUrl).includes('image-alt');
    });

    it('should handle complete evaluation failure', async function totalFailure() {
      const page = new MockPage({});
      page.evaluate = async () => { throw new Error('DOM inaccessible'); };

      const result = await evaluate(page.asPage());
      assume(result.success).is.false();
      assume(result.error).is.a('string');
      assume(result.duration).is.a('number');
    });

    it('should return perfect score with no issues', async function noIssues() {
      const page = createAccessibilityMock({ issues: [], passedChecks: 10 });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(100);
      assume(result.data!.violations.critical).equals(0);
      assume(result.data!.violations.serious).equals(0);
    });
  });
});
