# CLARIFY Phase

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

## Context to pull (silently, before asking questions)

Call `brandIdentity` + `appPlan` to get business name, type, audience, voice. Use this to personalize the question suggestions — but still ASK the user to confirm.

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
