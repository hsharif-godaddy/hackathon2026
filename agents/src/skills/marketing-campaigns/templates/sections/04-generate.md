# GENERATE Phase

**Execute content creation in this order. No deviation.** The first two steps run on the marketing agent (which has the social tool); Third step should only be run AFTER 1 and 2, the build handoff is LAST. (The business signal — vertical / salesType / location — is persisted primarily by `campaignPlanPropose` in PLAN; skill.md's GENERATE runs a backstop `brandIdentity` set for the rare case the plan params were dropped.)

1. **Social posts** (`socialPostCreate`) — FIRST content step.
2. **Email + ad copy** — inline, in the same response.
3. **Scaffold landing page** (`marketing-campaigns__campaignScaffoldPage`) — writes the landing page template (with countdown timer + date-gating) to the workspace. The landing page MUST exist before the build handoff.
4. **Handoff to DevelopAgent** to EDIT the landing page + create blog — LAST. This handoff builds CODE FILES only; social posts, email, and ad copy are the marketing agent's responsibility and MUST already be created (steps 1–2) before you hand off — do not defer any of them past this point. NEVER hand off to build before the social posts exist. After the build completes, continue to SUMMARY to save and show the campaign card.

(The canonical slug was sanitized and frozen in the `campaignPlanPropose` response — use `plan.landingPageSlug` for all references. All CTAs across channels MUST point to `/lp/[canonicalSlug]`, never a bare top-level route. Do NOT invent a different slug — reuse the exact value from the approved plan.)

**Local signals are derived.** If the business sells in person — derive this from the stored/known `salesType` (`in_store` / `service` / `hybrid` → in-person; `online` → online), the vertical (`restaurant` / `service` / `health` → in-person; `saas` / `blog` → online), plus a physical address / opening hours on the existing site — the landing-page handoff should tell DevelopAgent to surface address, hours, directions, and a "visit us in person" angle, pulled from the existing site. Omit local signals for online-only businesses.

---

## Step 1 (DO THIS FIRST): Create the social posts — `socialPostCreate`

You are currently on the marketing agent, which HAS the `socialPostCreate` tool. Call it NOW, before any handoff. This renders the publishable social widgets. Writing social copy as inline text, or deferring them as "draft concepts / ready to create", is a FAILURE — the build agent you hand off to next does NOT have this tool, so if you skip it here the social posts will never be created.

```javascript
socialPostCreate({
  topic: '[campaign theme — e.g. Memorial Day gear upgrade]',
  contentApproach: 'promotional',
  platform: 'all',
  mode: 'multiple',
  count: [N],
  includeImages: true,
  imageProvider: 'search',
  scheduledDate: '[first post date YYYY-MM-DD]',
  posts: [
    {
      styleLabel: '[angle — Teaser/Launch/Spotlight/Reminder/Last Chance]',
      styleDescription: '[what this post does] — publish [date]',
      content: '[full post text with emojis, hashtags, CTA — personalized to business]',
      hashtags: ['relevant', 'hashtags', 'without-hash-symbol'],
      callToAction: '[CTA text]'
    }
    // ...one object per confirmed social post
  ],
  brandContext: {
    name: '[business name]',
    type: '[business type]',
    tone: '[brand tone]'
  }
})
```

This renders the social post widget. The user publishes to Facebook/Instagram directly from it.

## Step 2: Write email + ad copy inline

In the SAME message after calling `socialPostCreate`, write email and ad copy as formatted text. These are copy-paste content — AAB cannot send emails or submit ads.

**Email format:**

> ### Email [#]: "[Subject Line]"
> **Send date:** [date] | **Angle:** [type]
> **Preview text:** [40 chars]
>
> [Headline]
>
> [Body — 3-4 paragraphs: hook, offer, details, CTA]
>
> **[CTA Button]** → /lp/[campaign-slug]

**Ad format:**

> ### Ad [#]: [Platform] — "[Headline]"
> **Headline:** [25-40 chars] | **CTA:** [action]
> **Description:** [90 chars]
> **Targeting:** [audience, interests]
> **Destination:** /lp/[campaign-slug]

---

## Step 3: Scaffold landing page — `campaignScaffoldPage`

**Only do this AFTER steps 1–2 (social posts + email/ad) are done.** Call `marketing-campaigns__campaignScaffoldPage` with the campaign name, start date, end date, and landing page path from the approved plan.

This tool writes the landing page at `src/pages/lp/[campaign-slug].tsx` with a countdown timer, coming-soon state, and sale-ended state already built in. The landing page MUST exist before the handoff in Step 4. Do NOT skip this step.

---

## Step 4 (DO THIS LAST): Handoff to DevelopAgent — edit the landing page + create blog

**Only do this AFTER step 3 (campaignScaffoldPage) has completed.** Call `handoff({ agent: 'develop' })` with ONE complete brief. Do NOT split into multiple handoffs.

**IMPORTANT CONTEXT:** The landing page already exists at `src/pages/lp/[campaign-slug].tsx` — it was written by `campaignScaffoldPage` in Step 3. The file has a working countdown timer, a "sale ended" state, and placeholder content for the builder to replace. The builder's job is to EDIT this file — replace the placeholder section with creative campaign content while keeping the countdown timer and ended state intact.

**CRITICAL RULES FOR THE HANDOFF BRIEF:**
- The brief MUST be a single block of text — not fragmented sections the agent picks from
- The landing page ALREADY EXISTS with a countdown timer — tell the builder to EDIT it (replace placeholder content), NOT create a new file from scratch
- The blog MUST be discoverable — set up a blog index/listing page + route if one doesn't exist, and link it from the nav. Never leave a post as an orphaned page reachable only by direct URL.
- NEVER tell DevelopAgent to create a summary/planning markdown file
- NEVER tell DevelopAgent to put social posts, emails, or ads into a file (those were already created in Step 1–2)

**The complete handoff brief:**

```
Build the following for our [campaign type] campaign.

=== LANDING PAGE (EDIT — file already exists at src/pages/lp/[campaign-slug].tsx) ===

The landing page already exists with a working countdown timer and "sale ended" state. EDIT this file — replace the placeholder campaign content section (marked with a comment) with a full creative landing page.

DO NOT recreate the file from scratch. DO NOT remove the countdown timer, the useCountdown hook, the SALE_END/SALE_START constants, or any of the three date-gated states (active sale, sale-ended, and coming-soon). Each non-active state contains a placeholder comment — fill in its content, but do not delete the state branches or the countdown logic. Only replace the placeholder content areas.

Creative content to add (replacing the placeholder):
- Hero with compelling background image (call media() FIRST to get real image URL)
- Campaign headline + offer details + CTA button
- Offer details section with terms
- Social proof / trust signals
- On-brand design matching existing site
- You may restyle the countdown timer bar to match your design, but do NOT remove it or change its logic

Images: Use media() tool to search, use returned URLs directly. No placeholders.

Route registration (REQUIRED — without this the page 404s):
- Read src/routes.tsx (or the app's route config file)
- Add a lazy import for the campaign page: `const CampaignPage = lazy(() => import('./pages/lp/[campaign-slug].tsx'))`
- Add a route entry: `{ path: '/lp/[campaign-slug]', element: <CampaignPage /> }`
- This app does NOT use filesystem-based routing — an explicit route entry is mandatory
- The /lp/ prefix is REQUIRED for marketing attribution (UTM tracking, data-lake ingestion)

Site discovery: Add an announcement banner / link in the main layout pointing to /lp/[campaign-slug].

[IF A SALE BANNER WAS ALSO PLANNED, ADD:]
Also add a site-wide dismissible announcement banner (coupon code + end date) in the main layout. This is IN ADDITION to the landing page, not instead of it.

=== BLOG SYSTEM + POSTS ===

FIRST, make the blog discoverable:
- Check how THIS app handles blog content (markdown in src/content/blog/, OR page components such as src/pages/blog/). Match the app's existing convention.
- If the app has NO blog system yet (common on a brand-new site), CREATE one: a blog index/listing page AND its route, plus a link from the main nav/header — so posts are listed and reachable, not orphaned.

THEN create [N] blog post(s):
- Preferred convention: markdown files at src/content/blog/[slug].md so the marketing calendar can read their frontmatter. If the app is page-based, create the post page AND make sure it appears on the blog index.
- Required frontmatter for markdown posts (EXACT format — the marketing calendar reads these fields):
---
title: '[title]'
publishedAt: '[YYYY-MM-DDTHH:MM:SSZ]'
published: true
tags: ['tag1', 'tag2']
excerpt: '[1-2 sentence summary]'
---
- Each post: 400-600 words, headings, tips, CTA linking to the campaign landing page.
- One file per post — never combine posts into one file, never skip a post.

Post list:
[...for each confirmed blog post: title, slug, publishedAt (exact ISO 8601 date), angle]

=== CAMPAIGN DETAILS ===
Business: [name] ([type])
Offer: [description]
Dates: [start] to [end]
Brand voice: [voice]

=== WHAT NOT TO CREATE ===
- Do NOT create any file in a marketing/ directory
- Do NOT create summary/planning documents
- Do NOT put social posts, email copy, or ad copy into any file (already created before this handoff)
- Do NOT recreate src/pages/lp/[campaign-slug].tsx from scratch — EDIT it (replace the placeholder content)
- Files to EDIT: src/pages/lp/[campaign-slug].tsx
- Files to CREATE: blog index/listing + route (if missing), and the blog post(s)
```

**Post-build verification:**

After the handoff returns, verify BOTH the countdown AND the route registration:

**Check 1 — Countdown intact:**
1. Use `grepSearch` or `readFile` on `src/pages/lp/[campaign-slug].tsx` to confirm it contains `useCountdown`.
2. **If missing** (builder overwrote the file): re-handoff with a SHORT correction brief:
   "The landing page at src/pages/lp/[campaign-slug].tsx is missing the countdown timer. Edit the file: add `import { useState, useEffect } from 'react';` and the useCountdown hook, define `const SALE_END = '[endDate]T23:59:59Z';`, and add a countdown bar above the main content. When the countdown reaches zero, show 'This Sale Has Ended' instead of the page content."

**Check 2 — Route registered:**
3. Use `grepSearch` or `readFile` on `src/routes.tsx` to confirm it contains `/lp/[campaign-slug]`.
4. **If missing** (builder skipped route registration): re-handoff with a SHORT correction brief:
   "The campaign landing page route is missing. Edit src/routes.tsx: add a lazy import `const CampaignPage = lazy(() => import('./pages/lp/[campaign-slug].tsx'))` and a route entry `{ path: '/lp/[campaign-slug]', element: <CampaignPage /> }`. Without this route the page 404s."

**Retry rules:**
5. **Maximum 1 retry** (for either or both failures). If the correction also fails, continue to SUMMARY anyway — do not loop.
6. **If both checks pass:** proceed to SUMMARY.

**Wait for the handoff to complete and verification to pass, then proceed to SUMMARY.**
