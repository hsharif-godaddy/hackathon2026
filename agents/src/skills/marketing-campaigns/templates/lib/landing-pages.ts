/**
 * Landing Pages API
 *
 * Defines the structure and gated lookups for landing pages. Content is rich TSX
 * (see content/index.ts loader); this module only holds the manifest-derived
 * metadata used to gate the single permanent /lp/:slug route.
 */
export interface LandingPage {
  /** Stable id from landing-pages.json (`page-<nanoid>`) — the handle a campaign references. */
  id?: string;
  /** URL-friendly identifier. */
  slug: string;
  /** Campaign start date (YYYY-MM-DD). */
  startDate?: string;
  /** Campaign end date (YYYY-MM-DD). */
  endDate?: string;
  /** Lifecycle status from landing-pages.json. */
  status?: 'published' | 'scheduled' | 'draft';
}

let landingPages: LandingPage[] = [];

/** Set the landing pages collection (called by the loader). */
export function setLandingPages(pages: LandingPage[]): void {
  landingPages = pages;
}

/**
 * Get a landing page by slug. Excludes ONLY drafts (status === 'draft'),
 * so a draft page 404s. Scheduled/future-dated pages ARE reachable — the page
 * component renders its own coming-soon/active/ended state based on the date.
 */
export function getPageBySlug(slug: string): LandingPage | null {
  return landingPages.find(p => p.slug === slug && p.status !== 'draft') || null;
}

/**
 * Get a landing page by its stable manifest id (ungated).
 * This is how a marketing campaign resolves the page asset it references
 * (simple_campaign_content.contentRefId). Unlike slug lookups it ignores the
 * draft gate so a campaign can resolve scheduled/future pages too.
 */
export function getPageById(id: string): LandingPage | null {
  return landingPages.find(p => p.id === id) || null;
}

/** Get all non-draft landing pages (excludes ONLY drafts; scheduled/future included). */
export function getAllPages(): LandingPage[] {
  return landingPages.filter(p => p.status !== 'draft');
}
