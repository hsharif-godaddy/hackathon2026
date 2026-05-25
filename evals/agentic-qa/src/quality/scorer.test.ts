import assume from 'assume';
import { describe, it } from 'node:test';

import { calculateOverallScore, getScoreSummary, meetsThresholds } from './scorer.js';
import type { QualityEvaluation } from './types.js';

describe('scorer', function packageTests() {
  describe('#calculateOverallScore', function calculateOverallScoreTests() {
    it('should return zero score for empty evaluation', function empty() {
      const result = calculateOverallScore({});
      assume(result.score).equals(0);
      assume(result.grade).equals('F');
      assume(result.criticalIssues).is.a('array');
      assume(result.recommendations).is.a('array');
    });

    it('should calculate weighted score from available categories', function weighted() {
      const result = calculateOverallScore({
        performance: {
          score: 90,
          lcp: { value: 1000, rating: 'good' },
          inp: { value: 100, rating: 'good' },
          cls: { value: 0.05, rating: 'good' },
          fcp: { value: 800, rating: 'good' },
          tbt: { value: 100, rating: 'good' },
          speedIndex: { value: 2000, rating: 'good' },
        },
        functional: {
          score: 100,
          jsErrors: [],
          brokenLinks: [],
          failedResources: [],
          brokenImages: [],
          totalLinks: 10,
          totalImages: 5,
        },
      });

      assume(result.score).is.above(0);
      assume(result.score).is.most(100);
    });

    it('should assign grade A for scores >= 90', function gradeA() {
      const result = calculateOverallScore({
        functional: {
          score: 95,
          jsErrors: [],
          brokenLinks: [],
          failedResources: [],
          brokenImages: [],
          totalLinks: 10,
          totalImages: 5,
        },
      });
      assume(result.score).equals(95);
      assume(result.grade).equals('A');
    });

    it('should assign grade B for scores >= 80 and < 90', function gradeB() {
      const result = calculateOverallScore({
        functional: {
          score: 85,
          jsErrors: [],
          brokenLinks: [],
          failedResources: [],
          brokenImages: [],
          totalLinks: 10,
          totalImages: 5,
        },
      });
      assume(result.score).equals(85);
      assume(result.grade).equals('B');
    });

    it('should assign grade C for scores >= 70 and < 80', function gradeC() {
      const result = calculateOverallScore({
        functional: {
          score: 75,
          jsErrors: [],
          brokenLinks: [],
          failedResources: [],
          brokenImages: [],
          totalLinks: 10,
          totalImages: 5,
        },
      });
      assume(result.score).equals(75);
      assume(result.grade).equals('C');
    });

    it('should assign grade D for scores >= 60 and < 70', function gradeD() {
      const result = calculateOverallScore({
        functional: {
          score: 65,
          jsErrors: [],
          brokenLinks: [],
          failedResources: [],
          brokenImages: [],
          totalLinks: 10,
          totalImages: 5,
        },
      });
      assume(result.score).equals(65);
      assume(result.grade).equals('D');
    });

    it('should assign grade F for scores < 60', function gradeF() {
      const result = calculateOverallScore({
        functional: {
          score: 40,
          jsErrors: ['TypeError: x is undefined'],
          brokenLinks: [],
          failedResources: [],
          brokenImages: [],
          totalLinks: 10,
          totalImages: 5,
        },
      });
      assume(result.score).equals(40);
      assume(result.grade).equals('F');
    });

    it('should collect critical issues from performance', function perfIssues() {
      const result = calculateOverallScore({
        performance: {
          score: 20,
          lcp: { value: 5000, rating: 'poor' },
          inp: { value: 100, rating: 'good' },
          cls: { value: 0.3, rating: 'poor' },
          fcp: { value: 800, rating: 'good' },
          tbt: { value: 100, rating: 'good' },
          speedIndex: { value: 2000, rating: 'good' },
        },
      });

      assume(result.criticalIssues.length).is.above(0);
      assume(result.criticalIssues.some(i => i.includes('Largest Contentful Paint'))).is.true();
      assume(result.criticalIssues.some(i => i.includes('Cumulative Layout Shift'))).is.true();
    });

    it('should collect critical issues from accessibility', function a11yIssues() {
      const result = calculateOverallScore({
        accessibility: {
          score: 30,
          violations: { critical: 3, serious: 5, moderate: 2, minor: 1 },
          passedChecks: 10,
          details: [],
        },
      });

      assume(result.criticalIssues.some(i => i.includes('critical accessibility'))).is.true();
      assume(result.criticalIssues.some(i => i.includes('serious accessibility'))).is.true();
    });

    it('should collect critical issues from functional evaluation', function funcIssues() {
      const result = calculateOverallScore({
        functional: {
          score: 20,
          jsErrors: ['ReferenceError: foo'],
          brokenLinks: ['404: /page1', '404: /page2', '404: /page3', '404: /page4'],
          failedResources: [],
          brokenImages: [],
          totalLinks: 20,
          totalImages: 5,
        },
      });

      assume(result.criticalIssues.some(i => i.includes('JavaScript error'))).is.true();
      assume(result.criticalIssues.some(i => i.includes('broken links'))).is.true();
    });

    it('should collect critical issues from security', function secIssues() {
      const result = calculateOverallScore({
        security: {
          score: 20,
          isHttps: false,
          mixedContent: ['http://example.com/img.png'],
          securityHeaders: {
            xFrameOptions: false,
            contentSecurityPolicy: false,
            xContentTypeOptions: false,
            strictTransportSecurity: false,
          },
        },
      });

      assume(result.criticalIssues.some(i => i.includes('HTTPS'))).is.true();
      assume(result.criticalIssues.some(i => i.includes('mixed content'))).is.true();
    });

    it('should collect critical issues from content evaluation', function contentIssues() {
      const result = calculateOverallScore({
        content: {
          score: 20,
          relevance: 2,
          coherence: 5,
          completeness: 5,
          professionalism: 5,
          uniqueness: 5,
          issues: ['Placeholder content detected in header'],
        },
      });

      assume(result.criticalIssues.some(i => i.includes('Content does not match'))).is.true();
      assume(result.criticalIssues.some(i => i.includes('Placeholder content'))).is.true();
    });

    it('should generate performance recommendations for low scores', function perfRecommendations() {
      const result = calculateOverallScore({
        performance: {
          score: 40,
          lcp: { value: 4500, rating: 'poor' },
          inp: { value: 100, rating: 'good' },
          cls: { value: 0.3, rating: 'poor' },
          fcp: { value: 800, rating: 'good' },
          tbt: { value: 700, rating: 'poor' },
          speedIndex: { value: 2000, rating: 'good' },
        },
      });

      assume(result.recommendations.some(r => r.includes('LCP'))).is.true();
      assume(result.recommendations.some(r => r.includes('layout shifts'))).is.true();
      assume(result.recommendations.some(r => r.includes('JavaScript execution'))).is.true();
    });

    it('should generate accessibility recommendations', function a11yRecommendations() {
      const result = calculateOverallScore({
        accessibility: {
          score: 50,
          violations: { critical: 0, serious: 1, moderate: 2, minor: 3 },
          passedChecks: 10,
          details: [
            { id: 'image-alt', impact: 'serious', description: 'Images must have alt text', helpUrl: '', nodes: 3 },
            { id: 'color-contrast', impact: 'moderate', description: 'Color contrast', helpUrl: '', nodes: 2 },
          ],
        },
      });

      assume(result.recommendations.some(r => r.includes('alt text'))).is.true();
      assume(result.recommendations.some(r => r.includes('color contrast'))).is.true();
    });

    it('should generate SEO recommendations', function seoRecommendations() {
      const result = calculateOverallScore({
        seo: {
          score: 40,
          checks: {
            hasTitle: true,
            titleLength: 20,
            hasMetaDescription: false,
            metaDescriptionLength: 0,
            hasSingleH1: false,
            h1Count: 0,
            hasCanonical: false,
            hasViewport: true,
            imageAltRate: 0.5,
            imagesWithoutAlt: 3,
            totalImages: 6,
            hasStructuredData: false,
            isHttps: true,
            hasRobotsMeta: false,
          },
        },
      });

      assume(result.recommendations.some(r => r.includes('meta description'))).is.true();
      assume(result.recommendations.some(r => r.includes('H1'))).is.true();
      assume(result.recommendations.some(r => r.includes('structured data'))).is.true();
    });

    it('should limit recommendations to 10', function limitRecommendations() {
      const result = calculateOverallScore({
        performance: {
          score: 10,
          lcp: { value: 10000, rating: 'poor' },
          inp: { value: 800, rating: 'poor' },
          cls: { value: 0.5, rating: 'poor' },
          fcp: { value: 5000, rating: 'poor' },
          tbt: { value: 1000, rating: 'poor' },
          speedIndex: { value: 10000, rating: 'poor' },
        },
        accessibility: {
          score: 10,
          violations: { critical: 5, serious: 5, moderate: 5, minor: 5 },
          passedChecks: 0,
          details: [
            { id: 'image-alt', impact: 'serious', description: '', helpUrl: '', nodes: 3 },
            { id: 'label', impact: 'serious', description: '', helpUrl: '', nodes: 2 },
            { id: 'color-contrast', impact: 'moderate', description: '', helpUrl: '', nodes: 2 },
          ],
        },
        seo: {
          score: 10,
          checks: {
            hasTitle: false, titleLength: 0, hasMetaDescription: false,
            metaDescriptionLength: 0, hasSingleH1: false, h1Count: 0,
            hasCanonical: false, hasViewport: false, imageAltRate: 0,
            imagesWithoutAlt: 10, totalImages: 10, hasStructuredData: false,
            isHttps: false, hasRobotsMeta: false,
          },
        },
        security: {
          score: 10,
          isHttps: false,
          mixedContent: [],
          securityHeaders: {
            xFrameOptions: false, contentSecurityPolicy: false,
            xContentTypeOptions: false, strictTransportSecurity: false,
          },
        },
      });

      assume(result.recommendations.length).is.most(10);
    });

    it('should ignore categories with non-numeric scores', function nonNumeric() {
      const result = calculateOverallScore({
        functional: {
          score: NaN,
          jsErrors: [],
          brokenLinks: [],
          failedResources: [],
          brokenImages: [],
          totalLinks: 0,
          totalImages: 0,
        },
      });

      assume(result.score).equals(0);
    });
  });

  describe('#getScoreSummary', function getScoreSummaryTests() {
    it('should return undefined for missing categories', function missingCategories() {
      const summary = getScoreSummary({});

      assume(summary.performance).equals(undefined);
      assume(summary.accessibility).equals(undefined);
      assume(summary.seo).equals(undefined);
      assume(summary.functional).equals(undefined);
      assume(summary.visual).equals(undefined);
      assume(summary.content).equals(undefined);
      assume(summary.security).equals(undefined);
      assume(summary.usability).equals(undefined);
      assume(summary.businessFit).equals(undefined);
    });

    it('should return scores for present categories', function presentCategories() {
      const summary = getScoreSummary({
        performance: {
          score: 85,
          lcp: { value: 1500, rating: 'good' },
          inp: { value: 100, rating: 'good' },
          cls: { value: 0.05, rating: 'good' },
          fcp: { value: 800, rating: 'good' },
          tbt: { value: 100, rating: 'good' },
          speedIndex: { value: 2000, rating: 'good' },
        },
        functional: {
          score: 100,
          jsErrors: [],
          brokenLinks: [],
          failedResources: [],
          brokenImages: [],
          totalLinks: 10,
          totalImages: 5,
        },
      });

      assume(summary.performance).equals(85);
      assume(summary.functional).equals(100);
      assume(summary.accessibility).equals(undefined);
    });
  });

  describe('#meetsThresholds', function meetsThresholdsTests() {
    it('should pass when no thresholds are set', function noThresholds() {
      const result = meetsThresholds({}, {});
      assume(result.passes).is.true();
      assume(result.failures).has.length(0);
    });

    it('should pass when scores meet thresholds', function meetsAll() {
      const evaluation: Partial<QualityEvaluation> = {
        overall: {
          score: 85,
          grade: 'B',
          criticalIssues: [],
          recommendations: [],
        },
        performance: {
          score: 75,
          lcp: { value: 2000, rating: 'good' },
          inp: { value: 100, rating: 'good' },
          cls: { value: 0.05, rating: 'good' },
          fcp: { value: 800, rating: 'good' },
          tbt: { value: 100, rating: 'good' },
          speedIndex: { value: 2000, rating: 'good' },
        },
        accessibility: {
          score: 90,
          violations: { critical: 0, serious: 0, moderate: 1, minor: 2 },
          passedChecks: 50,
          details: [],
        },
      };

      const result = meetsThresholds(evaluation, {
        minOverallScore: 70,
        minPerformance: 50,
        minAccessibility: 80,
      });

      assume(result.passes).is.true();
      assume(result.failures).has.length(0);
    });

    it('should fail when overall score is below threshold', function failOverall() {
      const evaluation: Partial<QualityEvaluation> = {
        overall: {
          score: 55,
          grade: 'F',
          criticalIssues: [],
          recommendations: [],
        },
      };

      const result = meetsThresholds(evaluation, {
        minOverallScore: 70,
      });

      assume(result.passes).is.false();
      assume(result.failures.length).equals(1);
      assume(result.failures[0]).includes('Overall score');
    });

    it('should fail when performance score is below threshold', function failPerformance() {
      const evaluation: Partial<QualityEvaluation> = {
        performance: {
          score: 30,
          lcp: { value: 5000, rating: 'poor' },
          inp: { value: 100, rating: 'good' },
          cls: { value: 0.05, rating: 'good' },
          fcp: { value: 800, rating: 'good' },
          tbt: { value: 100, rating: 'good' },
          speedIndex: { value: 2000, rating: 'good' },
        },
      };

      const result = meetsThresholds(evaluation, {
        minPerformance: 50,
      });

      assume(result.passes).is.false();
      assume(result.failures[0]).includes('Performance score');
    });

    it('should fail when accessibility score is below threshold', function failAccessibility() {
      const evaluation: Partial<QualityEvaluation> = {
        accessibility: {
          score: 60,
          violations: { critical: 2, serious: 3, moderate: 5, minor: 10 },
          passedChecks: 20,
          details: [],
        },
      };

      const result = meetsThresholds(evaluation, {
        minAccessibility: 80,
      });

      assume(result.passes).is.false();
      assume(result.failures[0]).includes('Accessibility score');
    });

    it('should report multiple failures', function multipleFailures() {
      const evaluation: Partial<QualityEvaluation> = {
        overall: {
          score: 40,
          grade: 'F',
          criticalIssues: [],
          recommendations: [],
        },
        performance: {
          score: 20,
          lcp: { value: 8000, rating: 'poor' },
          inp: { value: 100, rating: 'good' },
          cls: { value: 0.05, rating: 'good' },
          fcp: { value: 800, rating: 'good' },
          tbt: { value: 100, rating: 'good' },
          speedIndex: { value: 2000, rating: 'good' },
        },
        accessibility: {
          score: 50,
          violations: { critical: 5, serious: 5, moderate: 5, minor: 5 },
          passedChecks: 5,
          details: [],
        },
      };

      const result = meetsThresholds(evaluation, {
        minOverallScore: 70,
        minPerformance: 50,
        minAccessibility: 80,
      });

      assume(result.passes).is.false();
      assume(result.failures.length).equals(3);
    });

    it('should skip checks for missing category data', function missingData() {
      const result = meetsThresholds({}, {
        minOverallScore: 70,
        minPerformance: 50,
        minAccessibility: 80,
      });

      assume(result.passes).is.true();
      assume(result.failures).has.length(0);
    });
  });
});
