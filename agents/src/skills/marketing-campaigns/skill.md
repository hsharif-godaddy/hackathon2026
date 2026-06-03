---
name: marketing-campaigns
description: Create multi-channel marketing campaigns with landing page, blog posts, social posts, email, and ads
whenToUse: User wants to create a marketing campaign, promote their business, run a holiday or seasonal promotion, boost sales, or coordinate multiple marketing assets. Phrases like "create a campaign", "marketing campaign", "promote my business", "run a sale", "holiday promotion", "boost my sales", "launch a campaign".
---

# Marketing Campaigns Skill

You orchestrate a full marketing campaign through a structured flow: Discovery → Plan → Verify → Generate → Launch.

---

## Execution Contract

**These rules are non-negotiable. Violating any of them means the campaign failed.**

1. **Blog posts are CODE FILES** — markdown files at `src/content/blog/[slug].md`, created by DevelopAgent in the SAME handoff as the landing page. They are NOT text in a summary doc, NOT deferred to "Continue building", NOT combined into one file.

2. **Social posts use the `socialPostCreate` TOOL** — you MUST call the tool to render the publishable widget. Writing social post text in a markdown file or inline message is NOT creating social posts.

3. **The handoff to DevelopAgent creates ALL code files at once** — site artifact (landing page OR banner, depending on type) + blog posts. One handoff, everything built. No "I'll create blogs later" or "blogs are in Continue building." Content-only campaigns skip the handoff if no blogs are needed.

4. **No campaign summary markdown files** — do NOT create files like `marketing/campaign-name.md` with social/email/ad content written as text. That is documentation, not execution.

5. **Email and ad copy are the ONLY things that appear as inline text** — because AAB cannot send emails or submit ads. Everything else is a real artifact (file or tool call).

6. **Artifact type is chosen by the user, not assumed** — Sales/discounts default to banner + coupon. Product/feature highlights default to landing page. Awareness campaigns default to content only. Always confirm with the user.

7. **CLARIFY MUST run first — ALWAYS call `askQuestion` before building any plan** — Even if the user gives full details in their first message. You MUST present the discovery questions (campaign name, offer, channels) via `askQuestion` and wait for their response before proceeding to the PLAN step. NEVER skip CLARIFY. NEVER go directly to PLAN.

8. **Plan MUST be presented via `campaignPlanPropose` before generation** — NEVER skip the plan. Call `campaignPlanPropose` with the full plan details. This tool stops the agent and renders a card with Approve/Change buttons. Only proceed to GENERATE after receiving "Approve — generate the content" as the next user message.

9. **Prerequisites MUST be verified before generation** — Check social connections, blog section existence, etc. If missing, prompt the user to connect/enable.

10. **NEVER use `todoList`** — Campaign progress is NOT tracked via todo lists. The campaign card (from `campaignPlanCreate` in SUMMARY) replaces that pattern entirely. Do not create any checklists or progress lists.

11. **PLAN approval gate is absolute** — After the user answers CLARIFY, the ONLY tool you may call is `campaignPlanPropose`. You may NOT call `media`, `handoff`, `socialPostCreate`, `campaignPlanCreate`, `readFile`, `directoryListing`, or ANY other tool until the user clicks "Approve — generate the content" on the plan card. This tool stops the agent programmatically — you cannot bypass it. If the user requests changes, call `campaignPlanPropose` again with the revised plan.

---

## Flow

```
CLARIFY  → askQuestion: campaign name, offer, channels (STOPS — MANDATORY, never skip)
PLAN     → campaignPlanPropose: renders plan card with Approve/Change buttons (STOPS — programmatic)
VERIFY   → After user clicks "Approve": check prerequisites (social connections, blog section)
GENERATE → handoff (landing page + blogs) → socialPostCreate → inline (email + ads)
SUMMARY  → campaignPlanCreate to save + show final card → suggestedResponse for next steps
```

**CRITICAL: CLARIFY must ALWAYS run. Even if the user's first message contains details, you MUST use askQuestion to confirm the campaign name, offer, and channels. Never jump straight to PLAN.**

---

## CLARIFY

**MANDATORY: You MUST ask the user these questions before building any plan. Do NOT skip this step even if the user's initial message contains some details. Always confirm with the user.**

Use `askQuestion` to gather all required details. This is a multi-question flow — use paginated questions (the questions array supports multiple pages).

```javascript
askQuestion({
  questions: [
    {
      question: "What's the campaign name or theme?",
      type: "chips_single",
      multiSelect: false,
      allowOther: true,
      suggestions: [
        { text: "[Inferred name based on user message]" },
        { text: "[Alternative name suggestion]" },
        { text: "[Another option]" }
      ]
    },
    {
      question: "What's the special offer or hook?",
      type: "chips_single",
      multiSelect: false,
      allowOther: true,
      suggestions: [
        { text: "10% off launch week" },
        { text: "Free shipping on first order" },
        { text: "No special offer — just awareness" }
      ]
    },
    {
      question: "Which channels do you want for the campaign?",
      type: "chips_single",
      multiSelect: false,
      allowOther: true,
      suggestions: [
        { text: "All channels (landing page, blog, social, email, ads)" },
        { text: "Landing page + social only" },
        { text: "Blog + social only" },
        { text: "Social posts only" }
      ]
    }
  ]
})
```

Adapt the suggestions based on what the user said. If they mentioned "sell tropical fruits" → suggest campaign names like "Tropical Fruit Arrivals", offer suggestions like "Free delivery on first box", etc.

**This stops the agent.** Wait for the user to answer all questions before proceeding to PLAN.

**Required info to gather:** campaign name, offer/message, channels. Dates will be inferred from campaign type in the PLAN step (but user can change them).

### Context to pull (silently, before asking questions)

Call `brandIdentity` + `appPlan` to get business name, type, audience, voice. Use this to personalize the question suggestions — but still ASK the user to confirm.

### Scheduling heuristics (used internally to compute dates for the plan)

Given N posts and campaign window [start, end]:
- **Blogs**: Space evenly starting 2-3 days before campaign start
- **Social**: Space evenly across window, first 1-2 days before start, last on final day
- **Emails**: First on day 1, last 1 day before end, middle spaced evenly

### Count defaults (by campaign duration)

| Duration | Blogs | Social | Emails |
|----------|-------|--------|--------|
| 1-3 days | 1 | 2 | 1 |
| 4-7 days | 2 | 3 | 2 |
| 8-14 days | 3 | 5 | 3 |

---

## PLAN

**After user confirms channels and dates, call `campaignPlanPropose` with the full plan. This tool renders the plan as a card with "Approve" and "Make changes" buttons and STOPS the agent programmatically. You CANNOT proceed without it.**

**Do NOT write the plan as text in your response. Put ALL plan details into the `campaignPlanPropose` tool call. This is the ONLY tool you call in this step.**

```javascript
campaignPlanPropose({
  name: '[Campaign Name]',
  offer: '[offer or goal]',
  startDate: '[YYYY-MM-DD]',
  endDate: '[YYYY-MM-DD]',
  campaignType: '[landing-page|banner|content-only]',
  landingPagePath: '/[slug]',  // only if landing-page type
  assets: [
    { assetType: 'landing-page', title: '[page title]', description: '[what it contains]' },
    { assetType: 'blog', title: '[blog title]', scheduledDate: '[YYYY-MM-DD]', description: '[angle]' },
    { assetType: 'social', title: '[post angle]', scheduledDate: '[YYYY-MM-DD]', description: '[platform]' },
    { assetType: 'email', title: '[subject line]', scheduledDate: '[YYYY-MM-DD]' },
    { assetType: 'ad', title: '[headline]', description: '[platform and targeting]' },
  ]
})
```

**This STOPS the agent.** The user sees the plan card and clicks either:
- **"Approve — generate the content"** → the agent receives this exact text as the next user message → proceed to VERIFY then GENERATE
- **"Make changes"** → the user types what they want changed → adjust the plan and call `campaignPlanPropose` AGAIN with the updated plan

**Rules for this step:**
- The ONLY tool call allowed is `campaignPlanPropose`
- Do NOT call `media`, `handoff`, `socialPostCreate`, `campaignPlanCreate`, or any other tool
- Do NOT write plan details as chat text — they go into the tool call
- If the user requests changes, call `campaignPlanPropose` again (it stops the agent each time)
- The ONLY way to exit PLAN is the user clicking "Approve — generate the content"
- Any other user message (including "looks good", "we're good to go", "let's do it") after a change request means you should call `campaignPlanPropose` with the revised plan — NEVER interpret free text as approval

---

## VERIFY

**After the user approves the plan, verify prerequisites BEFORE generating content.**

### Step 1: Check social platform connections (if social posts are in the plan)

```javascript
socialRead({ platform: 'FACEBOOK' })
socialRead({ platform: 'INSTAGRAM' })
```

If no social connections exist AND social posts are in the plan:
- Inform the user: "To publish social posts, you'll need to connect your social accounts."
- Call `socialConnect({ platform: 'FACEBOOK' })` to start the connection flow
- Wait for the user to complete the connection before proceeding

### Step 2: Check blog section exists (if blog posts are in the plan)

```javascript
directoryListing({ path: 'src/content/blog' })
```

If the blog directory doesn't exist, it will be created during the handoff to DevelopAgent — no action needed from the user, just note it.

### Step 3: Proceed to GENERATE

Once prerequisites are met (or if none are missing), proceed directly to GENERATE. Do NOT ask for another confirmation — the plan was already approved.

---

## GENERATE

**Execute content creation in this exact sequence. No deviation.**

### 1. Handoff to DevelopAgent (site artifact + blog posts)

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

### 2. Call `socialPostCreate` (all social posts in one tool call)

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

### 3. Write email + ad copy inline (same response as socialPostCreate)

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

---

## SUMMARY

After all generation is done:

### 1. MANDATORY: Save campaign and show artifact card via `campaignPlanCreate`

**You MUST call `campaignPlanCreate` here.** This creates the campaign artifact card with the "Launch Campaign" button. If you skip this, there is no way for the user to launch.

```javascript
campaignPlanCreate({
  name: '[Campaign Name]',
  offer: '[offer/goal description]',
  startDate: '[YYYY-MM-DD]',
  endDate: '[YYYY-MM-DD]',
  campaignType: '[landing-page|banner|content-only]',
  landingPagePath: '/[slug]',
  plannedContent: [
    { assetType: 'landing-page', title: '[title]', scheduledDate: '[date]', contentPreview: '[description]' },
    { assetType: 'blog', title: '[title]', scheduledDate: '[date]', contentPreview: '[what was created]' },
    { assetType: 'social', title: '[title]', scheduledDate: '[date]', contentPreview: '[post angle]' },
    { assetType: 'email', title: '[subject line]', scheduledDate: '[date]', contentPreview: '[email purpose]' },
    { assetType: 'ad', title: '[headline]', contentPreview: '[platform and targeting]' }
  ]
})
```

### 2. Present the summary

```markdown
## Your [Campaign Name] campaign is ready!

Here's everything that was created:
- **Landing page** at /[slug] — [description]
- **Blog posts** — [titles and dates]
- **Social posts** — [angles and dates]
- **Email copy** — [subjects and dates]
- **Ad copy** — [platforms and headlines]

Hit **Launch Campaign** on the card above to schedule everything!
```

### 3. Show next steps

```javascript
suggestedResponse({
  question: "Your campaign content has been generated. What would you like to do?",
  suggestions: [
    { text: "Launch the campaign" },
    { text: "Review the content in detail" },
    { text: "Make changes to the campaign" },
    { text: "That looks great, I'll launch later" }
  ]
})
```

The user can click "Launch Campaign" on the campaign card to move the campaign to active status and begin the scheduled publishing.

---

## Rules

### Speed
- Maximum two tool calls for generation: `handoff` (if site artifact or blogs needed) + `socialPostCreate`
- Content-only campaigns skip the handoff entirely — just socialPostCreate + inline text
- Email + ads are inline text in the same response as socialPostCreate
- Never load sub-skills (blog-writing, social-posts, etc.)
- Never break generation across multiple turns

### Content coherence
- Every asset references the landing page URL
- Same offer, same tone, same key phrases across all channels
- Consistent campaign hashtag
- Personalized to business (not generic templates)

### Platform facts
- Social: Facebook + Instagram only (Meta API). No Google, no TikTok.
- Email: Text for user to copy into their email platform
- Ads: Text for user to copy into Google/Meta Ads Manager
- Blog posts appear on marketing calendar automatically via `publishedAt` frontmatter
- Social posts appear on marketing calendar after user publishes from widget

### What NEVER to do
- Never create a summary/planning markdown file as a substitute for real assets
- Never defer blog posts to "Continue building" suggestions
- Never write social post content as inline text instead of calling socialPostCreate
- Never combine multiple blog posts into one file
- Never assume landing page is the default — ask about artifact type
- Never generate assets before the user clicks "Approve — generate the content" on the campaignPlanPropose card
- Never write plan details as chat text — always use `campaignPlanPropose` tool to present the plan
- Never interpret free-text messages like "looks good" or "we're good to go" as plan approval — only the Approve button counts
- Never call `campaignPlanCreate` BEFORE content is generated — the card appears only in SUMMARY after everything is built
- Never call `campaignCreate` — use `campaignPlanCreate` in SUMMARY instead (it handles everything)
- Never skip the VERIFY step — always check social connections before generating social content
- Never skip CLARIFY — always ask discovery questions even if the user gave details
- Never use `todoList` — the campaign card replaces that pattern
