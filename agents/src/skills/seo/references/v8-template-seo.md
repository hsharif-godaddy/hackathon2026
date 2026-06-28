# Implementing SEO in the v8 Template

## Table of Contents

- [Head Management with react-helmet](#head-management-with-react-helmet)
- [JSON-LD Structured Data](#json-ld-structured-data)
- [Schema Types](#schema-types)
- [Image Hygiene](#image-hygiene)
- [Semantic HTML](#semantic-html)
- [Sitemap and robots.txt](#sitemap-and-robotstxt)
- [Implementation Checklist](#implementation-checklist)

---

The v8 template renders every page on the server. Crawlers receive fully-rendered HTML with head already populated. Every page must set its own head tags and structured data through `@dr.pogodin/react-helmet`.

## Head Management with react-helmet

Every page MUST set, via `<Helmet>`:

- `<title>` — unique, <= 60 chars
- `<meta name="description">` — unique, <= 160 chars
- `<link rel="canonical">` — absolute URL for the current route
- Open Graph: `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
- `<meta name="twitter:card" content="summary_large_image">`

Titles and descriptions MUST be specific to the page. Never copy the home page title onto other pages.

Build absolute canonical, Open Graph, and Twitter URLs explicitly. `og:image`/`twitter:image` must be an absolute URL to a real image the site serves (e.g. a static file in `public/`) — the v8 template has no dynamic OG-image endpoint, so do not point at `/api/og`.

```tsx
import { Helmet } from '@dr.pogodin/react-helmet';

export default function AboutPage() {
  const title = 'About - Acme Consulting';
  const description = 'Meet the team behind Acme Consulting...';
  const canonicalUrl = 'https://acme.example/about';
  const ogImage = 'https://acme.example/og-image.png'; // a real static image (e.g. in public/)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${canonicalUrl}#webpage`,
    name: title,
    url: canonicalUrl,
    isPartOf: { '@id': 'https://acme.example/#website' },
    about: { '@id': 'https://acme.example/#organization' },
  };

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={ogImage} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <section>{/* page content */}</section>
    </>
  );
}
```

---

## JSON-LD Structured Data

Inject JSON-LD inside `<Helmet>`. Always wrap the object with `JSON.stringify` — never handwrite the JSON string.

Homepage: emit ONE `@graph` with the WebSite + Organization + WebPage baseline, linked by `@id`. Add a more specific business type (e.g. LocalBusiness) only when the business has a real physical location.

```tsx
const site = 'https://acme.example';
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${site}/#website`, name: 'Acme Consulting', url: `${site}/` },
    { '@type': 'Organization', '@id': `${site}/#organization`, name: 'Acme Consulting', url: `${site}/`, logo: `${site}/logo.png` },
    { '@type': 'WebPage', '@id': `${site}/#webpage`, url: `${site}/`, isPartOf: { '@id': `${site}/#website` }, about: { '@id': `${site}/#organization` }, datePublished: 'YYYY-MM-DD', dateModified: 'YYYY-MM-DD' },
  ],
};

<Helmet>
  <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
</Helmet>
```

---

## Schema Types

The homepage always emits the `WebSite` + `Organization` + `WebPage` triad. Use this table for more specific types:

| @type | Use on |
|-------|--------|
| `Organization` | Homepage business entity (baseline; use a subtype if one fits) |
| `WebSite` | Homepage (add `potentialAction` if the site has search) |
| `LocalBusiness` | Homepage — only when the business has a real location |
| `Person` | Personal portfolio or author pages |
| `Article` | News or editorial article |
| `BlogPosting` | Blog post (prefer over `Article` for blogs) |
| `Product` | E-commerce product page |
| `FAQPage` | Pages with Q&A content |
| `AboutPage` / `ContactPage` | About / contact routes |
| `BreadcrumbList` | Deep pages — add alongside the page-specific schema |

Other pages emit their page-purpose `@type` and reference the homepage `Organization`/`WebSite` by `@id` (`isPartOf` / `about`) rather than re-declaring them. Keep blocks minimal and accurate — don't invent data the business doesn't have.

---

## Image Hygiene

- Every `<img>` MUST have explicit `width` and `height` (prevents CLS)
- Every `<img>` MUST have descriptive `alt` (not the filename)
- LCP image: `fetchpriority="high"`, default `loading="eager"`
- Below-the-fold: `loading="lazy"`
- Prefer WebP when available
- `alt=""` only for purely decorative images

---

## Semantic HTML

- Exactly ONE `<h1>` per page, aligned with `<Helmet>` `<title>`
- Use `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`
- Heading levels nest correctly — don't skip `<h1>` to `<h4>`

---

## Sitemap and robots.txt

The template serves `/sitemap.xml` and `/robots.txt` automatically from `src/server/entry.ts`.

- `src/lib/seo-routes.ts` is the agent-editable registry. Add an entry for every new publicly-crawlable page.
- `sitemap.xml` is generated at request time from this registry.
- `robots.txt` is auto-generated and references `/sitemap.xml`. Do NOT create a `robots.txt` file.
- Base URL comes from the request, or from `PUBLIC_URL` / `SITE_URL` env vars.
- Do NOT list dev-only or auth-required routes.
- Do NOT add raw parameterized routes like `/products/:id`. Enumerate real values or skip.

Example: after creating `src/pages/about.tsx` at route `/about`:

```ts
{ path: "/about", changefreq: "monthly", priority: 0.8 }
```

---

## Implementation Checklist

Items marked (validator) are checked by the post-publish `SeoValidator`. Other items require manual verification.

- [ ] Unique `<title>` via `<Helmet>` per page (validator)
- [ ] Unique `<meta name="description">` per page (validator)
- [ ] `<link rel="canonical">` per page (validator)
- [ ] `og:title` (validator), `og:description` (validator), `og:image` (validator), `og:url` (validator), `og:type` (validator)
- [ ] `twitter:card` = `summary_large_image` (validator), `twitter:image` absolute URL (validator)
- [ ] At least one valid JSON-LD block with appropriate `@type` (validator)
- [ ] Exactly one `<h1>` matching page intent (validator)
- [ ] All `<img>` have `width`, `height`, descriptive `alt`
- [ ] LCP image has `fetchpriority="high"`; below-fold images have `loading="lazy"`
- [ ] New public pages added to `src/lib/seo-routes.ts`
