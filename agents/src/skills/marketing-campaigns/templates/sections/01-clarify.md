# CLARIFY Phase

**MANDATORY: You MUST ask the user these questions before building any plan. Do NOT skip this step even if the user's initial message contains some details. Always confirm with the user.**

Use `askQuestion` ONCE. It ALWAYS asks two things — **what they're promoting** and **the goal**. It ALSO asks for the **vertical / industry** when that's still missing after pulling brand context (see "Context to pull" below) — but ONLY if it's NOT already known and NOT confidently derivable from the site analysis. Within reason: include it only if genuinely missing, in this SINGLE askQuestion call, then go STRAIGHT to PLAN — do NOT fire a second round. Do NOT ask for the campaign **name**, the **dates** or **how long it should run**, the **channels**, the artifact type, or budget — ALL of those are the agent's job to propose in PLAN (the user can change any of them there). The example below shows the two core questions plus the optional vertical question; drop the vertical question if you already have it.

```javascript
// Pull brandIdentity FIRST. Keep the two core questions ALWAYS.
// Append a business-info question ONLY for a field that's still unknown
// (not known, not derivable from the site) — drop the ones you already have.
// Never add a question for anything the AI proposes (the mix, the dates, the duration).
askQuestion({
  questions: [
    {
      question: "What are you promoting with this campaign?",
      type: "chips_single",
      multiSelect: false,
      allowOther: true,
      suggestions: [
        { text: "[Top product/service inferred from the site]" },
        { text: "[A specific collection or category]" },
        { text: "The business overall — general awareness" }
      ]
    },
    {
      question: "What would you like this to achieve?",
      type: "chips_single",
      multiSelect: false,
      allowOther: true,
      suggestions: [
        { text: "Get more customers / sales" },
        { text: "Build buzz for a launch" },
        { text: "Drive foot traffic / local visibility" }
      ]
    },
    // ↓↓ INCLUDE ONLY IF MISSING — omit if the vertical is already derivable from the site ↓↓
    {
      question: "What kind of business is this?", // → vertical (omit if known)
      type: "chips_single",
      multiSelect: false,
      allowOther: true,
      suggestions: [
        { text: "Retail / shop" },
        { text: "Restaurant / food" },
        { text: "Service business" },
        { text: "Health / wellness" }
      ]
    }
  ]
})
```

Adapt the suggestions to the site analysis and the user's message. If they sell tropical fruits → the "what are you promoting" chips might be "Summer mango box", "Tropical sampler", "The shop overall"; keep the goal chips framed as business outcomes (more sales, a strong launch, local visibility).

**This stops the agent.** Wait for the user to answer all questions before proceeding to PLAN.

**Required info to gather:** what they're promoting + the goal (always), plus the vertical if you couldn't infer it from the site. The agent still PROPOSES the campaign name, the dates, AND how long it runs; do NOT ask the user for any of these — in particular, NEVER ask "how long should the campaign run?" (propose a sensible duration in PLAN; the user changes it there). Do NOT ask the user to pick channels, in any form (no "Which channels?" question, no channel menu/chips like "Social posts + blog" or "All channels"). The optimal channel mix is the AI's call, recommended in the PLAN step, where the user adjusts it via "Approve" / "Make changes". Asking channels here is the single most common failure of this skill — if you feel the urge to add a channels question, STOP: it belongs in PLAN, not CLARIFY. (Channel changes are fully allowed AFTER the plan is proposed — that's the revision loop, not an upfront question.) Dates are also inferred from campaign type in PLAN (user can change them).

## Context to pull (silently, before asking questions)

Call `brandIdentity` (get) to retrieve business name, audience, voice, AND — if previously stored — `vertical`, `salesType`, and `location`. This decides whether you still need the vertical question: if `vertical` is already stored on `brandIdentity`, reuse it and DROP its question (never re-ask a stored value); likewise if it's obvious from the site analysis, treat it as known and reflect it in the PLAN intro instead. Only ask the vertical when it's neither stored NOR derivable. The `vertical` / `salesType` / `location` are persisted to the brand book automatically when `campaignPlanPropose` runs in PLAN (you pass them as params; a backstop `brandIdentity` set in GENERATE covers the rare dropped-param case), so a later campaign reuses them. Use whatever you did retrieve to personalize the remaining question suggestions.

When it helps the user trust the recommendation, briefly reflect what you learned in plain language alongside your questions — e.g. *"From your site, it looks like you sell curated antique china to collectors and designers."* Keep it to 1–2 sentences, plain English, no marketing jargon. The goal is for the user to feel understood before you propose a plan.

## Scheduling heuristics (used internally to compute dates for the plan)

Given N posts and campaign window [start, end]:
- **Blogs**: Space evenly starting 2-3 days before campaign start
- **Social**: Space evenly across window, first 1-2 days before start, last on final day
- **Emails**: First on day 1, last 1 day before end, middle spaced evenly

## Count defaults (by campaign duration)

| Duration | Blogs | Social | Emails |
|----------|-------|--------|--------|
| 1-3 days | 1 | 2 | 1 |
| 4-7 days | 2 | 3 | 2 |
| 8-14 days | 3 | 5 | 3 |
