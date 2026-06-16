import { describe, expect, it } from 'vitest'

import {
  categorizeSeoAuditIssue,
  issuesForCategory,
  splitIssuesByCategory,
} from '@/app/[market]/develop/components/widgets/seo-audit-issue-category'

describe('categorizeSeoAuditIssue', () => {
  it('classifies JSON-LD codes as AEO', () => {
    expect(categorizeSeoAuditIssue('missing-json-ld')).toBe('aeo')
    expect(categorizeSeoAuditIssue('invalid-json-ld')).toBe('aeo')
    expect(categorizeSeoAuditIssue('aeo-missing-schema-type')).toBe('aeo')
  })

  it('classifies metadata checks as SEO', () => {
    expect(categorizeSeoAuditIssue('missing-title')).toBe('seo')
    expect(categorizeSeoAuditIssue('missing-og-title')).toBe('seo')
    expect(categorizeSeoAuditIssue('missing-seo-route')).toBe('seo')
  })

  it('classifies registry orphan routes as AEO', () => {
    expect(categorizeSeoAuditIssue('orphaned-seo-route')).toBe('aeo')
  })
})

describe('splitIssuesByCategory', () => {
  it('splits mixed issues into SEO and AEO buckets', () => {
    const issues = [
      { code: 'missing-title', label: 'Missing page title' },
      { code: 'missing-json-ld', label: 'Missing JSON-LD structured data' },
    ]

    expect(splitIssuesByCategory(issues)).toEqual({
      seo: [issues[0]],
      aeo: [issues[1]],
    })
  })
})

describe('issuesForCategory', () => {
  it('returns only issues for the requested category', () => {
    const issues = [
      { code: 'missing-h1', label: 'Missing H1 heading' },
      { code: 'empty-json-ld', label: 'Empty JSON-LD block' },
    ]

    expect(issuesForCategory(issues, 'aeo')).toEqual([issues[1]])
  })
})
