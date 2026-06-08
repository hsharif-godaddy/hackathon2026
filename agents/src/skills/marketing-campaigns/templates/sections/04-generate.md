# GENERATE Phase

**Execute content creation in this exact sequence. No deviation.**

## 1. Handoff to DevelopAgent (site artifact + blog posts)

Call `handoff({ agent: 'develop' })` with ONE complete brief. Do NOT split into multiple handoffs.

**CRITICAL RULES FOR THE HANDOFF BRIEF:**
- The brief MUST be a single block of text — not fragmented sections the agent picks from
- Blog posts MUST be specified as individual files with exact paths (`src/content/blog/[slug].md`)
- NEVER tell DevelopAgent to create a summary/planning markdown file
- NEVER tell DevelopAgent to put social posts, emails, or ads into a file

**The complete handoff brief (adapt the SITE ARTIFACT section based on user's choice):**

```
Build the following for our [campaign type] campaign. Create ALL files in this single pass.

=== SITE ARTIFACT ===

[IF LANDING PAGE]:
Route: /[campaign-slug]
Requirements:
- Hero with compelling background image (call media() FIRST to get real image URL)
- Campaign headline + offer details + CTA button
- Offer details section with terms
- Social proof / trust signals
- Campaign end date / urgency element
- On-brand design matching existing site
Images: Use media() tool to search, use returned URLs directly. No placeholders.
Site discovery: Add announcement banner to main layout linking to this page.

[IF BANNER + COUPON]:
Add a site-wide announcement banner to the main layout with:
- Campaign message + coupon code (prominently displayed, easy to copy)
- Campaign end date for urgency
- Dismissible (X button, stores in localStorage)
- On-brand styling matching existing site
- Link to relevant product/service page if applicable
Do NOT create a separate landing page.

[IF CONTENT ONLY — omit this section entirely]

=== BLOG POSTS ===

Create [N] blog posts as SEPARATE markdown files. Each file path: src/content/blog/[slug].md

Required frontmatter for EACH file (EXACT format — the marketing calendar reads these fields):
---
title: '[title]'
publishedAt: '[YYYY-MM-DDTHH:MM:SSZ]'
published: true
tags: ['tag1', 'tag2']
excerpt: '[1-2 sentence summary]'
---

Post 1: "[title]"
- File: src/content/blog/[slug-1].md
- publishedAt: [exact ISO 8601 date]
- Angle: [angle]
- Content: 400-600 words, headings, tips, CTA linking to campaign page or main site

Post 2: "[title]"
- File: src/content/blog/[slug-2].md
- publishedAt: [exact ISO 8601 date]
- Angle: [angle]
- Content: 400-600 words, headings, tips, CTA linking to campaign page or main site

[...repeat for each confirmed blog post]

IMPORTANT: Each blog post = one separate .md file in src/content/blog/. Do NOT:
- Combine multiple posts into one file
- Put blog content inside another file
- Create a marketing summary file instead of actual blog posts
- Skip the blog posts

=== CAMPAIGN DETAILS ===
Business: [name] ([type])
Offer: [description]
Dates: [start] to [end]
Brand voice: [voice]

=== WHAT NOT TO CREATE ===
- Do NOT create any file in a marketing/ directory
- Do NOT create summary/planning documents
- Do NOT put social posts, email copy, or ad copy into any file
- The ONLY files to create are: site artifact (page or banner component) + blog .md files
```

**Wait for handoff to complete before proceeding.** If artifact type is Content Only AND no blog posts were confirmed, skip the handoff entirely and go straight to socialPostCreate.

## 2. Call `socialPostCreate` (all social posts in one tool call)

Immediately after DevelopAgent hands back, call the tool:

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

This renders the social post widget. User publishes to Facebook/Instagram directly from it.

## 3. Write email + ad copy inline (same response as socialPostCreate)

In the SAME message after calling socialPostCreate, write email and ad copy as formatted text. These are copy-paste content — AAB cannot send emails or submit ads.

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
