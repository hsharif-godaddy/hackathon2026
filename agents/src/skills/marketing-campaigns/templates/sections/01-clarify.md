# CLARIFY Phase

**MANDATORY: You MUST ask the user these questions before building any plan. Do NOT skip this step even if the user's initial message contains some details. Always confirm with the user.**

Use `askQuestion` ONCE to gather only what the agent genuinely needs FROM THE USER: **what they're promoting** and **the goal**. Make a SINGLE askQuestion call with exactly these two questions, then go STRAIGHT to PLAN. Do NOT ask a second round of questions. Do NOT ask for the campaign **name**, the **dates** or **how long it should run**, the **channels**, the artifact type, a follow-up **deal/offer** question, or budget — ALL of those are the agent's job to propose in PLAN (the user can change any of them there). The `questions` array below has two entries on purpose; do not extend it and do not follow it with another askQuestion.

```javascript
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
    }
  ]
})
```

Adapt the suggestions to the site analysis and the user's message. If they sell tropical fruits → the "what are you promoting" chips might be "Summer mango box", "Tropical sampler", "The shop overall"; keep the goal chips framed as business outcomes (more sales, a strong launch, local visibility).

**This stops the agent.** Wait for the user to answer all questions before proceeding to PLAN.

**Required info to gather:** what they're promoting + the goal — and NOTHING else. The agent PROPOSES the campaign name, the dates, AND how long it runs; do NOT ask the user for any of these — in particular, NEVER ask "how long should the campaign run?" (propose a sensible duration in PLAN; the user changes it there). Do NOT ask the user to pick channels, in any form (no "Which channels?" question, no channel menu/chips like "Social posts + blog" or "All channels"). The optimal channel mix is the AI's call, recommended in the PLAN step, where the user adjusts it via "Approve" / "Make changes". Asking channels here is the single most common failure of this skill — if you feel the urge to add a channels question, STOP: it belongs in PLAN, not CLARIFY. (Channel changes are fully allowed AFTER the plan is proposed — that's the revision loop, not an upfront question.) Dates are also inferred from campaign type in PLAN (user can change them).

## Context to pull (silently, before asking questions)

Call `brandIdentity` + `appPlan` to get business name, type, audience, voice. Use this to personalize the question suggestions — but still ASK the user to confirm.

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
