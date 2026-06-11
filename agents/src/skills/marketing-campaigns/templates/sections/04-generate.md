# GENERATE Phase

**Execute content creation in this order. No deviation.** The first two steps run on the marketing agent (which has the social tool); the build handoff is LAST.

1. **Social posts** (`socialPostCreate`) — FIRST.
2. **Email + ad copy** — inline, in the same response.
3. **Handoff to DevelopAgent** to build the landing page + blog — LAST. This handoff builds CODE FILES only; social posts, email, and ad copy are the marketing agent's responsibility and MUST already be created (steps 1–2) before you hand off — do not defer any of them past this point. NEVER hand off to build before the social posts exist. After the build completes, continue to SUMMARY to save and show the campaign card.

(The landing-page slug is already fixed in the approved plan, so social posts can reference the landing-page URL before the page is built.)

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

## Step 2: Write email + ad copy inline (same response as socialPostCreate)

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
> **[CTA Button]** → /[campaign-slug]

**Ad format:**

> ### Ad [#]: [Platform] — "[Headline]"
> **Headline:** [25-40 chars] | **CTA:** [action]
> **Description:** [90 chars]
> **Targeting:** [audience, interests]
> **Destination:** /[campaign-slug]

---

## Step 3 (DO THIS LAST): Handoff to DevelopAgent — build the landing page + blog

**Only do this AFTER steps 1–2 (social posts + email/ad) are done.** Call `handoff({ agent: 'develop' })` with ONE complete brief. Do NOT split into multiple handoffs.

**CRITICAL RULES FOR THE HANDOFF BRIEF:**
- The brief MUST be a single block of text — not fragmented sections the agent picks from
- The blog MUST be discoverable — set up a blog index/listing page + route if one doesn't exist, and link it from the nav. Never leave a post as an orphaned page reachable only by direct URL.
- NEVER tell DevelopAgent to create a summary/planning markdown file
- NEVER tell DevelopAgent to put social posts, emails, or ads into a file (those were already created in Step 1–2)

**The complete handoff brief:**

```
Build the following for our [campaign type] campaign. Create ALL files in this single pass.

=== SITE ARTIFACT (landing page — always) ===

Route: /[campaign-slug]
Requirements:
- Hero with compelling background image (call media() FIRST to get real image URL)
- Campaign headline + offer details + CTA button
- Offer details section with terms
- Social proof / trust signals
- Campaign end date / urgency element
- On-brand design matching existing site
Images: Use media() tool to search, use returned URLs directly. No placeholders.
Site discovery: Add an announcement banner / link in the main layout pointing to this page.

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
- Files to create: the landing page, the blog index/listing + route (if missing), and the blog post(s)
```

**Wait for the handoff to complete, then proceed to SUMMARY.**
