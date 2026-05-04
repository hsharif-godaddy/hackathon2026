# SEO

The v8 template is server-rendered. Every public page must set head tags, structured data, and be registered in the sitemap.

**For any SEO work - adding a new page, editing metadata, JSON-LD, canonical URLs, Open Graph, sitemap, or implementing SEO improvements - load the `seo` skill first.** It covers:

- `@dr.pogodin/react-helmet` usage (required for title/meta/OG/canonical on every page)
- JSON-LD structured data (`<script type="application/ld+json">`) and schema types
- Image hygiene (`width`/`height`/`alt`, LCP `fetchpriority`, lazy loading)
- Semantic HTML and heading hierarchy
- `src/lib/seo-routes.ts` registry (drives `/sitemap.xml`)

Do not hand-roll head management or sitemap generation - the patterns in the skill match how the template's SSR expects to find them.
