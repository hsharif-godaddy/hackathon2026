# LLM Streaming Latency Analysis

Investigation into perceived text editor tool slowness during app creation. Users reported the text editor tool takes a disproportionately long time to start producing output.

## User Feedback

- **Raghav Jha** — flagged as his single biggest issue
- **Rishabh Jain** — tried refreshing twice, remained stuck at text editor stage
- **Dineth Mendis** — confirmed same observation
- Suspected Claude 4.6-specific regression

## Root Cause

**The latency is on the GoCode/model side, not in our streaming pipeline.**

When the model calls `str_replace_based_edit_tool`, Anthropic's streaming format sends the tool _name_ first (`content_block_start`), then streams the tool _arguments_ (`input_json_delta`). The model emits the tool name quickly, then pauses to "think" about the file it needs to generate. During this pause, GoCode sends zero bytes.

The UI receives `tool_start` (shows "Text Editor" spinner) but has no `partialInput` to display until the model starts generating. This creates a perceived hang.

## Methodology

Ran the `@airo/llm-proxy` tool (formerly the standalone `debug-proxy.js`) between agent and GoCode to measure per-chunk streaming timing. The proxy intercepts HTTP traffic and logs each SSE chunk with delta timing, elapsed time, and parsed event types.

**Setup** — run the proxy standalone against a fixed upstream and point the agent at it:

```
UPSTREAM_URL=https://caas-gocode-prod.caas-prod.prod.onkatana.net PORT=8888 pnpm run llm-proxy

ANTHROPIC_BASE_URL=http://localhost:8888   # catches LLM chat calls
OPENAI_BASE_URL=http://localhost:8888      # catches embeddings
```

(In the integrated `pnpm run dev` loop the proxy is always in-path via the `/u/<provider>` prefixes; the standalone form above reproduces the original single-upstream capture.)

**Key insight:** In the default local config (with `isS2SAuthEnabled()` routing Claude calls through the Anthropic provider), `OPENAI_BASE_URL` only affects embeddings while `ANTHROPIC_BASE_URL` captures LLM chat calls. In other configurations (e.g., OpenAI-compatible proxy mode), `OPENAI_BASE_URL` may also carry chat traffic. Both env vars are required to capture all traffic in the default setup.

## Findings

### Stall Pattern

Two stall locations observed in every `str_replace_based_edit_tool` call:

1. **After tool command, before file path** — model has decided to use the tool and emitted `{"command":` but then pauses 1-60s before writing the file path. The model is planning _what_ to write.

2. **Mid-file content** — 2-10s pauses in the middle of generating file content (e.g., between JSX blocks). The model is thinking about the next section.

### Stalls Scale with File Size

Data from 4 test runs across 3 app creation sessions:

| File Size | Pre-path Stall | Total Time | Notes                 |
| --------- | -------------- | ---------- | --------------------- |
| 5KB       | —              | 4.2s       | No noticeable stall   |
| 6KB       | —              | 3.6s       | No noticeable stall   |
| 14KB      | 1.3s           | 5.4s       | Minor                 |
| 15KB      | 2.2s           | 11.7s      | + 5.1s mid-file stall |
| 26KB      | 2.6–3.1s       | 7.5–8.6s   | Moderate              |
| 41KB      | 5.4s           | 10.5s      |                       |
| 66KB      | 4.9s           | 12.2s      | + 2.6s mid-file stall |
| 69KB      | 7.4s           | 10.8s      |                       |
| 72KB      | 7.4s           | 16.4s      |                       |
| 130KB     | 9.1s           | 17.4s      | + 4.8s mid-file stall |
| 214KB     | **26.1s**      | 31.6s      | Worst case run 4      |
| 419KB     | **61.3s**      | 70.4s      | Worst case run 5      |
| 449KB     | **62.3s**      | 69.6s      | Worst case run 3      |

Roughly **1s of pre-path stall per 7-10KB** of output.

### Token Generation is Fast When Active

Between stalls, chunks arrive at 0-5ms gaps. The model produces ~1000 chunks/second when actively generating. The bottleneck is entirely in the thinking pauses.

### Other Observations

- **TTFB consistently 2-3.5s** for most requests (model prefill time)
- **Some requests have 10-20s TTFB** with single-chunk responses — model thinks then dumps everything at once
- **Text responses also have occasional 1-2s pauses** — the model's overall token rate is sluggish
- **Not a streaming/buffering issue on our side** — the proxy sits between agent and GoCode and sees raw TCP chunks. Stalls are visible at the TCP level

### Josh Eichorn's Diagnostic

> "If we are sitting around waiting for tool call start message it's a model thinking problem. If we have the tool call start message, then it's all about the input delta rate."
>
> "If you see the edit go from spinning to done without lines counting up, it's a streaming/processing issue not an LLM issue."

Our observation: the edit spins for a long time then lines count up fast — confirming the LLM thinking pattern.

## Mitigation

Since we can't control model thinking time, the UI was updated to show more useful information during the stall:

- **Before:** "Text Editor" with spinner (no context)
- **After:** Active todo item title with spinner (e.g., "Homepage", "Creating navigation component")

The agent always calls `todoList` to mark items in-progress before calling `str_replace_based_edit_tool`, so the todo store has the current task name. The `TextEditorToolRenderer` now reads from `useTodoListStore` and shows the active item title as fallback when `partialInput` is not yet available.

See: `app/src/app/develop/components/tool-renderers/TextEditorToolRenderer.tsx`
