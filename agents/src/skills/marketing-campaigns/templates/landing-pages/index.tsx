/**
 * Landing Pages — loader + route component
 *
 * Pages are listed in `landing-pages.json` (the manifest: a stable `id`, slug,
 * `componentPath`, publish date, and status). The page content is rich TSX —
 * each `.tsx` in this folder default-exports a React page component. The manifest
 * `id` (`page-<nanoid>`) is the stable handle a marketing campaign references
 * (simple_campaign_content.contentRefId) — slugs can change, ids should not.
 *
 * Modules are imported EAGERLY (NOT lazy) so server-side renderToString resolves
 * components synchronously without hitting a Suspense boundary — mirrors the
 * eager-404 precedent in app-templates/v8/src/routes.tsx. Gating (draft/future)
 * happens at render time via getPageBySlug.
 */
import type { ComponentType } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { setLandingPages, getPageBySlug, type LandingPage as LandingPageData } from '../../lib/landing-pages';
// Manifest lives at src/content/data/landingPages.json; served via virtual:content.
// @ts-expect-error — virtual:content types are generated at build time from the content dir
import { landingPages as landingPagesManifest } from 'virtual:content';

export interface PageManifestEntry {
  /** Stable id (`page-<nanoid>`) — what a campaign references (contentRefId). */
  id: string;
  /** URL slug used for the /lp/:slug route. */
  slug: string;
  /** Path to the page component, relative to this folder (e.g. "./summer-sale.tsx"). */
  componentPath: string;
  /** Campaign start date (YYYY-MM-DD). */
  startDate?: string;
  /** Campaign end date (YYYY-MM-DD). */
  endDate?: string;
  /** Lifecycle status. */
  status?: 'published' | 'scheduled' | 'draft';
  /** Optional marketing-campaign association. */
  campaignId?: string;
}

// Normalize a path to a "./name.tsx" form so manifest entries and glob keys match.
const normalize = (p: string) => (p.startsWith('./') ? p : `./${p.replace(/^\//, '')}`);

export interface LandingPageProps {
  startDate?: string;
  endDate?: string;
}

// EAGER (SSR-safe; see routes.tsx eager-404 precedent). Each module's default export is the page component.
const pageModules = import.meta.glob<{ default: ComponentType<LandingPageProps> }>('./*.tsx', { eager: true });

const manifest = (landingPagesManifest as PageManifestEntry[]) ?? [];

// slug -> component (only manifest-listed pages are routable)
const componentLoaders: Record<string, ComponentType<LandingPageProps>> = {};
for (const entry of manifest) {
  const mod = pageModules[normalize(entry.componentPath)];
  if (mod?.default) componentLoaders[entry.slug] = mod.default;
}

setLandingPages(
  manifest.map((e): LandingPageData => ({
    id: e.id,
    slug: e.slug,
    startDate: e.startDate,
    endDate: e.endDate,
    status: e.status,
  })),
);

/**
 * The single permanent route component for /lp/:slug.
 * Gates at render time — getPageBySlug returns null for drafts (redirect home).
 * Scheduled/future pages are reachable; their countdown handles pre-launch state.
 */
export default function LandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getPageBySlug(slug) : null;   // gate: draft -> null
  const Page = slug ? componentLoaders[slug] : undefined;
  if (!page || !Page) return <Navigate to="/" replace />;
  return <Page startDate={page.startDate} endDate={page.endDate} />;   // synchronous — no lazy/Suspense
}
