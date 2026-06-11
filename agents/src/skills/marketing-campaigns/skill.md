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

3. **The handoff to DevelopAgent creates ALL code files at once** — the landing page (always) + any blog posts (+ an optional banner). One handoff, everything built. No "I'll create blogs later" or "blogs are in Continue building." The handoff always runs because a landing page is always built (see rule 6). Social posts are created via `socialPostCreate` BEFORE this handoff (see GENERATE), not in it.

4. **No campaign summary markdown files** — do NOT create files like `marketing/campaign-name.md` with social/email/ad content written as text. That is documentation, not execution.

5. **Email and ad copy are the ONLY things that appear as inline text** — because AAB cannot send emails or submit ads. Everything else is a real artifact (file or tool call).

6. **A landing page is ALWAYS in the plan — it is the one mandatory channel** — Every campaign includes a landing page as its destination. There is NO content-only or banner-only campaign that omits the landing page; a banner/coupon may be added on top for a sale, but never replaces it. The number of blog posts and social posts is the AI's call. The AI proposes all of this (with the channel mix) in the PLAN card, not as an upfront question; the user confirms or changes it via Approve / Make changes.

7. **CLARIFY MUST run first — ALWAYS call `askQuestion` before building any plan** — Even if the user gives full details in their first message. You MUST present the discovery questions (what they're promoting + the goal) via `askQuestion` and wait for their response before proceeding to the PLAN step. NEVER skip CLARIFY. NEVER go directly to PLAN.

8. **Plan MUST be presented via `marketing-campaigns__campaignPlanPropose` before generation** — NEVER skip the plan. Call `marketing-campaigns__campaignPlanPropose` with the full plan details. This tool stops the agent and renders a card with Approve/Change buttons. Only proceed to GENERATE after receiving "Approve — generate the content" as the next user message.

9. **Prerequisites MUST be verified before generation** — Check social connections, blog section existence, etc. If missing, prompt the user to connect/enable.

10. **NEVER use `todoList`** — Campaign progress is NOT tracked via todo lists. The campaign card (from `marketing-campaigns__campaignPlanCreate` in SUMMARY) replaces that pattern entirely.

11. **PLAN approval gate is absolute** — After the user answers CLARIFY, the ONLY tool you may call is `marketing-campaigns__campaignPlanPropose`. You may NOT call `media`, `handoff`, `socialPostCreate`, `marketing-campaigns__campaignPlanCreate`, `readFile`, `directoryListing`, or ANY other tool until the user clicks "Approve — generate the content" on the plan card. This tool stops the agent programmatically — you cannot bypass it. If the user requests changes, call `marketing-campaigns__campaignPlanPropose` again with the revised plan.

12. **NEVER ask the user to choose channels before the first plan** — Do NOT present a "Which channels?" question, menu, or chips in CLARIFY or anywhere before `campaignPlanPropose`. CLARIFY asks ONLY what the user is promoting + the goal. The AI decides the optimal channel mix and proposes it in the PLAN card; the user adjusts it there via "Approve" / "Make changes". Asking the user to pick channels up front is a FAILURE of this skill — even if it feels natural for a multi-channel campaign. **This does NOT restrict channel changes AFTER the plan is proposed:** if the user later asks to add or drop a channel, that is a normal plan revision — adjust the plan and re-propose via `campaignPlanPropose` (see RE-ENTRY AFTER PLAN CHANGES). The prohibition is only on asking up front.

---

## Flow

```
CLARIFY  → ONE askQuestion call: what you're promoting + the goal ONLY (STOPS — MANDATORY, never skip). NO second round of questions. The agent PROPOSES the name, dates, duration, channel mix, and artifact type — none of those are asked. NEVER ask which channels or how long the campaign runs.
PLAN     → Brief trust-building intro (surface your assumptions and invite correction, state the goal + why-this-mix in plain language, set expectations honestly with NO invented numbers) → then marketing-campaigns__campaignPlanPropose: AI recommends the optimal channel mix, renders plan card with Approve/Change buttons (STOPS — programmatic)
VERIFY   → After user clicks "Approve": check prerequisites (social connections, blog section)
GENERATE → socialPostCreate (social posts) + email/ad inline FIRST (on marketing, which has the social tool) → THEN handoff to build the landing page + blogs (last; social must exist before the build handoff)
SUMMARY  → marketing-campaigns__campaignPlanCreate to save + show final card → suggestedResponse for next steps
```

**CRITICAL: CLARIFY must ALWAYS run. Even if the user's first message contains details, you MUST use askQuestion to capture what they're promoting and the goal. The name, dates, and channel mix are proposed by the AI in PLAN, not asked. Never jump straight to PLAN.**

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
- Two tool calls for generation: `socialPostCreate` (FIRST — social posts) + `handoff` (LAST — builds the landing page + blogs)
- The handoff always runs: a landing page is always built (see Execution Contract rule 6)
- Email + ads are inline text in the same response as socialPostCreate (before the build handoff)
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
- Never silently assume the artifact type — propose it (with the channel mix and a one-line rationale) in the PLAN card so the user can confirm or change it
- Never generate assets before the user clicks "Approve — generate the content" on the plan card
- Never write plan details as chat text — always use `marketing-campaigns__campaignPlanPropose` tool
- Never interpret free-text messages like "looks good" as plan approval — only the Approve button counts
- Never call `marketing-campaigns__campaignPlanCreate` BEFORE content is generated — the card appears only in SUMMARY
- Never skip the VERIFY step — always check social connections before generating social content
- Never skip CLARIFY — always ask discovery questions even if the user gave details
- Never ask the user to choose channels in CLARIFY (no "Which channels?" question, menu, or chips) — the AI recommends the mix in the PLAN card; the user changes it there, or via "Make changes" after the plan is shown
- Never use `todoList` — the campaign card replaces that pattern
- Never invent specific performance numbers (visits, leads, sales, conversion %, "X% lift") — you do NOT have that data. Set expectations qualitatively (direction + hours of work saved); fabricated metrics destroy customer trust
- Never skip the assumptions intro before the plan card — surfacing what you inferred (and inviting correction) is how the user catches a wrong guess before any content is built
