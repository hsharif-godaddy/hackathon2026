# Log Analysis Service POC

> **Author**: Harsh Maheshwari

## Problem Statement

PaaS customers are experiencing failed deployments due to common issues (missing dependencies, TypeScript errors, config problems). Currently, they only see raw error logs without guidance on how to fix the issues.

**Goal**: Build a Log Analysis Service that reviews deployment logs and produces an actionable fix plan, reducing customer support burden and improving time-to-resolution.

---

## Architecture Overview

Tier numbering follows the `DiagnoseTier` enum: Tier 1 = pattern, Tier 2 = embedding (reserved), Tier 3 = LLM. The pipeline wires Tier 1 → Tier 3; Tier 2 is a placeholder slot that is rejected at the HTTP schema today and kept as service-level defense-in-depth.

```
PaaS Publish/Preview Failure
        │
        ▼
POST /apps/:appId/diagnose
  HTTP gates:
    400 VALIDATION_ERROR  (Zod: target / tier. tier='embedding' is rejected here.)
    403 PRODUCT_NOT_ALLOWED  (JWT.product !== 'PaaSNodeJS')
    404 APP_NOT_FOUND     (validateAppOwnership middleware)
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│                 PaaSDiagnoseService                      │
│                                                          │
│  Dedupe: 409 ANOTHER_DIAGNOSE_IN_FLIGHT if same appId    │
│  Defense-in-depth: 501 TIER_NOT_IMPLEMENTED for          │
│  tier='embedding' arriving from non-HTTP callers         │
│                                                          │
│  1. CustomerLogsService.getLogs({appId,target})          │ ← already sanitized
│                │                                         │
│                ▼                                         │
│  2. Early-exit: no error-level / error-token log in      │
│     last 3h → status='noerrlog'; skip classifiers        │
│                │                                         │
│                ▼                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Tier 1: PatternClassifier (PAAS_ALL_PATTERNS)      │──┼──► match → pattern recommendation
│  └────────────────────────────────────────────────────┘  │      (short-circuits Tier 3)
│                │ no match / classifier threw             │
│                ▼                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Tier 2: Embedding (reserved — never reached)       │  │
│  └────────────────────────────────────────────────────┘  │
│                │                                         │
│                ▼                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Tier 3: LlmClassifier (DiagnoseLlmClient)          │──┼──► ClassifierResult.degraded === true
│  │   prompt-load ENOENT → degraded 'llm-prompt-missing'│  │      → 500 LLM_FAILURE
│  │   LLM-call failure  → degraded 'llm-failure'       │  │        {success:false, errorCode,
│  │   (30s AbortController timeout, upstream cancel)   │  │         analysis preserved}
│  └────────────────────────────────────────────────────┘  │   else → LLM analysis JSON
│                │                                         │
│                ▼                                         │
│  3. Assemble analysis; return {success:true, analysis}   │
│     or {success:false, errorCode, analysis} on degraded  │
└──────────────────────────────────────────────────────────┘
```

### Design Decisions

| Decision            | Choice                                                                      | Rationale                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent vs Service    | **Service**                                                                 | PaaS needs stateless HTTP API, not WebSocket conversation                                                                                              |
| Analysis Approach   | **Pattern + LLM** (embedding tier deferred)                                 | Determinism for known issues + LLM for everything else                                                                                                 |
| Invocation          | **API + optional auto-trigger**                                             | Flexible: explicit calls now, auto-trigger later                                                                                                       |
| Funding             | **Platform-subsidized**                                                     | `BudgetOverride.DiagnoseTask` — separate pool                                                                                                          |
| Cap semantics       | **Per-app, `-1` = unlimited**                                               | Simple sentinel; JWT > Switchboard > default                                                                                                           |
| Prompt organization | **Externalized markdown fragments**                                         | Matches existing `createPromptBuilder()` pattern                                                                                                       |
| LLM integration     | **`LlmClient` interface + `DiagnoseLlmClient` adapter over `@airo/ai-lib`** | Don't reinvent the wheel — inherit provider selection, `AI_MODEL_OVERRIDE`, telemetry, usage tracking. Classifier stays unit-testable via fake client. |

### Cost Analysis

Cost per analysis is driven almost entirely by LLM-tier invocations. Values below are **order-of-magnitude estimates only** — validate with real token counts before quoting in any budget doc (see [Cost Validation](#cost-validation)).

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
  target: "preview" | "publish"; // Required
  tier?: "pattern" | "llm"; // Default 'pattern'. 'llm' skips pattern tier.
  // 'embedding' is reserved in the DiagnoseTier type
  // but rejected at the HTTP schema (400 VALIDATION_ERROR).
}
```

Internal log-fetch window is fixed at 3h / 500 lines; neither is caller-tunable today.

### Response

```typescript
interface DiagnoseResponse {
  success: boolean;
  analysis: {
    status: "healthy" | "failing" | "degraded" | "unknown" | "noerrlog";
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
      creditsUsed?: number; // reserved; not populated today
      creditsRemaining?: number; // reserved; not populated today
    };
  };
  error?: string;
  errorCode?:
    | "CAP_EXCEEDED" // reserved; no cap enforced today
    | "SUPERVISOR_UNAVAILABLE"
    | "UPSTREAM_UNAVAILABLE"
    | "APP_NOT_FOUND"
    | "VALIDATION_ERROR"
    | "PRODUCT_NOT_ALLOWED"
    | "ANOTHER_DIAGNOSE_IN_FLIGHT"
    | "TIER_NOT_IMPLEMENTED"
    | "LLM_FAILURE"
    | "UNKNOWN";
}
```

`status: "noerrlog"` is emitted when no error-level or error-token log entries exist in the fetched 3h window — the classifiers are skipped entirely and the response carries a single informational issue (`id: "no-failure-detected"`).

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

- **400 Validation Error** — request body failed Zod schema. `tier='embedding'` is rejected here (the value is reserved in `DiagnoseTier` but not exposed via HTTP).
- **403 Product Not Allowed** — JWT `product !== 'PaaSNodeJS'`. AAB callers always hit this.
- **404 App Not Found** — `validateAppOwnership` middleware did not find the app row (see [PaaS Tenancy](#paas-tenancy-gap) for the PaaS-specific gap).
- **409 Another Diagnose In Flight** — a diagnose is already running for this `appId`; caller must wait and retry.
- **429 Cap Exceeded** — **reserved**; no cap is enforced today. Listed for forward-compat.
- **501 Tier Not Implemented** — defense-in-depth for non-HTTP callers that hand `tier='embedding'` straight to the service. HTTP callers are rejected earlier with 400.
- **503 Supervisor Unavailable / Upstream Unavailable** — publish/preview container not reachable, or the log fetch upstream failed.
- **500 LLM Failure** — the LLM tier returned a degraded result (prompt file missing, upstream call failed, JSON/schema validation failed, timeout). Response body carries `errorCode: "LLM_FAILURE"` plus the assembled `analysis` (with the degraded sentinel issue) so clients can still render context; they MUST NOT treat it as a finding.
- **500 Unknown** — unhandled failure in the route / service.

---

## Classification Tiers

Tier numbering matches the `DiagnoseTier` enum ordering (`'pattern' | 'embedding' | 'llm'`): Tier 1 = pattern, Tier 2 = embedding (reserved), Tier 3 = LLM. The pipeline wires Tier 1 → Tier 3; Tier 2 is covered last in this section because it is reserved and not reached at runtime.

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

### Tier 3: LLM Classifier (Pattern Fallback)

When Tier 1 misses, invoke the LLM with a predefined prompt that combines PaaS requirements + sanitized logs, and parse a structured JSON response.

#### LlmClient Abstraction

`LlmClassifier` depends on an `LlmClient` interface (`generateStructured<T>(args)`), not on the SDK directly. This keeps the classifier deterministically testable (unit tests inject a fake client) and centralizes the SDK integration in one place.

The production implementation is **`DiagnoseLlmClient`** (`agents/src/services/diagnose/DiagnoseLlmClient.ts`). It is a thin adapter over `@airo/ai-lib` helpers — deliberately **not** a bespoke `generateText` wrapper:

- **Model selection**: `getAgentModelWithName('fast')` from `agents/src/utils/model-selection.ts`. This is the same helper tools like `qa-analyze` use, so diagnose inherits provider selection (Anthropic direct via `ANTHROPIC_API_KEY`, else OpenAI/GoCode proxy via `OPENAI_BASE_URL`), `AI_MODEL_OVERRIDE` env hatch, and DevTools middleware wrapping for free.
- **Generation**: `generateTextWithTracking` from `@airo/ai-lib`. Provides telemetry (`tool_llm.generate.*` events), usage-callback hook, and metadata propagation.
- **Structured output**: JSON parse + zod `LlmAnalysisSchema.safeParse` locally, because ai-lib does not yet expose a `generateObjectWithTracking`. When/if it does, this layer collapses.
- **Budget routing**: Wrapped in `llmMetadataContext.run({ user: BudgetOverride.DiagnoseTask, tags: ['source:diagnose', 'target:<t>'] }, ...)` so GoCode proxy charges the platform pool.
- **Timeout**: 30s hard ceiling enforced with an `AbortController` + `setTimeout` wired through `generateTextWithTracking`'s `abortSignal`. On abort, the underlying HTTP call is cancelled (prior `Promise.race` implementation leaked sockets). `DiagnoseLlmClient` throws a timeout error; `LlmClassifier` catches it in the LLM-call try and returns a degraded `llm-failure` result.
- **Degraded-result signalling**: `ClassifierResult.degraded: boolean` is the contract between the classifier and the orchestrator. `LlmClassifier` sets `degraded: true` on two branches:

  - **`llm-prompt-missing`** — `ENOENT` from the prompt-load try (missing markdown fragment). Platform misconfig; retry doesn't help.
  - **`llm-failure`** — any failure in the LLM-call try (timeout, upstream error, JSON parse fail, schema mismatch, even an `ENOENT` bubbling up from a downstream dep). Transient / retryable.

  The two tries are intentionally separate so an `ENOENT` outside the prompt-load path is NOT misclassified as `llm-prompt-missing`.

  When `PaaSDiagnoseService` sees `llmResult.degraded === true` it returns `{success: false, errorCode: 'LLM_FAILURE', error, analysis}`. The analysis is still assembled (with the sentinel issue visible to clients for context) but the failure envelope ensures callers get HTTP 500 and can distinguish "analyzer broken" from "real issue found".

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
├── user.md                   # {{logs}} + app context
├── output-schema.md          # JSON schema for the response
├── symptom-mapping.md        # Maps log-line patterns to guideline-violation categories
└── requirements/
    ├── package-json.md       # package.json shape expectations
    ├── dependencies.md       # Runtime deps must resolve at install time
    ├── runtime.md            # App must bind to process.env.PORT
    ├── packaging.md          # Archive/build artifact expectations
    └── frameworks.md         # Framework-specific entry points (Next, Remix, etc.)
```

Note the shift in framing: fragments describe **what a conforming PaaS app must do** (guideline-compliance checker) rather than generic debugging categories. The LLM is expected to decline and return the `no-platform-violation-detected` sentinel when logs clearly indicate customer-code bugs (SyntaxError, TS type errors, etc.) rather than platform violations. When logs are sparse or unrelated, it returns the `insufficient-log-evidence` sentinel.

Composition via `createPromptBuilder()` — same machinery DevelopAgent/InitialAgent use.

#### Output Contract

The LLM tier returns the same `issues[]` shape as Tier 1 with `source: 'llm'`. The LLM is prompted to:

1. Identify the **primary** failure (one issue, severity `error`).
2. Include any warnings it spots.
3. Write actionable `recommendation` text (imperative verbs, file paths where relevant).
4. Cite up to 3 `relatedLogs` (verbatim log lines) per issue.
5. Return a sentinel shape (`no-platform-violation-detected` or `insufficient-log-evidence`) if the logs don't indicate a platform-level problem.

### Tier 2: Embedding Classifier (Reserved)

Declared in the `DiagnoseTier` type and in `ClassifierSource` enums, but **not** exposed via the HTTP schema — `DiagnoseRequestBodySchema` narrows `tier` to `'pattern' | 'llm'`, so HTTP callers get **400 `VALIDATION_ERROR`** if they send `tier: 'embedding'`. The service keeps a runtime guard (`PaaSDiagnoseService` returns **501 `TIER_NOT_IMPLEMENTED`**) as defense-in-depth for non-HTTP callers. No classifier is wired; no corpus exists.

**Deferred because**: the LLM tier handles the same logs with stronger reasoning. An embedding tier only pays off if a significant share of calls falls into a well-defined corpus that's cheaper to embed than to LLM. Measure Tier 1 miss rate and Tier 2 cost in PR 1; add Tier 3 only if the data justifies.

Reference implementation pattern when revisited: `agents/src/agents/assessment-agent/embedding-classifier.ts` (pre-computed centroids, `text-embedding-3-small`, cosine similarity, 0.70 threshold).

---

## Cap Configuration (Deferred)

Per-app cap enforcement is **not implemented** on this branch. `creditsUsed` / `creditsRemaining` on the response metadata and `CAP_EXCEEDED` in the errorCode union are reserved for a future PR but never populated today. Abuse prevention currently consists of in-flight dedupe (one diagnose per `appId`) and the 30s LLM timeout; if real abuse signal appears, revisit the original design (JWT claim → Switchboard flag → default, per-app 24h rolling window, atomic SQLite `UPDATE ... WHERE` to combine check-and-increment).

---

## File Structure

```
agents/src/
├── services/
│   └── diagnose/
│       ├── index.ts                          # Module exports
│       ├── types.ts                          # Type definitions (DiagnoseRequest, Analysis, Classifier, etc.)
│       ├── DiagnoseService.ts                # Product-neutral interface (type-only)
│       ├── PaaSDiagnoseService.ts            # PaaS concrete implementation (orchestration, in-flight dedupe, early-exit)
│       ├── DiagnoseLlmClient.ts              # Production LlmClient (ai-lib adapter, AbortController timeout)
│       ├── classifiers/
│       │   ├── PatternClassifier.ts          # Tier 1: regex
│       │   ├── LlmClassifier.ts              # Tier 2: LlmClient (injected) + prompt composition
│       │   └── patterns/
│       │       ├── index.ts                  # PAAS_ALL_PATTERNS = build ∪ deploy ∪ runtime
│       │       ├── build-patterns.ts         # PAAS_BUILD_PATTERNS (missing-module, ts-error, build-script-missing, dist-missing)
│       │       ├── deploy-patterns.ts        # PAAS_DEPLOY_PATTERNS (port-binding, health-check-timeout)
│       │       ├── runtime-patterns.ts       # PAAS_RUNTIME_PATTERNS (heap-oom, env-var-missing)
│       │       └── types.ts                  # PatternRule
│       └── __tests__/
│           ├── PatternClassifier.test.ts
│           ├── LlmClassifier.test.ts
│           ├── LlmClassifier.prompts.test.ts # Sentinel passthrough + schema validation
│           ├── DiagnoseLlmClient.test.ts     # AbortController timeout, provider selection
│           └── PaaSDiagnoseService.test.ts   # Tier dispatch, in-flight dedupe, noerrlog early-exit
├── prompts/
│   └── diagnose/                             # See "Prompt Organization" above
├── utils/
│   └── date-utils.ts                         # toIsoDateString (extracted; unit-tested)
└── server/
    └── routes/
        └── diagnose.ts                       # API route handler (PaaS product gate)
```

**Companion AAB implementation (future).** When AAB diagnose ships, add `AABDiagnoseService.ts` as a sibling to `PaaSDiagnoseService.ts` (implementing the same `DiagnoseService` interface — do **not** extend `PaaSDiagnoseService`) plus `AAB_BUILD_PATTERNS` / `AAB_DEPLOY_PATTERNS` / `AAB_RUNTIME_PATTERNS` files. The route picks which implementation to wire based on the JWT product.

---

## Concurrency Control

Prevent parallel analyses on the same app (double-click, misbehaving client). In-memory per-app map tracks the in-flight diagnose and **rejects** any concurrent call with 409 `ANOTHER_DIAGNOSE_IN_FLIGHT` — it does not queue or dedupe to the existing promise. The rationale is that a second caller is almost always a retry with different intent, and returning a clear 409 lets them decide whether to wait.

```typescript
// PaaSDiagnoseService.diagnose(), simplified
const existing = this.inFlight.get(request.appId);
if (existing) {
  return {
    success: false,
    error: `Another diagnose is already in progress (target=${existing.target}).`,
    errorCode: 'ANOTHER_DIAGNOSE_IN_FLIGHT',
    analysis: buildUnknownAnalysis(...),
  };
}
const promise = this.runAnalysis(request).finally(() => this.inFlight.delete(request.appId));
this.inFlight.set(request.appId, { target: request.target, promise });
return promise;
```

Scope: single agents process. Production runs one agent per app, so in-memory is sufficient. Revisit if topology changes.

---

## Integration Points

### Existing Code Reuse

| Component                                   | Path                                                         | Usage                                             |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| CustomerLogsService                         | `agents/src/services/customer-logs-service.ts`               | Fetch logs from containers                        |
| LogSanitizer                                | `agents/src/services/log-sanitizer.ts`                       | Light redaction (Bearer, API keys) before LLM     |
| EmbeddingClassifier pattern                 | `agents/src/agents/assessment-agent/embedding-classifier.ts` | Reference for Tier 3 (future)                     |
| validateAppOwnership                        | `agents/src/server/middleware/app-ownership.ts`              | Route protection                                  |
| BudgetOverride                              | `packages/ai-grants/src/grant-session-manager.ts`            | Platform-subsidized budget                        |
| createPromptBuilder                         | `agents/src/prompts/diagnose/` (composition helper)          | LLM tier prompt assembly                          |
| countTokens                                 | `packages/ai-lib/src/utils/token-counter.ts`                 | Cost validation                                   |
| getAgentModelWithName                       | `agents/src/utils/model-selection.ts`                        | Provider selection + override plumbing            |
| generateTextWithTracking                    | `packages/ai-lib/src/utils/tool-llm-helper.ts`               | LLM call with telemetry + usage hook              |
| `abortSignal` on `generateTextWithTracking` | `packages/ai-lib/src/utils/tool-llm-helper.ts`               | Upstream HTTP cancel on timeout (socket-leak fix) |
| llmMetadataContext                          | `@airo/ai-common`                                            | Per-call LiteLLM metadata (budget + tags)         |
| toIsoDateString                             | `agents/src/utils/date-utils.ts`                             | Computes the `since` window for log fetch         |

### Wiring `DiagnoseService` to `CustomerLogsService`

```typescript
// PaaSDiagnoseService.runAnalysis, simplified
const sinceIso = toIsoDateString(startedAt, DEFAULT_SINCE_HOURS * 60);
const logsResponse = await this.customerLogsService.getLogs({
  appId,
  target,
  since: sinceIso,
  lines: this.defaultLines, // hardcoded default (500); not caller-tunable today
});
if (!logsResponse.success) {
  return this.buildErrorResponse(request, logsResponse, startedAt); // maps APP_NOT_FOUND, SUPERVISOR_UNAVAILABLE, UPSTREAM_UNAVAILABLE, VALIDATION_ERROR
}
```

**Sanitization note**: `LogSanitizer` is already applied inside `CustomerLogsService`. For LLM input, this is desirable — we need stack traces, file paths, module names (kept) but not tokens/passwords (redacted). Do **not** bypass sanitization for LLM calls.

### Budget Override

Add to `packages/ai-grants/src/grant-session-manager.ts`:

```typescript
export enum BudgetOverride {
  // ... existing
  DiagnoseTask = "airo-builder:paas-diagnose-task",
}
```

**Platform team must** provision the GoCode budget for `airo-builder:paas-diagnose-task` before PR 1 deploys — otherwise LLM-tier calls will be rejected at the proxy.

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

## PaaS Tenancy Gap (Open)

`validateAppOwnership` middleware (`agents/src/server/middleware/app-ownership.ts`) reads from the agents SQLite `apps` table. Per the dual-product architecture in `CLAUDE.md`, **PaaS apps may not have a row there** — middleware returns 404.

**Current behavior on this branch.** The diagnose route applies `validateAppOwnership` **and** a JWT product gate (`product === 'PaaSNodeJS'` → else 403 `PRODUCT_NOT_ALLOWED`). There is **no** PaaS-specific bypass of the ownership DB check today — if the PaaS `apps` row is missing, the caller gets 404 even with a valid PaaS JWT.

This is acceptable only because the PaaS flow is expected to upsert an `apps` row via the standard `CustomerLogsService` prerequisites (socket path registration) before the customer can meaningfully hit `/diagnose`. If that assumption breaks, the route needs either (a) a PaaS-aware middleware that falls back to JWT `siteId` validation, or (b) a request-body supervisor path following the dual-product pattern. Decision owner: PaaS control-plane team. Track before GA.

---

## Abuse Prevention

Defense-in-depth today is intentionally light; extend when we see signal.

- **PaaS product gate** — 403 `PRODUCT_NOT_ALLOWED` for any JWT whose product is not `PaaSNodeJS`, so AAB and unknown callers can't even hit the orchestrator.
- **In-flight dedupe** — 409 `ANOTHER_DIAGNOSE_IN_FLIGHT` per appId prevents concurrent/rapid-fire calls from stacking LLM work.
- **LLM timeout** — 30s hard ceiling via `AbortController` on the upstream HTTP call. On abort, the classifier returns a degraded `llm-failure` issue; no socket leak.
- **Request validation** — Zod-enforced `target: 'preview'|'publish'` and `tier: 'pattern'|'llm'` (`embedding` is rejected at the HTTP schema; service still guards with 501 for non-HTTP callers). Log-window (`since`) and line count are not caller-tunable.
- **Per-app cap** — _not implemented today_; the pool is funded by the platform budget override and relies on the above for throttling. Re-open if we see abuse.

---

## Phased Rollout

| PR       | Scope                                                                                                                                                                  | Status                             | Gates before merge                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **PR 1** | Pattern classifier + LLM classifier + `POST /apps/:appId/diagnose` for **`publish` and `preview`**. No cap.                                                            | In review (`harsh/wt_Diagnose_v1`) | Tier 1 unit tests, LLM integration test with real logs, authorization test, GoCode budget provisioned |
| **PR 2** | Cap enforcement (JWT → Switchboard → default, per-app 24h window, atomic SQLite update).                                                                               | Deferred                           | Revisit only if abuse signal appears                                                                  |
| **PR 3** | Preview-specific patterns (dev server startup, HMR failures). The route already accepts `target: 'preview'`; this PR adds PaaS rules tuned for dev-time failure modes. | Pending                            | Preview patterns green on real failed previews                                                        |
| **PR 4** | Embedding classifier (Tier 3) — only if Tier 1 miss rate × LLM cost justifies corpus maintenance.                                                                      | Optional                           | Decision gated on PR 1 + PR 3 metrics                                                                 |
| **PR 5** | Auto-trigger on `BuildError` in `PaaSPublishStrategy`.                                                                                                                 | Optional                           | Opt-in via `analyzeOnFailure: true` flag                                                              |

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

Per `agents/CLAUDE.md`, cases in `src/server/routes/__tests__/authorization-security.integration.test.ts` cover:

- Cross-tenant access rejected (JWT siteId != app owner).
- Non-PaaS product rejected with 403 `PRODUCT_NOT_ALLOWED` (tests mock `agentContext.product = 'PaaSNodeJS'` to reach the service code path).
- A stub `DiagnoseService` is injected via `_setDependencies()` so the route is exercised without hitting real dev-supervisor or LLM.

### Unit Tests of note

- `PaaSDiagnoseService.test.ts` — tier dispatch (`pattern` short-circuits LLM; explicit `tier='llm'` skips pattern; non-HTTP `tier='embedding'` → 501 defense-in-depth); in-flight dedupe; `noerrlog` early-exit when no error-level or error-token logs present; `ClassifierResult.degraded === true` surfaces as `{success:false, errorCode:'LLM_FAILURE'}`.
- `LlmClassifier.test.ts` — failure-mode assertions (`llm-failure`, `llm-prompt-missing` each set `degraded: true`; ENOENT from the LLM call path stays as `llm-failure`, not `llm-prompt-missing`).
- `LlmClassifier.prompts.test.ts` — sentinel passthrough (`no-platform-violation-detected`, `insufficient-log-evidence`) plus Zod schema validation of each sentinel shape.
- `DiagnoseLlmClient.test.ts` — AbortController timeout + upstream cancel; JSON-parse failure; `json`-fence stripping; schema-mismatch error; non-timeout rethrow.
- `diagnose.test.ts` (route) — product gate, tenant isolation, schema rejection of `tier='embedding'`, errorCode→status mapping table (including `LLM_FAILURE → 500`).
- `date-utils.test.ts` — `toIsoDateString` corner cases.

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

1. **Functional**: API returns actionable recommendations for common failures; LLM-tier output validates against the JSON schema.
2. **Performance**: Tier 1 responses < 500ms; Tier 2 (LLM) responses < 10s (p95).
3. **Cost**: Real per-analysis cost measured in PR 1 and documented; cap math revisited only if PR 2 is reopened.
4. **Coverage**: Correctly identifies 80%+ of test failure scenarios across pattern + LLM tiers.
5. **Quality**: All tests pass; authorization tests added; no TypeScript/lint errors; observability events emitted across the pipeline:

   - invocation: `diagnose.invocation.start`, `diagnose.invocation.rejected`
   - tiers: `diagnose.tier.pattern.hit`, `diagnose.tier.pattern.failure`, `diagnose.tier.llm.hit`, `diagnose.tier.llm.failure`, `diagnose.tier.llm.prompt_missing`, `diagnose.tier.not_implemented`
   - LLM response parsing: `diagnose.llm.parse_error`, `diagnose.llm.schema_error`
   - logs / early-exit: `diagnose.logs.fetch_failed`, `diagnose.early_exit.no_failure`

   `diagnose.cap.*` is reserved for PR 2 only.

---

## Future Enhancements (Post-POC)

| Enhancement            | Description                                    | Effort |
| ---------------------- | ---------------------------------------------- | ------ |
| Tier 3 Embedding       | Third-tier classifier (only if data justifies) | 2 days |
| Auto-trigger           | Invoke from `BuildError` path automatically    | 1 day  |
| Requirements Checklist | Compare against expected project structure     | 3 days |
| Historical Analysis    | Track common failures per customer             | 1 week |
| Proactive Analysis     | Analyze before publish to catch issues early   | 3 days |
| Multi-language Support | Pattern definitions for Python, Ruby, etc.     | 1 week |
| Continuous iteration   | Re-analyze after customer fix attempt          | 1 week |

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
- `ClassifierResult.degraded === true` — the LLM tier returned a sentinel (`llm-failure` or `llm-prompt-missing`) rather than a real finding. Today this already surfaces as HTTP 500 `LLM_FAILURE`; the log entry gives ESSP triage visibility without relying on response-body scraping.
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
