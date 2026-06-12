/**
 * SEO Quality Scorer — RUBICON-143
 *
 * Converts a SeoAuditReport into a 0-100 quality score and detects
 * regressions against a stored baseline snapshot.
 */

import type { SeoAuditReport, SeoPageAudit, SeoIssueSeverity } from './seo-audit.js';

// ─── Scoring weights ───────────────────────────────────────────────────────

const SEVERITY_DEDUCTION: Record<SeoIssueSeverity, number> = {
  critical: 20,
  warning:  10,
  info:      3,
};

/** Score a single page (0-100). */
export function scorePageAudit(page: SeoPageAudit): number {
  let score = 100;
  for (const issue of page.issues) {
    score -= SEVERITY_DEDUCTION[issue.severity] ?? 5;
  }
  return Math.max(0, score);
}

/** Map of route path → 0-100 page score. */
export type PageScores = Record<string, number>;

/** Map of route path → array of issue codes present on that page. */
export type PageIssues = Record<string, string[]>;

export interface SeoQualityResult {
  /** 0-100 site-wide score (average of page scores). */
  score: number;
  pageScores: PageScores;
  /** Issue codes per page that have at least one issue. */
  missingElements: PageIssues;
  pageCount: number;
  pagesWithIssues: number;
}

/** Derive a SeoQualityResult from an existing audit report. */
export function scoreAuditReport(report: SeoAuditReport): SeoQualityResult {
  const pageScores: PageScores = {};
  const missingElements: PageIssues = {};

  for (const page of report.pages) {
    const s = scorePageAudit(page);
    pageScores[page.path] = s;
    if (page.issues.length > 0) {
      missingElements[page.path] = page.issues.map(i => i.code);
    }
  }

  const scores = Object.values(pageScores);
  const score = scores.length === 0
    ? 100
    : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const pagesWithIssues = Object.keys(missingElements).length;

  return { score, pageScores, missingElements, pageCount: scores.length, pagesWithIssues };
}

// ─── Regression detection ──────────────────────────────────────────────────

/** Minimum score drop that constitutes a regression. */
const REGRESSION_DROP_THRESHOLD = 10;

export interface RegressionDetail {
  path: string;
  /** Issue codes that are new in the current snapshot (not in baseline). */
  newIssues: string[];
}

export interface SeoRegressionResult {
  isRegression: boolean;
  /** Current minus baseline score (negative = degradation). */
  scoreDelta: number;
  regressions: RegressionDetail[];
}

/**
 * Compare a new quality result against a previously stored baseline.
 *
 * A regression is declared when:
 *  - The site score dropped by more than REGRESSION_DROP_THRESHOLD points, OR
 *  - Any page has new issue codes that were not present in the baseline.
 */
export function detectRegression(
  current: SeoQualityResult,
  baseline: { score: number; missingElements: PageIssues },
): SeoRegressionResult {
  const scoreDelta = current.score - baseline.score;

  const regressions: RegressionDetail[] = [];

  for (const [path, currentIssues] of Object.entries(current.missingElements)) {
    const baselineIssues = new Set(baseline.missingElements[path] ?? []);
    const newIssues = currentIssues.filter(code => !baselineIssues.has(code));
    if (newIssues.length > 0) {
      regressions.push({ path, newIssues });
    }
  }

  const isRegression = scoreDelta <= -REGRESSION_DROP_THRESHOLD || regressions.length > 0;

  return { isRegression, scoreDelta, regressions };
}

/**
 * Convenience wrapper: deserializes `previous.missingElements` (stored as JSON string
 * in the DB) and runs detectRegression in one call.
 */
export function detectRegressionFromSnapshot(
  current: SeoQualityResult,
  previous: { score: number; missingElements: string },
): SeoRegressionResult {
  const previousMissing: PageIssues = JSON.parse(previous.missingElements);
  return detectRegression(current, { score: previous.score, missingElements: previousMissing });
}
