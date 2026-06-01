# SEO

The v8 template is server-rendered. Every public page must set head tags, structured data, and be registered in the sitemap.

## SEO check (audit)

When the user asks to **check** or **audit** SEO, **hand off to marketing** to run **`seoAnalysis`** (strategy + technical report widget). Do not load the `seo` skill or run `seo__audit` for the initial check.

After the widget appears, **stop** — wait for **Fix SEO issues** or an explicit fix request.

## SEO fixes and implementation

**For code changes** — new pages, metadata, JSON-LD, canonical URLs, Open Graph, sitemap — **load the `seo` skill first.** It covers:

- `@dr.pogodin/react-helmet` usage (required for title/meta/OG/canonical on every page)
- JSON-LD structured data (`<script type="application/ld+json">`) and schema types
- Image hygiene (`width`/`height`/`alt`, LCP `fetchpriority`, lazy loading)
- Semantic HTML and heading hierarchy
- `src/lib/seo-routes.ts` registry (drives `/sitemap.xml`)

Do not hand-roll head management or sitemap generation. Use the native `URL` API for generated Open Graph image URLs so query values are escaped correctly.

To **re-run only the technical scan** after the skill is loaded: `seo__audit`. **Stop** after the audit tool the same way — do not bulk-fix in the same turn unless the user asked to fix.
