# Initial Agent Test Harness — Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Goal

Build a standalone Go binary that runs the initial agent's conversation loop against the Claude API with simulated tools, measures cost/latency, and uses an LLM judge to score the quality of project names and handoff prompts. This enables rapid iteration on the initial agent's system prompt and model configuration.

## Architecture

The harness lives inside the existing `go-agent/` module as a new command, reusing its dependencies (Anthropic Go SDK v1.30.0, yaml.v3, etc.).

```
go-agent/
├── cmd/
│   ├── agent/                # Existing agent command
│   └── harness/
│       └── main.go           # Test harness CLI entry point
├── internal/
│   ├── ...                   # Existing internal packages
│   ├── harness/
│   │   ├── config/           # YAML config loading + validation
│   │   ├── runner/           # Conversation loop + tool simulation
│   │   ├── judge/            # LLM-as-judge evaluation
│   │   └── report/           # JSON output + terminal summary table
├── configs/
│   └── harness/
│       ├── baseline.yaml     # Current production agent settings
│       └── experiment-1.yaml # Example variant config
├── results/                  # Output directory (gitignored)
│   └── harness/
├── go.mod                    # Existing module
└── go.sum
```

## Flow

1. Load experiment config (YAML) specifying prompt files, model params, test cases, and judge criteria
2. For each test case: read and concatenate prompt markdown files to build the system prompt, applying `cache_control: {"type": "ephemeral"}` to system blocks to mirror production caching behavior
3. Call Claude API (non-streaming) with system prompt, user message, and tool definitions
4. Run multi-turn conversation loop handling tool calls
5. After completion: record latency, compute cost from token usage, extract project name + handoff prompt
6. Run LLM judge on captured outputs
7. Save per-run JSON results, print terminal summary table

## Config Format

```yaml
name: "baseline"
description: "Current production initial agent settings"

# Model configuration
model: "claude-haiku-4-5-20251001"
temperature: 0.5
max_output_tokens: 8000
max_steps: 10
effort: "low"

# System prompt — ordered list of markdown files concatenated into system prompt
# The first file gets cache_control: {"type": "ephemeral"} to mirror production caching behavior
prompt_files:
  - "../agents/src/prompts/initial/core.md"
  - "../agents/src/prompts/shared/communication.md"
  - "../agents/src/prompts/initial/attributes.md"
  - "../agents/src/prompts/initial/guidelines.md"
  - "../agents/src/prompts/initial/examples.md"
  - "../agents/src/prompts/shared/security.md"

# Optional: replace specific files with alternatives
# Key = original path, Value = replacement path
prompt_overrides: {}

# Test cases
test_cases:
  - id: "bakery-brief"
    user_message: "I want a website for my bakery"
    persona: "Small bakery owner in Portland, specializing in sourdough"

  - id: "saas-detailed"
    user_message: "Build a project management SaaS called TaskFlow for small dev teams. Clean, minimal design with dark mode."
    persona: "Startup founder, technical background"

  - id: "portfolio-vague"
    user_message: "portfolio site"
    persona: "Freelance photographer, landscape work"

# Responder configuration (for askQuestion simulation)
responder:
  model: "claude-haiku-4-5-20251001" # Cheap model is fine for persona simulation

# Judge configuration
judge:
  model: "claude-sonnet-4-6-20250514"
  criteria:
    - name: "project_name_quality"
      description: "Is the project name specific, relevant, and 1-3 words?"
      scale: "1-5"
    - name: "handoff_completeness"
      description: "Does the handoff include all required sections (design direction, visual elements, motion, section guidance, build order)?"
      scale: "1-5"
    - name: "design_specificity"
      description: "Is the design direction specific and distinctive, not generic?"
      scale: "1-5"
    - name: "anti_cliche"
      description: "Does the handoff explicitly avoid common AI design patterns?"
      scale: "1-5"

# Repetitions per test case (for measuring variance)
runs_per_case: 1
```

## API Mode

The harness uses **non-streaming** API calls (`Messages.New()` rather than streaming). This simplifies token extraction — all usage fields (input, output, cache creation, cache read) are available in the single response object. The harness doesn't need real-time token display.

## Tool Definitions & Simulation

Tool schemas must match the production schemas exactly. The LLM selects tool call arguments based on the schema it sees — a simplified schema would produce different behavior than production.

### askQuestion

**Schema** (from `agents/src/tools/ai-lib-tools/ask-question.ts`):

- `questions` — array (min 1, max 10) of question objects:
  - `question` (string) — The question text
  - `suggestions` (array) — Each element is either a plain string OR `{text: string, value?: string}`
  - `allowOther` (boolean, default true) — Whether to show "Other" option
  - `multiSelect` (boolean, optional) — Allow multiple selections
  - `metadata` (optional object) — Tracking metadata

**Simulation:** Extract questions from tool call args. Send to a separate Claude API call using the configured responder model:

```
System: You are a potential customer being asked questions about a website you want built.
Your persona: {test_case.persona}
Your original request: {test_case.user_message}

Answer each question concisely. Pick from the suggestions when they fit your persona, otherwise provide a custom answer.
```

Append the askQuestion tool call + simulated user response to conversation history. Continue the loop.

**Design note:** In production, `askQuestion` is a stop-after tool — the agent pauses and the real user answers asynchronously. In the harness, the LLM responder simulates the answer immediately and the loop continues. This is intentional: it lets us test the full agent flow without human intervention.

**Cost tracking:** The responder LLM call's tokens are tracked separately as `responder_tokens` so they don't inflate the agent's cost.

### setProjectName

**Schema** (from `agents/src/tools/ai-lib-tools/set-project-name.ts`):

- `name` (string) — The project name

**Simulation:** Capture the name. Return `{"success": true, "message": "Project name set to: {name}"}`. Record in results as `project_name`.

### todoList

**Schema** (from `agents/src/tools/ai-lib-tools/todo-list.ts`): The full production schema must be used. Key fields:

- `operation` (enum) — `create_list`, `get_list`, `show_list`, `list_all`, `delete_list`, `add_items`, `update_items`, `delete_items`, `mark_done`, `mark_undone`, `select_list`
- `appId` (optional string)
- `listId` (optional string)
- `listName` (optional string)
- `listDescription` (optional string)
- `items` (optional array) — `{title, description, completed?, order?}`
- `itemIds` (optional string array) — For mark/delete operations
- `updates` (optional array) — `{itemId, title?, description?, order?}`

**Simulation:** Only `create_list` needs meaningful simulation. Capture full arguments. Return mock success:

```json
{
  "success": true,
  "listId": "mock-list-1",
  "message": "List created with N items"
}
```

Other operations return generic success. Record `create_list` calls in results as `todo_list`.

### handoff

**Schema** (from `packages/ai-lib/src/tools/handoff-helpers.ts`):

- `targetAgent` (string) — ID of the agent to hand off to
- `prompt` (string) — Brief summary of what you completed

**Simulation:** Capture both fields. Return `{"success": true}`. This is a stop-after tool — end the conversation loop. Record `prompt` in results as `handoff_prompt`.

### websiteRebuild

**Schema** (from `agents/src/tools/ai-lib-tools/website-rebuild.ts`):

- `url` (string) — URL to rebuild

**Simulation:** Return mock success. End loop. Not expected for standard test cases but handled gracefully.

## Conversation Loop

1. Send system prompt + `[{role: "user", content: user_message}]` with tool definitions
2. Parse response:
   - If `stop_reason: "tool_use"`: execute simulated tools, append tool results, continue
   - If `stop_reason: "end_turn"` with no tool calls: end loop
   - If max steps reached (configurable, default 10): end loop, flag as incomplete
3. For `askQuestion`: execute LLM responder, add user message with answers, continue loop
4. For `handoff`/`websiteRebuild`: end loop (stop-after tools)
5. For `setProjectName`/`todoList`: return mock result, continue loop

Track per-turn timing and token usage throughout.

## Cost Calculation

Hardcoded per-token rates by model:

| Model                      | Input (per 1M) | Output (per 1M) | Cache Write (per 1M) | Cache Read (per 1M) |
| -------------------------- | -------------- | --------------- | -------------------- | ------------------- |
| claude-haiku-4-5-20251001  | $1.00          | $5.00           | $1.25                | $0.10               |
| claude-sonnet-4-6-20250514 | $3.00          | $15.00          | $3.75                | $0.30               |
| claude-opus-4-6-20250901   | $15.00         | $75.00          | $18.75               | $1.50               |

Cost = (input*tokens * input*rate) + (output_tokens * output*rate) + (cache_creation * cache*write_rate) + (cache_read * cache_read_rate)

Agent cost and responder/judge cost tracked separately.

## LLM Judge

After each run, send captured outputs to the judge model:

```
You are evaluating the output of an AI website planning agent.

User's original request: {user_message}

Project name set by agent: {project_name}

Handoff prompt generated by agent:
---
{handoff_prompt}
---

Score each criterion on a 1-5 scale. For each, provide a brief reasoning (1-2 sentences) then a numeric score.

Criteria:
{for each criterion in config: name + description}

Respond in JSON:
{
  "scores": {
    "criterion_name": {"score": N, "reasoning": "..."},
    ...
  }
}
```

Judge cost is tracked separately and included in the results but not in the agent's cost metric.

## Output Format

### Per-run JSON

Saved to `results/harness/{config_name}/{test_case_id}/{run_number}.json`:

```json
{
  "config_name": "baseline",
  "test_case_id": "bakery-brief",
  "run_number": 1,
  "timestamp": "2026-04-15T10:30:00Z",
  "model": "claude-haiku-4-5-20251001",
  "temperature": 0.5,
  "effort": "low",
  "turns": 3,
  "latency_ms": 3200,
  "agent_tokens": {
    "input": 4500,
    "output": 2100,
    "cache_creation": 4500,
    "cache_read": 3800
  },
  "agent_cost_usd": 0.0032,
  "responder_tokens": {"input": 800, "output": 200},
  "responder_cost_usd": 0.0004,
  "judge_tokens": {"input": 3000, "output": 500},
  "judge_cost_usd": 0.0015,
  "project_name": "Portland Sourdough",
  "asked_questions": true,
  "questions_asked": ["What type of bakery?", "Who is your target audience?"],
  "todo_list": {
    "listName": "Portland Sourdough Website",
    "items": [...]
  },
  "handoff_prompt": "Build homepage design preview...",
  "handoff_target": "develop",
  "judge_scores": {
    "project_name_quality": {"score": 4, "reasoning": "..."},
    "handoff_completeness": {"score": 5, "reasoning": "..."},
    "design_specificity": {"score": 3, "reasoning": "..."},
    "anti_cliche": {"score": 4, "reasoning": "..."}
  },
  "complete": true
}
```

### Terminal Summary

```
Experiment: baseline (3 test cases x 1 run)
Model: claude-haiku-4-5-20251001 | Temp: 0.5 | Effort: low

 Test Case       | Latency | Cost    | Name              | Name Q | Complete | Specific | Anti-Cliche
-----------------+---------+---------+-------------------+--------+----------+----------+------------
 bakery-brief    | 3.2s    | $0.003  | Portland Sourdough| 4/5    | 5/5      | 3/5      | 4/5
 saas-detailed   | 2.1s    | $0.002  | TaskFlow          | 5/5    | 5/5      | 4/5      | 4/5
 portfolio-vague | 4.5s    | $0.004  | Lens & Light      | 4/5    | 4/5      | 3/5      | 3/5
-----------------+---------+---------+-------------------+--------+----------+----------+------------
 Averages        | 3.3s    | $0.003  |                   | 4.3    | 4.7      | 3.3      | 3.7

Total cost: $0.009 (agent) + $0.001 (responder) + $0.005 (judge) = $0.015
Results saved to: results/harness/baseline/
```

## CLI Interface

```bash
# Run a single experiment
cd go-agent && go run ./cmd/harness configs/harness/baseline.yaml

# Run with specific test case only
cd go-agent && go run ./cmd/harness -case bakery-brief configs/harness/baseline.yaml

# Run multiple experiments and compare (positional args)
cd go-agent && go run ./cmd/harness configs/harness/baseline.yaml configs/harness/experiment-1.yaml

# Override runs per case
cd go-agent && go run ./cmd/harness -runs 3 configs/harness/baseline.yaml
```

**Environment:** Reads `ANTHROPIC_API_KEY` from environment.

## Dependencies

- `github.com/anthropics/anthropic-sdk-go` v1.30.0 — Claude API client (already in go.mod)
- `gopkg.in/yaml.v3` — config parsing (in go.mod as indirect; `go get` will promote to direct)
- Standard library for JSON, file I/O, time measurement

## Out of Scope

- WebSocket integration with the agents service
- Real database writes (all tools are simulated)
- UI or web dashboard for results
- Automatic prompt optimization (this is a measurement tool, optimization is manual)
