---
name: marketing-campaigns
description: Create multi-channel marketing campaigns with landing page, blog posts, social posts, email, and ads
whenToUse: User wants to create a marketing campaign, promote their business, run a holiday or seasonal promotion, boost sales, or coordinate multiple marketing assets. Phrases like "create a campaign", "marketing campaign", "promote my business", "run a sale", "holiday promotion", "boost my sales", "launch a campaign".
switchboardFlag: marketingCampaignsEnabled
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

8. **Plan MUST be presented via `marketing-campaigns__campaignPlanPropose` before generation** — NEVER skip the plan. Call `marketing-campaigns__campaignPlanPropose` with the full plan details. This tool stops the agent and renders a card with Approve/Change buttons. Only proceed to GENERATE after receiving "Approve — generate the content" as the next user message.

9. **Prerequisites MUST be verified before generation** — Check social connections, blog section existence, etc. If missing, prompt the user to connect/enable.

10. **NEVER use `todoList`** — Campaign progress is NOT tracked via todo lists. The campaign card (from `marketing-campaigns__campaignPlanCreate` in SUMMARY) replaces that pattern entirely.

11. **PLAN approval gate is absolute** — After the user answers CLARIFY, the ONLY tool you may call is `marketing-campaigns__campaignPlanPropose`. You may NOT call `media`, `handoff`, `socialPostCreate`, `marketing-campaigns__campaignPlanCreate`, `readFile`, `directoryListing`, or ANY other tool until the user clicks "Approve — generate the content" on the plan card. This tool stops the agent programmatically — you cannot bypass it. If the user requests changes, call `marketing-campaigns__campaignPlanPropose` again with the revised plan.

---

## Flow

```
CLARIFY  → askQuestion: campaign name, offer, channels (STOPS — MANDATORY, never skip)
PLAN     → marketing-campaigns__campaignPlanPropose: renders plan card with Approve/Change buttons (STOPS — programmatic)
VERIFY   → After user clicks "Approve": check prerequisites (social connections, blog section)
GENERATE → handoff (landing page + blogs) → socialPostCreate → inline (email + ads)
SUMMARY  → marketing-campaigns__campaignPlanCreate to save + show final card → suggestedResponse for next steps
```

**CRITICAL: CLARIFY must ALWAYS run. Even if the user's first message contains details, you MUST use askQuestion to confirm the campaign name, offer, and channels. Never jump straight to PLAN.**

**RE-ENTRY AFTER PLAN CHANGES:** If the user's message is anything other than "Approve — generate the content" after you called `marketing-campaigns__campaignPlanPropose`, you are STILL in the PLAN phase. Adjust the plan per their request and call `marketing-campaigns__campaignPlanPropose` AGAIN with the revised plan. Do NOT call `skill({ action: 'list' })`. Do NOT restart from CLARIFY. Do NOT call `askQuestion`. Just revise and re-propose.

Detailed implementation for each phase lives in `templates/sections/`. When this skill.md says **"→ Read `templates/sections/NN-name.md`"**, read that file directly.

---

## Phase Instructions

**CLARIFY** → Read `templates/sections/01-clarify.md`
**PLAN** → Read `templates/sections/02-plan.md`
**VERIFY** → Read `templates/sections/03-verify.md`
**GENERATE** → Read `templates/sections/04-generate.md`
**SUMMARY** → Read `templates/sections/05-summary.md`

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
- Never generate assets before the user clicks "Approve — generate the content" on the plan card
- Never write plan details as chat text — always use `marketing-campaigns__campaignPlanPropose` tool
- Never interpret free-text messages like "looks good" as plan approval — only the Approve button counts
- Never call `marketing-campaigns__campaignPlanCreate` BEFORE content is generated — the card appears only in SUMMARY
- Never skip the VERIFY step — always check social connections before generating social content
- Never skip CLARIFY — always ask discovery questions even if the user gave details
- Never use `todoList` — the campaign card replaces that pattern
