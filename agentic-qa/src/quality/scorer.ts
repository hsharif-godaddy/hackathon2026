import type {
  AccessibilityScore,
  BusinessFitScore,
  ContentScore,
  EvaluationCategory,
  FunctionalScore,
  PerformanceScore,
  QualityEvaluation,
  SecurityScore,
  SEOScore,
  UsabilityScore,
  VisualScore,
} from './types.js';
import { CATEGORY_WEIGHTS } from './types.js';

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

interface OverallResult {
  score: number;
  grade: Grade;
  criticalIssues: string[];
  recommendations: string[];
}

/**
 * Calculate the overall quality score from individual category scores
 */
export function calculateOverallScore(
  evaluation: Partial<QualityEvaluation>
): OverallResult {
  let totalWeight = 0;
  let weightedSum = 0;

  // Calculate weighted sum of available scores
  for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    const categoryData = evaluation[category as EvaluationCategory];
    if (categoryData && typeof categoryData === 'object' && 'score' in categoryData) {
      const score = (categoryData as { score: number }).score;
      if (typeof score === 'number' && !isNaN(score)) {
        weightedSum += score * weight;
        totalWeight += weight;
      }
    }
  }

  // Calculate normalized score
  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const grade = scoreToGrade(score);

  // Collect critical issues from all categories
  const criticalIssues = collectCriticalIssues(evaluation);

  // Generate recommendations based on scores
  const recommendations = generateRecommendations(evaluation);

  return {
    score,
    grade,
    criticalIssues,
    recommendations,
  };
}

/**
 * Convert numeric score to letter grade
 */
function scoreToGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Collect critical issues from all evaluation categories
 */
function collectCriticalIssues(evaluation: Partial<QualityEvaluation>): string[] {
  const issues: string[] = [];

  // Performance critical issues
  const perf = evaluation.performance as PerformanceScore | undefined;
  if (perf) {
    if (perf.lcp.rating === 'poor') {
      issues.push(`Critical: Largest Contentful Paint is ${Math.round(perf.lcp.value)}ms (should be < 2500ms)`);
    }
    if (perf.cls.rating === 'poor') {
      issues.push(`Critical: Cumulative Layout Shift is ${perf.cls.value.toFixed(2)} (should be < 0.1)`);
    }
  }

  // Accessibility critical issues
  const a11y = evaluation.accessibility as AccessibilityScore | undefined;
  if (a11y) {
    if (a11y.violations.critical > 0) {
      issues.push(`Critical: ${a11y.violations.critical} critical accessibility violations`);
    }
    if (a11y.violations.serious > 2) {
      issues.push(`Serious: ${a11y.violations.serious} serious accessibility issues`);
    }
  }

  // Functional critical issues
  const func = evaluation.functional as FunctionalScore | undefined;
  if (func) {
    if (func.jsErrors.length > 0) {
      issues.push(`Critical: ${func.jsErrors.length} JavaScript error(s) detected`);
    }
    if (func.brokenLinks.length > 3) {
      issues.push(`Serious: ${func.brokenLinks.length} broken links found`);
    }
  }

  // Security critical issues
  const sec = evaluation.security as SecurityScore | undefined;
  if (sec) {
    if (!sec.isHttps) {
      issues.push('Critical: Site is not using HTTPS');
    }
    if (sec.mixedContent.length > 0) {
      issues.push(`Serious: ${sec.mixedContent.length} mixed content resource(s)`);
    }
  }

  // Content critical issues
  const content = evaluation.content as ContentScore | undefined;
  if (content) {
    if (content.relevance < 4) {
      issues.push('Serious: Content does not match the original request');
    }
    if (content.issues.some(i => i.toLowerCase().includes('placeholder'))) {
      issues.push('Critical: Placeholder content detected');
    }
  }

  // Visual critical issues
  const visual = evaluation.visual as VisualScore | undefined;
  if (visual) {
    if (visual.placeholders.length > 0) {
      issues.push(`Serious: ${visual.placeholders.length} placeholder pattern(s) detected`);
    }
    if (visual.responsiveIssues.length > 0) {
      issues.push(`Moderate: ${visual.responsiveIssues.length} responsive design issue(s)`);
    }
  }

  return issues;
}

/**
 * Generate recommendations based on evaluation results
 */
function generateRecommendations(evaluation: Partial<QualityEvaluation>): string[] {
  const recommendations: string[] = [];

  // Performance recommendations
  const perf = evaluation.performance as PerformanceScore | undefined;
  if (perf && perf.score < 70) {
    if (perf.lcp.rating !== 'good') {
      recommendations.push('Optimize images and consider lazy loading to improve LCP');
    }
    if (perf.tbt.rating !== 'good') {
      recommendations.push('Reduce JavaScript execution time to improve interactivity');
    }
    if (perf.cls.rating !== 'good') {
      recommendations.push('Add explicit dimensions to images and embeds to prevent layout shifts');
    }
  }

  // Accessibility recommendations
  const a11y = evaluation.accessibility as AccessibilityScore | undefined;
  if (a11y && a11y.score < 80) {
    if (a11y.details.some(d => d.id === 'image-alt')) {
      recommendations.push('Add descriptive alt text to all images');
    }
    if (a11y.details.some(d => d.id === 'label')) {
      recommendations.push('Associate labels with all form inputs');
    }
    if (a11y.details.some(d => d.id === 'color-contrast')) {
      recommendations.push('Improve color contrast for better readability');
    }
  }

  // SEO recommendations
  const seo = evaluation.seo as SEOScore | undefined;
  if (seo && seo.score < 80) {
    if (!seo.checks.hasMetaDescription) {
      recommendations.push('Add a meta description between 120-160 characters');
    }
    if (!seo.checks.hasSingleH1) {
      recommendations.push('Ensure exactly one H1 heading per page');
    }
    if (seo.checks.imageAltRate < 1) {
      recommendations.push('Add alt text to all images for better SEO');
    }
    if (!seo.checks.hasStructuredData) {
      recommendations.push('Add JSON-LD structured data for rich search results');
    }
  }

  // Content recommendations
  const content = evaluation.content as ContentScore | undefined;
  if (content && content.score < 70) {
    if (content.completeness < 6) {
      recommendations.push('Add more content sections to make the site comprehensive');
    }
    if (content.uniqueness < 6) {
      recommendations.push('Vary the content to avoid repetition across sections');
    }
    if (content.professionalism < 6) {
      recommendations.push('Revise content to sound more professional and authentic');
    }
  }

  // Visual recommendations
  const visual = evaluation.visual as VisualScore | undefined;
  if (visual && visual.score < 70) {
    if (visual.placeholders.length > 0) {
      recommendations.push('Replace all placeholder text with real content');
    }
    if (visual.responsiveIssues.length > 0) {
      recommendations.push('Fix responsive design issues for better mobile experience');
    }
  }

  // Business fit recommendations
  const bizFit = evaluation.businessFit as BusinessFitScore | undefined;
  if (bizFit && bizFit.missingElements.length > 0) {
    const missing = bizFit.missingElements.slice(0, 3).join(', ');
    recommendations.push(`Add missing ${bizFit.siteType} elements: ${missing}`);
  }

  // Security recommendations
  const sec = evaluation.security as SecurityScore | undefined;
  if (sec && sec.score < 80) {
    if (!sec.securityHeaders.contentSecurityPolicy) {
      recommendations.push('Add Content-Security-Policy header for XSS protection');
    }
    if (!sec.securityHeaders.strictTransportSecurity) {
      recommendations.push('Enable HSTS for secure connections');
    }
  }

  // Usability recommendations
  const usability = evaluation.usability as UsabilityScore | undefined;
  if (usability && usability.issues.length > 0) {
    const majorIssues = usability.issues.filter(i => i.severity >= 3);
    if (majorIssues.length > 0) {
      recommendations.push(`Address ${majorIssues.length} major usability issue(s)`);
    }
  }

  return recommendations.slice(0, 10); // Limit to top 10 recommendations
}

/**
 * Get a summary of scores by category
 */
export function getScoreSummary(
  evaluation: Partial<QualityEvaluation>
): Record<string, number | undefined> {
  return {
    performance: (evaluation.performance as PerformanceScore | undefined)?.score,
    accessibility: (evaluation.accessibility as AccessibilityScore | undefined)?.score,
    seo: (evaluation.seo as SEOScore | undefined)?.score,
    functional: (evaluation.functional as FunctionalScore | undefined)?.score,
    visual: (evaluation.visual as VisualScore | undefined)?.score,
    content: (evaluation.content as ContentScore | undefined)?.score,
    security: (evaluation.security as SecurityScore | undefined)?.score,
    usability: (evaluation.usability as UsabilityScore | undefined)?.score,
    businessFit: (evaluation.businessFit as BusinessFitScore | undefined)?.score,
  };
}

/**
 * Check if evaluation meets minimum thresholds
 */
export function meetsThresholds(
  evaluation: Partial<QualityEvaluation>,
  thresholds: {
    minOverallScore?: number;
    minPerformance?: number;
    minAccessibility?: number;
  }
): { passes: boolean; failures: string[] } {
  const failures: string[] = [];
  const overall = evaluation.overall;

  if (thresholds.minOverallScore && overall && overall.score < thresholds.minOverallScore) {
    failures.push(`Overall score ${overall.score} below threshold ${thresholds.minOverallScore}`);
  }

  const perf = evaluation.performance as PerformanceScore | undefined;
  if (thresholds.minPerformance && perf && perf.score < thresholds.minPerformance) {
    failures.push(`Performance score ${perf.score} below threshold ${thresholds.minPerformance}`);
  }

  const a11y = evaluation.accessibility as AccessibilityScore | undefined;
  if (thresholds.minAccessibility && a11y && a11y.score < thresholds.minAccessibility) {
    failures.push(`Accessibility score ${a11y.score} below threshold ${thresholds.minAccessibility}`);
  }

  return {
    passes: failures.length === 0,
    failures,
  };
}
