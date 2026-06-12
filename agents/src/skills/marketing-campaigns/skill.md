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

13. **The PLAN education goes IN the tool call — populate every field** — `marketing-campaigns__campaignPlanPropose` has REQUIRED education fields you MUST fill: `assumptions` (3-4 things you inferred about their business — audience, goal, what to feature — phrased so they can correct a wrong guess), `whyThisMix` (one or two plain sentences on why these channels serve the goal and what each key asset does), and `expectation` (a rough, directional ballpark — never precise numbers). The plan card renders these as the customer-facing education, so they appear reliably without depending on prose. A brief one-line lead-in sentence before the tool call is fine, but the assumptions / why / expectation belong in the fields — do NOT omit them.

---

## Flow

```
CLARIFY  → ONE askQuestion call: what you're promoting + the goal ONLY (STOPS — MANDATORY, never skip). NO second round of questions. The agent PROPOSES the name, dates, duration, channel mix, and artifact type — none of those are asked. NEVER ask which channels or how long the campaign runs.
PLAN     → Trust-building intro that EDUCATES: surface assumptions (invite correction), state the goal + why marketing it this way matters, explain why EACH asset serves the goal (conversationally, not one cramped line), give a plain-language checklist of what they're getting, and set a rough/directional expectation (clearly-labeled ballpark ranges OK; never precise numbers as guarantees) → then marketing-campaigns__campaignPlanPropose: AI recommends the optimal channel mix, renders plan card with Approve/Change buttons (STOPS — programmatic)
VERIFY   → After user clicks "Approve": check prerequisites (social connections, blog section)
GENERATE → socialPostCreate (social posts) + email/ad inline FIRST (on marketing, which has the social tool) → THEN handoff to build the landing page + blogs (last; social must exist before the build handoff)
SUMMARY  → marketing-campaigns__campaignPlanCreate to save + show final card → suggestedResponse for next steps
```

**CRITICAL: CLARIFY must ALWAYS run. Even if the user's first message contains details, you MUST use askQuestion to capture what they're promoting and the goal. The name, dates, and channel mix are proposed by the AI in PLAN, not asked. Never jump straight to PLAN.**

**RE-ENTRY AFTER PLAN CHANGES:** If the user's message is anything other than "Approve — generate the content" after you called `marketing-campaigns__campaignPlanPropose`, you are STILL in the PLAN phase. Adjust the plan per their request and call `marketing-campaigns__campaignPlanPropose` AGAIN with the revised plan. Do NOT call `skill({ action: 'list' })`. Do NOT restart from CLARIFY. Do NOT call `askQuestion`. Just revise and re-propose.

The phase requirements you must follow are inlined below — **this skill.md is authoritative for behavior.** The `templates/sections/*.md` files are extended human-reference notes; do not rely on reading them at runtime.

---

## Phase requirements

**CLARIFY, VERIFY, GENERATE** follow the Flow above + the Execution Contract. The two phases below are spelled out in full because they carry the requirements most often missed.

### PLAN — fill the education fields on the tool call (this is where you build trust)

YOU decide the channel mix — the smallest set that achieves the goal, landing page always included. Then call `marketing-campaigns__campaignPlanPropose` with the full plan AND its REQUIRED education fields. The plan card renders these fields, so the owner sees the education **every time** — it does not depend on you writing prose:

- `assumptions`: 3-4 plain bullets of what you inferred (audience, main goal, what to feature), phrased so they can correct a wrong guess — e.g. `["Your audience is collectors and interior designers", "Your main goal is sales, not just awareness", "You want to feature the summer collection"]`.
- `whyThisMix`: one or two plain sentences — why these channels for their goal + what each asset does (landing page = one place to land and buy; blog = search traffic over weeks; social = reach your followers now).
- `expectation`: a rough, honest ballpark — e.g. `"A small first wave of visitors and a handful of early sales, with the blog building search traffic over the following weeks — real numbers depend on your audience and offer."` NEVER precise numbers.
- `assets`: the dated asset list (the card renders titles + dates).

A short one-line lead-in sentence before the tool call is fine; do NOT restate the asset list in chat. The tool STOPS the agent for Approve / Make changes.

### SUMMARY — save the card, be honest about status

After all generation, call `marketing-campaigns__campaignPlanCreate` to save and render the campaign card, then summarize what was built. **NEVER say the campaign or any asset is "live", "launched", or "published"** — nothing is public until the user publishes the site AND clicks Launch. Lead with **"built and ready to launch."** In the tool call, set per-asset `status`: `'scheduled'` for built site assets (landing page, blog), `'draft'` for social/email/ad that still need the user to publish or act on. Never `'published'`/`'sent'`.

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
- Never write the **dated asset list** (exact titles + dates) as chat text — that goes in the `marketing-campaigns__campaignPlanPropose` tool call, which renders it. The education (assumptions / why / expectation) also goes in that tool call's fields, not prose — see Execution Contract rule 13.
- Never call `marketing-campaigns__campaignPlanPropose` without populating its education fields (`assumptions`, `whyThisMix`, `expectation`) — that's where the customer-facing education lives and the card renders it (Execution Contract rule 13)
- Never interpret free-text messages like "looks good" as plan approval — only the Approve button counts
- Never call `marketing-campaigns__campaignPlanCreate` BEFORE content is generated — the card appears only in SUMMARY
- Never skip the VERIFY step — always check social connections before generating social content
- Never skip CLARIFY — always ask discovery questions even if the user gave details
- Never ask the user to choose channels in CLARIFY (no "Which channels?" question, menu, or chips) — the AI recommends the mix in the PLAN card; the user changes it there, or via "Make changes" after the plan is shown
- Never use `todoList` — the campaign card replaces that pattern
- Never present precise performance numbers as projections or guarantees (no "200 visits," "15 leads," "30% lift" stated as fact) — you do NOT have that data. A rough, directional expectation is good and expected (e.g. "a small first wave of visitors," "a handful of early sales," or a clearly-labeled ballpark range like "maybe a few dozen visitors in week one"); just frame it as an estimate that depends on their audience and offer, never a promise
- Never leave the `assumptions` field empty — surfacing what you inferred (and inviting correction) is how the user catches a wrong guess before any content is built
