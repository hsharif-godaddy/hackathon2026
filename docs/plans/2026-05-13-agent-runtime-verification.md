# Agent Runtime Verification

## Problem Statement

Trace analysis of agent edit sessions reveals a significant verification gap:

- **44.5%** of edit traces have **zero** post-work verification
- Of the 55.5% that do verify, **81%** is `npm run type-check` — which the preview container already runs automatically on save
- Only **45.9%** of small-edit sessions (1-3 file edits) include any verification step
- Almost nothing verifies **runtime behavior**: HTTP routes responding, DB migrations landing, auth wiring working, external services reachable

The agent confirms "the code compiles" but rarely confirms "the thing I built actually works."

---

## Goals

- Make the agent verify runtime behavior — not just types — after logical work completes
- Keep verification cheap: one HTTP call, not a test suite
- Stay within context-window budget (minimal new tool surface)
- Reuse existing tools where possible (database skill already has query tools)

## Non-Goals

- No UI probe / Playwright / headless browser tool (too heavy, separate decision)
- No unified `verify` orchestrator tool (costs more tokens than narrow tools)
- No new DB query tool — the existing database skill provides `listTables`, `getSchema`, `getTableData`
- No automatic verification trigger — agent decides, prompted by hints in tool/skill descriptions
- No changes to the existing `vite-tsc-plugin` type-check auto-forwarding loop

---

## Proposal

Three changes, shipped together:

| Change | Location | Token Cost |
|--------|----------|------------|
| New `httpCheck` tool | `agents/src/tools/ai-lib-tools/http-check.ts` | ~80-100 tokens (global, always loaded) |
| Verification hints in skill.md files | Per-skill `skill.md` | 0 on normal turns (only loaded when skill is active) |
| Optional prompt rule in develop agent | `agents/src/prompts/develop/core.md` | ~150 tokens (loaded every develop turn) |

### Why not just a prompt rule?

A prompt rule alone ("verify your work") is vague and leads to the agent inventing shell-based workarounds (`curl | grep`, `sqlite3 < query`). The `httpCheck` tool gives the agent a clean, bounded mechanism. The skill hints make verification recipes discoverable at the exact moment they're relevant.

### Why not a centralized verification dispatch?

A `verify({ type: 'http' | 'db' | 'auth', ... })` discriminated-union tool costs more schema tokens than one narrow tool, and the database verification tools already exist in the skill. Keeping them separate matches how the agent encounters them in context.

---

## Verification Class Analysis

Every tool and skill was classified by what level of verification is feasible:

- **Class A — Infrastructure**: Does the resource exist? Does it respond?
- **Class B — Skill-invariant**: Does the response have the expected shape/schema?
- **Class C — Happy-path probe**: Can we exercise the core flow end-to-end?

### Summary Matrix

| Skill / Tool | Class A | Class B | Class C |
|---|---|---|---|
| **database** | `listTables` after migration | `getSchema` for column check | `getTableData` for seed/write confirmation |
| **authentication** | `httpCheck GET /api/auth/session` | Skip (shape varies by version) | Skip (E2E territory) |
| **commerce** | `httpCheck` on checkout route | Chain `fetch_catalog` after product ops | Skip (external deps) |
| **stripe** | `httpCheck GET /api/stripe/products` + `HEAD https://api.stripe.com` | Skip (account-dependent) | Skip |
| **email** | `httpCheck` on contact/email route | Skip (user-specific) | Skip (no mailbox) |
| **google-maps** | `httpCheck GET /api/maps/config` | Verify JSON shape | Skip (needs API key) |
| **ai-agent** | `httpCheck POST /api/chat` with `{"messages":[]}` | Skip (streaming) | Skip (costs money) |
| **online-appointments** | `httpCheck GET /api/appointments/availability` | Verify time-slot JSON | Marginal |
| **blog** | `httpCheck GET /blog` | Skip (user content) | Skip |
| **publishing** | `publishing__status` (already exists) | Built into status tool | `httpCheck GET <published-url>` |
| **asset generation** | `httpCheck HEAD <asset-url>` | Skip (if URL resolves, format correct) | Skip |
| **external service tools** | Self-verifying (return value) | N/A | N/A |
| **terminalCommand** | Self-verifying (exit code) | N/A | N/A |
| **CSS/visual tools** | Skip (visual output) | N/A | N/A |

**Key insight:** Class A is almost always worthwhile and achievable with `httpCheck` alone. Class B is marginal for most skills. Class C enters E2E territory and is out of scope.

---

## Implementation Details

### 1. New Tool: `httpCheck`

**File:** `agents/src/tools/ai-lib-tools/http-check.ts`

One tool covering three verification needs: API routes, auth wiring, and external reachability.

**Schema:**

```ts
z.object({
  url: z.string().describe("App-relative path ('/api/...') or absolute URL for external reachability"),
  method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
  body: z.string().optional().describe('Request body for POST'),
  headers: z.record(z.string(), z.string()).optional(),
  expectStatus: z.number().default(200).describe('Expected status code; mismatch = failure'),
  timeoutMs: z.number().min(500).max(10000).default(5000),
})
```

**Routing:**
- App-relative paths (starting with `/`) route through the dev-supervisor proxy — `DevSupervisorClient.getProxyConfig()` already exists
- Absolute URLs (`http://` / `https://`) go out directly from the agent process

**Return shape:**

```ts
{ ok: boolean, status: number, latencyMs: number, bodyPreview: string /* first 512 chars */, mismatchReason?: string }
```

**Tool description (behavioral nudge):**

> "Verify an API route or external URL responds. Use after creating or modifying server API routes to confirm they are registered and responding. For app routes use relative paths ('/api/...'); for external reachability use absolute URLs."

### 2. Skill Verification Hints

Each skill that creates runtime artifacts gets a short verification section in its `skill.md`. These only load when the skill is active — zero cost on normal turns.

| Skill | Hint |
|-------|------|
| authentication | "After install + server restart, verify: `httpCheck GET /api/auth/session` should return 200." |
| database | "After schema changes, verify with `database__listTables` and `database__getSchema`. After writes, confirm with `database__getTableData`." |
| commerce | "After `install_storefront`, verify: `httpCheck GET /api/commerce/create-checkout-session`." |
| stripe | "After route creation, verify: `httpCheck GET /api/stripe/products`. Reachability: `httpCheck HEAD https://api.stripe.com`." |
| ai-agent | "After install, verify: `httpCheck POST /api/chat` with body `{\"messages\":[]}` should return 200." |
| online-appointments | "After install, verify: `httpCheck GET /api/appointments/availability` should return 200." |
| google-maps | "After dynamic maps setup, verify: `httpCheck GET /api/maps/config` should return JSON." |
| blog | "After install, verify: `httpCheck GET /blog` should return 200." |
| email | "After creating email/contact routes, verify with `httpCheck` against the route." |
| publishing | "After publish, confirm live site: `httpCheck GET <published-url>`." |

### 3. Develop Prompt Rule (Optional)

~15 lines added near "Completing Work" in `agents/src/prompts/develop/core.md`:

```
## Verification Discipline

Before using `suggestedResponse` to end a turn, verify new runtime behavior based on change class:

- **CSS / copy / layout only** — no verification needed; HMR is sufficient.
- **New/changed API route** — call `httpCheck` against the route with the expected status.
- **DB schema or migration change** — if the database skill is loaded, call `database__listTables` to confirm tables exist, or `database__getTableData` to check seed data landed.
- **Auth-related edit** — call `httpCheck` against `/api/auth/session`.
- **External service integration** — call `httpCheck` with `method: 'HEAD'` against the provider's base URL.
- **npm package install** — call `httpCheck` against a route that uses the package, or check `viewLogs` for import errors.

Do not run `npm run type-check` manually — the preview container runs tsc automatically on save and forwards errors back to you.
```

### 4. Database Write-Tool Description Updates

The existing write tools (`insertRow`, `updateRow`, `deleteRow`) get a one-line addition to their Zod descriptions:

> "After mutating data, call `database__getTableData` to verify the change landed."

---

## Token Budget Impact

| Component | Token Cost | When Paid |
|-----------|-----------|-----------|
| `httpCheck` tool schema + description | ~80-100 tokens | Every turn (global tool) |
| Develop prompt rule | ~150 tokens | Every develop turn |
| Per-skill verification hints | ~20-40 tokens each | Only when skill is active |
| DB write-tool description additions | ~15 tokens each | Only when database skill is active |

**Total worst-case per turn:** ~250 tokens additional. Current tool registry is ~37 tools; one more is negligible.

---

## Rollout Plan

1. **Land together in one PR:** `httpCheck` tool + registration + skill.md verification hints + optional develop prompt rule
2. **No corpus-eval changes initially** — existing corpora still pass because verification is additive (agent does more, not less)
3. **Measure for ~1 week** against trace data (see Success Metrics below)
4. **Iterate:** If verification rate doesn't improve, strengthen the prompt rule. If token budget is a concern, drop the prompt rule and rely solely on tool description + skill hints.

---

## Open Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `httpCheck` against `/api/auth/session` when no auth skill is loaded returns 404, agent misinterprets as breakage | Prompt rule scopes suggestion to "auth-related edits" only |
| Database skill not loaded during DB verification (agent made raw schema changes via `terminalCommand`) | Prompt says "if the database skill is loaded" — agent falls back to `httpCheck` against an API route |
| External reachability false negatives (`HEAD` returns 401 without API key) | Prompt says "confirm reachability" — a non-timeout response (even 401) is sufficient signal |
| Agent over-verifies trivial CSS changes, wasting tokens | Explicit "CSS / copy / layout only — no verification needed" carve-out in prompt rule |
| `httpCheck` fetches sensitive data from app routes | Return only first 512 chars of body; tool runs within agent process (same trust boundary) |

---

## Success Metrics

After ~1 week of traces, confirm:

| Metric | Baseline | Target |
|--------|----------|--------|
| Edit traces with zero post-work verification | 44.5% | < 25% |
| Small-edit sessions (1-3 edits) with verification | 45.9% | > 70% |
| Manual `npm run type-check` calls in traces | 459 occurrences | < 100 |
| `httpCheck` appearances in post-work sequences | 0 | > 200 |
| `database__listTables`/`getTableData` after migration steps | Rare | Consistent |

---

## Files Modified

| File | Change |
|------|--------|
| `agents/src/tools/ai-lib-tools/http-check.ts` | New file — tool implementation |
| `agents/src/tools/ai-lib-tools/index.ts` | Register `httpCheck` |
| `agents/src/prompts/develop/core.md` | Add Verification Discipline section |
| `agents/src/skills/authentication/skill.md` | Append verification hint |
| `agents/src/skills/database/skill.md` | Append verification hint |
| `agents/src/skills/database/tools/*.ts` | Update write-tool descriptions |
| `agents/src/skills/commerce-one-time-payment/skill.md` | Append verification hint |
| `agents/src/skills/commerce-storefront/skill.md` | Append verification hint |
| `agents/src/skills/stripe/skill.md` | Append verification hint |
| `agents/src/skills/ai-agent/skill.md` | Append verification hint |
| `agents/src/skills/online-appointments/skill.md` | Append verification hint |
| `agents/src/skills/google-maps/skill.md` | Append verification hint |
| `agents/src/skills/blog/skill.md` | Append verification hint |
| `agents/src/skills/email/skill.md` | Append verification hint |
