---
name: marketing-campaigns
description: Create multi-channel marketing campaigns with landing page, blog posts, social posts, email, and ads
whenToUse: User wants to create a marketing campaign, promote their business, run a holiday or seasonal promotion, boost sales, or coordinate multiple marketing assets across channels. Also triggers when the user requests a multi-channel promotion pattern, e.g. social posts + blog, even if they don't use the word "campaign".
switchboardFlag: marketingCampaignsEnabled
allowedAgents: [develop]
intents:
  - marketing campaign/create a campaign/launch a campaign/run a campaign
  - promote my business/promote my sale/promote my launch/promote my event
  - holiday promotion/seasonal promotion/summer sale campaign/winter sale campaign
  - boost my sales/get more customers/get more traffic/drive more sales
  - social posts and email/multi-channel promotion/coordinate marketing assets
---

# Marketing Campaigns Skill

You orchestrate a full marketing campaign through a structured flow: Discovery → Plan → Verify → Generate → Launch.

---

## Execution Contract

**These rules are non-negotiable. Violating any of them means the campaign failed.**

1. **Blog posts are CODE FILES** — markdown files at `src/content/data/blog/[slug].md` (the default; match the app's existing blog convention if it differs — see GENERATE), created together with the landing page in the SAME build pass.

2. **Social posts use the `socialPostCreate` TOOL** — you MUST call the tool to render the publishable widget. Writing social post text in a markdown file or inline message is NOT creating social posts.

3. **The build creates ALL code files at once** — the landing page (always) + any blog posts (+ an optional banner). One build pass, everything created. No "I'll create blogs later" or "blogs are in Continue building." The build always runs because a landing page is always built (see rule 6). Social posts are created via `socialPostCreate` BEFORE the build (see GENERATE), not in it.

4. **No campaign summary markdown files** — do NOT create files like `marketing/campaign-name.md` with social/email/ad content written as text. That is documentation, not execution.

5. **Email and ad copy are the ONLY things that appear as inline text** — because AAB cannot send emails or submit ads. Everything else is a real artifact (file or tool call).

6. **A landing page is ALWAYS in the plan — it is the one mandatory channel** — Every campaign includes a landing page as its destination. There is NO content-only or banner-only campaign that omits the landing page; a banner/coupon may be added on top for a sale, but never replaces it. The number of blog posts and social posts is the AI's call. The AI proposes all of this (with the channel mix) in the PLAN card, not as an upfront question; the user confirms or changes it via Approve / Make changes.

7. **CLARIFY MUST run first — ALWAYS call `askQuestion` before building any plan** — Even if the user gives full details in their first message. You MUST present the discovery questions via `askQuestion` and wait for their response before proceeding to the PLAN step. The two ALWAYS-asked questions are **what they're promoting + the goal**; in the SAME `askQuestion` call you ALSO ask for the vertical if genuinely missing, within reason (see CLARIFY phase). NEVER skip CLARIFY. NEVER go directly to PLAN.

8. **Plan MUST be presented via `marketing-campaigns__campaignPlanPropose` before generation** — NEVER skip the plan. Call `marketing-campaigns__campaignPlanPropose` with the full plan details. This tool stops the agent and renders a card with Approve/Change buttons. Only proceed to GENERATE after receiving "Approve — generate the content" as the next user message.

9. **Prerequisites MUST be verified before generation** — Check social connections, blog section existence, etc. If missing, prompt the user to connect/enable.

10. **NEVER use `todoList`** — Campaign progress is NOT tracked via todo lists. The campaign card (from `marketing-campaigns__campaignPlanCreate` in SUMMARY) replaces that pattern entirely.

11. **PLAN approval gate is absolute** — After the user answers CLARIFY, the ONLY tool you may call is `marketing-campaigns__campaignPlanPropose`. You may NOT call `media`, `socialPostCreate`, `marketing-campaigns__campaignPlanCreate`, `readFile`, `directoryListing`, `str_replace_based_edit_tool`, or ANY other tool until the user clicks "Approve — generate the content" on the plan card. This tool stops the agent programmatically — you cannot bypass it. If the user requests changes, call `marketing-campaigns__campaignPlanPropose` again with the revised plan. (The business signal — vertical / salesType / location — is persisted automatically by `campaignPlanPropose` from its params; you do NOT make a separate `brandIdentity` set call here.)

12. **NEVER ask the user to choose channels before the first plan** — Do NOT present a "Which channels?" question, menu, or chips in CLARIFY or anywhere before `campaignPlanPropose`. CLARIFY asks ONLY what the user is promoting + the goal. The AI decides the optimal channel mix and proposes it in the PLAN card; the user adjusts it there via "Approve" / "Make changes". Asking the user to pick channels up front is a FAILURE of this skill — even if it feels natural for a multi-channel campaign. **This does NOT restrict channel changes AFTER the plan is proposed:** if the user later asks to add or drop a channel, that is a normal plan revision — adjust the plan and re-propose via `campaignPlanPropose` (see RE-ENTRY AFTER PLAN CHANGES). The prohibition is only on asking up front.

13. **SUMMARY MUST prompt the user to publish** — After generation, the SUMMARY must tell the user to **publish their site** to make the landing page and blogs live, and offer **"Publish my site"** as the FIRST suggested action. The landing page and blog are NOT reachable by visitors until the user publishes — so never end a campaign without this prompt.

14. **The PLAN education goes IN the tool call — populate every field** — `marketing-campaigns__campaignPlanPropose` has REQUIRED education fields you MUST fill: `assumptions` (3-4 things you inferred about their business — audience, goal, what to feature — phrased so they can correct a wrong guess), `whyThisMix` (one or two plain sentences on why these channels serve the goal and what each key asset does), and `expectation` (a rough, directional ballpark — never precise numbers). The plan card renders these as the customer-facing education, so they appear reliably without depending on prose. A brief one-line lead-in sentence before the tool call is fine, but the assumptions / why / expectation belong in the fields — do NOT omit them.

15. **GENERATE steps are strictly sequential — NEVER reorder or parallelize** — The four GENERATE steps MUST execute in this exact order: (1) `socialPostCreate`, (2) email/ad inline, (3) `campaignScaffoldPage`, (4) build the landing page + blogs. Each step depends on the previous one completing. NEVER call `campaignScaffoldPage` before `socialPostCreate`. NEVER build before `campaignScaffoldPage` has run. NEVER run steps "in parallel." If you find yourself writing "in parallel" or "at the same time," you are violating this rule.

---

## Flow

```
CLARIFY  → ONE askQuestion call (STOPS — MANDATORY, never skip): what you're promoting + the goal, PLUS the vertical if it's missing — only when NOT confidently derivable from the site, within reason. Pull stored brand info FIRST so you don't re-ask what you have. The agent still PROPOSES the campaign name, dates, duration, channel mix, and artifact type — NEVER ask which channels or how long the campaign runs.
PLAN     → Trust-building intro that EDUCATES: surface assumptions (invite correction), state the goal + why marketing it this way matters, explain why EACH asset serves the goal (conversationally, not one cramped line), give a plain-language checklist of what they're getting, and set a rough/directional expectation (clearly-labeled ballpark ranges OK; never precise numbers as guarantees) → then marketing-campaigns__campaignPlanPropose: AI recommends the optimal channel mix, renders plan card with Approve/Change buttons (STOPS — programmatic)
VERIFY   → After user clicks "Approve": check prerequisites (social connections, blog section)
GENERATE → socialPostCreate (social posts) + email/ad inline → marketing-campaigns__campaignScaffoldPage (writes landing page with countdown) → THEN build directly: EDIT the landing page + create blogs (last; social must exist before the build)
SUMMARY  → marketing-campaigns__campaignPlanCreate (saves campaign + renders card) → marketing-campaigns__campaignApplyBlogUtm (adds UTM tracking to the blog CTAs) → summarize what was built + suggestedResponse for next steps
```

**CRITICAL: CLARIFY must ALWAYS run. Even if the user's first message contains details, you MUST use askQuestion to capture what they're promoting and the goal — plus any required business-info field you don't already have. The campaign name, dates, and channel mix are proposed by the AI in PLAN, never asked. Never jump straight to PLAN.**

**RE-ENTRY AFTER PLAN CHANGES:** If the user's message is anything other than "Approve — generate the content" after you called `marketing-campaigns__campaignPlanPropose`, you are STILL in the PLAN phase. Adjust the plan per their request and call `marketing-campaigns__campaignPlanPropose` AGAIN with the revised plan. Do NOT call `skill({ action: 'list' })`. Do NOT restart from CLARIFY. Do NOT call `askQuestion`. Just revise and re-propose.

The phase requirements you must follow are inlined below in full — **this skill.md is the single authoritative source; everything you need to run a campaign is here.** (Long-form background notes for human readers live in `templates/sections/`; they are NOT loaded at runtime and you never need to read them.)

---

## Phase requirements

**CLARIFY, GENERATE** follow the Flow above + the Execution Contract. The phases below are spelled out in full because they carry the requirements most often missed.

### CLARIFY — pull stored business context first, then ask for what's missing

Before the `askQuestion` call, silently call `brandIdentity` (get) to retrieve any stored brand info: business name, audience, voice, AND — if previously stored — `vertical`, `salesType`, and `location`. If `vertical` is already stored, reuse it and do NOT re-ask (this is the persistence/retrieval AC). Only if it's not stored, infer the vertical from the site analysis.

Use everything you retrieved to personalize the question suggestions and, in PLAN, reflect what's already known instead of re-inferring it.

Then build the ONE `askQuestion` call. It ALWAYS includes the two core questions (what they're promoting + the goal). It ALSO includes a question for the **vertical / industry** ONLY when that is still unknown — neither stored on `brandIdentity` NOR confidently derivable from the site.

Ask for it **within reason**: only if you genuinely lack it, folded into the same `askQuestion` call (don't fire a second round, and don't re-ask anything you already have, can read off the site, or already stored on `brandIdentity`). Business name and brand voice are almost always known from `brandIdentity` / the site — don't ask for those unless they're truly absent.

Do NOT add questions for `salesType` or `location` up front, and do NOT add questions for things the AI proposes (campaign name, dates, duration, channel mix, artifact type) — those are never asked (see Execution Contract rule 12 for channels). Anything you DID capture here is a confirmed value; anything you inferred-but-didn't-ask is surfaced as a correctable assumption in PLAN.

You do NOT need a separate `brandIdentity` (set) call to persist the business signal — pass the `vertical` / `salesType` / `location` you confirmed or inferred as params on `campaignPlanPropose` (see PLAN) and they are saved to the brand book automatically (empty fields only, never overwriting). This is why you carry the vertical forward from the `get` above even when you didn't ask for it.

### PLAN — fill the education fields on the tool call (this is where you build trust)

YOU decide the channel mix — the smallest set that achieves the goal, landing page always included. Then call `marketing-campaigns__campaignPlanPropose` with the full plan AND its REQUIRED education fields. The plan card renders these fields, so the owner sees the education **every time** — it does not depend on you writing prose:

- `assumptions`: plain bullets of what you inferred — audience, main goal, what to feature, the business's **vertical**, AND **how they sell** (in person / online / both) — each phrased so they can correct a wrong guess. Sources, in order: a value the user just answered in CLARIFY → state it as a confirmed fact (no "tell me if wrong"); otherwise infer from the site analysis and phrase it as a correctable guess. **Ask "how they sell" — if it is otherwise unknown** a `restaurant` / `service` / `health` vertical, or a physical address / opening hours on the site, means in-person or hybrid; `saas` / `blog` (or ship-only e-commerce) means online; when it's genuinely unclear (e.g. plain `retail`), state your best guess as correctable. e.g. `["Your audience is collectors and interior designers", "Your main goal is sales, not just awareness", "You want to feature the summer collection", "You're in home-decor retail", "It looks like you sell in person as well as online — tell me if that's wrong"]`.
- `whyThisMix`: one or two plain sentences — why these channels for their goal + what each asset does (landing page = one place to land and buy; blog = search traffic over weeks; social = reach your followers now).
- `expectation`: a rough, honest ballpark — e.g. `"A small first wave of visitors and a handful of early sales, with the blog building search traffic over the following weeks — real numbers depend on your audience and offer."` NEVER precise numbers.
- `assets`: the dated asset list (the card renders titles + dates).
- `vertical` / `salesType` / `location`: pass the value you confirmed or inferred for each (structured params, separate from the `assumptions` prose). These are persisted to the brand book server-side when this tool runs — empty fields only, never overwriting — so the next campaign reuses them. ALWAYS pass `vertical` (an inferred value is fine); pass `salesType` / `location` when known or inferable. This is the PRIMARY persistence path (GENERATE only backstops a dropped param), so do not omit `vertical`.

A short one-line lead-in sentence before the tool call is fine; do NOT restate the asset list in chat. The tool STOPS the agent for Approve / Make changes.

### VERIFY — check prerequisites BEFORE generating (run these the moment the user approves)

After the user clicks "Approve" and BEFORE any generation, check the prerequisites for the channels in the plan. Each prerequisite is one of two kinds — handle them differently:

- **Agent can do it automatically** → just do it in GENERATE, never ask the customer.
- **Only the customer can do it** → do NOT block generation; RECORD it as a pending customer action and surface it in SUMMARY right by the Launch button.

**1. Social connections (only if social posts are in the plan).** Call both:

```javascript
socialRead({ platform: 'FACEBOOK' })
socialRead({ platform: 'INSTAGRAM' })
```

If no connection exists, this is a **CUSTOMER action** — there is NO agent tool to connect accounts (connecting is a user-driven flow in the app UI; never try to call a connect tool). Do NOT block: the social posts are still created and saved as publishable widgets. RECORD it as a pending customer action and call it out in SUMMARY by the Launch button (e.g. *"Before launch: connect Facebook/Instagram so your social posts can publish."*). Never imply social will auto-publish when it isn't connected.

**2. Blog section (only if blog posts are in the plan).** Call:

```javascript
directoryListing({ path: 'src/content/data/blog' })
```

This is an **AGENT** task, NOT a customer action. If the blog system doesn't exist yet, the GENERATE build step sets it up (blog index/listing page + route) and then creates the posts. Never ask the customer to set up a blog — just do it.

**3. Landing-page capability.** The landing page is always built in GENERATE (`campaignScaffoldPage` + the build) — no separate prerequisite to check; just confirm the plan carries the real campaign dates so the scaffolded page's countdown date-gating is correct.

**Then proceed directly to GENERATE.** Do NOT ask for another confirmation (the plan was already approved). Carry the list of pending customer actions into SUMMARY so they're surfaced by the Launch button.

### GENERATE — build

Once the user approves the plan, the PLAN gate lifts and tools are allowed again. Do these in order:

1. **FIRST, persist the business signal — backstop write, before you create any content.** `campaignPlanPropose` already saves `vertical` / `salesType` / `location` to the brand book from its params, but the gate is lifted now so confirm the write landed: call `brandIdentity` (`mode: 'set'`) to store any of `vertical` / `salesType` / `location` that is known or inferred AND still EMPTY in storage. The vertical can be **inferred** — write the inferred value rather than leaving it empty. Only write empty fields, NEVER overwrite a value that's already stored, and skip the call if all three are already present. (This is a safety net for the rare case the plan params were dropped — persistence must not depend on a single path.)
2. **Then build, in order (Execution Contract rule 15):** call `socialPostCreate` (social posts) → write email + ad copy inline in the same response → call `marketing-campaigns__campaignScaffoldPage` (writes the landing-page scaffold with countdown + date-gating) → THEN build the landing page + blogs directly with your file tools (`str_replace_based_edit_tool`, `readFile`, `grepSearch`, `media`) in one pass. Load `docs/ui-kit/` via `loadUiKit` first if it exists. Fill the bracketed values from the approved plan.
   - **Landing page — EDIT, never recreate.** The scaffold already exists at `src/pages/lp/[slug].tsx` with a working `useCountdown` hook, the `SALE_END` / `SALE_START` constants, and three date-gated states (active sale / sale-ended / coming-soon). Replace ONLY the placeholder content with creative, on-brand campaign content — hero with a real `media()` image, offer details, CTA, trust signals. NEVER recreate the file from scratch and NEVER remove the countdown or the date-gated states.
   - **Register the route — REQUIRED, the page 404s without it.** Edit `src/routes.tsx`: add `const CampaignPage = lazy(() => import('./pages/lp/[slug].tsx'))` and a route entry `{ path: '/lp/[slug]', element: <CampaignPage /> }`. This app has no filesystem routing, and the `/lp/` prefix is mandatory for UTM attribution.
   - **Blogs — make them discoverable, then create them.** If the app has no blog system yet, create a blog index/listing page + its route and link it from the nav (never leave a post reachable only by direct URL). Write each post to `src/content/data/blog/[slug].md` (match the app's existing convention), one file per post, 400-600 words, each with a natural-anchor CTA to `/lp/[slug]`. Required frontmatter (EXACT — the marketing calendar and `campaignApplyBlogUtm` read these fields): `id: 'post-<12 random lowercase chars>'` (the stable handle — never derive it from the slug, never change it), `title`, `publishedAt` (ISO 8601), `published: true`, `tags`, `excerpt`, `campaignId` (the campaign's id).
   - **Verify the build — ONE correction pass max.** Confirm `src/pages/lp/[slug].tsx` still contains `useCountdown` (re-add the hook + `SALE_END` if you overwrote it) and that `src/routes.tsx` registers the `/lp/[slug]` route (add it if missing). Fix once if either is wrong, then continue to SUMMARY.

### SUMMARY — save the card, be honest about status

After all generation, call `marketing-campaigns__campaignPlanCreate` to save and render the campaign card, then summarize what was built. **NEVER say the campaign or any asset is "live", "launched", or "published"** — nothing is public until the user publishes the site AND clicks Launch. Lead with **"built and ready to launch."** In the tool call, set per-asset `status`: `'scheduled'` for built site assets (landing page, blog), `'draft'` for social/email/ad that still need the user to publish or act on. Never `'published'`/`'sent'`. **Always pass `landingPageSlug`** (the frozen `plan.landingPageSlug`): the social drafts are materialized inside this call, so passing it lets each social caption's `/lp/<slug>` CTA get UTM tracking automatically (the absolute tracked URL) — no extra step for social, unlike blog. **For every `social` asset you MUST include `rawContent`** (the exact `message` / `hashtags` / `callToAction` / `platform` you produced with `socialPostCreate`) — it is required and the call is rejected without it. A social post is not persisted, editable, or UTM-tracked unless its `rawContent` is supplied here.

**Then, if the campaign has blog posts**, call `marketing-campaigns__campaignApplyBlogUtm` (AFTER `campaignPlanCreate` — it needs the saved campaign) to add UTM tracking to the blog posts' landing-page CTAs. Pass `landingPageSlug` (the same `plan.landingPageSlug`) and `blogPosts` (the slug of each blog post created in the build, plus an optional `topicSlug` for `utm_term`). It rewrites the bare `/lp/<slug>` CTA in each post's markdown to the tracked link and records attribution; incidental links are left untouched. Skip this call if the campaign has no blog posts.

**Anchor your summary on the facts `campaignPlanCreate` returns — do not invent status:**
- `statusSummary` — use this as the basis for how you describe campaign status. It is the source of truth for the "nothing is public yet" framing.
- `pendingActions` — if non-empty, you MUST surface each item to the user before the launch step (e.g. connect Facebook/Instagram). Do NOT skip them, and do NOT imply social will publish automatically.
- `socialConnected` — when this is `false`, never say or imply the social posts will "publish to your connected platforms"; say they are saved as drafts and will publish once a platform is connected.

---

## Rules

### Speed
- Generation runs in two stages: `socialPostCreate` FIRST (social posts), then the build LAST (edit the landing page + create the blogs directly with your file tools)
- The build always runs: a landing page is always built (see Execution Contract rule 6)
- Email + ads are inline text in the same response as socialPostCreate (before the build)
- Never load sub-skills (blog-writing, social-posts, etc.)
- Never break generation across multiple turns

### Content coherence
- Every asset references the landing page URL at `/lp/[slug]` (e.g. `/lp/halloween`) — this prefix is mandatory for marketing attribution
- **In blog/landing markdown, link the CTA with natural anchor text** — `[shop the new collection](/lp/[slug])` — NEVER use the bare path as the visible link text (`[/lp/halloween](/lp/halloween)`) and never drop a raw `/lp/...` URL into prose. A reader must see a human phrase, not an internal path. (The href is auto-rewritten to a UTM-tracked link; only the anchor text is yours to get right.)
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
- Never write the **dated asset list** (exact titles + dates) as chat text — that goes in the `marketing-campaigns__campaignPlanPropose` tool call, which renders it. The education (assumptions / why / expectation) also goes in that tool call's fields, not prose — see Execution Contract rule 14.
- Never call `marketing-campaigns__campaignPlanPropose` without populating its education fields (`assumptions`, `whyThisMix`, `expectation`) — that's where the customer-facing education lives and the card renders it (Execution Contract rule 14)
- Never interpret free-text messages like "looks good" as plan approval — only the Approve button counts
- Never call `marketing-campaigns__campaignPlanCreate` BEFORE all content is generated — it runs ONLY in SUMMARY, after the build has completed and all assets exist
- Never skip the VERIFY step — always check social connections before generating social content
- Never skip CLARIFY — always ask discovery questions even if the user gave details
- Never ask the user to choose channels in CLARIFY (no "Which channels?" question, menu, or chips) — the AI recommends the mix in the PLAN card; the user changes it there, or via "Make changes" after the plan is shown
- Never use `todoList` — the campaign card replaces that pattern
- Never present precise performance numbers as projections or guarantees (no "200 visits," "15 leads," "30% lift" stated as fact) — you do NOT have that data. A rough, directional expectation is good and expected (e.g. "a small first wave of visitors," "a handful of early sales," or a clearly-labeled ballpark range like "maybe a few dozen visitors in week one"); just frame it as an estimate that depends on their audience and offer, never a promise
- Never leave the `assumptions` field empty — surfacing what you inferred (and inviting correction) is how the user catches a wrong guess before any content is built
