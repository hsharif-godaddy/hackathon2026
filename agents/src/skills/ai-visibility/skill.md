---
name: ai-visibility
description: Check whether AI assistants (ChatGPT, Claude) mention or recommend the user's business, or test a specific user-supplied search query
switchboardFlag: aiVisibilityEnabled
whenToUse: >-
  User wants to know if AI chatbots or LLMs can find their business, or wants to test a specific query.
  Phrases: "Can LLMs find me?", "Can AI find my business?", "Do AI chatbots recommend me?",
  "Am I visible to AI assistants?", "AI visibility check", "does ChatGPT know about me?",
  "does Claude mention my business?", "AI citation check", "check my AI visibility",
  "what happens when someone searches X in ChatGPT", "does my business come up when someone asks Y",
  "how does my business show up on ChatGPT?", "does Claude mention me?",
  "check only ChatGPT", "check only Claude".
intents:
  - AI visibility/LLM citation/ChatGPT mentions
---

# AI Visibility Skill

**Purpose:** Query AI platforms to check whether the user's business is mentioned or recommended, then report back.

---

## When to Use This Skill

**User says:**

- "Can LLMs find me?"
- "Can AI find my business?"
- "Do AI chatbots recommend me?"
- "Does ChatGPT mention my business?"
- "Am I visible to AI assistants?"
- "Check my AI visibility"
- "Does my business come up when someone searches 'restaurants in Tempe, AZ'?"
- "What does ChatGPT say when someone asks for the best bakeries near me?"

---

## Flow

### Standard check (no specific query provided)

Call `ai-visibility__checkAiVisibility()`. Pass `location` and `vertical` if you know them from the conversation or prior context. The tool auto-generates 3–5 search queries tailored to the business (prompts cached for 10 min), runs each against ChatGPT and Claude in parallel, and returns the results.

### Single-platform check

When the user asks about a specific platform (e.g. "how does my business show up on ChatGPT?", "does Claude mention me?"), pass `platforms: ["chatgpt"]` or `platforms: ["claude"]`. This restricts queries to that platform only. The prompt cache is shared regardless of platform — platform queries always run fresh.

### Custom query (user provides a specific prompt)

When the user gives a specific query they want to test, pass `customPrompts: ["<the user's query>"]`. Combine with `platforms` if they also specify a platform — e.g. `{ customPrompts: ["best yoga studios in Austin"], platforms: ["chatgpt"] }`.

## Summarizing results

The tool returns `{ brandName, prompts, results }` where `results` is a flat list of `{ prompt, platform, response, error }` entries.

Your response must contain exactly two things:

1. **The queries that were run** — list the `prompts` array so the user can see what was searched.
2. **One summary per platform** — how many queries mentioned the business and any notable excerpts.

**Example response format:**

> I ran these 4 searches across ChatGPT and Claude for **Mesa Bakery**:
> - "best bakery in Mesa AZ"
> - "artisan sourdough bakery Mesa"
> - "where to buy sourdough in Mesa Arizona"
> - "Mesa Bakery reviews"
>
> **ChatGPT** ✅ — Mentioned in 3 of 4 queries. Consistently cited for artisan sourdough in Mesa, AZ.
> **Claude** ⚠️ — Not found in any of the queries.

**STOP after the platform summaries.** Do not add why the business was or wasn't found, recommendations, next steps, explanations of how AI models work, or calls to action.

---

## Notes

- Results reflect a single query at a single point in time — they are not exhaustive.
- Different queries produce different results; this is a directional signal, not a definitive score.
- If brand info is missing (no name set up), ask the user to describe their business before running the standard check. Custom queries do not require a brand name.
