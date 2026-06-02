import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn().mockReturnValue({
      id: 'test-app',
      path: '/tmp/app',
      publishedUrl: 'https://example.com',
    }),
  }; }),
}));

vi.mock('../../../../services/seo-audit.js', () => ({
  getCachedSeoAuditReport: vi.fn().mockReturnValue(null),
  runAndCacheSeoAudit: vi.fn().mockResolvedValue({
    appId: 'test-app',
    auditedAt: new Date().toISOString(),
    htmlBaseUrl: 'https://example.com',
    auditMode: 'published',
    publishedBaseUrl: 'https://example.com',
    routes: ['/'],
    pages: [
      {
        path: '/',
        layer: 'published',
        ok: false,
        issues: [{ code: 'missing-description', label: 'Missing meta description' }],
      },
    ],
    summary: { totalPages: 1, pagesWithIssues: 1, issueCount: 1 },
  }),
  formatSeoAuditSummary: vi.fn().mockReturnValue('1 issue(s) found'),
}));

import { seoAuditTool } from '../seo-audit-tool.js';

describe('seoAuditTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns seo-audit-report widget for the UI', async () => {
    const result = await seoAuditTool.execute(
      {},
      { metadata: { appId: 'test-app' } } as never,
    );

    expect(result.success).toBe(true);
    expect(result.widgetType).toBe('seo-audit-report');
    expect(result.widgetData.type).toBe('seo-audit-report');
    expect(result.widgetData.offerFix).toBe(true);
    expect(result.widgetData.report.summary.issueCount).toBe(1);
  });
});
