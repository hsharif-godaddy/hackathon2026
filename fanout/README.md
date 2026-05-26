# Airo Fanout Lambda

S3-event-triggered Lambda that fans out feedback submissions to Slack, CRM (CMAPI), the investigator Lambda, and Jira (AABSP).

## Architecture

See `docs/superpowers/specs/2026-05-21-fanout-lambda-extraction-design.md` for full design.

## Run tests

```bash
pnpm --filter @airo/fanout-lambda test
```

## Deploy

CDK stack: `cdk/lib/feedback-fanout-stack.ts`. Triggered by `cdk deploy FeedbackFanoutStack`.

## Failure handling

The handler follows a **bulkhead** pattern: every downstream
(CRM, Slack, investigator, Jira) is wrapped in `try/catch` →
`log('warn', …)` → continue. No single downstream can break the others.

| Step | On failure |
|------|------------|
| Parquet read | Throws → DLQ (corrupt parquet, replay won't help) |
| Switchboard gate `fanout_via_lambda !== true` | Early return (no-op, not a failure) |
| State.json read | Throws → AWS Lambda async retry → DLQ |
| State.json write race (`PreconditionFailed`) | Resolved by re-read + age check |
| CRM `getCase` (dedup check) | Falls through to fresh path with `IfMatch` overwrite |
| CRM `postCase` (fresh) | Log + skip; `caseId=null` saved in state; Slack / investigator / Jira still run |
| CRM `postNote` (kickoff or duplicate) | Log + skip |
| Slack | Log + skip |
| Investigator invoke | Log + skip; Jira still runs |
| Jira find / create | Log + skip |

**Why CRM is treated like the rest, not as fail-stop:**
- Most CRM failures are 4xx data errors (e.g. CMAPI 422 "Missing Contact
  Information" when Profile API can't supply email/phone). Replaying the
  same parquet won't fix them.
- AWS Lambda async retries the entire handler 3× before DLQ. On a 5xx
  CMAPI outage this would re-fire Slack/Jira/investigator on each retry,
  duplicating downstream messages.
- Parquet is the source of truth. Manual replay from the parquet S3
  event is the recovery path for any genuinely-needed retry.

**What lands in the DLQ:** parquet decode crash, Lambda code bug, OOM,
IAM deny, state.json bucket access failure. Real "the Lambda itself is
broken" signals — not normal downstream hiccups.

### Replay idempotency per downstream

Important when manually replaying from DLQ — same parquet event re-fired
to the Lambda has these effects:

| Downstream | Replay behavior | Why |
|------------|-----------------|-----|
| State.json | Idempotent | Conditional `IfMatch` on the etag; second writer 412s harmlessly |
| CRM `postCase` | Deduped within 60min via state ledger | Existing case found → duplicate note posted instead of new case |
| CRM `postNote` (kickoff/duplicate) | **Will duplicate** | Notes have no idempotency key; replay adds a second note to the same case |
| Slack | **Will duplicate** | Webhook has no idempotency; replay produces a second Slack message in the channel |
| Investigator invoke | Investigator-side dedup via `active/<cid>/<aid>/state.json` lock | Concurrent replays no-op; replay after completion may re-trigger (verify with investigator owner) |
| Jira | Idempotent via Feedback ID custom field (`cf[36238]`) | Search before create finds existing issue → skip |

When replaying from DLQ, expect: 1 new CRM note + 1 duplicate Slack
message + 1 idempotent Jira no-op + (likely) 1 idempotent investigator
no-op. Acceptable trade-off for catastrophic-failure replay scenarios.

### Replay from DLQ

1. AWS Console → SQS → `airo-fanout-dlq-<env>` → poll messages
2. Copy message body (S3 event JSON pointing at a parquet)
3. Read CloudWatch logs around the message's enqueue time → diagnose
   root cause (rotate token / fix IAM / etc.)
4. Replay:

```bash
aws lambda invoke \
  --function-name airo-fanout-<env> \
  --invocation-type Event \
  --payload '<paste S3 event JSON here, base64-encoded if --cli-binary-format=raw-in-base64-out is unset>' \
  --region us-west-2 \
  /tmp/out.json
```

5. Verify `fanout.fresh.done` in CloudWatch
6. Delete the DLQ message

## Switchboard flag setup

Flag name: `appbuilder-fanout-via-lambda` (boolean, default `false`)

Create in dev + test + prod via the Switchboard UI:
1. Navigate to the airo-app-builder app config (e.g.
   `https://switchboard.int.test-gdcorp.tools/airo-app-builder` for test;
   swap the env subdomain for dev/prod).
2. **New flag** → name `appbuilder-fanout-via-lambda`, type `boolean`, default `false`.
3. Description: "When ON, the fanout Lambda owns Slack/CRM/investigator
   dispatch for feedback submissions. When OFF, BFF/UI owns everything
   (today's behavior from PR #3946)."

The flag is read by **two** call sites, but only one of them talks to
Switchboard directly:
- **BFF** (`app/src/app/api/feedback/s3-store/route.ts`) resolves it on every
  feedback submit, stamps the resolved boolean into the parquet's
  `fanout_via_lambda` column, and logs `feedback.store.s3.fanout_flag`.
- **Lambda** reads `row.fanout_via_lambda` directly from the parsed parquet —
  it has no Switchboard client, no IAM grant, and no env-var kill switch.
  Anything other than strict `true` (false / null / missing column) makes
  the Lambda no-op at handler entry, so legacy submissions are safe.

This avoids Lambda needing its own Switchboard client + IAM, and gives
an atomic per-submission flip — no risk of doubled Slack messages or
missed CRM cases mid-rollout.

## Cutover (per env)

1. Land this PR → CDK deploys the Lambda; Switchboard flag exists with
   default `false`. Lambda is live but every event no-ops via
   `fanout.disabled` because the BFF stamps `fanout_via_lambda=false` for
   everyone.
2. **Wire `FANOUT_LAMBDA_FN` on the website Katana container** to the
   value of the CDK `FanoutFunctionName` output (e.g. `airo-fanout-dev-v2`
   in dev, `airo-fanout-test`, `airo-fanout-prod`). Without this env var
   the BFF silently skips the invoke and logs
   `feedback.store.fanout.fn_not_configured` at startup — fanout will be
   a complete no-op end-to-end. Redeploy the website pod after setting it.
3. Fill the two CDK-owned secrets via AWS Console:
   - `<env>-airo-fanout-slack-webhook` → `{"webhookUrl": "<URL>"}`
   - `<env>-airo-fanout-jira-api-token` → `{"email": "<sa-email>", "apiToken": "<token>"}`
4. Verify Lambda is idle: submit feedback in the env, look for
   `fanout.disabled` in CloudWatch and `feedback.store.s3.fanout_flag`
   `value: false` in Loki.
5. Add a per-shopper override in the dev Switchboard (your shopperId →
   `true`) and submit test feedback. Verify Lambda runs end-to-end:
   single Slack message in the same Block Kit format the UI used to
   build, CRM case opened, no duplicate messages, investigator invoked.
6. Widen flag rollout: 10% → 50% → 100% in dev.
7. Repeat in test, then prod, with shopper-override staging at each step.
8. After 100% in prod is stable, follow-up PR drops the legacy UI Slack
   + companion-hub paths and removes the gate.

Scope: the Lambda fires for ALL three feedback categories (issue,
support, feedback) when the flag is ON. Flag OFF preserves today's
per-category flow — issue/support → `/api/crm/case` + Slack;
feedback (NPS) → companion-hub + Slack. The same Switchboard gate
applies uniformly across categories; the Lambda picks the right Slack
Block Kit builder via `row.feedback_category` (the BFF stamps it on
every parquet write).

## Slack message triage links

Every Slack notification includes deep-links to the entities created
for that submission:

| Link | Target | Built when |
|------|--------|------------|
| `Case` | Salesforce Lightning case page | issue/support category + CMAPI returned `caseId` + `SALESFORCE_LIGHTNING_BASE` set |
| `Jira` | AABSP Jira issue browse page | eligibility passes + Jira create succeeded |

Labels intentionally match the single-word convention of the sibling
diagnostic links (`Preview`, `Nexus`, `Console`). The case number and
Jira issue key live in the URL hover-tooltip — they're noise in the
visible row.

The investigation URL is intentionally NOT in the Slack triage block —
the investigator already posts its own deep-link as a CRM case note
when it completes (see `maybeAddCrmCaseNote` in
`investigator/handler.mjs`), and the kickoff note posts it upfront
when CRM creation succeeds. A third copy in Slack would add no
triage value.

Order of operations in `handleFreshPath`: state → CRM postCase → Jira
search/create → Slack (with enrichment) → kickoff note → investigator
invoke. Jira moved BEFORE Slack so the Jira key is available at
message-build time. Slack call is the same try/catch-warn-not-throw
shape as before; if any link is missing (e.g. CRM 422 left `caseId=null`),
that link is omitted but the rest of the message renders unchanged.

The Salesforce Lightning URL pattern is
`${SALESFORCE_LIGHTNING_BASE}/lightning/r/Case/${caseRecordId}/view`
(verified against `https://godaddy-corp.atlassian.net/wiki/spaces/CARESFINT/pages/3863389051`).
When `SALESFORCE_LIGHTNING_BASE` is empty (e.g. sandbox env where the
Lightning instance differs), the `Case` link is omitted entirely; the
rest of the Slack message renders unchanged. Triagers can still find
the case via Nexus or the kickoff note in the CRM case itself.

Happy-path NPS submissions (rating ≥ 5) get NO triage links — there's
no CRM/Jira/investigator to link to. The Slack message renders
identically to the legacy UI Block Kit shape (backward compat).

## Jira fanout (AABSP)

After Slack + CRM + investigator dispatch, the Lambda creates an AABSP
Jira ticket for triage. The step is wrapped in try/catch warn-not-throw
so a Jira outage / token failure / 4xx never blocks or rolls back the
prior fanouts — the surrounding fanouts always complete first.

### Eligibility

| Category   | Action                                              | Issue type      |
| ---------- | --------------------------------------------------- | --------------- |
| `issue`    | Always create                                       | `Bug`           |
| `support`  | Always create                                       | `SOS Support`   |
| `feedback` | Only when `rating != null && rating < 5`            | `Prod Feedback` |

### Auth

Basic auth with a service-account email + Atlassian API token.
Atlassian OAuth 3LO does not support a clean `client_credentials`
grant for non-interactive workloads, so the Lambda uses the
service-account API token path: it base64-encodes
`<email>:<apiToken>` and attaches it as
`Authorization: Basic <encoded>` on the tenant site URL
`https://<site>.atlassian.net/rest/api/3/...` (the
`api.atlassian.com` gateway is OAuth-only and rejects Basic auth).
The Basic header is cached in-process per Lambda warm container.

API tokens are long-lived but Atlassian recommends manual rotation
roughly every 30 days for service accounts. Rotate by minting a new
token in the SA's Atlassian profile, updating the
`<env>-airo-fanout-jira-api-token` secret in Secrets Manager, then
revoking the old token.

### Idempotency

Every issue body sets the typed Feedback ID custom field
(`FEEDBACK_ID_CUSTOM_FIELD_ID` in `jira-client.mjs`, currently `cf[36238]`)
to the submission UUID. Before creating, the Lambda runs a JQL search
(`project="AABSP" AND cf[<FEEDBACK_ID_CUSTOM_FIELD_ID>]="<id>"`); a
non-empty result short-circuits to `fanout.jira.skip_existing`. Parquet
replays (DLQ replay, Lambda retry, S3 double-fire) are therefore safe.
The labels column stays clean (`AAB-App` only).

### Environment variables

| Var                            | Source                              | Notes                                              |
| ------------------------------ | ----------------------------------- | -------------------------------------------------- |
| `JIRA_API_TOKEN_SECRET_ARN`    | CDK-owned Secrets Manager secret    | JSON `{email, apiToken}`                           |
| `JIRA_BASE_URL`                | `config.jiraBaseUrl`                | Tenant site URL (e.g. `https://godaddy-corp.atlassian.net`) |
| `JIRA_PROJECT_KEY`             | `config.jiraProjectKey`             | `AABSP`                                            |

### Setup (per env, post-deploy)

1. CDK deploys `JiraApiTokenSecret` with REPLACE_ME placeholders and
   `RemovalPolicy.RETAIN`. The secret's name is
   `<env>-airo-fanout-jira-api-token`.
2. Mint an API token in the service account's Atlassian profile
   (`https://id.atlassian.com/manage-profile/security/api-tokens`)
   and record the SA's email address.
3. Ops opens the Secrets Manager console for the secret and replaces
   `email` and `apiToken` with the provisioned values.
4. While placeholders remain, every Jira step logs
   `fanout.jira.find_failed` (or `fanout.jira.create_failed` if a
   prior find succeeded but the create call hits the 401) with the
   Atlassian response and skips — Slack/CRM/investigator continue
   running normally.
5. Rotate the API token roughly every 30 days: mint a new one,
   update the secret, then revoke the old token.

### Customization

Issue type is chosen per category: `issue → Bug`, `support → SOS Support`,
`feedback → Prod Feedback`. Typed AABSP custom fields hold the structured
data triagers care about (App ID, Subscription/Plan, Origin, Topics,
Customer Consent, Feedback ID, S3 Object Reference, Experiments, Rating);
the description ADF holds only the customer's feedback text rendered as
prose paragraphs. Labels stay minimal (`AAB-App`). The customer ID is
intentionally NOT in labels — Jira labels are project-wide searchable and
not redactable per-issue, so customer/shopper IDs stay only in custom
fields where they can be cleaned per-issue. See `jira-mapping.mjs` for
the full mapping and `getJiraIssueTypeMetaWithFields` against AABSP for
the source of truth on field IDs.
