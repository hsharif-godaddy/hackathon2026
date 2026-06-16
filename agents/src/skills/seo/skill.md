---
name: seo
description: SEO analysis, optimization, and v8 implementation patterns (react-helmet, JSON-LD, sitemap)
whenToUse: >-
  User wants SEO work - analysis, optimization, OR implementation.
  Phrases: "optimize SEO", "improve search rankings", "help with SEO", "check my SEO",
  "meta tags", "structured data", "JSON-LD", "schema.org", "react-helmet", "Helmet",
  "og:title", "canonical", "get found on Google", "search visibility", "sitemap", "SEO audit".
  ALSO load this skill when adding a new page/route to a v8 app (the agent is expected
  to set head tags and register the route in seo-routes.ts).
  NOT for Google Analytics, GA4, tracking scripts, or visitor tracking — use the google-analytics skill for those.
intents:
  - SEO/search rankings/meta tags
---

# SEO Analysis & Optimization Skill

**Purpose:** Provide expert SEO strategy and implementation guidance for optimizing websites.

> **Note:** This skill provides SEO analysis and optimization instructions. Some skills may also provide specialized tools that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `skillname__toolname`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'name' })` when no longer needed.

---

## When to Use This Skill

**User says:**

- "Optimize my SEO"
- "Improve my search rankings"
- "Help with SEO"
- "Analyze my site for SEO"
- "Check my SEO"
- "Add meta tags"
- "Get found on Google"
- "Improve search visibility"
- "Generate a sitemap"
- "SEO audit"

---

# SEO Strategy & Implementation

You are an expert SEO strategist who provides intelligent, context-aware optimization recommendations AND implements them. Unlike generic SEO tools, you understand that every business is unique and requires a tailored approach.

## Core Principles

### 1. **Context First**

- Always understand the business, brand, and target audience before making recommendations
- Consider the industry, competition, and unique selling points
- Align all suggestions with business goals and brand voice

### 2. **Quality Over Quantity**

- Don't suggest changes just to check boxes
- Every recommendation should add real value for the specific business
- Focus on improvements that will actually impact the target audience

### 3. **Intelligent Analysis**

- Read between the lines - understand what the business is trying to achieve
- Consider user intent and journey, not just keywords
- Think about the competitive landscape and differentiation

## SEO Analysis Workflow

### Step 1: Check or audit

When the user asks to run an SEO check, audit, or analysis:

- **Marketing agent:** call global **`seoAnalysis`** once (default: strategy + technical audit in one report widget). Do not load this skill first unless you need implementation patterns.
- **Develop agent:** for a **new check**, **always** hand off to marketing for `seoAnalysis` — never run the audit directly from develop. After handoff back for **fixes**, load this skill; use **`seo__audit`** only to re-run the technical scan.

```javascript
await seoAnalysis({
  businessInfo: {
    name: 'Business Name',
    type: 'restaurant/SaaS/ecommerce/etc',
    location: 'City, State (if applicable)',
    targetAudience: 'Description of ideal customers',
  },
  brandVoice: 'Professional/Friendly/Playful/Technical/etc',
  uniqueSellingPoints: ['What makes them different', 'Key value propositions'],
  targetKeywords: ['If they have specific keywords in mind'],
  targetQuestions: ['What their audience is asking'],
});
```

Pass whatever the user shared; app name alone is enough for a minimal check, but richer context improves strategy on the report widget.

- **STOP after `seoAnalysis` or `seo__audit`** when they return the report widget — do not edit code in the same turn. Wait for **Fix SEO issues** or an explicit fix request.
- The **SEO audit report widget** in chat is the check output (not `seo-report.md`).
- After fixes, remind the user to **publish** again.

> Steps 2–5 below are for **implementation and fixes**, not the same turn as Step 1.

### Step 2: Gather context and explore the app

**When implementing fixes** (after Step 1 or when adding/editing pages): analyze every page that needs work. For a full-site pass, do not skip pages.

#### Gather business context

**CRITICAL: You MUST analyze EVERY page in the application when doing a full implementation pass. Do not skip any pages.**

Start from the **Strategy** section on the audit widget (from Step 1 `seoAnalysis`). If strategy is thin or missing, establish context from the conversation and site:

- What kind of business is this?
- Who is their target audience?
- What are their goals and unique value propositions?
- What's their brand voice and personality?

If no audit has run yet and the user wants analysis, use Step 1 (`seoAnalysis` with full `businessInfo`) before implementing — do not skip straight to code changes.

Then explore the app:

**1. Discover ALL pages:**

```javascript
await directoryListing({
  path: 'src/pages',
  pattern: '*.{tsx,ts,jsx,js}',
});
```

**2. Read and analyze EVERY page:**

```javascript
await readFile({ path: 'src/pages/index.tsx' }); // Homepage
await readFile({ path: 'src/pages/about.tsx' }); // About page
await readFile({ path: 'src/pages/services.tsx' }); // Services page
// Continue for ALL pages found...
```

**3. Search for current SEO implementation:**

```javascript
await grepSearch({
  query: 'document.title|meta name=|<title>',
  includePatterns: ['**/*.{tsx,ts,html}'],
});
```

### Step 3: Intelligent Analysis

When analyzing pages, consider:

1. **Page Purpose**: What is each page trying to achieve?
   - Homepage: First impression, value proposition clarity
   - About: Trust building, story telling
   - Product/Service: Conversion optimization
   - Blog: Thought leadership, answering questions

2. **Audience Alignment**: Does the content speak to the target audience?
   - Language and tone match
   - Addresses their pain points
   - Uses terminology they understand

3. **Brand Consistency**: Is the SEO strategy aligned with the brand?
   - Voice and messaging
   - Visual and content hierarchy
   - Unique differentiators highlighted

4. **Competitive Edge**: How can SEO help them stand out?
   - Unique angles on common topics
   - Underserved keywords in their niche
   - Content gaps competitors missed

### Step 4: Context-Aware Recommendations

Instead of generic suggestions, provide specific, actionable recommendations:

#### Bad (Generic):

- "Add an FAQ section"
- "Include more keywords"
- "Add meta descriptions"

#### Good (Context-Aware):

- "Add an FAQ addressing common concerns about sustainable sourcing that your eco-conscious customers care about"
- "Incorporate 'farm-to-table Austin' naturally in your homepage hero section to capture local searches"
- "Write meta descriptions that emphasize your 24-hour delivery guarantee - a key differentiator from competitors"

### Step 5: Generate Strategic Report (optional)

For **SEO checks**, the report widget from Step 1 is sufficient — do not create `seo-report.md` in the same turn.

When doing a **deep marketing handoff** or the user asks for a written strategy doc, you may create `seo-report.md` that includes:

**For a written report: include analysis for EVERY page in the application**

1. **Executive Summary**
   - Current SEO strengths
   - Key opportunities aligned with business goals
   - Competitive advantages to leverage

2. **Page-by-Page Analysis**
   - What's working well
   - Specific improvements with business rationale
   - Priority based on impact and effort

3. **Content Strategy**
   - Topics that resonate with their audience
   - Questions to answer for their customers
   - How to showcase unique value propositions

4. **Technical Recommendations**
   - Only if they actually matter for this business
   - With clear explanations of business impact

5. **Implementation Plan**
   - Prioritized list of changes to implement
   - Specific files to modify
   - Example code snippets where helpful

### Step 6: Implement SEO Improvements

After the audit widget (or optional report), implement the recommendations:

**RSS feed for blogs.** If the site has a blog (`src/lib/blog.ts` exists) but no
feed yet (no `/feed.xml` in `src/server/entry.ts`), add one automatically as part
of the SEO work via `skill({ action: "load", skill: "rss" })`.

**Priority 1: Page titles and meta descriptions**

Every page MUST have unique, SEO-optimized metadata. **Follow the existing pattern you discovered:**

1. **Find an existing page with metadata:**

```javascript
// Search for pages that already have SEO metadata
await grepSearch({
  query: 'metadata|<Head|meta name=',
  includePatterns: ['src/**/*.{tsx,jsx}'],
});

// Read one to see the pattern
await readFile({ path: 'path/to/page-with-metadata.tsx' });
```

2. **Copy the pattern exactly:**
   - If the app exports `metadata` → Use that same structure
   - If the app uses `<Head>` component → Use that same component
   - If the app uses `<Helmet>` → Use that same component
   - Match import statements, syntax, and structure exactly

3. **Apply to all pages consistently:**
   - Every page should use the SAME pattern
   - Don't mix different approaches
   - Keep the structure consistent across the entire app

**Example approach (adapt based on what you find):**

```typescript
// If you found this pattern in one page:
export const metadata = {
  title: 'Existing Page Title',
  description: 'Existing description',
};

// Then apply the SAME pattern to other pages:
export const metadata = {
  title: 'New Unique Page Title - Brand Name',
  description: 'Compelling description with keywords',
};
```

**⚠️ Critical:** Never introduce a new pattern if one already exists. Consistency > "best practice".

#### After technical fixes — business and strategy recommendations

When you finish fixing **technical** issues from the audit (metadata, Helmet, routes, headings, etc.):

1. **Review the audit widget Strategy section** and your page reads for gaps that code alone did not fix — e.g. weak value proposition, missing audience language, thin content, keyword opportunities, FAQ/content ideas.
2. **Briefly recommend** any business-context improvements to the user in plain language. Do not bulk-implement large content rewrites unless they ask.
3. **Separate technical vs strategic** in your summary: what you fixed in code vs what they may want to tackle next (copy, new sections, local SEO, etc.).

**Priority 2: Content optimization**

Update page content to naturally incorporate target keywords:

- H1 headings with primary keywords
- First paragraph includes target keywords
- Semantic variations throughout content
- Clear, scannable structure

**Priority 3: Technical SEO**

Implement structured data, optimize images, improve performance:

```typescript
// Example: Local business structured data
<script type="application/ld+json">
{JSON.stringify({
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Business Name",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "123 Main St",
    "addressLocality": "City",
    "addressRegion": "ST",
    "postalCode": "12345"
  }
})}
</script>
```

## Example Analysis Approaches

### For a Local Restaurant:

- Focus on local SEO and "near me" searches
- Highlight unique menu items or dining experience
- Answer questions like "gluten-free options?" or "good for groups?"
- Emphasize what makes them different from other local restaurants

### For a B2B SaaS:

- Target problem-aware searches ("how to reduce customer churn")
- Build thought leadership content
- Optimize for comparison searches vs competitors
- Focus on ROI and business outcomes

### For an E-commerce Brand:

- Optimize for product-specific searches
- Build trust signals (reviews, guarantees)
- Answer buyer questions proactively
- Highlight unique product benefits

## Detecting Existing SEO Patterns

**CRITICAL FIRST STEP:** Before making any SEO recommendations, discover what patterns already exist in the codebase.

### Discovery Process:

1. **Search for existing SEO implementations:**

```javascript
// Look for common metadata patterns
await grepSearch({
  query: 'metadata|meta name=|<Head|Helmet|<title>',
  includePatterns: ['**/*.{tsx,ts,jsx,js}'],
});
```

2. **Read sample pages to identify the pattern:**

```javascript
// Check homepage and another page to identify the pattern
await readFile({ path: 'src/pages/index.tsx' });
await readFile({ path: 'src/app/page.tsx' });
```

### Follow Existing Patterns:

**DO NOT prescribe a specific library or approach.** Instead, observe what the codebase already uses:

- If pages export a `metadata` object → Follow that pattern (likely Next.js app router)
- If pages use `<Head>` from `next/head` → Follow that pattern (likely Next.js pages router)
- If pages export a `meta` function → Follow that pattern (likely Remix)
- If pages use `<Helmet>` from `@dr.pogodin/react-helmet` → v8 SSR template, see the "Implementing SEO in the v8 Template" section below
- If pages use `<Helmet>` from `react-helmet-async` or legacy `react-helmet` → Follow that pattern
- If NO pattern exists → Choose the idiomatic approach for the framework

### Decision Criteria:

1. **Consistency First:** Match existing patterns in the codebase
2. **Framework Native:** Prefer built-in framework solutions over third-party libraries
3. **Simple & Standard:** If no pattern exists, choose the most common approach for that framework

**⚠️ Key Principle:** When in doubt, search the codebase for how metadata is currently handled. The best approach is the one the app is already using.

## Common App Templates & Patterns

**Note for all apps**: Many development environments add `<meta name="robots" content="noindex, nofollow">` in development mode. This is intentional and prevents dev sites from being indexed. Don't remove this - it should be environment-aware.

### What to Look For:

1. **Page Titles**: Check if pages have unique, descriptive titles with target keywords
2. **Meta Descriptions**: Look for compelling descriptions that include keywords and CTAs
3. **Heading Structure**: Ensure proper H1-H6 hierarchy with keywords in headings
4. **Content Quality**:
   - Keyword density (1-2% for primary keywords)
   - Natural keyword placement in first 100 words
   - Related keywords and semantic variations
   - Content length appropriate for topic depth
5. **Image Alt Text**: Check if images have descriptive, keyword-relevant alt attributes
6. **Content Opportunities**:
   - Rewrite content to naturally incorporate target keywords
   - Expand thin content
   - Add sections to answer user questions
   - Create content that targets featured snippets

### When No Existing SEO Pattern Exists:

If the app has NO existing metadata implementation, you'll need to set one up:

1. **If it's a v8 template app** (check for `@dr.pogodin/react-helmet` in package.json, `src/entry-server.tsx`, or `src/server/entry.ts`):
   follow the "Implementing SEO in the v8 Template" section below. This is the path for all new Airo apps.

2. **Otherwise, check if a metadata library is already installed:**

Look for: `@dr.pogodin/react-helmet`, `react-helmet-async`, `react-helmet`, or framework-specific packages in package.json.

3. **If a library exists but isn't used:**
   - Use that library (it was installed for a reason)
   - Search for setup/provider code that might exist
   - Follow the library's patterns

4. **If no library exists:**
   - Check package.json for the framework
   - Search online documentation for that framework's recommended SEO approach
   - Install dependencies only if the framework doesn't have built-in SEO support
   - Choose the most standard, well-documented approach

**Example decision process:**

```javascript
// If you see "next": "^14.0.0" in package.json → Next.js likely has built-in metadata
// If you see "@dr.pogodin/react-helmet" in dependencies → v8 SSR template, use the pattern in the v8 section below
// If you see "react-helmet-async" in dependencies → Use that (already installed)

// Search for any setup that might exist
await grepSearch({ query: 'HelmetProvider|metadata|meta:', includePatterns: ['**/*.{tsx,jsx}'] });
```

**⚠️ Important:**

- Don't install new dependencies without checking what's already there
- Framework-native solutions are always preferable to third-party libraries
- When in doubt, search for the framework's official SEO documentation

## Modern SEO Considerations

### Answer Engine Optimization (AEO)

- Think about how AI assistants would summarize content
- Structure information for easy extraction
- Use clear headings and concise answers

### User Experience Signals

- Page speed and mobile experience matter
- Prioritize based on actual user behavior
- Local businesses should focus on mobile

### E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)

- Showcase credentials where they matter
- Build trust signals appropriate to the industry
- Highlight real experience and expertise

## Your SEO Implementation Workflow

1. **Check (Step 1)** — `seoAnalysis` or `seo__audit` → report widget → STOP
2. **Discover Existing Patterns** — Search for current SEO implementations, reference package.json dependencies
3. **Analyze** — Read pages with readFile/directoryListing; use strategy from the audit widget
4. **Report (optional)** — `seo-report.md` only when user or marketing handoff needs a written doc
5. **Implement** — Follow existing patterns; if none exist, choose idiomatic approach for the framework
6. **Verify** — Optional `seo__audit`; check unique titles and descriptions per page
7. **Recommend** — Note any business/strategy opportunities from the audit widget that fixes did not address

**Quality Check Before Completing fixes:**

- ✓ Searched for and identified existing SEO patterns in the codebase
- ✓ Analyzed every page that needed changes
- ✓ Addressed issues from the audit widget (or user request)
- ✓ Implemented metadata for ALL affected pages using consistent patterns
- ✓ Optimized content with natural keyword incorporation where appropriate
- ✓ Added structured data where appropriate
- ✓ Summarized technical fixes **and** any remaining business/strategy recommendations

## Communication Style

Keep responses focused and actionable:

1. **Initial Response**: "I'll analyze your site for SEO optimization. Let me first check what patterns you're already using..."
2. **Pattern Discovery**: "Found existing [metadata pattern]. I'll follow this same approach for consistency."
   OR "No existing SEO patterns found. I'll set up [idiomatic approach] based on your [framework]."
3. **During Analysis**: Show progress as you read pages
4. **After check**: "Your SEO audit report is above. Key opportunities: [2-3 bullet points]. Click Fix SEO issues when you're ready."
   **After optional written report**: "I've created seo-report.md. Key opportunities: [2-3 bullet points]"
5. **During Implementation**: Explain changes as you make them
6. **Completion**: "Technical SEO fixes are done. [What changed]. **Strategy notes:** [1–3 business/content opportunities from the audit if any]. Publish again to validate live HTML."

## Remember

SEO is not just about keywords and meta tags - it's about understanding the business, the audience, and creating content that genuinely serves users while being discoverable by search engines. Every optimization should make the site better for real people, not just search bots.

When building generated Open Graph image URLs, use the native `URL` API with `searchParams.set()` instead of interpolating query strings. This keeps titles and descriptions correctly escaped for crawlers and social previews.

---

# Implementing SEO in the v8 Template

The v8 template renders every page on the server. Crawlers receive fully-rendered HTML with head already populated. Every page must set its own head tags and structured data through `@dr.pogodin/react-helmet`.

## 1. Head management with react-helmet

Every page MUST set, via `<Helmet>`:

- `<title>` - unique, <= 60 chars
- `<meta name="description">` - unique, <= 160 chars
- `<link rel="canonical">` - absolute URL for the current route
- Open Graph: `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
- `<meta name="twitter:card" content="summary_large_image">`

Titles and descriptions MUST be specific to the page. Never copy the home page title onto other pages.

Build absolute canonical, Open Graph, and Twitter URLs explicitly. If the page uses a generated OG image endpoint, use the native `URL` API and `searchParams.set()` instead of string interpolation so values are escaped correctly.

```tsx
import { Helmet } from '@dr.pogodin/react-helmet';

export default function AboutPage() {
  const title = 'About - Acme Consulting';
  const description = 'Meet the team behind Acme Consulting...';
  const canonicalUrl = 'https://acme.example/about';
  const ogImage = new URL('/api/og', canonicalUrl);
  ogImage.searchParams.set('title', title);
  ogImage.searchParams.set('description', description);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${canonicalUrl}#webpage`,
    name: title,
    url: canonicalUrl,
    // reference the homepage entities by @id — don't re-declare the Organization
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
        <meta property="og:image" content={ogImage.href} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={ogImage.href} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <section>{/* page content */}</section>
    </>
  );
}
```

## 2. JSON-LD structured data

Inject JSON-LD inside `<Helmet>`. Always wrap the object with `JSON.stringify` - never handwrite the JSON string.

```tsx
// Homepage: emit ONE @graph with the WebSite + Organization + WebPage baseline,
// linked by @id. Add a more specific business type (e.g. LocalBusiness) only when
// the business has a real physical location.
const site = 'https://acme.example';
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${site}/#website`, name: 'Acme Consulting', url: `${site}/` },
    { '@type': 'Organization', '@id': `${site}/#organization`, name: 'Acme Consulting', url: `${site}/`, logo: `${site}/logo.png` },
    { '@type': 'WebPage', '@id': `${site}/#webpage`, url: `${site}/`, isPartOf: { '@id': `${site}/#website` }, about: { '@id': `${site}/#organization` }, datePublished: 'YYYY-MM-DD', dateModified: 'YYYY-MM-DD' }, // dates: real build date, replace the placeholder
  ],
};

<Helmet>
  <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
</Helmet>
```

### Schema types

The homepage always emits the `WebSite` + `Organization` + `WebPage` triad shown above (one `@graph`, linked by `@id`). Use this table to pick a more specific business type for the homepage `Organization` when one applies, and the page-purpose `@type` for other pages:

| @type                        | Use on                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| `Organization`               | Homepage business entity (baseline triad; use a subtype below if one fits) |
| `WebSite`                    | Homepage (baseline triad; add `potentialAction` if the site has search) |
| `LocalBusiness`              | Homepage business node — only when the business has a real location     |
| `Person`                     | Personal portfolio or author pages                                      |
| `Article`                    | News or editorial article                                               |
| `BlogPosting`                | Blog post (prefer over `Article` for blogs)                             |
| `Product`                    | E-commerce product page                                                 |
| `FAQPage`                    | Pages with Q&A content                                                  |
| `AboutPage` / `ContactPage`  | About / contact routes                                                  |
| `BreadcrumbList`             | Deep pages - add alongside the page-specific schema                     |

**Other pages** emit their page-purpose `@type` and reference the homepage `Organization`/`WebSite` by `@id` (`isPartOf` / `about`) **rather than re-declaring them**. Fill required properties per schema.org; keep blocks minimal and accurate — don't invent data the business doesn't have (no fabricated phone, address, or hours).

## 3. Image hygiene

- Every `<img>` MUST have explicit `width` and `height` (prevents CLS)
- Every `<img>` MUST have descriptive `alt` (not the filename)
- LCP image: `fetchpriority="high"`, default `loading="eager"`
- Below-the-fold: `loading="lazy"`
- Prefer WebP when available
- `alt=""` only for purely decorative images

## 4. Semantic HTML

- Exactly ONE `<h1>` per page, aligned with `<Helmet>` `<title>`
- Use `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`
- Heading levels nest correctly - don't skip `<h1>` to `<h4>`

## 5. Sitemap and robots.txt

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

## 6. v8 implementation checklist

The advisory post-publish validator (`SeoValidator`) fetches the published URL and
checks a subset of these items. Items it checks are marked (validator). Other items
require manual verification — the validator will not complain if they are missing.

- [ ] Unique `<title>` via `<Helmet>` per page (validator)
- [ ] Unique `<meta name="description">` per page (validator)
- [ ] `<link rel="canonical">` per page (validator)
- [ ] `og:title` (validator), `og:description` (validator), `og:image` (validator), `og:url` (validator), `og:type` (validator) set
- [ ] `twitter:card` = `summary_large_image` (validator), `twitter:image` absolute URL (validator)
- [ ] At least one valid JSON-LD block with an appropriate `@type` (validator)
- [ ] Exactly one `<h1>` matching page intent (validator)
- [ ] All `<img>` have `width`, `height`, descriptive `alt`
- [ ] LCP image has `fetchpriority="high"`; below-fold images have `loading="lazy"`
- [ ] New public pages added to `src/lib/seo-routes.ts`
