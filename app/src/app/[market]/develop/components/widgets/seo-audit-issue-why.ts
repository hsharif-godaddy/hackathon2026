type TranslateFn = (
  key: string,
  values?: Record<string, string | number>,
  fallback?: string,
) => string

/** Fallback "why it matters" copy keyed by SeoValidator / AEO check code. */
const SEO_ISSUE_WHY_FALLBACKS: Record<string, string> = {
  'missing-title':
    'The page title is the main link text in search results — without it, search engines may show a generic or unhelpful label.',
  'empty-title':
    'An empty title gives search engines nothing useful to show in results, which hurts click-through rates.',
  'missing-description':
    'Meta descriptions often appear under your link in search results — missing copy means Google may pick random text from your page.',
  'empty-description':
    'An empty meta description misses a chance to summarize your page and encourage clicks from search results.',
  'missing-h1':
    'The H1 tells visitors and search engines what the page is about — it should clearly describe the main topic.',
  'missing-json-ld':
    'JSON-LD structured data helps search engines and AI tools understand your business and page content for rich results.',
  'empty-json-ld':
    'An empty JSON-LD block provides no structured data, so AI and search tools cannot reliably interpret this page.',
  'invalid-json-ld':
    'Invalid JSON-LD cannot be parsed, so structured data benefits are lost until the syntax is fixed.',
  'missing-og-title':
    'Open Graph title controls how your page appears when shared on social platforms and in some search previews.',
  'empty-og-title':
    'An empty Open Graph title leads to poor previews when your page is shared on social media.',
  'missing-og-description':
    'Open Graph description appears in social link previews — without it, platforms may show unrelated page text.',
  'empty-og-description':
    'An empty Open Graph description reduces control over how your page looks when shared.',
  'missing-og-image':
    'Open Graph image is the thumbnail when your page is shared — missing images get fewer clicks.',
  'empty-og-image':
    'An empty Open Graph image URL means social shares will not show a preview image.',
  'invalid-og-image-url':
    'Social platforms require an absolute image URL — relative paths will not render in link previews.',
  'missing-og-url':
    'Open Graph URL tells platforms which canonical page is being shared — it should match your live page URL.',
  'empty-og-url':
    'An empty Open Graph URL can cause the wrong page to be associated with social shares.',
  'invalid-og-url-url':
    'Open Graph URL must be absolute so social platforms can link to the correct page.',
  'missing-og-type':
    'Open Graph type hints what kind of content is being shared (e.g. website, article), improving preview accuracy.',
  'empty-og-type':
    'An empty Open Graph type gives platforms less context about your page content.',
  'missing-twitter-card':
    'Twitter card meta controls how your link appears on X — without it, previews may be incomplete.',
  'empty-twitter-card':
    'An empty Twitter card setting reduces control over link previews on X.',
  'missing-twitter-image':
    'Twitter image meta sets the preview thumbnail on X — missing images get less engagement.',
  'empty-twitter-image':
    'An empty Twitter image URL means shares on X will not show a preview image.',
  'invalid-twitter-image-url':
    'Twitter requires an absolute image URL for card previews to render correctly.',
  'missing-canonical':
    'Canonical URL tells search engines which version of a page to index when duplicates exist.',
  'empty-canonical':
    'An empty canonical URL leaves search engines guessing which URL is the primary one to rank.',
  'invalid-canonical-url':
    'Canonical URL must be absolute so search engines index the correct live page.',
  'missing-noindex':
    'This page is expected to be hidden from search — the noindex directive confirms that intent.',
  'unexpected-noindex':
    'A noindex tag tells search engines not to list this page — remove it if you want this page found in search.',
  'missing-helmet':
    'Head tags (title, meta, canonical) were not detected in source — SEO metadata may be missing at build time.',
  'missing-seo-route':
    'Routes must be registered in seo-routes.ts so titles and meta can be managed consistently for each page.',
  'orphaned-seo-route':
    'A route in seo-routes.ts has no matching page file — this can cause broken metadata or 404s.',
  'aeo-missing-schema-type':
    'JSON-LD needs an @type so AI assistants and rich results know what kind of entity this page describes.',
  'aeo-url-mismatch:head':
    'Canonical and og:url should match — conflicting URLs confuse crawlers and AI about which page is authoritative.',
  'aeo-url-mismatch:jsonld':
    'JSON-LD url should match your canonical URL — mismatches reduce trust in structured data for AI and search.',
  'aeo-url-mismatch:canonical-page':
    'This page was scanned at one URL on your published site, but canonical points elsewhere — search engines may index the wrong page.',
  'aeo-url-mismatch:og-page':
    'Open Graph url should match the published page URL so social previews and crawlers reference the correct live page.',
  'aeo-url-mismatch:jsonld-page':
    'JSON-LD url should match the published page URL so AI and rich results describe the page that was actually scanned.',
}

function translationKeyForIssueWhy(code: string): string {
  return `builder_seo_audit_issue_why_${code.replace(/[:-]/g, '_')}`
}

export function whyForSeoAuditIssue(code: string, t: TranslateFn): string | null {
  if (code.startsWith('fetch failed:')) {
    return t(
      'builder_seo_audit_issue_why_fetch_failed',
      undefined,
      'We could not load this page’s HTML — fixes may not appear in results until the page is reachable.',
    )
  }

  const fallback = SEO_ISSUE_WHY_FALLBACKS[code]
  if (!fallback) {
    return null
  }

  return t(translationKeyForIssueWhy(code), undefined, fallback)
}
