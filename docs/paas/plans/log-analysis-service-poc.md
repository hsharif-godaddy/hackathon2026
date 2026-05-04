# Log Analysis Service POC

> **Author**: Harsh Maheshwari

## Problem Statement

PaaS customers are experiencing failed deployments due to common issues (missing dependencies, TypeScript errors, config problems). Currently, they only see raw error logs without guidance on how to fix the issues.

**Goal**: Build a Log Analysis Service that reviews deployment logs and produces an actionable fix plan, reducing customer support burden and improving time-to-resolution.

---

## Architecture Overview

```
PaaS Publish/Preview Failure
        │
        ▼
POST /apps/:appId/diagnose
        │
        ▼
┌──────────────────────────────────────────────────┐
│             DiagnoseService                   │
│                                                  │
│  1. CustomerLogsService.getLogs({appId,target})  │  ← already sanitized
│                │                                 │
│                ▼                                 │
│  2. Cap pre-check (PR 2+)                        │
│     resolveCap(jwt, switchboard, default)        │
│     if cap !== -1 && used >= cap → 429           │
│                │                                 │
│                ▼                                 │
│  ┌────────────────────────────────────────────┐  │
│  │ Tier 1: PatternClassifier (regex)          │──┼──► match → pattern recommendation
│  └────────────────────────────────────────────┘  │
│                │ no match                        │
│                ▼                                 │
│  ┌────────────────────────────────────────────┐  │
│  │ Tier 2: EmbeddingClassifier (optional)     │──┼──► confident → corpus recommendation
│  └────────────────────────────────────────────┘  │      (PR 4 — only if data justifies)
│                │ low confidence / skipped        │
│                ▼                                 │
│  ┌────────────────────────────────────────────┐  │
│  │ Tier 3: LlmClassifier (LlmClient + prompt) │──┼──► LLM-generated action plan JSON
│  └────────────────────────────────────────────┘  │
│                │                                 │
│                ▼                                 │
│  3. Record usage, return response                │
└──────────────────────────────────────────────────┘
```

### Design Decisions

| Decision            | Choice                              | Rationale                                                 |
| ------------------- | ----------------------------------- | --------------------------------------------------------- |
| Agent vs Service    | **Service**                         | PaaS needs stateless HTTP API, not WebSocket conversation |
| Analysis Approach   | **Pattern + LLM** (Tier 2 deferred) | Determinism for known issues + LLM for everything else    |
| Invocation          | **API + optional auto-trigger**     | Flexible: explicit calls now, auto-trigger later          |
| Funding             | **Platform-subsidized**             | `BudgetOverride.DiagnoseTask` — separate pool             |
| Cap semantics       | **Per-app, `-1` = unlimited**       | Simple sentinel; JWT > Switchboard > default              |
| Prompt organization | **Externalized markdown fragments** | Matches existing `createPromptBuilder()` pattern          |
| LLM integration     | **`LlmClient` interface + `AiLibLlmClient` adapter over `@airo/ai-lib`** | Don't reinvent the wheel — inherit provider selection, `AI_MODEL_OVERRIDE`, telemetry, usage tracking. Classifier stays unit-testable via fake client. |

### Cost Analysis

Cost per analysis is driven almost entirely by Tier 3 LLM invocations. Values below are **order-of-magnitude estimates only** — validate with real token counts before quoting in any budget doc (see [Cost Validation](#cost-validation)).

| Approach                  | Cost per 1000      | Coverage  | Chosen          |
| ------------------------- | ------------------ | --------- | --------------- |
| Pattern-only              | $0                 | ~60%      |                 |
| **Pattern + LLM**         | **measure in POC** | **~90%+** | **Yes (PR 1)**  |
| Pattern + Embedding + LLM | measure later      | ~95%      | PR 4 (optional) |

### Cost Validation

Before quoting any cost number externally:

1. Run a real failed publish through the service.
2. Count tokens with `countTokens()` from `packages/ai-lib/src/utils/token-counter.ts` (uses `ai-tokenizer` — `o200k_base` encoding for OpenAI, Claude encoding for Anthropic).
3. Multiply by the GoCode proxy's charged rate per 1M tokens for the selected model (confirm with platform team — not in `packages/ai-lib/src/utils/model-pricing.ts` for embedding models).
4. Post-deployment, query ES indices `airo-builder-model-spend` / `airo-builder-enduser-spend` for actual per-analysis cost.

---

## API Design

### Endpoint

```
POST /apps/:appId/diagnose
```

### Request

```typescript
interface DiagnoseRequest {
  target: "preview" | "publish"; // Required (PR 1: 'publish' only; PR 3 adds 'preview')
  since?: string; // ISO 8601 timestamp
  lines?: number; // Max lines (default: 200, max: CUSTOMER_LOGS_MAX_LINES)
  options?: {
    forceFullAnalysis?: boolean; // Skip Tier 1, go straight to Tier 3
  };
}
```

### Response

```typescript
interface DiagnoseResponse {
  success: boolean;
  analysis: {
    status: "healthy" | "failing" | "degraded" | "unknown";
    issues: Array<{
      id: string;
      category: string;
      severity: "error" | "warning";
      message: string;
      recommendation: string;
      confidence: number;
      source: "pattern" | "embedding" | "llm";
      relatedLogs?: string[];
    }>;
    summary: {
      totalIssues: number;
      errors: number;
      warnings: number;
      primaryRecommendation: string;
    };
    metadata: {
      logsAnalyzed: number;
      tierUsed: "pattern" | "embedding" | "llm";
      analysisTimeMs: number;
      creditsUsed?: number; // From GoCode session cost (PR 2+)
      creditsRemaining?: number; // -1 if unlimited (PR 2+)
    };
  };
  error?: string;
  errorCode?:
    | "CAP_EXCEEDED"
    | "SUPERVISOR_UNAVAILABLE"
    | "APP_NOT_FOUND"
    | "LLM_FAILURE"
    | "UNKNOWN";
}
```

### Example Response

```json
{
  "success": true,
  "analysis": {
    "status": "failing",
    "issues": [
      {
        "id": "missing-module-lodash",
        "category": "Missing Dependency",
        "severity": "error",
        "message": "Cannot find module 'lodash'",
        "recommendation": "Install missing package: npm install lodash",
        "confidence": 95,
        "source": "pattern",
        "relatedLogs": [
          "2026-04-20T10:30:45Z Error: Cannot find module 'lodash'"
        ]
      }
    ],
    "summary": {
      "totalIssues": 1,
      "errors": 1,
      "warnings": 0,
      "primaryRecommendation": "Install missing package: npm install lodash"
    },
    "metadata": {
      "logsAnalyzed": 150,
      "tierUsed": "pattern",
      "analysisTimeMs": 45,
      "creditsUsed": 0,
      "creditsRemaining": 5
    }
  }
}
```

### Error Responses

- **429 Cap Exceeded** (PR 2+):
  ```json
  {
    "success": false,
    "error": "Analysis cap reached for this app",
    "errorCode": "CAP_EXCEEDED",
    "analysis": { "metadata": { "creditsUsed": 5, "creditsRemaining": 0 } }
  }
  ```
- **503 Supervisor Unavailable** — publish/preview container not reachable.
- **404 App Not Found** — AAB: app not in DB; PaaS: see [PaaS Tenancy](#paas-tenancy-gap).

---

## Classification Tiers

### Tier 1: Pattern Classifier (Zero LLM Cost)

Regex-based matching for well-known error patterns. Runs first, instant response.

#### Pattern Categories

| Category                 | Example Pattern                      | Recommendation                                                  |
| ------------------------ | ------------------------------------ | --------------------------------------------------------------- |
| **Missing Dependency**   | `Cannot find module 'X'`             | Install missing package: npm install X                          |
| **TypeScript Error**     | `error TS2304: Cannot find name 'Y'` | Fix TypeScript compilation errors                               |
| **Memory Exhaustion**    | `JavaScript heap out of memory`      | Increase Node.js memory: NODE_OPTIONS=--max-old-space-size=4096 |
| **Port Binding**         | `EADDRINUSE`                         | Port already in use. Check for conflicting processes            |
| **Health Check Timeout** | `health check.*timeout`              | App failed to start within timeout. Check startup logs          |
| **Build Script Missing** | `missing script: build`              | Add "build" script to package.json                              |
| **Dist Folder Missing**  | `dist/ folder not found`             | Ensure build creates dist/ directory                            |
| **Env Var Missing**      | `process.env.X is undefined`         | Set required environment variable: X                            |

#### Sample Implementation

```typescript
const PATTERNS = [
  {
    id: "missing-module",
    pattern: /Cannot find module ['"]([^'"]+)['"]/,
    category: "Missing Dependency",
    severity: "error" as const,
    getRecommendation: (match: RegExpMatchArray) =>
      `Install missing package: npm install ${match[1]}`,
  },
  {
    id: "ts-error",
    pattern: /error TS(\d+):/,
    category: "TypeScript Error",
    severity: "error" as const,
    getRecommendation: () =>
      "Fix TypeScript compilation errors in your source code",
  },
  {
    id: "heap-oom",
    pattern: /JavaScript heap out of memory|FATAL ERROR.*Allocation failed/i,
    category: "Memory Exhaustion",
    severity: "error" as const,
    getRecommendation: () =>
      "Increase Node.js memory: add NODE_OPTIONS=--max-old-space-size=4096 to build script",
  },
];
```

### Tier 2: Embedding Classifier (Deferred to PR 4)

For logs not matched by Tier 1, optionally use text embeddings to find semantic similarity with known failure categories.

**Deferred because**: Tier 3 (LLM) handles the same cases with stronger reasoning. Tier 2 only pays off if a significant share of calls falls into a well-defined corpus that's cheaper to embed than to LLM. Measure Tier 1 miss rate and Tier 3 cost in PR 1; add Tier 2 only if the data justifies.

Reference implementation pattern: `agents/src/agents/assessment-agent/embedding-classifier.ts` (pre-computed centroids, `text-embedding-3-small`, cosine similarity, 0.70 threshold).

### Tier 3: LLM Classifier (POC Scope)

When Tier 1 misses, invoke the LLM with a predefined prompt that combines PaaS requirements + sanitized logs, and parse a structured JSON response.

#### LlmClient Abstraction

`LlmClassifier` depends on an `LlmClient` interface (`generateStructured<T>(args)`), not on the SDK directly. This keeps the classifier deterministically testable (unit tests inject a fake client) and centralizes the SDK integration in one place.

The production implementation is **`AiLibLlmClient`** (`agents/src/services/diagnose/AiLibLlmClient.ts`). It is a thin adapter over `@airo/ai-lib` helpers — deliberately **not** a bespoke `generateText` wrapper:

- **Model selection**: `getAgentModelWithName('fast')` from `agents/src/utils/model-selection.ts`. This is the same helper tools like `qa-analyze` use, so diagnose inherits provider selection (Anthropic direct via `ANTHROPIC_API_KEY`, else OpenAI/GoCode proxy via `OPENAI_BASE_URL`), `AI_MODEL_OVERRIDE` env hatch, and DevTools middleware wrapping for free.
- **Generation**: `generateTextWithTracking` from `@airo/ai-lib`. Provides telemetry (`tool_llm.generate.*` events), usage-callback hook, and metadata propagation.
- **Structured output**: JSON parse + zod `LlmAnalysisSchema.safeParse` locally, because ai-lib does not yet expose a `generateObjectWithTracking`. When/if it does, this layer collapses.
- **Budget routing**: Wrapped in `llmMetadataContext.run({ user: BudgetOverride.DiagnoseTask, tags: ['source:diagnose', 'target:<t>'] }, ...)` so GoCode proxy charges the platform pool.
- **Timeout**: Hard 30s ceiling via `Promise.race` — on expiry `LlmClassifier` returns `status: 'unknown'` with an `llm-failure` issue rather than propagating the error.

#### Model Selection Today

`MODEL_MAPPINGS` (`agents/src/utils/model-selection.ts:115-126`) currently routes both `fast` and `full` tiers to `'sonnet'`. The `'fast'` label is aspirational — when the team wants to shift diagnose to `haiku`, it's a one-line change in that mapping and nothing in diagnose needs to move. The doc's original "Haiku" framing reflected intent; the actual tier label is `fast`.

#### Model Overrides (scope note)

`getAgentModelWithName` honors runtime overrides via `runWithModelOverride(...)` (AsyncLocalStorage in ai-lib). Today that wrapper is only installed on the **WebSocket message entry point** (`agents/src/server/ai-lib-websocket-server.ts` → `messageMiddleware`), which reads `agentContext.modelSelectorEnabled` (Switchboard-style feature flag on the JWT), `metadata.modelOverride` (per-project, client-owned), and `agentContext.modelOverride` (JWT-signed), gated through `guardAllowedOverrideModel`.

**Diagnose is an HTTP POST route, so it does not sit inside that wrapper.** PR 1 therefore honors `AI_MODEL_OVERRIDE` (env) and the static mapping, but not per-project / per-site Switchboard-driven overrides. If that becomes a requirement, a later PR should factor the override resolver out of `ai-lib-websocket-server.ts`, call it from the diagnose route, and wrap `diagnoseService.diagnose(...)` in `runWithModelOverride(...)`. Not in PR 1 scope.

#### Prompt Organization

Mirrors the existing `agents/src/prompts/` fragment-based composition (see `agents/CLAUDE.md` → Prompt Composition):

```
agents/src/prompts/diagnose/
├── system.md                 # Entry point, composes sub-fragments
├── user.md                   # {{logs}} {{appContext}}
├── requirements/
│   ├── build.md              # Build must produce dist/ with server entry
│   ├── runtime.md            # App must listen on process.env.PORT
│   ├── health.md             # Health endpoint must respond within 30s
│   └── deps.md               # All runtime deps must be in package.json
└── output-schema.md          # JSON schema for action plan
```

**`system.md` skeleton:**

```md
You are a deployment troubleshooter for PaaS apps on Airo App Builder.

## PaaS Requirements the app must satisfy

{{BuildRequirements}}
{{RuntimeRequirements}}
{{HealthRequirements}}
{{DependencyRequirements}}

## Task

Given deployment logs, identify why the deployment failed and produce an action plan.

## Output Contract

{{OutputSchema}}

Return ONLY the JSON. No prose, no markdown fences.
```

**`user.md` skeleton:**

```md
## App Context

- appId: {{appId}}
- target: {{target}}
- packageManager: {{packageManager}}
- buildCommand: {{buildCommand}}

## Logs (last {{logCount}} lines)

{{logs}}
```

Composition via `createPromptBuilder()` — same machinery DevelopAgent/InitialAgent use.

#### Output Contract

Tier 3 returns the same `issues[]` shape as Tier 1/2 with `source: 'llm'`. The LLM is prompted to:

1. Identify the **primary** failure (one issue, severity `error`).
2. Include any warnings it spots.
3. Write actionable `recommendation` text (imperative verbs, file paths where relevant).
4. Cite up to 3 `relatedLogs` (verbatim log lines) per issue.

---

## Cap Configuration

### Resolution Order

```typescript
function resolveCap(agentContext, switchboardClient): number {
  // 1. JWT claim (preferred — caller controls per-token)
  if (typeof agentContext.paasDiagnoseCreditCap === "number") {
    return agentContext.paasDiagnoseCreditCap;
  }
  // 2. Switchboard (runtime-adjustable, central)
  const flagValue = await switchboardClient.getString(
    "paas-diagnose-credit-cap",
  );
  if (flagValue !== undefined) {
    const parsed = parseInt(flagValue, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  // 3. Default
  return 5;
}
```

### Sentinel: `-1` = No Cap

```typescript
if (cap !== -1 && usedCredits >= cap) {
  return reject("CAP_EXCEEDED");
}
```

### "Credits" Unit

For POC, **one credit = one analysis invocation** (simple, deterministic). Actual GoCode cost is captured in `onBudgetReport` for observability but does not drive cap accounting. Revisit post-POC if variable-cost accounting is needed.

### Switchboard Integration

Agents service does not currently use Switchboard (only `app/` does — see `app/src/lib/switchboard/server.ts`). PR 2 adds a minimal agents-side client that calls `https://bff.pcx.{rootDomain}/api/config/feature/{flag}?app=airo-app-builder` with the JWT. Failure modes: Switchboard unreachable → fall through to default, log warning.

### JWT Claim

Custom claim `paasDiagnoseCreditCap` (number). Coordinate with the PaaS token issuer (control plane) before enabling — the claim must be signed alongside standard agents-service claims.

---

## Per-App Tracking

**Table**: `diagnose_usage (app_id TEXT PRIMARY KEY, credits_used INTEGER, window_start INTEGER)`.

**Window**: rolling 24h. On pre-check, reset `credits_used = 0` and `window_start = now` if `now - window_start > 24h`.

**Atomicity** (learned from troubleshooter's acknowledged race condition — `troubleshooter/internal/tokenbucket/tokenbucket.go:56-57`): use a single `UPDATE ... WHERE` statement that combines the check and increment, not read-modify-write:

```sql
UPDATE diagnose_usage
SET credits_used = credits_used + 1
WHERE app_id = ? AND (credits_used < ? OR ? = -1);
-- rowcount = 0 → cap exceeded
```

---

## File Structure

```
agents/src/
├── services/
│   └── diagnose/
│       ├── index.ts                          # Module exports
│       ├── types.ts                          # Type definitions
│       ├── DiagnoseService.ts                # Main service (singleton)
│       ├── cap-resolver.ts                   # JWT → Switchboard → default (PR 2)
│       ├── usage-repository.ts               # SQLite atomic cap check (PR 2)
│       ├── AiLibLlmClient.ts                 # Production LlmClient (ai-lib adapter)
│       ├── classifiers/
│       │   ├── PatternClassifier.ts          # Tier 1: regex
│       │   ├── LlmClassifier.ts              # Tier 3: LlmClient (injected) + prompt
│       │   ├── EmbeddingClassifier.ts        # Tier 2 (PR 4, optional)
│       │   └── patterns/
│       │       ├── build-patterns.ts         # npm, TypeScript errors
│       │       ├── deploy-patterns.ts        # Health check, port errors
│       │       └── runtime-patterns.ts       # Crashes, memory errors
│       └── __tests__/
│           ├── PatternClassifier.test.ts
│           ├── LlmClassifier.test.ts
│           ├── DiagnoseService.test.ts
│           └── cap-resolver.test.ts
├── prompts/
│   └── diagnose/                             # See "Prompt Organization" above
└── server/
    └── routes/
        └── diagnose.ts                       # API route handler
```

---

## Concurrency Control

Prevent parallel analyses on the same app (double-click, misbehaving client). In-memory per-app lock:

```typescript
const inFlight = new Map<string, Promise<DiagnoseResponse>>();

async function analyze(req) {
  if (inFlight.has(req.appId)) return inFlight.get(req.appId);
  const p = doAnalyze(req).finally(() => inFlight.delete(req.appId));
  inFlight.set(req.appId, p);
  return p;
}
```

Scope: single agents process. Production runs one agent per app, so in-memory is sufficient. Revisit if topology changes.

---

## Integration Points

### Existing Code Reuse

| Component                   | Path                                                         | Usage                                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| CustomerLogsService         | `agents/src/services/customer-logs-service.ts`               | Fetch logs from containers                    |
| LogSanitizer                | `agents/src/services/log-sanitizer.ts`                       | Light redaction (Bearer, API keys) before LLM |
| EmbeddingClassifier pattern | `agents/src/agents/assessment-agent/embedding-classifier.ts` | Reference for Tier 2 (PR 4)                   |
| validateAppOwnership        | `agents/src/server/middleware/app-ownership.ts`              | Route protection (AAB)                        |
| BudgetOverride              | `packages/ai-grants/src/grant-session-manager.ts`            | Platform-subsidized budget                    |
| createPromptBuilder         | `agents/src/prompts/diagnose/` (composition helper)          | Tier 3 prompt assembly                        |
| countTokens                 | `packages/ai-lib/src/utils/token-counter.ts`                 | Cost validation                               |
| getAgentModelWithName       | `agents/src/utils/model-selection.ts`                        | Provider selection + override plumbing        |
| generateTextWithTracking    | `packages/ai-lib/src/utils/tool-llm-helper.ts`               | LLM call with telemetry + usage hook          |
| llmMetadataContext          | `@airo/ai-common`                                            | Per-call LiteLLM metadata (budget + tags)     |

### Wiring `DiagnoseService` to `CustomerLogsService`

```typescript
const logsResponse = await customerLogsService.getLogs({
  appId,
  target, // 'publish' in PR 1
  lines: request.lines ?? 200,
});
if (!logsResponse.success) {
  return errorFromLogsResponse(logsResponse); // maps APP_NOT_FOUND, SUPERVISOR_UNAVAILABLE, etc.
}
const text = logsResponse.logs
  .map((l) => `${l.timestamp} ${l.source} ${l.message}`)
  .join("\n");
```

**Sanitization note**: `LogSanitizer` is already applied inside `CustomerLogsService`. For LLM input, this is desirable — we need stack traces, file paths, module names (kept) but not tokens/passwords (redacted). Do **not** bypass sanitization for LLM calls.

### Budget Override

Add to `packages/ai-grants/src/grant-session-manager.ts`:

```typescript
export enum BudgetOverride {
  // ... existing
  DiagnoseTask = "airo-builder:diagnose-task",
}
```

**Platform team must** provision the GoCode budget for `airo-builder:diagnose-task` before PR 1 deploys — otherwise Tier 3 calls will be rejected at the proxy.

### Publish Auto-Trigger (Optional — PR 5)

Wire into `agents/src/server/routes/publish/strategies/PaaSPublishStrategy.ts:88` where `BuildError` is thrown:

```typescript
if (options.analyzeOnFailure) {
  const analysis = await logAnalysisService.analyze({
    appId,
    target: "publish",
    lines: 100,
  });
  // Include in error response
}
```

---

## PaaS Tenancy Gap

`validateAppOwnership` middleware (`agents/src/server/middleware/app-ownership.ts`) reads from the agents SQLite `apps` table. Per the dual-product architecture in `CLAUDE.md`, **PaaS apps may not have a row there** — middleware will return 404.

**Resolution path (PR 1)**:

- AAB flow: use `validateAppOwnership` as normal.
- PaaS flow: rely on JWT `siteId` validation only (no DB check). Route detects PaaS via JWT claim or dedicated header.
- Log fetch still works because `CustomerLogsService.getLogs()` requires `app.socketPath` — PaaS must ensure this is registered via the standard app upsert path before calling `/diagnose`, or pass supervisor path in the request (dual-product pattern).

Finalize with whoever owns PaaS control plane before PR 1 ships.

---

## Abuse Prevention

Per-app cap prevents a single app from draining the shared pool. Additional defense:

- **Per-customer rate limit** (route-level, e.g., 10 analyses / hour / customerId) — prevents one customer abusing many apps.
- **Request validation** — reject if `lines > CUSTOMER_LOGS_MAX_LINES`.
- **LLM timeout** — Tier 3 has a hard 30s timeout; fall through to `{ status: 'unknown' }` response on expiry.

---

## Phased Rollout

| PR       | Scope                                                                                                                | Status   | Gates before merge                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| **PR 1** | Pattern classifier + Tier 3 LLM + `POST /apps/:appId/diagnose` for **publish only**. No cap (behaves as `cap = -1`). | Required | Tier 1 unit tests, Tier 3 integration test with real logs, authorization test, GoCode budget provisioned |
| **PR 2** | Cap enforcement: JWT → Switchboard → default. Per-app 24h window. Atomic SQLite update.                              | Required | Cap-exceeded returns 429, concurrent-request race test passes, Switchboard client mockable               |
| **PR 3** | Preview target + preview-specific patterns (dev server startup, HMR failures).                                       | Required | Preview patterns green on real failed previews                                                           |
| **PR 4** | Embedding classifier (Tier 2) — only if Tier 1 miss rate × Tier 3 cost justifies corpus maintenance.                 | Optional | Decision gated on PR 1 + PR 3 metrics                                                                    |
| **PR 5** | Auto-trigger on `BuildError` in `PaaSPublishStrategy`.                                                               | Optional | Opt-in via `analyzeOnFailure: true` flag                                                                 |

---

## Out of Scope for POC

- Continuous iteration (re-analyze after customer fix) — troubleshooter pattern, defer.
- Autofix / automated remediation — explicitly not in scope; output is advisory only.
- Multi-model split (Claude for hypotheses, OpenAI for remediation) — troubleshooter does this; single-model for simplicity.
- Persistent analysis state machine (DB-tracked `GettingEvidence → GettingHypotheses → Finished`) — POC is synchronous.
- Per-customer prompt customization / knowledge base.
- Multi-language support beyond Node.js/TypeScript.

---

## Verification Plan

### Unit Tests

```bash
pnpm --filter @airo/agents test:unit "diagnose"
```

### Authorization Tests

Per `agents/CLAUDE.md`, add cases to `src/server/routes/__tests__/authorization-security.integration.test.ts` covering:

- Cross-tenant access rejected (JWT siteId != app owner).
- PaaS path accepts siteId-only auth.
- Cap check runs AFTER auth (so cap responses don't leak app existence).

### Manual API Test

```bash
curl -X POST http://localhost:4000/apps/{appId}/diagnose \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{"target": "publish"}'
```

### Integration Test

```bash
pnpm --filter @airo/agents test:integration "diagnose"
```

Integration test seeds a failed publish log fixture, runs the full pipeline, asserts on `source` (pattern vs llm) and `primaryRecommendation`.

### Cost Validation

Run on 10+ real failed publishes from ESSP (`.ds-logs-gdelastic.katana.<app>-dev-*`), count tokens, compute actual cost per analysis, compare to estimates.

### Build Verification

```bash
pnpm typecheck && pnpm lint && pnpm build
```

---

## Success Criteria

1. **Functional**: API returns actionable recommendations for common failures; Tier 3 output validates against the JSON schema.
2. **Performance**: Tier 1 responses < 500ms; Tier 3 responses < 10s (p95).
3. **Cost**: Real per-analysis cost measured in PR 1 and documented; cap math verified in PR 2.
4. **Coverage**: Correctly identifies 80%+ of test failure scenarios across pattern + LLM tiers.
5. **Quality**: All tests pass; authorization tests added; no TypeScript/lint errors; observability events emitted (`diagnose.invocation`, `diagnose.tier.<n>.hit`, `diagnose.cap.exceeded`).

---

## Future Enhancements (Post-POC)

| Enhancement            | Description                                  | Effort |
| ---------------------- | -------------------------------------------- | ------ |
| Tier 2 Embedding       | Mid-tier classifier (only if data justifies) | 2 days |
| Auto-trigger           | Invoke from `BuildError` path automatically  | 1 day  |
| Requirements Checklist | Compare against expected project structure   | 3 days |
| Historical Analysis    | Track common failures per customer           | 1 week |
| Proactive Analysis     | Analyze before publish to catch issues early | 3 days |
| Multi-language Support | Pattern definitions for Python, Ruby, etc.   | 1 week |
| Continuous iteration   | Re-analyze after customer fix attempt        | 1 week |

---

## Appendix: Common PaaS Failure Patterns

### Build Phase

| Error                    | Cause                      | Fix                  |
| ------------------------ | -------------------------- | -------------------- |
| `Cannot find module 'X'` | Missing dependency         | npm install X        |
| `error TS2304`           | TypeScript type error      | Fix source code      |
| `heap out of memory`     | Large build                | Increase Node memory |
| `missing script: build`  | No build command           | Add to package.json  |
| `ENOENT: dist/`          | Build didn't create output | Check build config   |

### Deploy Phase

| Error                  | Cause                 | Fix                         |
| ---------------------- | --------------------- | --------------------------- |
| `EADDRINUSE`           | Port conflict         | Check for running processes |
| `health check timeout` | App didn't start      | Check startup logs          |
| `SIGTERM`              | Process killed        | Memory/resource limit       |
| `connection refused`   | Service not listening | Check PORT binding          |

### Runtime

| Error                               | Cause           | Fix             |
| ----------------------------------- | --------------- | --------------- |
| `process.env.X undefined`           | Missing env var | Set in config   |
| `Cannot read property of undefined` | Runtime error   | Fix source code |
| `CORS error`                        | Missing headers | Configure CORS  |

## Phase 2 Follow-ups

Two items are deliberately deferred from the POC PR so they can be shipped with
a confidence-bearing test harness rather than as drive-bys.

### 1. Blind-spot logging

Emit a `diagnose.quality.blindspot` warn log from `DiagnoseService.runAnalysis`
when the analysis is likely a miss — cases where the pipeline returns a shape
that is structurally valid but semantically unhelpful. Triggering conditions:

- `status === 'healthy'` despite the app being in a failing state (caller context).
- Sole issue is the `llm-failure` sentinel (Tier 3 returned `handled: true` with
  no real finding).
- All issues are below `BLIND_SPOT_CONFIDENCE_THRESHOLD = 50`.
- Zero logs were analyzed (no stderr/stdout activity fetched).

Payload:

```ts
{
  appId, target, tierUsed, status,
  reason,                  // primary trigger, e.g. 'only-llm-failure'
  secondaryReasons: [],    // additional triggers that also fired
  issueCount, errorCount, warningCount,
  maxConfidence, minConfidence, issueIds,
  logsAnalyzed, analysisTimeMs,
}
```

Purpose: surface gaps in pattern/prompt coverage so the team can triage from
ESSP without needing to scrape the HTTP response body. Keep the log at `warn`
so it rides existing error-rate dashboards but doesn't page.

### 2. LLM schema cleanup

`LlmAnalysisSchema.status` and `LlmAnalysisSchema.primaryRecommendation` are
currently generated by the model and then discarded — `LlmClassifier.classify`
only reads `output.issues`. Copilot flagged this in PR #3234 review.

Two possible paths, in order of risk:

1. **Drop the fields** from the schema + prompt. Simpler, fewer tokens per call,
   but changes schema shape and could subtly influence completion behavior.
2. **Propagate them** into `ClassifierResult` and let `DiagnoseService` prefer
   the LLM's verdict when `tierUsed === 'llm'` instead of re-deriving status
   from issue severity.

Blocker for Phase 1: no test harness that validates "the LLM still identifies
the right issues after schema tightening." The right time to pick a path is
when blind-spot logging (item 1) gives us the signal to judge whether the
LLM's own `status` is more accurate than our derived one.
