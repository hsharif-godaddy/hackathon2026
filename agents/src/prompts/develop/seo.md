# SEO

The v8 template is server-rendered. Every public page must set head tags, structured data, and be registered in the sitemap.

## SEO check (audit)

When the user asks to **check** or **audit** SEO, **hand off to marketing** to run **`seoAnalysis`** (strategy + technical report widget).

After the widget appears, **stop** — wait for **Fix SEO issues** or an explicit fix request.

## Required on every public page

Use `<Helmet>` from `@dr.pogodin/react-helmet`. Every page you create or edit must emit, in this Helmet block:

- `<title>` — unique, ≤60 chars, derived from the business brief (not "Home" or the brand name alone).
- `<meta name="description">` — unique, ≤160 chars, from the brief.
- `<link rel="canonical" href={absoluteUrl}>`.
- Open Graph: `og:title`, `og:description`, `og:type`, `og:url`, `og:image`.
- Twitter: `<meta name="twitter:card" content="summary_large_image">`, `twitter:title`, `twitter:description`, `twitter:image`.
- One `<script type="application/ld+json">` with the schema.org type that fits the business (Restaurant, LocalBusiness, Organization, SoftwareApplication, FAQPage, BlogPosting, Product, etc.). At minimum populate `@context`, `@type`, `name`, `url`. Add optional fields (`address`, `telephone`, `priceRange`, `openingHours`, etc.) **only when the user's brief gives you real values** — don't fabricate phone numbers, addresses, hours, prices, or customer/stat content. Better to omit a field than to placeholder it; crawlers index this data as authoritative business identity.

Every `<img>` must have `width`, `height`, descriptive `alt`, `loading` (`eager` for above-fold, `lazy` below), and `fetchpriority` (`high` for the LCP hero image, `auto` otherwise).

Exactly one `<h1>` per page. Headings progress `<h2>` → `<h3>` without skipping levels.

## Sitemap

Static paths in `src/routes.tsx` auto-sync into `src/lib/seo-routes.ts` on every edit. Don't hand-edit `seo-routes.ts` except to adjust `priority` / `changefreq` / `lastmod` after the sync.
