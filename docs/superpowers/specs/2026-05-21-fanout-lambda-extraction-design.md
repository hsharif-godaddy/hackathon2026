# Fanout Lambda Extraction — Design

**Status:** Implementation in progress — see [plan](../plans/2026-05-21-fanout-lambda-extraction.md)
**Date:** 2026-05-21
**Owner:** skilaru-godaddy
**Related:**
- [PR #3946 — Automated investigation fan-out on customer feedback](https://github.com/gdcorp-partners/airo-app-builder/pull/3946) (BFF fanout, current)
- [2026-05-14 — Feedback fanout automation design](./2026-05-14-feedback-fanout-automation-design.md) (predecessor design)
- [CMAPI Confluence](https://godaddy-corp.atlassian.net/wiki/spaces/CRM/pages/3609988873)

## 1. Summary

Move feedback fanout (Slack webhook + CRM case open + investigator Lambda invoke) out of the AAB BFF route into a dedicated AWS Lambda triggered by S3 ObjectCreated events on the feedback bucket. BFF stays slim — it authenticates, validates, and writes the parquet record. The new fanout Lambda owns every downstream side-effect.

This separates customer-facing latency from CMAPI tail latency, isolates blast radius, and makes fanout failures replayable via SQS DLQ rather than swallowed by a one-shot HTTP request.

## 2. Goals

1. Move CRM open + Slack post + investigator invoke out of BFF
2. BFF response time drops to S3-write latency only (~50ms) regardless of CMAPI/Slack health
3. Fanout failures retryable via SQS DLQ replay
4. Spam-click protection: 60-min sliding window per `(customerId, appId)` — duplicate submissions append a note to the existing CRM case rather than open a new one
5. Heavy investigator Lambda (Claude 60-turn run) protected by its own existing dedup (no new lock added there)
6. Cutover via switchboard flag — atomic flip, rollback safe

## 3. Non-goals

- Replacing BFF feedback endpoint (BFF still gates auth, validation, switchboard, writes to S3)
- Changing investigator Lambda behavior (existing PR #3946 stays as-is for the heavy investigation path)
- Registering custom Salesforce fields with CRM team (`airoBuilderAppId`, `airoBuilderCustomerId` would unlock CMAPI server-side dedup but is blocked on CRM team registration; out of scope)
- Switching from S3 events to SQS or EventBridge as trigger transport (S3 ObjectCreated is sufficient at our scale)

## 4. Architecture

```
┌───────────┐        ┌──────────────┐        ┌─────────────────────────┐
│  Browser  │────────▶  AAB BFF     ├────────▶ S3: feedback bucket     │
│  (UI)     │ POST   │  /api/feed   │ Write  │ airo-builder-feedback-* │
└───────────┘        │  back/submit │ parq   └────────────┬────────────┘
                     └──────────────┘                     │ ObjectCreated
                            │                             │
                            ▼ 200 OK                      ▼
                     Customer toast              ┌──────────────────┐
                                                 │  Fanout Lambda   │ ◀── DLQ (SQS)
                                                 │  (NEW)           │
                                                 └──┬───┬───┬───┬───┘
                       ┌────────────────────────────┘   │   │   │
                       ▼                                ▼   │   │
                ┌──────────────┐  ┌──────────────────────┐   │   │
                │ S3 state.json│  │  Slack webhook        │   │   │
                │ (same bucket)│  │  (only on fresh path) │   │   │
                └──────────────┘   └──────────────────────┘   │   │
                                                              ▼   │
                                              ┌──────────────────────┐
                                              │  CMAPI                │
                                              │  POST /v1/case        │
                                              │  GET /v1/case?caseId  │
                                              │  POST /v1/case/note   │
                                              └──────────────────────┘
                                                                  │
                                                                  ▼
                                              ┌──────────────────────┐
                                              │ Investigator Lambda  │
                                              │ (existing, untouched)│
                                              └──────────────────────┘
```

### 4.1 Components

| Component | New / Existing | Role |
|---|---|---|
| AAB BFF `/api/feedback/submit` | Existing (slimmed) | Auth, validate, write parquet to feedback bucket; no CRM/Slack/invoke |
| Feedback S3 bucket | Existing | AAB writes parquets; fanout reads parquets + reads/writes dedup state.json |
| Fanout Lambda | NEW | Reads parquet, dedup-checks, fans out to Slack + CRM + investigator |
| Investigator Lambda | Existing, unchanged | Heavy Claude run; has its own state lock |
| Investigator state bucket | Existing, untouched by fanout | Investigator-only |

### 4.2 S3 prefixes inside feedback bucket

```
airo-builder-feedback-{env}/
├── table_prefix/year=YYYY/month=MM/day=DD/hour=HH/appId=X/...parquet  ← AAB writes
└── dedup/{customerId}/{appId}/state.json                              ← Fanout writes
```

Fanout owns the `dedup/` prefix exclusively. AAB BFF writes only to the parquet partition path.

## 5. Data flow

### 5.1 BFF flow (slim)

```
POST /api/feedback/submit
  ├── withCustomerAuth → { customerId, shopperId, authType }
  ├── isEmployeeAuthType(authType) → 403 impersonation-not-allowed
  ├── shopperId.length === 3       → 403 internal-user-not-allowed
  ├── !switchboard('appbuilder-feedback-fanout') → 403 feature-disabled
  ├── !validateFanoutPayload(raw)  → 400 <error-code>
  ├── submissionId = uuid()
  ├── Write parquet to feedback bucket
  │     key:  table_prefix/year=2026/month=05/day=21/hour=11/appId={appId}/2026-05-21T11:30:00Z-{submissionId}.parquet
  │     row:  { schemaVersion: 1, submissionId, submittedAt, customerId, shopperId, appId,
  │             category, description|null, comment|null, rating|null, topics,
  │             customerConsent|null, fullStoryUrl|null }
  └── Return 200 { success: true, submissionId }
```

BFF does not call CMAPI, Slack webhook, or investigator Lambda. Customer-facing latency is bounded by S3 PutObject (~50ms P99).

### 5.2 Fanout Lambda flow

```
Step 1 — Read parquet from S3
  event.bucket + event.key → GetObject → parquet → record
  Validate record.schemaVersion === 1; else log warn + ack-exit

Step 2 — Dedup check
  stateKey = `dedup/${urlEncode(customerId)}/${urlEncode(appId)}/state.json`
  GetObject(stateKey):
    ├── 404 NoSuchKey                          → FRESH path
    ├── exists, age (now - startedAt) > 60min  → FRESH path (overwrite)
    └── exists, age <= 60min                    → DEDUP HIT path

Step 3a — FRESH path
  3a.1  Conditional state write — PutObject(stateKey, body, IfNoneMatch: '*')
        body: { schemaVersion: 1, submissionId, crmCaseId: null,
                startedAt: now, lastUpdatedAt: now }
        On 412 PreconditionFailed → another Lambda won race → ack-exit
  3a.2  POST CMAPI /v1/case
        externalSystemId: `airo-{customerId}-{appId|na}-{submissionId}` (deterministic on submissionId for retry-safety)
        Result: { id: "500U900000TP4kYIAT", caseNumber: "00012345", referenceId, created: true }
        On 5xx → re-throw → SQS retry
  3a.3  Update state.json (read-modify-write with IfMatch: etag)
        merge: { crmCaseId: "500U900000TP4kYIAT", lastUpdatedAt: now }
  3a.4  POST Slack webhook
        webhook URL from Secrets Manager (cached)
        On 5xx → log warn, continue
  3a.5  POST CMAPI /v1/case/note (kickoff link)
        caseRecordId: crmCaseId
        note: "AI investigation kicked off. Track: <ctx-url>"
        On 5xx → log warn, continue
  3a.6  Invoke Investigator Lambda (async)
        payload: { investigationId, customerId, appId, source: "feedback",
                   feedback, category, rating, topics, customerConsent,
                   crmCaseId, crmCaseNumber, ...keys }
        On 5xx → log warn, continue
  3a.7  Lambda exits success → S3 event ack

Step 3b — DEDUP HIT path
  3b.1  GET CMAPI /v1/case?caseId={state.crmCaseId}
        ├── 200 + status === "Open"  → continue 3b.2
        ├── 200 + status terminal    → STALE → fall through to FRESH path 3a (overwrite state)
        └── 404                      → STALE → fall through to FRESH path 3a
  3b.2  POST CMAPI /v1/case/note (append)
        caseRecordId: state.crmCaseId
        note: "Duplicate submission within 60-min window. SubmissionId: ... Feedback: ... Rating: ..."
        On 5xx → log warn, exit (best-effort)
  3b.3  Update state.json (merge: lastUpdatedAt only — startedAt unchanged)
  3b.4  Skip Slack (no channel re-ping)
  3b.5  Skip Investigator invoke (existing one running OR completed)
  3b.6  Lambda exits success
```

## 6. State.json schema

```typescript
interface FanoutDedupState {
  schemaVersion: 1;
  submissionId: string;            // first submission's uuid
  crmCaseId: string | null;        // SF Record ID (e.g. 500U900000TP4kYIAT). Null until step 3a.3.
  startedAt: number;               // epoch ms — anchors 60-min window
  lastUpdatedAt: number;
}
```

Minimal by design. CMAPI is the source of truth for case status, caseNumber, notes; we re-fetch on every dedup-hit verification rather than caching. State.json's only job is to remember "did we open a case for `(customerId, appId)` recently? if so, which one?"

## 7. Idempotency contract

`externalSystemId` on POST `/v1/case` is `airo-{customerId}-{appId|na}-{submissionId}`.

- `submissionId` is the parquet's UUID, generated once by BFF
- On Lambda retry (SQS redelivery): same parquet → same submissionId → same externalSystemId
- CMAPI upserts on externalId match: response `created: false` indicates retry hit existing case
- Lambda treats `created: false` like a fresh path successfully completed (state.json already has caseId from prior run; no-op)

## 8. Failure handling

| Failure | Action |
|---|---|
| Parquet unreadable | Log error → fail Lambda → SQS retry → DLQ on 3rd fail |
| `schemaVersion` mismatch | Log warn → ack-exit (no retry — bad data won't get better) |
| State.json corrupt JSON | Log warn → treat as 404 → fresh path |
| State conditional write 412 (race lost) | Ack-exit cleanly — winner does the work |
| Slack 5xx | Log warn → continue (best-effort) |
| CMAPI POST 5xx | Re-throw → SQS retry (idempotent via externalSystemId) |
| CMAPI GET 404 (stale state) | Fall through to fresh path |
| CMAPI GET status terminal | Fall through to fresh path (case closed during window) |
| Investigator invoke fail | Log warn → continue (state has caseId; manual replay possible) |
| Lambda timeout (60s) | SQS retry; resumes from state.json checkpoint via etag merge |

## 9. Lambda spec

| Setting | Value | Reason |
|---|---|---|
| Runtime | Node.js 22.x | Match investigator Lambda toolchain |
| Architecture | arm64 | Cheaper, same code |
| Memory | 512 MB | Parquet read + JSON parse + 4 HTTP calls |
| Timeout | 60s | CMAPI P99 ~5s × 3 calls + Slack + invoke + buffer |
| Reserved concurrency | 50 | Throttle to protect CMAPI from spike |
| Trigger | S3 ObjectCreated on feedback bucket, prefix `table_prefix/` | Native AWS dedup retry |
| Async invoke retries | 2 (Lambda built-in) | Then to DLQ |
| DLQ | SQS, 14-day retention | Replay-friendly for manual recovery |

### 9.1 Environment variables

```
INVESTIGATE_LAMBDA_FN
INVESTIGATE_BUCKET                  # for invoke payload S3 keys passed through
FEEDBACK_BUCKET                     # for state.json read/write
SLACK_WEBHOOK_SECRET_ARN
CRM_BASE_URL                        # https://crm.int.{env-}godaddy.com
CERT_SECRET_ARN
LOG_LEVEL                           # default: info
DEBUG_CONSOLE_BASE_URL              # for kickoff note `?ctx=` URLs
```

### 9.2 IAM (least-privilege)

```
- s3:GetObject               on  arn:aws:s3:::airo-builder-feedback-{env}/table_prefix/*
- s3:GetObject,PutObject     on  arn:aws:s3:::airo-builder-feedback-{env}/dedup/*
- secretsmanager:GetSecretValue on  slack-webhook-arn, cert-arn
- lambda:InvokeFunction      on  arn:aws:lambda:*:*:function:airo-investigator-{env}
- sqs:SendMessage            on  fanout-dlq-arn
- logs:CreateLogStream,PutLogEvents on  /aws/lambda/airo-fanout-{env}/*
```

No SSM, no DynamoDB, no cross-account, no investigator-bucket access.

## 10. CDK changes

New stack: `cdk/lib/feedback-fanout-stack.ts`

```typescript
new FeedbackFanoutStack(app, 'FeedbackFanoutStack', {
  envName: config.envName,
  feedbackBucket: feedbackS3Stack.feedbackBucket,           // cross-stack ref
  investigatorFunctionArn: investigatorStack.lambdaArn,     // for invoke
  slackWebhookSecretArn: '<slack-secret-arn>',
  certSecretArn: investigatorStack.certSecretArn,           // reuse
  debugConsoleBaseUrl: config.debugConsoleBaseUrl,
});
```

Resources created:
- Lambda function `airo-fanout-{env}` (NodejsFunction or DockerImageFunction)
- SQS DLQ `airo-fanout-dlq-{env}` (14-day retention)
- IAM role with policies above
- S3 ObjectCreated notification on feedback bucket → Lambda
- CloudWatch log group with 30-day retention
- CloudWatch alarms:
  - DLQ depth > 0 for 5 min
  - Lambda error rate > 5% over 15 min
  - Lambda duration P99 > 30s over 15 min
  - Divergence between feedback parquets received and CRM cases opened (sanity check for lost S3 events)

## 11. Source layout

```
fanout/
├── handler.mjs              ← S3 event entry, orchestrates flow
├── handler.test.mjs
├── parquet-reader.mjs       ← parquet → record
├── parquet-reader.test.mjs
├── state.mjs                ← S3 state.json read/conditional-write/etag-merge
├── state.test.mjs
├── slack.mjs                ← webhook POST
├── slack.test.mjs
├── crm-client.mjs           ← copy from investigator/ — POST case + GET case + POST note
├── crm-client.test.mjs
├── crm-token.mjs            ← copy from investigator/
├── cert-loader.mjs          ← copy from investigator/
├── package.json
├── README.md
└── Dockerfile (matches investigator/Dockerfile pattern)
```

### 11.1 Code-sharing decision

Copy-paste `crm-client.mjs`, `crm-token.mjs`, `cert-loader.mjs` from investigator/ into fanout/ for v1.

**Rationale:** ~200 lines of duplication. Investigator and fanout are likely to evolve in different directions (investigator drives Claude, fanout drives Slack/CRM); coupling them via a shared package would block one's iteration on the other. Lift to `packages/lambda-shared/` later if maintenance cost actually materializes.

## 12. Cutover plan

### 12.1 Switchboard flag

`appbuilder-fanout-via-lambda` (boolean, default OFF). Created in test + prod (Switchboard `airo-app-builder` app).

### 12.2 Deploy sequence

| PR | Branch base | Changes | Effect |
|---|---|---|---|
| 1 (this design) | `main` | New CDK stack, fanout/ source, switchboard flag created (OFF) | Lambda live, idle (flag-gated, exits on entry if OFF) |
| 2 (BFF slim) | `feature/feedback-fanout-clean` (existing PR #3946) OR follow-up | BFF writes parquet to feedback bucket on every submit; gates CRM+invoke behind `appbuilder-fanout-via-lambda` (skip if ON) | BFF emits parquet always; legacy fanout still runs when flag OFF |
| 3 (cleanup) | After 1 week stable | Delete BFF fanout code, delete switchboard flag | BFF responsibilities reduced to auth + validate + write S3 |

### 12.3 Cutover sequence per env

1. Deploy PR #1 → Lambda live, flag OFF → no behavior change
2. Deploy PR #2 → BFF writes parquet always → fanout still BFF-side because flag OFF
3. Test env: flip flag ON → fanout Lambda owns dispatch; verify CRM, Slack, investigator
4. Prod: flip flag ON
5. Watch metrics 1 week
6. Deploy PR #3 → cleanup

Atomic rollback: flip flag back to OFF; BFF resumes fanout.

## 13. Cross-Lambda contract

| Field | Fanout writes | Investigator reads |
|---|---|---|
| Invoke payload `crmCaseId` | ✅ | ✅ — uses for terminal CRM mergeState note |
| Invoke payload `investigationId` | ✅ | ✅ — uses for own dedup lock |
| `dedup/.../state.json` (feedback bucket) | ✅ | ❌ never reads |
| `active/.../state.json` (investigator bucket) | ❌ never reads | ✅ |

Lambdas pass data via invoke payload only. No shared S3 file. No etag merge dance between them.

## 14. Risks

### 14.1 S3 event lost (low frequency, hard to detect)

S3 ObjectCreated is at-least-once but not strictly guaranteed. Lost event → parquet exists, no fanout. Detection via CloudWatch alarm on divergence between parquet count and CRM case count over 15-min window. Recovery: manual replay by re-emitting ObjectCreated event for stuck parquets.

### 14.2 Stale state during agent intervention

Agent closes case mid-window. Customer submits again. State.json still says case is open. GET CMAPI catches this (status check) → fall through to fresh path. Cost: tiny edge case, handled.

### 14.3 State.json schema evolution

Schema change requires either backward-compat shim or one-shot migration. Mitigation: `schemaVersion` field; state files older than 60min are stale anyway and overwritten on next submit. Effectively a 1-hour drain.

### 14.4 Cross-Lambda invoke payload schema drift

Fanout adds field to invoke payload → investigator must accept (or ignore unknown). Mitigation: investigator already permissively destructures payload; new fields are additive only.

## 15. Out-of-scope follow-ups

- File CMAPI ticket to register `airoBuilderAppId` + `airoBuilderCustomerId` as Salesforce additionalData fields (would unlock server-side dedup search; nice-to-have, not blocking)
- DynamoDB-backed state if S3 conditional-write contention becomes an issue (no expected scale that'd hit it)
- Step Functions orchestration (overkill for current scope)
- Lift shared CMAPI/cert utilities to `packages/lambda-shared/` (defer until duplication actually causes pain)

## 16. Decisions log

| Decision | Why | Date |
|---|---|---|
| Separate Lambda over BFF inline | Customer latency, replay-ability, blast radius isolation | 2026-05-21 |
| Branch off `main` (not stacked on PR #3946) | Independent infra, non-blocking review, easier merge order | 2026-05-21 |
| S3 ObjectCreated trigger | Native AWS retry, replay-friendly, matches data-lake pattern | 2026-05-21 |
| Lambda owns Slack + CRM + invoke | Single source of truth, secrets stay server-side | 2026-05-21 |
| BFF keeps auth + validation + switchboard | Cheap garbage rejection at edge | 2026-05-21 |
| Dedup via S3 state.json (not CMAPI custom-field search) | CRM team registration is blocker; state file ships now | 2026-05-21 |
| State.json in feedback bucket #1 (own prefix), not investigator bucket #2 | Self-contained, no cross-Lambda file sharing | 2026-05-21 |
| Minimal state.json schema (caseId + window only) | CMAPI is source of truth; cache pointer only | 2026-05-21 |
| externalSystemId deterministic on submissionId (drop epochMs+uuid) | Lambda retry idempotency via CMAPI upsert | 2026-05-21 |
| Switchboard flag for cutover | Atomic flip, atomic rollback | 2026-05-21 |
| Copy-paste shared utilities into fanout/ | Lambdas evolve independently; lift to package later if pain | 2026-05-21 |

## 17. Test plan

### 17.1 Unit (vitest, Node `--test`)

- Parquet reader: schema v1 happy path, schema mismatch warn, malformed bytes
- State reader: 404, valid JSON, corrupt JSON, age > 60min, age within window
- State writer: 412 race, etag merge retry, 3-attempt cap
- CRM client: POST case 200/5xx, GET case Open/Closed/404, POST note
- Slack client: 200, 5xx swallow
- Handler: each branch (FRESH happy path, DEDUP HIT happy path, stale state fallthrough, race-loss exit, schema mismatch exit)

### 17.2 Integration

- LocalStack S3 + Lambda harness for ObjectCreated event flow
- Mock CMAPI server with deterministic responses for end-to-end
- Mock Slack webhook returning 200 / 5xx

### 17.3 Manual / E2E in test env

Test environment + DEV switchboard flag flips:
1. Submit feedback → verify CRM case opens + Slack pings + investigator invoked
2. Spam-click within 60 min → verify second case is NOT opened; existing case has appended note
3. Spam-click after 60 min → verify fresh case opens
4. Different appId same customer → verify independent locks
5. Force CMAPI 5xx → verify SQS retry, eventual DLQ
6. Force Lambda timeout → verify state checkpoint; retry resumes
7. Flag flip back to OFF → verify BFF resumes legacy fanout cleanly

## 18. Implementation handoff

Next step: invoke `writing-plans` skill to break this design into implementation tasks ordered by dependency. Plan should produce:
- Task list scoped to PR #1 (Lambda + CDK + tests)
- Task list scoped to PR #2 (BFF slim + flag-gated cutover)
- Task list scoped to PR #3 (cleanup)

Each PR independently mergeable per the cutover plan in §12.

## 19. Jira fanout (AABSP) — addendum

Added as a 5th fanout step after Slack + CRM + investigator. Wrapped in
`try/catch` warn-not-throw so a Jira failure never blocks or rolls back
prior fanouts.

**Eligibility:**
- `issue` → always (Bug)
- `support` → always (Task)
- `feedback` → only when `rating != null && rating < 5` (Task)

**Auth:** Basic auth with a service-account email + Atlassian API
token (Atlassian OAuth 3LO does not support a clean
`client_credentials` grant; the SA API token is the supported
non-interactive path). The Lambda reads `{email, apiToken}` from a
CDK-owned Secrets Manager secret, base64-encodes `<email>:<apiToken>`,
and attaches it as `Authorization: Basic ...` on the tenant site URL
`https://<site>.atlassian.net/rest/api/3/...` (the
`api.atlassian.com` gateway is OAuth-only).

**Idempotency:** every issue body emits a `feedback-id-<id>` label.
Before creating, the Lambda runs JQL
`project="AABSP" AND labels="feedback-id-<id>"`; a non-empty result
short-circuits to `fanout.jira.skip_existing`. Parquet replays are
therefore safe.

**Mapping:** standard fields only — `summary`, `description` (ADF),
`issuetype.name`, `project.key`, `labels`. No custom fields, priority,
or reporter set. AABSP has no custom fields, so all metadata lives in
the ADF description (paragraphs + a `codeBlock` for the verbatim
feedback text) and the labels (`user-feedback`,
`feedback-type-<cat>`, `customer-<id>`, `app-<id>`,
`feedback-id-<id>`, optional `rating-<n>`).

**Env vars:** `JIRA_API_TOKEN_SECRET_ARN`, `JIRA_BASE_URL`,
`JIRA_PROJECT_KEY`. Site URL + project key live in
`cdk/lib/config.ts` (env-overridable for future sandbox routing). The
API token secret is provisioned by CDK with REPLACE_ME placeholders
and RETAIN policy; ops fills `{email, apiToken}` via Secrets Manager
console post-deploy. API tokens are minted in the service account's
Atlassian profile and rotated roughly every 30 days.

See `fanout/README.md` § "Jira fanout (AABSP)" for setup steps and the
full mapping schema.
