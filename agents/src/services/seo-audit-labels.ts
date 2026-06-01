/** Human-readable labels for SeoValidator check codes. */
export const SEO_CHECK_LABELS: Record<string, string> = {
  'missing-title': 'Missing page title',
  'empty-title': 'Empty page title',
  'missing-description': 'Missing meta description',
  'empty-description': 'Empty meta description',
  'missing-h1': 'Missing H1 heading',
  'missing-json-ld': 'Missing JSON-LD structured data',
  'empty-json-ld': 'Empty JSON-LD block',
  'invalid-json-ld': 'Invalid JSON-LD JSON',
  'missing-og-title': 'Missing Open Graph title',
  'empty-og-title': 'Empty Open Graph title',
  'missing-og-description': 'Missing Open Graph description',
  'empty-og-description': 'Empty Open Graph description',
  'missing-og-image': 'Missing Open Graph image',
  'empty-og-image': 'Empty Open Graph image',
  'invalid-og-image-url': 'Open Graph image must be an absolute URL',
  'missing-og-url': 'Missing Open Graph URL',
  'empty-og-url': 'Empty Open Graph URL',
  'invalid-og-url-url': 'Open Graph URL must be absolute',
  'missing-og-type': 'Missing Open Graph type',
  'empty-og-type': 'Empty Open Graph type',
  'missing-twitter-card': 'Missing Twitter card meta',
  'empty-twitter-card': 'Empty Twitter card meta',
  'missing-twitter-image': 'Missing Twitter image',
  'empty-twitter-image': 'Empty Twitter image',
  'invalid-twitter-image-url': 'Twitter image must be an absolute URL',
  'missing-canonical': 'Missing canonical link',
  'empty-canonical': 'Empty canonical URL',
  'invalid-canonical-url': 'Canonical URL must be absolute',
  'missing-noindex': 'Expected noindex robots meta',
  'unexpected-noindex': 'Page is noindex (hidden from search)',
  'missing-helmet': 'No Helmet / head tags detected in page source',
  'missing-seo-route': 'Route not registered in seo-routes.ts',
};

export function labelForSeoCheck(code: string): string {
  if (code.startsWith('fetch failed:')) {
    return `Could not fetch page (${code.replace('fetch failed: ', '')})`;
  }
  return SEO_CHECK_LABELS[code] ?? code;
}
