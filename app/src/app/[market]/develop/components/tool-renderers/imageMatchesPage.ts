/**
 * Pure helpers for matching asset manifest entries to a page URL.
 * Extracted from RebuildBuildPageToolRenderer for independent testability.
 */

interface AssetItem {
  url: string
  altText?: string
  description?: string
  type: string
  sourcePages?: string[]
}

/**
 * Normalises a URL for page-matching: strips trailing slash, lowercases pathname.
 * We only compare pathnames so that CDN rewrites of the hostname don't matter.
 */
export function normalisePath(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname.replace(/\/+$/, '').toLowerCase() || '/'
  } catch {
    return url.toLowerCase()
  }
}

export function imageMatchesPage(asset: AssetItem, pageUrl: string): boolean {
  const pagePath = normalisePath(pageUrl)
  return (
    asset.type === 'image' &&
    (asset.sourcePages ?? []).some(s => normalisePath(s) === pagePath)
  )
}
