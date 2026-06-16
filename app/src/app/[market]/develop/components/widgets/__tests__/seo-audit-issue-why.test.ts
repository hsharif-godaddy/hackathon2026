import { describe, expect, it, vi } from 'vitest'

import { whyForSeoAuditIssue } from '@/app/[market]/develop/components/widgets/seo-audit-issue-why'

type TranslateFn = (
  key: string,
  values?: Record<string, string | number>,
  fallback?: string,
) => string

describe('whyForSeoAuditIssue', () => {
  it('returns fetch-failed guidance for unreachable pages', () => {
    const t: TranslateFn = (_key, _values, fallback) => fallback ?? _key

    expect(whyForSeoAuditIssue('fetch failed: HTTP 404', t)).toContain('could not load')
  })

  it('derives translation keys with colons and hyphens normalized', () => {
    const t = vi.fn<TranslateFn>((key, _values, fallback) => fallback ?? key)

    whyForSeoAuditIssue('aeo-url-mismatch:canonical-page', t)

    expect(t).toHaveBeenCalledWith(
      'builder_seo_audit_issue_why_aeo_url_mismatch_canonical_page',
      undefined,
      expect.any(String),
    )
  })

  it('returns null for unknown issue codes', () => {
    const t: TranslateFn = key => key

    expect(whyForSeoAuditIssue('unknown-custom-code', t)).toBeNull()
  })
})
