import { describe, it, expect } from 'vitest';
import { scorePageAudit, scoreAuditReport, detectRegression } from '../SeoQualityScorer.js';
import type { SeoPageAudit, SeoAuditReport } from '../seo-audit.js';

function makePage(path: string, codes: Array<{ code: string; severity: 'critical' | 'warning' | 'info' }>): SeoPageAudit {
  return {
    path,
    layer: 'source',
    ok: codes.length === 0,
    issues: codes.map(({ code, severity }) => ({ code, label: code, severity })),
  };
}

function makeReport(pages: SeoPageAudit[]): SeoAuditReport {
  return {
    appId: 'test-app',
    auditedAt: new Date().toISOString(),
    htmlBaseUrl: null,
    auditMode: 'source-only',
    routes: pages.map(p => p.path),
    pages,
    summary: {
      totalPages: pages.length,
      pagesWithIssues: pages.filter(p => !p.ok).length,
      issueCount: pages.reduce((n, p) => n + p.issues.length, 0),
    },
  };
}

describe('scorePageAudit', () => {
  it('returns 100 for a page with no issues', () => {
    const page = makePage('/', []);
    expect(scorePageAudit(page)).toBe(100);
  });

  it('deducts 20 for each critical issue', () => {
    const page = makePage('/', [
      { code: 'missing-title', severity: 'critical' },
      { code: 'missing-description', severity: 'critical' },
    ]);
    expect(scorePageAudit(page)).toBe(60);
  });

  it('deducts 10 for each warning issue', () => {
    const page = makePage('/', [
      { code: 'missing-og:image', severity: 'warning' },
      { code: 'missing-twitter:card', severity: 'warning' },
    ]);
    expect(scorePageAudit(page)).toBe(80);
  });

  it('deducts 3 for each info issue', () => {
    const page = makePage('/', [
      { code: 'missing-helmet', severity: 'info' },
    ]);
    expect(scorePageAudit(page)).toBe(97);
  });

  it('never goes below 0', () => {
    const page = makePage('/', [
      { code: 'missing-title', severity: 'critical' },
      { code: 'missing-description', severity: 'critical' },
      { code: 'missing-h1', severity: 'critical' },
      { code: 'missing-og:image', severity: 'warning' },
      { code: 'missing-og:title', severity: 'warning' },
      { code: 'missing-og:description', severity: 'warning' },
      { code: 'missing-twitter:card', severity: 'warning' },
    ]);
    expect(scorePageAudit(page)).toBe(0);
  });
});

describe('scoreAuditReport', () => {
  it('returns 100 for a report with no pages', () => {
    const result = scoreAuditReport(makeReport([]));
    expect(result.score).toBe(100);
    expect(result.pageCount).toBe(0);
    expect(result.pagesWithIssues).toBe(0);
  });

  it('averages page scores across all pages', () => {
    const report = makeReport([
      makePage('/', []),                                                       // 100
      makePage('/about', [{ code: 'missing-title', severity: 'critical' }]),  // 80
    ]);
    const result = scoreAuditReport(report);
    expect(result.score).toBe(90);
    expect(result.pagesWithIssues).toBe(1);
  });

  it('populates missingElements only for pages with issues', () => {
    const report = makeReport([
      makePage('/', []),
      makePage('/about', [{ code: 'missing-title', severity: 'critical' }]),
    ]);
    const result = scoreAuditReport(report);
    expect(result.missingElements['/']).toBeUndefined();
    expect(result.missingElements['/about']).toEqual(['missing-title']);
  });
});

describe('detectRegression', () => {
  const baseline = {
    score: 90,
    missingElements: {
      '/about': ['missing-og:image'],
    } as Record<string, string[]>,
  };

  it('reports no regression when score and issues are the same', () => {
    const current = {
      score: 90,
      pageScores: { '/': 100, '/about': 90 },
      missingElements: { '/about': ['missing-og:image'] },
      pageCount: 2,
      pagesWithIssues: 1,
    };
    const result = detectRegression(current, baseline);
    expect(result.isRegression).toBe(false);
    expect(result.regressions).toHaveLength(0);
  });

  it('reports regression when score drops more than 10 points', () => {
    const current = {
      score: 79,
      pageScores: { '/': 80, '/about': 78 },
      missingElements: { '/about': ['missing-og:image'] },
      pageCount: 2,
      pagesWithIssues: 1,
    };
    const result = detectRegression(current, baseline);
    expect(result.isRegression).toBe(true);
    expect(result.scoreDelta).toBe(-11);
  });

  it('reports regression when new issues appear on a page', () => {
    const current = {
      score: 88,
      pageScores: { '/': 100, '/about': 76 },
      missingElements: {
        '/about': ['missing-og:image', 'missing-title'], // 'missing-title' is new
      },
      pageCount: 2,
      pagesWithIssues: 1,
    };
    const result = detectRegression(current, baseline);
    expect(result.isRegression).toBe(true);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]!.path).toBe('/about');
    expect(result.regressions[0]!.newIssues).toEqual(['missing-title']);
  });

  it('does not flag issues that were already in baseline', () => {
    const current = {
      score: 88,
      pageScores: { '/': 100, '/about': 90 },
      missingElements: { '/about': ['missing-og:image'] }, // same as baseline
      pageCount: 2,
      pagesWithIssues: 1,
    };
    const result = detectRegression(current, baseline);
    expect(result.isRegression).toBe(false);
  });

  it('reports regression for a new page with issues not in baseline', () => {
    const current = {
      score: 85,
      pageScores: { '/': 100, '/about': 90, '/contact': 65 },
      missingElements: {
        '/about': ['missing-og:image'],
        '/contact': ['missing-title', 'missing-description'],
      },
      pageCount: 3,
      pagesWithIssues: 2,
    };
    const result = detectRegression(current, baseline);
    expect(result.isRegression).toBe(true);
    const contactRegression = result.regressions.find(r => r.path === '/contact');
    expect(contactRegression?.newIssues).toEqual(['missing-title', 'missing-description']);
  });
});
