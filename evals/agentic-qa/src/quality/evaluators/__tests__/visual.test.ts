import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate } from '../visual.js';
import { MockPage } from './mock-page.js';

describe('visual', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should return success with clean page', async function clean() {
      const page = new MockPage({
        evaluateReturns: [
          '',    // detectPlaceholders: page text
          false, // detectPlaceholders: placeholder images
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 }, // mobile
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 }, // tablet
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 }, // desktop
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data).is.not.undefined();
      assume(result.data!.placeholders).has.length(0);
      assume(result.data!.responsiveIssues).has.length(0);
      assume(result.data!.score).equals(70); // 100 * (7/10) default AI score
    });

    it('should detect lorem ipsum placeholder text', async function loremIpsum() {
      const page = new MockPage({
        evaluateReturns: [
          'Welcome to our site. Lorem ipsum dolor sit amet consectetur.',
          false,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.placeholders.length).is.above(0);
      assume(result.data!.score).is.below(70);
    });

    it('should detect fake phone numbers', async function fakePhone() {
      const page = new MockPage({
        evaluateReturns: [
          'Call us at 555-1234 for more info',
          false,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.placeholders.length).is.above(0);
    });

    it('should detect placeholder email addresses', async function fakeEmail() {
      const page = new MockPage({
        evaluateReturns: [
          'Email us at test@test.com',
          false,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.placeholders.some(p => p.includes('test@test'))).is.true();
    });

    it('should detect example.com domains', async function exampleDomain() {
      const page = new MockPage({
        evaluateReturns: [
          'Visit example.com for details',
          false,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.placeholders.length).is.above(0);
    });

    it('should detect placeholder images', async function placeholderImages() {
      const page = new MockPage({
        evaluateReturns: [
          'Clean text content',
          true, // has placeholder images
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.placeholders).includes('placeholder-image');
    });

    it('should report horizontal scroll issues', async function horizontalScroll() {
      const page = new MockPage({
        evaluateReturns: [
          '',
          false,
          { hasHorizontalScroll: true, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.responsiveIssues.some(i => i.includes('Horizontal scroll'))).is.true();
    });

    it('should report overflow issues', async function overflow() {
      const page = new MockPage({
        evaluateReturns: [
          '',
          false,
          { hasHorizontalScroll: false, overlappingCount: 10, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.responsiveIssues.some(i => i.includes('overflow'))).is.true();
    });

    it('should report small text issues', async function smallText() {
      const page = new MockPage({
        evaluateReturns: [
          '',
          false,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 15 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.responsiveIssues.some(i => i.includes('small text'))).is.true();
    });

    it('should apply penalty for each placeholder found', async function placeholderPenalty() {
      const page = new MockPage({
        evaluateReturns: [
          'Lorem ipsum dolor sit amet. Call 555-1234. Email test@test.com',
          false,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      // Multiple placeholders detected: 10 penalty each, then * 0.7 for AI default
      assume(result.data!.score).is.below(70);
    });

    it('should use default AI score of 7 when no API key', async function defaultAiScore() {
      const page = new MockPage({
        evaluateReturns: [
          '',
          false,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage(), {});
      assume(result.success).is.true();
      assume(result.data!.aiAestheticScore).equals(7);
      assume(result.data!.aiAestheticFeedback).equals(undefined);
    });

    it('should deduplicate placeholders', async function dedup() {
      const page = new MockPage({
        evaluateReturns: [
          'Lorem ipsum here. And more lorem ipsum there.',
          false,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      const loremCount = result.data!.placeholders.filter(p => p.includes('lorem')).length;
      assume(loremCount).is.most(1);
    });

    it('should handle evaluate errors gracefully', async function errorHandling() {
      const page = new MockPage();
      page.evaluate = async () => { throw new Error('Page crashed'); };

      const result = await evaluate(page.asPage());
      assume(result.success).is.false();
      assume(result.error).includes('Page crashed');
      assume(result.duration).is.a('number');
    });

    it('should cap placeholders at 10', async function capPlaceholders() {
      const page = new MockPage({
        evaluateReturns: [
          'Lorem ipsum dolor sit amet placeholder [your name] [insert text] xxx sample text coming soon under construction example.com 555-1234 123-456-7890 test@test.com your@email.com imgplaceholder via placeholder',
          true,
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
          { hasHorizontalScroll: false, overlappingCount: 0, smallTextCount: 0 },
        ],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.placeholders.length).is.most(10);
    });
  });
});
