# Feedback Fan-out Automation — Design

**Status:** **Implemented** (PR #3839, 2026-05-20). Sections below describe the original design as drafted on 2026-05-14. See [Implementation Deltas](#implementation-deltas) at the bottom for the as-shipped behavior where it diverges from this design.
**Author:** skilaru-godaddy
**Date:** 2026-05-14 (drafted) · 2026-05-20 (deltas appended)
**Related:** PR #3782 (CRM case on Report Issue), PR #3405 (Airo feedback investigator), PR #3652 (S2S IAM JWT for investigator), PR #3596 (feedback storage enrichment), PR #3839 (this implementation)

## Goal

Cut feedback resolution time by automating triage on customer feedback that signals a problem. On submit, the BFF opens a CRM case and kicks off the existing investigator Lambda; when the investigation completes, the Lambda enriches the CRM case with a caseNote containing the root-cause summary and a deep link to the full investigation report. Slack notification stays on the existing client-side webhook flow.

## Scope (v1)

**In:**

- `issue` (Report Issue / bug report) — already opens CRM case via PR #3782; extend with investigator invoke.
- `support` (Get Support) — new: opens CRM case + investigator.
- `feedback` (Share Feedback / NPS) **with `rating != null && rating < 5`** — new: opens CRM case + investigator. Captures Displeased (1–3) and Neutral (4).
- Lambda post-completion fan-out: PATCH CRM case caseNote with AI summary + report deep link.

**Out:**

- NPS ≥ 5 / null → existing S3 store + Slack notification path unchanged. No CRM case. No investigator.
- Thumbs-up / thumbs-down post-generation feedback (separate flow).
- Retry harness, DLQ, EventBridge orchestration.
- New "fan-out" Lambda (BFF + extended investigator Lambda is sufficient).
- Customer-visible investigation status.
- **Slack thread reply / bot token migration / `chat.postMessage`. Deferred to a later iteration.** Initial Slack notification on submit continues to use the existing client-side incoming webhook flow without modification.

## Non-goals

- Replacing the debug-console-driven manual investigation flow. Both entry points (manual + feedback) coexist; investigation state schema gets a `source` field to differentiate.
- Cross-app correlation, deduplication of repeat feedback. Each submit triggers a fresh investigation.
- Localization of caseNote copy in v1 (English only; matches existing CRM case body).
- Any change to `app/src/app/api/slack-webhook/feedback/route.ts`, `slackBuilders.ts`, or `sendFeedbackToSlack`. They stay as-is.

## Architecture

### Trigger matrix

| Category | Form payload | Triggers fan-out? | CRM severity |
|---|---|---|---|
| `issue` | `{topics, description, followUp}` | Always | S2 (existing) |
| `support` | `{topics, description, followUp}` | Always | S3 |
| `feedback` | `{rating, topics, comment, customerConsent}` | `rating != null && rating < 5` | S3 |
| `feedback` | `rating ≥ 5` or `null` | No fan-out (existing path) | — |

`shouldFanOut` is computed client-side in `submitFeedback.ts` as a UI hint; the BFF re-validates server-side (zero trust on client classification).

### High-level shape

- **No new Lambda.** BFF orchestrates the synchronous fan-out (CRM open + investigator invoke). The existing investigator Lambda is extended with a post-completion step (CRM caseNote PATCH).
- **Investigator invoke is async** (`InvocationType: 'Event'`). Customer never waits for cold start.
- **Slack stays as-is.** Existing client-side `sendFeedbackToSlack` continues to fire in parallel with `/api/feedback/submit`. No coordination between Slack post and CRM/investigator fan-out in v1.
- **Best-effort independence.** CRM open and investigator invoke each run in their own try/catch on the BFF. A failure in one does not cascade. Investigator gracefully skips its CRM caseNote step if `crmCaseId` is missing in its input.

### Phase 1 — Customer submit (sync, ~1–3 s budget)

1. Client (`submitFeedback.ts`) receives form data per category; computes `shouldFanOut`.
2. Client calls in parallel (existing parallelism preserved):
   - `POST /api/feedback/s3-store` (always; existing, unchanged).
   - `POST /api/slack-webhook/feedback` (always; existing, unchanged).
   - `POST /api/feedback/submit` (new) — **only when `shouldFanOut` is true**. Owns CRM case open + investigator invoke.
3. **`POST /api/feedback/submit`** (new BFF route):
   - Auth: `withCustomerAuth` — pulls `customerId`, `shopperId`, `authType` from JWT. Block impersonation (`e2s`) and TLA (3-char shopperId) — same gates as today's `/api/crm/case`.
   - Switchboard flag: `appbuilder-feedback-fanout` (new), default off; phased rollout.
   - Validate body shape per `category`. Server-side enforces `rating < 5` for `feedback` category. Reject 400 if mismatched.
   - **Step 1**: open CRM case via `openCrmCase(input)` (existing client; extended to accept `category` + variant payload, see below). Capture `{caseId, caseNumber}`.
   - **Step 2**: invoke investigator Lambda (`InvocationType: 'Event'`) with feedback-flavored payload (see Investigator Input Schema). Failure logged, not surfaced.
   - Return `{success: true, caseId, caseNumber}` to client. UI shows "Case #N opened. We're investigating." toast.
4. Independent failure handling:
   - CRM open fails → no `caseId`/`caseNumber`. Continue: invoke investigator **without** `crmCaseId` (lambda will skip caseNote step). Return `{success: true, caseId: null}` (Slack post + S3 store sibling calls already succeeded). Client toast falls back to "Thanks for your feedback".
   - Investigator invoke fails → CRM still landed. Customer sees success with caseNumber.
   - Both fail → return 502; client growls "Submit failed, retry."
5. Modal closes on success. The existing client-side `sendFeedbackToSlack` and `storeToS3` calls run independently and have their own success/failure paths (unchanged).

### Phase 2 — Investigator runs (async, ~60–120 s)

Existing flow, unchanged. Lambda mints S2S IAM JWT for GoCode (PR #3652), runs LLM investigation against logs (Loki), agent state, and Langfuse evidence (PR #3573); writes report markdown to S3; emits SSE events for debug-console live view (PR #3646).

### Phase 3 — Lambda post-completion fan-out (new)

After report markdown is written and state transitions to `completed`:

1. **CRM caseNote PATCH** (only if `crmCaseId` present in input):
   - Lambda mints SSO JWT via cert from Secrets Manager (new IAM permission). Reuses the same cert material as the BFF; rotation is centralized.
   - PATCH `https://crm.int.test-godaddy.com/api/case-management/v1/case/{caseId}` adding caseNote: `"AI Investigation: <one-line summary>. Full report: <debug-console deep link>"` (URL: `https://debug-console.gd3p.tools/investigate/{investigationId}`).
   - Failure logged, non-fatal.
2. Lambda exits.

> **Deferred:** Slack thread reply on investigation completion. Will be added in a later iteration once the bot-token migration is in place. Current Slack notification is fire-and-forget on submit only.

### Audience-facing outcome

- **Customer:** instant submit, toast with case number. No further UI.
- **Engineering Slack channel:** existing top-level notification with description, Preview link (caseNumber **not** included in v1 because Slack post happens client-side in parallel with CRM open and does not wait for the caseNumber). Investigation result is visible only via debug-console / CRM case in v1.
- **Support (CRM):** case opens immediately with description in Escalation Details. CaseNote auto-added ~2 min later with AI summary + report link. Support clicks link → debug-console renders the investigation report (auth-gated: existing JOMAX flow). **This is the primary surface for resolution in v1.**
- **Debug console:** investigation appears in InvestigatePanel list as before; new `source: 'feedback'` filter chip lets internal users distinguish manual vs auto.

## Components

### New code

| Path | Role |
|---|---|
| `app/src/app/api/feedback/submit/route.ts` | Feedback fan-out endpoint. Owns CRM open + investigator invoke. Called only on the fan-out path (issue / support / feedback w/ rating<5). |
| `app/src/lib/investigate/invoke.ts` | Server-side investigator Lambda invoker. Same shape as `debug-console/src/lib/investigate/lambda-client.ts` but lives in BFF. Reads `INVESTIGATE_LAMBDA_FN` and `AWS_REGION` from env. Authenticates via Lambda execution role attached to Katana deployment. |

### Extended code

| Path | Change |
|---|---|
| `app/src/lib/crm/case-client.ts` | `openCrmCase()` accepts new `category: 'issue' \| 'support' \| 'feedback'` + variant payload. Builds category-specific Escalation Details and severity (S2 for issue, S3 for support/feedback). |
| `app/src/components/feedback/submitFeedback.ts` | Adds `submitFeedbackFanout()` helper that POSTs to `/api/feedback/submit` for fan-out categories. Existing `openCrmCaseForIssue` direct call is removed (now wrapped inside `/api/feedback/submit`). `sendFeedbackToSlack` and `storeToS3` calls remain unchanged — they continue to fire in parallel. |
| `app/src/components/feedback/FeedbackMultiStep.tsx` | Each `handle*Submit` callback computes `shouldFanOut` and calls `submitFeedbackFanout()` alongside existing Slack/S3 calls. Toast text uses returned `caseNumber` when present, falls back to "Thanks for your feedback" when null. |
| `app/src/app/api/crm/case/route.ts` | Becomes internal-only (not removed for backward compat). Logic of opening a CRM case moves into a shared helper consumed by both this route (issue category, existing client path) and `/api/feedback/submit` (all three categories). Once `/api/feedback/submit` is fully rolled out and `submitFeedback.ts` no longer calls `/api/crm/case` directly, the old route can be removed. |
| `debug-console/src/app/api/investigate/route.ts` | Accept new optional input fields: `crmCaseId`, `crmCaseNumber`, `category`, `rating`, `topics`, `source` ('console' \| 'feedback'). Forward to Lambda payload. Default `source: 'console'`. |
| `debug-console/src/lib/investigate/types.ts` (`InvestigationState`) | Add `source: 'console' \| 'feedback'`, `crmCaseId?: string`, `crmCaseNumber?: string`, `category?: 'issue' \| 'support' \| 'feedback'`, `rating?: number`, `topics?: string[]` to state schema. |
| Investigator Lambda handler (`investigator/handler.mjs` or current path) | Add post-completion step: if `crmCaseId` present → PATCH caseNote with AI summary + report deep link. Gated by env vars (`CRM_API_BASE`, `CRM_CERT_SECRET_ARN`). Wrapped in try/catch; failures logged, never throw. |
| Investigator CDK stack (`cdk/lib/investigator-stack.ts`) | Add IAM `secretsmanager:GetSecretValue` for `airo/feedback/crm-cert` (or whatever name aligns with existing cert path). Add Lambda env: `CRM_API_BASE`, `CRM_CERT_SECRET_ARN`, `DEBUG_CONSOLE_BASE_URL` (for deep links). |

### Removed / cleaned up

- Nothing in v1. `SLACK_FEEDBACK_WEBHOOK_URL` and the existing Slack webhook flow stay untouched.

## Investigator Input Schema (Lambda payload)

```typescript
interface InvestigatorInput {
  // Existing
  investigationId: string;
  appId: string;
  customerId: string;
  feedback: string;          // description (issue/support) or comment (feedback)
  fullstoryUrl: string | null;
  timeWindow: string | null;
  stateKey: string;
  historyPrefix: string;
  resultKey: string;
  tracePrefix: string;
  eventsPrefix: string;
  jomaxToken?: string;        // present only for console-source

  // New
  source: 'console' | 'feedback';
  category?: 'issue' | 'support' | 'feedback';
  rating?: number;
  topics?: string[];
  crmCaseId?: string;
  crmCaseNumber?: string;
}
```

`jomaxToken` becomes optional. When absent (feedback source), Lambda uses its own IAM identity for any downstream service call. Today's S2S IAM JWT path (PR #3652) covers GoCode; if other downstream services require user-identity auth, that gap will be raised as a follow-up — for v1 the investigator works against logs/Loki/agent state which the Lambda role can already reach.

## Data Flow Diagram

```
Customer
  │
  │  Submit (issue/support/feedback)
  ▼
Browser (submitFeedback.ts)
  │   ├──► POST /api/feedback/s3-store ────► S3 (existing, always)
  │   │
  │   ├──► POST /api/slack-webhook/feedback ► Slack incoming webhook (existing, always)
  │   │
  │   └──► POST /api/feedback/submit (only if shouldFanOut)
  │            │
  │            ▼
  │      BFF /api/feedback/submit
  │            │
  │            ├──► CRM API: open case ──► {caseId, caseNumber}
  │            │
  │            └──► Lambda Invoke (Event, async)
  │                     │
  │                     │  payload: {feedback, crmCaseId, category, rating?, ...}
  │                     ▼
  │              Investigator Lambda
  │                     │
  │                     │  (existing) S3 state, GoCode S2S, Loki, Langfuse
  │                     │  Investigation report → S3
  │                     │
  │                     └──► CRM PATCH caseNote (if crmCaseId)
  │
  ▼
Toast: "Case #N opened. Investigating." (or "Thanks for your feedback" on CRM failure)
```

## Failure Modes

| Failure | Behavior |
|---|---|
| S3 store fails | Client growls error. Customer can retry. (Existing behavior, unchanged.) |
| Existing Slack webhook fails | Logged client-side. CRM + investigator paths unaffected. (Existing behavior, unchanged.) |
| CRM open fails inside `/api/feedback/submit` | Continue: investigator invoked **without** `crmCaseId`; lambda skips caseNote step. Endpoint returns `{success: true, caseId: null}`. Toast shows fallback copy. Logged at `feedback.fanout.crm.failed`. |
| Investigator invoke fails inside `/api/feedback/submit` | CRM case still landed. Endpoint returns `{success: true, caseId, caseNumber}`. No investigation. Logged at `feedback.fanout.investigate.invoke_failed`. |
| Both CRM and investigator invoke fail | Endpoint returns 502; client growls "Submit failed, retry." Slack/S3 sibling calls already succeeded so feedback is not lost. |
| Investigator runs to completion but caseNote PATCH fails | Investigation result intact in S3 (visible in debug-console). CRM case stays bare. Logged at `investigate.crm.casenote.failed`. |
| Investigator times out / errors mid-run | Existing zombie-lock recovery (60s stale heartbeat reclaim). No CRM caseNote. CRM case already open. |

All transient failures are best-effort by design. No retries in v1. No DLQ. Cost of an occasional missed caseNote is low (investigation report still reachable via debug-console); cost of a retry storm against CRM is real.

## Security

- **Auth boundary**: customer JWT → BFF → cert SSO JWT (CRM) / Lambda invoke (IAM). Customer cannot inject `customerId`, `shopperId`, `category` overrides; all three derived from JWT or re-validated server-side.
- **Switchboard gate** `appbuilder-feedback-fanout` for phased rollout; default off in prod.
- **Impersonation gate**: e2s and TLA (3-char shopperId) blocked from triggering CRM case creation, matching existing `/api/crm/case` behavior.
- **Cert material in Lambda**: existing cert (used in BFF) is reused. CDK stack adds `secretsmanager:GetSecretValue` policy. No new cert provisioning. Rotation handled by existing pipeline.
- **Deep links** in CRM caseNote point to `debug-console.gd3p.tools/investigate/{id}` — auth-gated. Unauthorized clicks land on the JOMAX login page.

## Logging

All log events use the project's structured logger (`logger.info("domain.operation.lifecycle", { ... })`). New events:

- `feedback.fanout.start` `{customerId, appId, category, shouldFanOut, rating?}`
- `feedback.fanout.crm.success` `{customerId, appId, caseId, caseNumber, category}`
- `feedback.fanout.crm.failed` `{customerId, appId, category, error}`
- `feedback.fanout.investigate.invoked` `{investigationId, appId, customerId, category, hasCrmCaseId}`
- `feedback.fanout.investigate.invoke_failed` `{investigationId, appId, error}`
- `investigate.crm.casenote.success` `{investigationId, caseId}`
- `investigate.crm.casenote.failed` `{investigationId, caseId, error}`

## Testing

### Unit
- `case-client.ts`: variant body builders for all three categories. Severity, secondaryCategory, additionalData.appId, escalation details copy.
- `submit/route.ts`: each fan-out step in isolation with mocked downstream; partial failure paths each return success with caseId/null appropriately.
- `investigator/handler.mjs`: post-completion caseNote step skips when `crmCaseId` absent; failure path leaves investigation result intact.
- Switchboard flag off → endpoint returns 403 `feature-disabled`.
- NPS ≥ 5 / null + `category: 'feedback'` server-side rejection.
- Impersonation / TLA gates.

### Integration
- E2E feedback path (issue, support, feedback < 5): full submit → CRM stub assertion → Lambda invoke stub assertion. Verify caseNumber appears in toast and is forwarded to Lambda payload. Verify existing client-side Slack + S3 calls still fire in parallel.
- Phase-3 path: trigger Lambda directly with feedback-source payload including `crmCaseId` → verify caseNote stub PATCHed.

### E2E (`tests/e2e/`, `tests/regression/`)
- `data-testid` references in `FeedbackMultiStep.tsx` unchanged; existing feedback specs remain valid. New regression spec asserting toast text "Case #N opened" when fan-out path succeeds (mocked CRM in CI).

### Observability
- Grafana dashboard: panel for `feedback.fanout.*` event counts, success vs failure rate, p50/p95 end-to-end latency from submit → caseNote.
- Alert: `feedback.fanout.crm.failed` rate > 5% over 15 min triggers paging.
- Alert: `investigate.crm.casenote.failed` rate > 10% over 1 hr triggers paging (lower urgency since investigation result still reaches debug-console).

## Rollout

1. **Dev**: deploy CDK with new IAM + env. Manual test via debug-console + a staging customer.
2. **Test/INT**: enable Switchboard flag for `internal:test` GoDaddy TLA, exempting them from the TLA gate explicitly for this test path. Validate end-to-end on real CRM test env.
3. **Prod canary**: 5% Switchboard rollout. Monitor `feedback.fanout.*` panel, CRM caseNote success, Lambda error rate.
4. **Prod full**: 100% rollout once 24h canary clean.
5. **Cleanup**: remove the old `/api/crm/case` direct-from-client path once `submitFeedback.ts` is fully on `/api/feedback/submit` and the flag is at 100% for 7 days.

## Migration / Backward Compatibility

- Existing manual investigations from debug-console keep working. Lambda's new fields are optional; `source: 'console'` (default) means it skips the post-completion CRM caseNote.
- Existing `/api/crm/case` endpoint stays callable for backward compat during rollout. Client switches to `/api/feedback/submit` once the flag lands. After cleanup, `/api/crm/case` is removed (or kept as a thin internal helper consumed only by `/api/feedback/submit`).
- Existing `/api/slack-webhook/feedback` and the client-side `sendFeedbackToSlack` flow stay untouched in v1.

## Open Questions

- **Cert reuse in Lambda**: confirmed feasible only if the existing BFF cert in Katana Secrets Manager is reachable from the Lambda's account/region. If not, a separate cert + ACME/manual rotation is required. Verify at implementation time; if blocked, fall back to v1 = CRM open + investigator invoke (no caseNote), and ship caseNote in v1.1 once cert plumbing is sorted.
- **NPS=5 boundary**: spec is `< 5`, capturing 1–4. Confirm "5" is satisfied (today's bucket logic puts 5 in Satisfied; that aligns).
- **Toast copy** when `caseId` is null but investigator did fire: keep generic "Thanks for your feedback" (current decision) or differentiate? Likely fine as-is; revisit if support asks for it.

## Future (out of scope)

- **Slack thread reply on investigation completion** (v2): migrate Slack delivery to bot token (`chat.postMessage`), capture `ts`, and have the Lambda post a threaded reply with the AI summary + report deep link. Requires new Slack app provisioning, `xoxb-` token, and `SLACK_BOT_TOKEN` secret in Secrets Manager + Katana.
- Thumbs-down post-generation auto-investigation.
- Linear ticket creation alongside CRM case.
- Customer-visible "We're investigating" status with eventual resolution post-back to the builder UI.
- ~~Auto-deduplication~~ → **Shipped** in v1 as the spam-click lock (see [Implementation Deltas](#implementation-deltas) §3).
- Translate caseNote copy to non-EN locales.

---

## Implementation Deltas

Sections above are the design as drafted on 2026-05-14 and reviewed before code landed. The list below records every place the as-shipped implementation diverges from that design. Each delta says **what** changed, **why**, and points at the file/PR where the change is real.

### 1. CRM caseNote: POST, not PATCH

- **Designed:** `PATCH https://crm.int.test-godaddy.com/api/case-management/v1/case/{caseId}` adding caseNote.
- **Shipped:** `POST /api/case-management/v1/case/note` with `{caseRecordId | caseExternalId, note, noteType, noteTypeDetails}`.
- **Why:** CMAPI never exposed PATCH `/case/{id}`. Confirmed in [CMAPI Confluence page 3609988873](https://godaddy-corp.atlassian.net/wiki/pages/3609988873). An early revision used PATCH and 404'd on every call; the ship path is POST.
- **Files:** `investigator/crm-casenote.mjs`, `app/src/lib/crm/case-note-client.ts`.

### 2. Severity: S2 for all categories

- **Designed:** S2 for `issue`, S3 for `support` and `feedback`.
- **Shipped:** S2 for all three.
- **Why:** Salesforce routing uses the literal `[ISSUE]` / `[SUPPORT]` / `[FEEDBACK NPS X]` prefix in `escalationDetails` for category triage; the severity field doesn't differentiate routing. Pinning S2 keeps cases in the same SLA tier the existing CRM team handles.
- **Files:** `app/src/lib/crm/case-client.ts:124`.

### 3. Spam-click investigation lock (NEW; not in original design)

- **Shipped:** `POST /api/feedback/submit` checks S3 `active/{customerId}/{appId}/state.json` before invoking the Lambda. If an investigation is already running (state.status non-terminal AND `lastHeartbeatAt` within 15 min), the new submit:
  - Always opens a fresh CRM case (per "always file a case" contract).
  - **Skips** the Lambda invoke.
  - Posts a fire-and-forget cross-link note on the new case pointing at the in-flight `investigationId` so support agents who pick up the deduplicated case can follow the link.
- **Why:** Customers double-click Submit, the form ships to retry on transient errors, and a fresh investigator Lambda costs money + load. Mirrors debug-console's existing `acquireLock` pattern.
- **Files:** `app/src/lib/investigate/active-state.ts` (read + isActive), `app/src/app/api/feedback/submit/route.ts:191-251` (lock check + reuse-path note).

### 4. Cert material: env vars (BFF) + Secrets Manager (Lambda)

- **Designed:** Lambda mints SSO JWT via cert from Secrets Manager; BFF reuses the same cert through unspecified plumbing.
- **Shipped:**
  - **BFF**: cert + key passed via `AIRO_CLIENT_CERT` / `AIRO_CLIENT_KEY` env vars (PEM-encoded). Set on website Katana per env.
  - **Lambda**: `AIRO_CRM_CERT_SECRET_NAME` env var points at a Secrets Manager secret containing PEM.
- **Why:** Katana env-var injection is the simpler path for the BFF; Lambda uses Secrets Manager because env-var rotation in Lambda requires a stack update.
- **Files:** `app/src/lib/crm/airo-cert-token.ts`, `investigator/cert-loader.mjs`, `cdk/lib/investigator-stack.ts`.

### 5. CMAPI async case-creation flow

- **Designed (implicit):** sync POST `/v1/case` returns Salesforce case id immediately.
- **Shipped:** opt into CMAPI's async path by sending `externalSystemId` in the request body. Response is `{ status: "ACCEPTED", referenceId, message }` — the case is created in the background. We treat `referenceId` as the caseId for downstream linking; the real Salesforce caseNumber is fetched later via `GET /v1/case?externalId=<ref>`.
- **Why:** sync CMAPI P99 was ~5s with ~9% of calls > 10s and tail > 15s, timing out our 15s `AbortSignal.timeout` in test-godaddy. Async returns 202/200 in <1s. See [CMAPI Async Case Creation Confluence page 4248897195](https://godaddy-corp.atlassian.net/wiki/pages/4248897195).
- **`externalSystemId` shape:** `airo-{customerId}-{appId|na}-{epochMs}-{randomUUID(8)}` — customerId + UUID suffix prevent rapid double-submit collisions.
- **Files:** `app/src/lib/crm/case-client.ts:138-208`.

### 6. Investigate URL format

- **Designed:** `https://debug-console.gd3p.tools/investigate/{investigationId}`.
- **Shipped:** `${DEBUG_CONSOLE_BASE_URL}/?customerId=...&appId=...&tab=investigate`.
- **Why:** the support-agent flow lands on the console root with the investigate tab pre-selected and the customer/app pre-filled. Param order (`customerId`, `appId`, `tab`) is a contract with that flow. The investigationId is *not* in the URL because the same console page resolves it from active-state for the (customer, app) pair.
- **`DEBUG_CONSOLE_BASE_URL` per env:**
  - `pre-test` / `test` → `https://console.airo-builder.test-godaddy.com`
  - `prod-ecs` → `https://console.airo-builder.godaddy.com`
- **Files:** `app/src/app/api/feedback/submit/route.ts:62-73 buildInvestigateUrl`, `investigator/handler.mjs:268-298 maybeAddCrmCaseNote`.

### 7. Lambda kickoff note (NEW; from review feedback)

- **Shipped:** the BFF posts a fire-and-forget "kicked off" cross-link note to the original CRM case immediately after a successful fresh `invokeInvestigator()` call. The Lambda's terminal `maybeAddCrmCaseNote` only fires on `status === 'completed'`; without the kickoff note, a Lambda kill / timeout / crash would leave the original case with zero AI context.
- **Note text:** `"AI investigation kicked off for this case (investigationId: <id>). Track progress: <url>"`.
- **Files:** `app/src/app/api/feedback/submit/route.ts:283-307`.

### 8. Trace-fallback hardening (NEW; from review feedback)

- **Shipped:** when the skill fails to write `${REPORT_DIR}/{appId}.md`, `handler.mjs` falls back to scraping assistant text from the trace. The fallback now:
  1. Drops everything before the `phase-2-synthesis` marker line so phase-0/1 narration ("Sources complete", "Drilling into raw refs") never reaches the customer-visible CRM caseNote summary.
  2. Prepends a one-line `⚠️ Report reconstructed from execution trace; the synthesis file was not saved by the skill` banner so support agents know the report is lower-fidelity.
- **Why:** the skill's "stay silent in chat" rule is a soft prompt-discipline contract, not enforced. The fallback is the *common* path in Lambda (the model is asked "Want me to save?" and the question is never answered).
- **Files:** `investigator/handler.mjs:723-789`.

### 9. `customerConsent` is a strict required boolean

- **Designed:** payload field on the `feedback` category.
- **Shipped:** `validateFanoutPayload` returns `400 consent-required` when `customerConsent` is anything other than an explicit boolean. Silently coercing missing/`undefined` to `false` would conflate "declined" with "missing" — a compliance footgun.
- **Files:** `app/src/lib/feedback/fanout-validation.ts:99-104`.

### 10. Bidirectional env asymmetry warning

- **Designed:** (none — added during review).
- **Shipped:** route warns at `feedback.fanout.config.bucket_missing` when `INVESTIGATE_LAMBDA_FN` is set without `INVESTIGATE_BUCKET`, and at `feedback.fanout.config.fn_missing` for the inverse.
- **Why:** both deploy mistakes silently degrade the dedup lock or the invoke path; one-direction warns let the inverse mistake stay invisible.
- **Files:** `app/src/app/api/feedback/submit/route.ts:111-126`.

### 11. CMAPI POST `/case/note` semantics: log level

- **Shipped:** the inner case-note POST client logs failures at `warn`, not `error`, because every caller wraps it in fire-and-forget. The caller's own `warn` log is the canonical event; double-logging at mismatched severities triggered false pages on the airo-builder-ui error-rate dashboard.
- **Files:** `app/src/lib/crm/case-note-client.ts:74-89`.

### 12. Investigator skill output discipline + cache stats logging

- **Shipped:** the `airo-log-investigate` skill ships in this PR with explicit "stay silent in chat" output rules in `SKILL.md` and per-phase docs. The Lambda also emits a `claude.usage.summary` log line per investigation with `freshInputTokens / cacheCreationTokens / cacheReadTokens / cacheReadRatio / totalUsd` for cost observability. (A subagent fan-out experiment was added then reverted within this PR after a wall-clock regression; see commits `63c9c0f4d` + `c2ee8a518`.)
- **Files:** `investigator/skills/airo-log-investigate/SKILL.md`, `investigator/skills/airo-log-investigate/phases/*.md`, `investigator/handler.mjs` (cache stats).

### 13. `--max-turns` 35 → 60

- **Designed:** (unspecified).
- **Shipped:** Claude CLI `--max-turns=60` (was 35, briefly 50 on main). The bump was driven by an investigation that legitimately needed more turns to walk a wide log surface; lower caps caused premature termination and missed findings.
- **Files:** `investigator/handler.mjs:122`.

### 14. Source-flavored direct evidence mode

- **Designed (implicit):** Lambda always calls debug-console `/api/investigate-evidence` to fetch logs; debug-console handles Loki/ES/Langfuse/FullStory auth.
- **Shipped:** Lambda still defaults to console-mediated evidence (with JOMAX), but `source: 'feedback'` invocations switch to **direct mode** via `INVESTIGATION_DIRECT_MODE=1` plus per-source credentials (`LOKI_API_KEY`, `EB_LANGFUSE_*`, `*_ES_API_KEY`, `FULLSTORY_API_KEY`). Direct mode is faster (one less hop) and removes the customer-JOMAX dependency for automation-source runs.
- **Why:** the customer doesn't have a JOMAX session for automation-triggered investigations; the Lambda has its own IAM identity and per-source service creds for direct calls.
- **Cred cleanup:** all direct-mode keys + JOMAX_TOKEN + ANTHROPIC_AUTH_TOKEN are `delete`d in `handler.mjs`'s `finally` so warm-container reuse doesn't leak creds across invocations.
- **Files:** `investigator/handler.mjs:946-964`, `investigator/auth.mjs:45-83 buildChildEnv`.

### 15. Reviewer round 1 + 2 fixes (commit `37a99c460`)

- Eager `LambdaClient` / `S3Client` constants (no test seam, build-OOM avoided via `next.config.js` `serverExternalPackages` for `@aws-sdk/*`).
- `isInvestigationActive` type predicate narrows snapshot in callers without `if/else` ladders.
- `cert-not-configured` 403 distinct from `feature-disabled` 403 in the route response body.
- `INVESTIGATE_LAMBDA_FN`-without-`INVESTIGATE_BUCKET` asymmetry warn.
- `MAX_NOTE_CHARS` deprecated → `MAX_DESCRIPTION_CHARS` (alias preserved).
- Three near-identical `decodeJwtExpMs` decoders documented as intentionally divergent (cert-realm SSO vs GoCode S2S).

### 16. Logging events — final names

The shipped event names use the `feedback.fanout.*` prefix (BFF) and `[investigator]` (Lambda console.log/warn/error). The full list (all camelCase fields):

**BFF (`logger.{info,warn,error}`):**
- `feedback.fanout.start`
- `feedback.fanout.crm.success` / `feedback.fanout.crm.failed`
- `feedback.fanout.investigate.invoked` / `feedback.fanout.investigate.invoke_failed` / `feedback.fanout.investigate.skipped` / `feedback.fanout.investigate.reused`
- `feedback.fanout.flag.lookup_failed`
- `feedback.fanout.config.bucket_missing` / `feedback.fanout.config.fn_missing`
- `feedback.fanout.reuse.note_failed` / `feedback.fanout.reuse.note_skipped`
- `feedback.fanout.kickoff.note_failed`
- `feedback.crm.case-client.post.{start,success,failed,parse_failed}`
- `feedback.crm.case-note-client.post.{success,failed}`

**Lambda (`console.{log,warn,error}`):**
- `[investigator] claude.usage.summary` (cache stats)
- `[investigator] crm.casenote.success` / `crm.casenote.failed` / `crm.casenote.skipped`
- `[investigator] report.fallback.trace_stitched`
- `[investigator] history report copy failed`
- `[investigator] workDir cleanup failed`

### 17. Test count

- **Designed:** unit tests per task; integration smoke. Specific count not specified.
- **Shipped:** 144 tests green: 114 BFF (Vitest) + 10 Lambda (Node `--test`) + 20 Python (`unittest`). Pre-commit hooks (`pnpm lint`, i18n key validation) green.

---

*This deltas section is the canonical "as-shipped" reference. The body of the spec above is preserved verbatim as the original design document for audit trail.*
