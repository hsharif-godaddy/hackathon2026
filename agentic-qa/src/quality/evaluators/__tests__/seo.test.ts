import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate } from '../seo.js';
import { MockPage } from './mock-page.js';

describe('seo', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should score well for a fully optimized page', async function optimized() {
      const page = new MockPage({
        evaluateReturns: [{
          hasTitle: true,
          titleLength: 45,           // optimal range 30-60
          hasMetaDescription: true,
          metaDescriptionLength: 135, // optimal range 120-155
          hasSingleH1: true,
          h1Count: 1,
          hasCanonical: true,
          hasViewport: true,
          imageAltRate: 1,
          imagesWithoutAlt: 0,
          totalImages: 5,
          hasStructuredData: true,
          isHttps: true,
          hasRobotsMeta: true,
          isIndexable: true,
          hasOpenGraph: true,
          hasTwitterCards: true,
          hasProperHierarchy: true,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(100);
      assume(result.data!.checks.hasTitle).is.true();
      assume(result.data!.checks.hasMetaDescription).is.true();
      assume(result.data!.checks.hasSingleH1).is.true();
    });

    it('should penalize missing title', async function noTitle() {
      const page = new MockPage({
        evaluateReturns: [{
          hasTitle: false,
          titleLength: 5,
          hasMetaDescription: true,
          metaDescriptionLength: 135,
          hasSingleH1: true, h1Count: 1,
          hasCanonical: true, hasViewport: true,
          imageAltRate: 1, imagesWithoutAlt: 0, totalImages: 5,
          hasStructuredData: true, isHttps: true, hasRobotsMeta: true,
          isIndexable: true, hasOpenGraph: true, hasTwitterCards: true,
          hasProperHierarchy: true,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).is.below(100);
      assume(result.data!.checks.hasTitle).is.false();
    });

    it('should penalize missing meta description', async function noMetaDesc() {
      const page = new MockPage({
        evaluateReturns: [{
          hasTitle: true, titleLength: 45,
          hasMetaDescription: false,
          metaDescriptionLength: 0,
          hasSingleH1: true, h1Count: 1,
          hasCanonical: true, hasViewport: true,
          imageAltRate: 1, imagesWithoutAlt: 0, totalImages: 5,
          hasStructuredData: true, isHttps: true, hasRobotsMeta: true,
          isIndexable: true, hasOpenGraph: true, hasTwitterCards: true,
          hasProperHierarchy: true,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).is.below(100);
    });

    it('should give title length quality bonus for optimal range', async function titleLengthBonus() {
      const optimal = new MockPage({
        evaluateReturns: [{ hasTitle: true, titleLength: 45, hasMetaDescription: false, metaDescriptionLength: 0, hasSingleH1: false, h1Count: 0, hasCanonical: false, hasViewport: false, imageAltRate: 0, imagesWithoutAlt: 5, totalImages: 5, hasStructuredData: false, isHttps: false, hasRobotsMeta: false, isIndexable: true, hasOpenGraph: false, hasTwitterCards: false, hasProperHierarchy: true }],
      });
      const short = new MockPage({
        evaluateReturns: [{ hasTitle: true, titleLength: 15, hasMetaDescription: false, metaDescriptionLength: 0, hasSingleH1: false, h1Count: 0, hasCanonical: false, hasViewport: false, imageAltRate: 0, imagesWithoutAlt: 5, totalImages: 5, hasStructuredData: false, isHttps: false, hasRobotsMeta: false, isIndexable: true, hasOpenGraph: false, hasTwitterCards: false, hasProperHierarchy: true }],
      });

      const optResult = await evaluate(optimal.asPage());
      const shortResult = await evaluate(short.asPage());

      assume(optResult.data!.score).is.above(shortResult.data!.score);
    });

    it('should give meta description quality bonus for optimal range', async function metaDescLengthBonus() {
      const optimal = new MockPage({
        evaluateReturns: [{ hasTitle: false, titleLength: 0, hasMetaDescription: true, metaDescriptionLength: 140, hasSingleH1: false, h1Count: 0, hasCanonical: false, hasViewport: false, imageAltRate: 0, imagesWithoutAlt: 0, totalImages: 0, hasStructuredData: false, isHttps: false, hasRobotsMeta: false, isIndexable: true, hasOpenGraph: false, hasTwitterCards: false, hasProperHierarchy: true }],
      });
      const short = new MockPage({
        evaluateReturns: [{ hasTitle: false, titleLength: 0, hasMetaDescription: true, metaDescriptionLength: 60, hasSingleH1: false, h1Count: 0, hasCanonical: false, hasViewport: false, imageAltRate: 0, imagesWithoutAlt: 0, totalImages: 0, hasStructuredData: false, isHttps: false, hasRobotsMeta: false, isIndexable: true, hasOpenGraph: false, hasTwitterCards: false, hasProperHierarchy: true }],
      });

      const optResult = await evaluate(optimal.asPage());
      const shortResult = await evaluate(short.asPage());

      assume(optResult.data!.score).is.above(shortResult.data!.score);
    });

    it('should scale image alt rate proportionally', async function imageAltRate() {
      const full = new MockPage({
        evaluateReturns: [{ hasTitle: false, titleLength: 0, hasMetaDescription: false, metaDescriptionLength: 0, hasSingleH1: false, h1Count: 0, hasCanonical: false, hasViewport: false, imageAltRate: 1.0, imagesWithoutAlt: 0, totalImages: 10, hasStructuredData: false, isHttps: false, hasRobotsMeta: false, isIndexable: true, hasOpenGraph: false, hasTwitterCards: false, hasProperHierarchy: true }],
      });
      const half = new MockPage({
        evaluateReturns: [{ hasTitle: false, titleLength: 0, hasMetaDescription: false, metaDescriptionLength: 0, hasSingleH1: false, h1Count: 0, hasCanonical: false, hasViewport: false, imageAltRate: 0.5, imagesWithoutAlt: 5, totalImages: 10, hasStructuredData: false, isHttps: false, hasRobotsMeta: false, isIndexable: true, hasOpenGraph: false, hasTwitterCards: false, hasProperHierarchy: true }],
      });

      const fullResult = await evaluate(full.asPage());
      const halfResult = await evaluate(half.asPage());

      assume(fullResult.data!.score).is.above(halfResult.data!.score);
    });

    it('should give zero score for page with nothing', async function barePage() {
      const page = new MockPage({
        evaluateReturns: [{
          hasTitle: false, titleLength: 0,
          hasMetaDescription: false, metaDescriptionLength: 0,
          hasSingleH1: false, h1Count: 0,
          hasCanonical: false, hasViewport: false,
          imageAltRate: 0, imagesWithoutAlt: 0, totalImages: 0,
          hasStructuredData: false, isHttps: false, hasRobotsMeta: false,
          isIndexable: true, hasOpenGraph: false, hasTwitterCards: false,
          hasProperHierarchy: true,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).equals(0);
    });

    it('should handle errors gracefully', async function errorHandling() {
      const page = new MockPage();
      page.evaluate = async () => { throw new Error('DOM error'); };

      const result = await evaluate(page.asPage());
      assume(result.success).is.false();
      assume(result.error).includes('DOM error');
    });
  });
});
