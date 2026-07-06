# AI Visibility Skill

## Overview

The `ai-visibility` skill lets a user ask whether AI assistants (ChatGPT, Claude) mention or recommend their business, or test a specific query they have in mind. The agent queries both platforms via CaaS and summarizes the results.

This is a **POC/directional signal** — results reflect a single query at a point in time, not a comprehensive audit.

## Trigger phrases

- "Can LLMs find my business?"
- "Does ChatGPT know about me?"
- "Check my AI visibility"
- "Do AI chatbots recommend me?"
- "Does my business come up when someone searches 'restaurants in Tempe, AZ'?"

See `skill.md` `whenToUse` for the full list.

## Flow

```
User prompt
    │
    ▼
Agent loads ai-visibility skill
    │
    ▼
checkAiVisibility tool
    ├── Reads brand.identity + brand.summary from KV memory store
    ├── Standard: Calls Claude Haiku to generate 3–5 search queries tailored to the business type (prompts cached 10 min)
    │   Custom:  Uses the user-provided customPrompts directly (skips Haiku, no caching)
    ├── Runs each query against ChatGPT (gpt-4o) and Claude (fast tier) in parallel
    └── Returns { brandName, prompts, results: [{ prompt, platform, response, error }] }
    │
    ▼
Agent synthesizes across all results and tells the user:
    - Per-platform verdict: how many queries mentioned the business
    - Notable excerpts
    - Actionable suggestions if not found
    - prompts field available when user asks "what queries were used?"
```

## Tool parameters

| Parameter | Type | Description |
|---|---|---|
| `customPrompts` | `string[]` (optional, max 5, each max 500 chars) | User-provided queries to run instead of auto-generating. Bypasses Haiku and the result cache. Does not require a brand name. |
| `platforms` | `('chatgpt' \| 'claude')[]` (optional) | Restrict which platforms to query. Omit to query both. Use `["chatgpt"]` or `["claude"]` when the user asks about a specific platform. |

## Tool return shape

```typescript
{
  brandName: string;
  prompts: string[];   // queries that were actually run (auto-generated or custom)
  results: Array<{
    prompt: string;
    platform: string;
    response: string | null;
    error: string | null;
  }>;
}
```

## Data flow

Brand context is read from the KV memory store — no external lookup needed:

| Key | Fields used |
|---|---|
| `brand.identity` | `brandName`, `location`, `vertical`, `personality.description`, `audience.description` |
| `brand.summary` | `text` |

The description fields are concatenated (max 300 chars) and appended to the query as context. For custom queries, brand context is loaded but not required.

## Platform queries

All calls go through CaaS (`OPENAI_BASE_URL`) using the existing `OPENAI_API_KEY`:

| Step | Model | Via |
|---|---|---|
| Prompt generation (standard only) | `haiku` | `getModel('haiku')` → CaaS |
| ChatGPT queries | `gpt-4o` | `getModel('gpt-4o')` → CaaS |
| Claude queries | `sonnet` (fast tier) | `getAgentModelWithName('fast')` → CaaS |

All (prompt × platform) combinations run concurrently via `Promise.all`. Responses are truncated to 1000 characters. Per-platform errors are caught individually — a failure on one platform does not fail the whole tool.

## Caching

Generated prompts (standard runs only) are cached for 10 minutes, keyed by `${appId}:${brandName}:${location}:${vertical}`. The cache naturally misses when brand info changes. Platform responses (ChatGPT, Claude) are never cached — each invocation always runs fresh queries. Custom runs bypass the prompt cache entirely.

## Files

| File | Purpose |
|---|---|
| `agents/src/skills/ai-visibility/skill.md` | Agent instructions, intent phrases, example response format |
| `agents/src/skills/ai-visibility/tools/index.ts` | `checkAiVisibilityTool` — brand context load, query build, platform calls |
| `agents/src/skills/ai-visibility/tools/__tests__/index.test.ts` | Unit tests (mocks CaaS calls) |
| `evals/corpus-eval/corpora/skill-loader/ai-visibility.yaml` | Routing eval — positive/negative trigger cases |


## Limitations (POC scope)

- Results are directional — different phrasings of the same query can produce different responses from the same platform.
- Neither platform has web-search grounding in this configuration; responses reflect training data, not live web results.
- No scoring, trending, or historical comparison — this is a one-shot check.
- Perplexity was considered but removed in favor of routing both calls through CaaS.
