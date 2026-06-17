/**
 * Validation helpers for SEO completeness on v8 page files.
 * Used by the seo-page-post-edit-handler to record validation state
 * and by todo-list-tool to gate mark_done.
 */

export function isPageFile(filePath: string): boolean {
  return filePath.includes('src/pages/') && filePath.endsWith('.tsx');
}

export const SEO_SOURCE_CHECKS: Array<{ name: string; blocking: boolean; test: (c: string) => boolean }> = [
  { name: 'title',        blocking: true,  test: (c) => c.includes('<title>') || c.includes('<title ') },
  { name: 'description',  blocking: true,  test: (c) => c.includes('name="description"') },
  { name: 'canonical',    blocking: true,  test: (c) => c.includes('rel="canonical"') },
  { name: 'h1',           blocking: true,  test: (c) => c.includes('<h1') },
  { name: 'og:title',     blocking: false, test: (c) => c.includes('og:title') },
  { name: 'og:image',     blocking: false, test: (c) => c.includes('og:image') },
  { name: 'twitter:card', blocking: false, test: (c) => c.includes('twitter:card') },
  { name: 'json-ld',      blocking: false, test: (c) => c.includes('application/ld+json') },
];

export interface SeoValidationResult {
  /** Elements missing that block mark_done / completion. */
  blocking: string[];
  /** Elements missing that are advisory only (logged, not blocking). */
  advisory: string[];
}

/**
 * Returns missing SEO elements split into blocking and advisory sets.
 * Blocking elements gate mark_done and post-stream continuation.
 * Advisory elements are logged but never block the agent.
 */
export function validateSeoSource(content: string): SeoValidationResult {
  const missing = SEO_SOURCE_CHECKS.filter(({ test }) => !test(content));
  return {
    blocking: missing.filter((c) => c.blocking).map((c) => c.name),
    advisory: missing.filter((c) => !c.blocking).map((c) => c.name),
  };
}
