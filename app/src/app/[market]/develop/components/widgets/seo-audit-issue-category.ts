export type SeoAuditIssueCategory = 'seo' | 'aeo'

export type CategorizableSeoIssue = {
  code: string
  label: string
}

export function categorizeSeoAuditIssue(code: string): SeoAuditIssueCategory {
  if (
    code.startsWith('aeo-') ||
    code.includes('json-ld') ||
    code === 'orphaned-seo-route'
  ) {
    return 'aeo'
  }
  return 'seo'
}

export function splitIssuesByCategory<T extends CategorizableSeoIssue>(issues: T[]): {
  seo: T[]
  aeo: T[]
} {
  const seo: T[] = []
  const aeo: T[] = []
  for (const issue of issues) {
    if (categorizeSeoAuditIssue(issue.code) === 'aeo') {
      aeo.push(issue)
    } else {
      seo.push(issue)
    }
  }
  return { seo, aeo }
}

export function issuesForCategory<T extends CategorizableSeoIssue>(
  issues: T[],
  category: SeoAuditIssueCategory,
): T[] {
  return splitIssuesByCategory(issues)[category]
}
