---
name: seo
description: SEO analysis, optimization, and v8 implementation patterns (react-helmet, JSON-LD, sitemap)
whenToUse: >-
  User needs SEO work — analysis, optimization, or implementation.
  Triggers include SEO, search rankings, meta tags, page titles,
  descriptions, structured data, JSON-LD, schema.org, react-helmet,
  Helmet, Open Graph, og:title, canonical URL, sitemap, robots.txt,
  search visibility, Google indexing, head tags, new page route,
  IndexNow, Bing, Yandex, Yahoo, Naver, sitemap submission, Bing Webmaster Tools.
  Also load when adding a new page/route to ensure head tags and seo-routes.ts registration.
  For a one-shot SEO check/audit ("check my SEO", "SEO audit", post-publish SEO chip),
  do NOT load this skill — call the seoAnalysis tool directly and stop after the report widget;
  load this skill only for optimization/implementation work.
  NOT for Google Analytics or tracking scripts — use google-analytics skill.
intents:
  - SEO/search rankings/meta tags/structured data/JSON-LD/sitemap
  - optimize SEO/improve search/head tags/Open Graph
---

# SEO Analysis & Optimization

Expert SEO strategy and implementation. Context-aware recommendations tailored to the business, audience, and competitive landscape — not generic checkbox advice.

---

## Core Principles

1. **Context First** — understand the business, brand, and audience before recommending
2. **Quality Over Quantity** — every change should add real value for the specific business
3. **Consistency** — follow existing patterns in the codebase; never mix metadata approaches
4. **Implement, Don't Just Advise** — make the changes, don't just describe them

---

## Workflow

### Step 1: Check or Audit

When the user asks to run an SEO check, audit, or analysis, call global `seoAnalysis` directly (you have the tool) — it returns the strategy + technical audit in one report widget. Don't load this skill first for a check. Load this skill (and use `seo__audit` to re-run the technical scan) only for implementation/fixes.

```javascript
await seoAnalysis({
  businessInfo: {
    name: 'Business Name',
    type: 'restaurant/SaaS/ecommerce/etc',
    location: 'City, State (if applicable)',
    targetAudience: 'Description of ideal customers',
  },
  brandVoice: 'Professional/Friendly/Playful/Technical/etc',
  uniqueSellingPoints: ['What makes them different'],
  targetKeywords: ['specific keywords in mind'],
  targetQuestions: ['What their audience is asking'],
});
```

Pass whatever the user shared; app name alone is enough for a minimal check.

**STOP after `seoAnalysis` or `seo__audit`** when they return the report widget — do not edit code in the same turn. Wait for "Fix SEO issues" or an explicit fix request.

> Steps 2–5 below are for implementation and fixes, not the same turn as Step 1.

### Step 2: Discover Existing Patterns

Before making any changes, discover what patterns already exist:

```javascript
await grepSearch({
  query: 'metadata|meta name=|<Head|Helmet|<title>',
  includePatterns: ['**/*.{tsx,ts,jsx,js}'],
});
```

**Pattern detection decision tree:**
- Pages export `metadata` object → Next.js app router pattern
- Pages use `<Head>` from `next/head` → Next.js pages router pattern
- Pages export a `meta` function → Remix pattern
- Pages use `<Helmet>` from `@dr.pogodin/react-helmet` → v8 SSR template (load reference below)
- Pages use `react-helmet-async` or legacy `react-helmet` → follow that pattern
- No pattern exists → choose idiomatic approach for the framework

Never introduce a new pattern if one already exists. Consistency over "best practice".

### Step 3: Analyze Pages

Gather business context from the audit widget Strategy section. Then discover and read ALL pages:

```javascript
await directoryListing({ path: 'src/pages', pattern: '*.{tsx,ts,jsx,js}' });
await readFile({ path: 'src/pages/index.tsx' });
// Read EVERY page for a full-site pass
```

For each page, consider:
- **Purpose**: what is this page trying to achieve?
- **Audience alignment**: does content speak to the target audience?
- **Competitive edge**: how can SEO help them stand out?

Load business-type strategies and context-aware recommendation examples:

```typescript
skill({ action: 'loadReference', path: 'seo/references/analysis-strategies' })
```

### Step 4: Implement Fixes

**Priority 1: Metadata** — every page MUST have unique, SEO-optimized metadata following the existing pattern.

For v8 template apps, load the implementation reference:

```typescript
skill({ action: 'loadReference', path: 'seo/references/v8-template-seo' })
```

- Unique `<title>` per page (≤60 chars, page-specific)
- Unique `<meta name="description">` per page (≤160 chars)
- `<link rel="canonical">` with absolute URL
- Open Graph tags: `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
- `<meta name="twitter:card" content="summary_large_image">`
- JSON-LD structured data with appropriate `@type`

**Priority 2: Content optimization**
- H1 headings with primary keywords (exactly ONE per page)
- First paragraph includes target keywords naturally
- Semantic variations throughout content
- Clear, scannable structure with semantic HTML

**Priority 3: Technical SEO**
- Structured data (JSON-LD) with correct schema type
- Image hygiene: `width`, `height`, descriptive `alt`, `fetchpriority`/`loading`
- New public pages added to `src/lib/seo-routes.ts`

**RSS feed for blogs:** if the site has a blog (`src/lib/blog.ts` exists) but no feed yet, add one via `skill({ action: "load", skill: "rss" })`.

### Step 5: Verify and Recommend

After technical fixes:

1. Optionally re-run `seo__audit` to confirm fixes
2. Review the audit widget Strategy section for gaps that code alone didn't fix
3. Briefly recommend business-context improvements in plain language
4. Separate technical vs strategic in your summary

---

## Notes on URLs

Build absolute canonical, OG, and Twitter URLs explicitly — relative paths break for crawlers and social scrapers, which resolve them against their own origin.

`og:image`/`twitter:image` must be an absolute URL to a **real image the site serves** (e.g. a static file in `public/`):

```tsx
const ogImage = `${site}/og-image.png`; // a real image you've added; the v8 template has no dynamic OG endpoint — do not point at /api/og
```

Only if the framework genuinely provides a generated OG-image endpoint (e.g. Next.js `@vercel/og`) should you build its URL with the native `URL` API + `searchParams.set()` so query values stay escaped.

## Environment-Aware robots

Many dev environments add `<meta name="robots" content="noindex, nofollow">` in development mode. This is intentional — don't remove it.

---

## IndexNow (automatic on custom-domain publish)

When users ask about submitting their sitemap to **Bing**, **Yandex**, **Yahoo**, or **Naver**:

- Airo **automatically** pings **IndexNow** after publish when the site has an **active custom domain**. The ping includes every public URL from `seo-routes.ts` — crawlers that support IndexNow (Bing, Yandex, Naver) are notified — and Yahoo, which is served by Bing is also covered without manual steps.
- **Do not** recommend manual Bing Webmaster Tools sitemap submission for Airo sites on custom domains — it is redundant.
- **Preview URLs** (`*.airoapp.ai` and other platform hosts) are not indexable; IndexNow is skipped until publish on a custom domain.
- **Google Search Console** is separate (Google only). Mention GSC only when the user asks about Google specifically — verification and submission there are still manual.

Example reply when asked about Bing: "Your sitemap is submitted automatically when you publish on your custom domain — Airo uses IndexNow to notify Bing, Yandex, Yahoo, and Naver. No Bing Webmaster Tools setup needed. Preview URLs on `*.airoapp.ai` aren't indexed; connect a custom domain and publish to trigger it."

---

## Communication Style

1. **Start**: "I'll analyze your site for SEO optimization. Let me check what patterns you're already using..."
2. **Pattern found**: "Found existing [pattern]. I'll follow this for consistency."
3. **After check**: "Your SEO audit report is above. Key opportunities: [2-3 bullets]. Click Fix SEO issues when ready."
4. **Completion**: "Technical SEO fixes done. [What changed]. **Strategy notes:** [opportunities from audit]. Publish again to validate."
5. **Bing/Yandex/Yahoo/Naver submission**: explain IndexNow runs automatically on custom-domain publish; do not give manual Webmaster Tools steps.

---

## Quality Checklist

- ✓ Searched for and identified existing SEO patterns
- ✓ Analyzed every page that needed changes
- ✓ Addressed issues from the audit widget (or user request)
- ✓ Implemented metadata for ALL affected pages using consistent patterns
- ✓ Optimized content with natural keyword incorporation
- ✓ Added structured data where appropriate
- ✓ Summarized technical fixes and remaining business/strategy recommendations
