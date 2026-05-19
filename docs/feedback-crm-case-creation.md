# Feedback → CRM Case Creation

This document describes how Airo Builder opens a support case in GoDaddy CRM when a customer submits **Report a Bug** or **Get Support** through the in-product feedback modal. Originally landed in PR [#3782](https://github.com/gdcorp-partners/airo-app-builder/pull/3782).

---

## 1. Goals and Constraints

- **Customer-visible outcome.** When a user submits Report Issue or Get Support, support staff should have a real CRM ticket they can pick up, reply to, and escalate. Slack and Companion Hub are dev-team-facing only.
- **Best-effort.** The feedback UX must continue to work end-to-end even if SSO, Profile API, or CRM is degraded. A CRM failure is not a feedback failure.
- **No new client-visible authority.** All cert-authenticated calls run server-side; the browser never sees a minted SSO JWT or talks to `*.int.godaddy.com` directly.
- **No spoofing.** The customer's identity (`customerId`, `shopperId`) is taken from the validated JWT, never from the request body.
- **Staged rollout.** Feature is gated by a Switchboard flag plus a deploy-only env-var gate, so it can ship dark and ramp by shopper.
- **Scoped to AAB UI.** The Share Feedback flow is anonymous-style and is *not* mapped to CRM.

---

## 2. Architecture

```
┌─────────────────┐                    ┌─────────────────────────────────┐
│  Browser        │                    │  Next.js BFF (app/)             │
│  FeedbackMulti  │                    │                                 │
│    Step.tsx     │   POST             │  /api/crm/case                  │
│                 │  /api/crm/case     │   ├─ withCustomerAuth (JWT)     │
│  - Switchboard  │ ─────────────────▶ │   ├─ block e2s + TLA            │
│    flag check   │                    │   ├─ check Switchboard flag     │
│  - !isInternal  │                    │   ├─ check airoCertTokenService │
│  - try/catch    │                    │   │     .isConfigured()         │
│    isolation    │ ◀───── 200/4xx ─── │   └─ openCrmCase()              │
└─────────────────┘                    │                                 │
                                       │   ┌──────────────────────────┐  │
                                       │   │  airoCertTokenService    │  │
                                       │   │  (mTLS → SSO JWT)        │  │
                                       │   └──────────────────────────┘  │
                                       │              │ sso-jwt          │
                                       │              ▼                  │
                                       │   ┌──────────────────────────┐  │
                                       │   │  fetchCustomerProfile    │  │
                                       │   │  profile.api.int/...     │  │
                                       │   └──────────────────────────┘  │
                                       │              │ contact info     │
                                       │              ▼                  │
                                       │   ┌──────────────────────────┐  │
                                       │   │  POST crm.int/...        │  │
                                       │   │  /api/case-management/   │  │
                                       │   │      v1/case             │  │
                                       │   └──────────────────────────┘  │
                                       └─────────────────────────────────┘
```

**Three downstream calls per submission** (no caching): SSO mint → Profile API GET → CRM POST. Each is gated to a 10s timeout.

---

## 3. Components

### 3.1 Client (`app/src/components/feedback/`)

- `FeedbackMultiStep.tsx` — owns the modal, runs `handleSupportSubmit` and `handleIssueSubmit`. Both handlers fire the existing Slack + Companion Hub writes, then attempt the CRM case in a separate inner `try/catch`. A CRM failure logs `feedback.crm.case.save_failed` and falls through to Slack.
- `submitFeedback.ts` — exposes `openCrmCaseForIssue(input)`, a thin client helper that POSTs `/api/crm/case`. Skips entirely in local dev (`isLocalDev()`).
- The `Share Feedback` flow (`handleFeedbackSubmit`) is intentionally untouched — it's anonymous-style feedback, not a help request.

### 3.2 BFF route (`app/src/app/api/crm/case/route.ts`)

A `POST` handler wrapped in `withCustomerAuth({ level: 1 })`. Defense-in-depth gates, in order:

1. Reject `e2s` (employee impersonation) → `403 impersonation-not-allowed`.
2. Reject TLA shopperIds (3-char internal accounts) → `403 internal-user-not-allowed`.
3. `checkSwitchboardFlag('appbuilder-crm-case-create')` — fails closed on lookup error → `403 feature-disabled`.
4. `airoCertTokenService.isConfigured()` — when `AIRO_CLIENT_CERT`/`KEY` env vars are unset → `403 feature-disabled`.
5. Validate body: `description` non-empty, coerce `followUp`/`appId` to safe shapes.
6. Call `openCrmCase(...)` with `customerId`/`shopperId` from the JWT (never from the body).
7. On success → `200 { success: true, caseId, caseNumber }`.
8. On `openCrmCase` throw → `502 crm-case-failed`, logging the error message (not the body).

### 3.3 Cert-based SSO token (`app/src/lib/crm/airo-cert-token.ts`)

Mints an SSO JWT by presenting the Airo client cert (mTLS) to GoDaddy SSO. **Env-only**: when `AIRO_CLIENT_CERT` and `AIRO_CLIENT_KEY` are not set, `isConfigured()` returns false and callers treat the feature as disabled. Path-fallback was removed deliberately to keep config in one place.

**No token cache.** Feedback submissions are low-volume (~tens per day); a fresh mint per request eliminates a class of stale-token / cache-invalidation bugs. Revisit if volume grows materially.

Defensive parsing: SSO 2xx response must be valid JSON *and* a JSON object (`JSON.parse('null')` is filtered out before destructuring) *and* contain a recognised token field. Each branch logs a distinct event so Loki dashboards can disambiguate failure modes.

### 3.4 Profile + Case clients (`app/src/lib/crm/`)

- `profile-client.ts` — `fetchCustomerProfile(customerId, token)` GETs `${PROFILE_API_BASE}/v1/profiles/Account/{customerId}` with `Authorization: sso-jwt <token>` and `X-App-Key: airo-app-builder`. Returns `{ firstName, lastName, email, phone | null }`.
- `case-client.ts` — `openCrmCase(input)` orchestrates `getToken()` → `fetchCustomerProfile()` → `buildCaseBody()` → POST to CRM. Body is modeled on the working reference at `debug-console/scripts/crm-case-create-test.ts`.

### 3.5 CRM case body

Field mapping (constants in `case-client.ts`):

| Field | Value |
|---|---|
| `recordType` | `'standard'` |
| `status` | `'Open'` |
| `caseOrigin` | `'Automation'` |
| `primaryCategory` | `'Websites'` |
| `secondaryCategory` | `'Airo AI Builder'` |
| `issue` | `'General Support'` |
| `caseNotes[0].note` | `Comment : (appid - ${appId}) ${truncatedDescription}` when appId present, otherwise `Comment : ${truncatedDescription}` |
| `additionalData.severity` | `'S2'` (pinned for v1) |
| `additionalData.escalated` | `'true'` |
| `additionalData.permissionToMakeChanges` | `'true'` |
| `additionalData.type` | `'Complete'` |
| `additionalData.escalationDetails` | `truncatedDescription` |
| `contactName/FirstName/LastName/Email/Phone` | from Profile API (phone is digits-only, e.g. `15551234`) |
| `shopperId` | from JWT |

**`additionalData` is case-sensitive.** CRM silently drops keys that don't match the spec exactly — `Type`, `Permission to Make Changes`, `Escalation Details` all fail. Field names are camelCase, boolean-style values are lowercase strings (`'true'`, not `'TRUE'`).

`appId` is embedded in the `caseNotes[0].note` (rather than `additionalData`) so support agents see it inline when reading the case. The `(appid - ...)` segment is omitted entirely for sessions without an active app (e.g. landing-page Get Support submits) — there is no placeholder. The `followUp` form field is captured by Slack and Companion Hub for the dev team but is not sent to CRM.

`truncatedDescription` is `input.description.slice(0, 4000)` (with ellipsis). The textarea has no client-side maxLength yet — a follow-up will add it; the server cap is the safety net.

The case body is byte-identical for both Get Support and Report Issue submissions (only the user-typed description differs). If CRM triage needs to distinguish them, add a `flow` field to `additionalData` in a follow-up.

---

## 4. Failure Isolation

The defining behavioral guarantee: **a CRM failure must not break the feedback UX**. There are three failure layers:

1. **Inside `openCrmCase` (server)** — SSO timeout, Profile non-2xx, CRM non-2xx, parse failures. All propagate up to the route's `try/catch` → `502 crm-case-failed`.
2. **Inside `openCrmCaseForIssue` (client)** — fetch network error, non-2xx status, JSON parse failure. All throw → caught by the inner `try/catch` in `handleSupportSubmit` / `handleIssueSubmit` → `logger.warn('feedback.crm.case.save_failed', …)` → execution continues.
3. **Slack and Companion Hub still run.** The CRM block sits *between* the Companion Hub block and the Slack call; both flows already exist and have their own error handling. The submission's `outcome` is set after `sendFeedbackToSlack` succeeds — i.e., the analytic event reflects Slack delivery, not CRM.

This is locked by regression tests:

- `Feedback.test.tsx` — `should still submit to Slack and report success when CRM case creation fails` (issue flow + support flow variants).
- `case-client.test.ts` — covers profile-failure, CRM non-2xx, malformed-2xx-body parse-failed warn, missing-phone, etc.
- `airo-cert-token.test.ts` — covers env-not-set rejection, non-JSON 2xx, non-object JSON 2xx, missing-token-field, non-2xx propagation.

A 2xx-but-unparseable CRM body is not silent: it logs `feedback.crm.case-client.post.parse_failed` (warn) with a 300-char snippet so we can audit if CRM ever changes its response shape.

---

## 5. Security and Privacy

- **JWT-derived identity.** The route reads `customerId` and `shopperId` only from `authContext.user`. Body-supplied `customerId` is ignored by construction. A regression test pins this.
- **mTLS, not bearer.** The Airo client cert is the auth credential for the SSO mint; the resulting SSO JWT is short-lived and only used for two specific calls (Profile, CRM).
- **No client cert exposure.** Cert and key are read from `AIRO_CLIENT_CERT` / `AIRO_CLIENT_KEY` env vars at request time, never logged. The PEM material lives in Katana secrets.
- **SSO error envelopes.** The `not-object` and `no-token` log branches deliberately log only `Object.keys(parsed)`, never `parsed` itself, since SSO error envelopes can carry sensitive context.
- **Body snippets are bounded.** Non-2xx logs cap response bodies at 200–500 chars to avoid leaking large payloads into Loki.
- **TLA / impersonation guard.** Internal `e2s` and TLA accounts are blocked at both client and BFF — preventing employees from opening cases on a customer's behalf, and preventing internal accounts from polluting CRM with test cases.

---

## 6. Configuration

### 6.1 Switchboard flag

| Field | Value |
|---|---|
| Name | `appbuilder-crm-case-create` |
| Type | `boolean` |
| Default | `false` |
| App | `airo-app-builder` |

Create in dev, test, and prod Switchboard. Roll out via per-shopper overrides first, then widen. The flag gates **both** Get Support and Report Issue today; if per-flow ramping is wanted, add a second flag.

### 6.2 Environment variables

| Var | Required? | Default | Purpose |
|---|---|---|---|
| `AIRO_CLIENT_CERT` | **Required to enable feature** | unset | PEM client cert for mTLS to GoDaddy SSO |
| `AIRO_CLIENT_KEY` | **Required to enable feature** | unset | PEM client key |
| `AIRO_SSO_ENDPOINT` | Optional | `https://sso.test-godaddy.com/v1/secure/api/token` | SSO endpoint URL |
| `PROFILE_API_BASE` | Optional | `https://profile.api.int.test-godaddy.com` | Profile API base |
| `CRM_API_BASE` | Optional | `https://crm.int.test-godaddy.com` | CRM API base |

Local dev needs none of these. The route returns `403 feature-disabled` when either cert env var is unset, identical to the response when the Switchboard flag is off.

---

## 7. Observability

All log events use the `feedback.crm.*` and `cert-token.airo.*` domains. Suggested LogQL queries:

- Submission outcome: `{job="airo-app-builder-app"} |= "feedback.crm.case.submit"`
- SSO mint failures: `{job="airo-app-builder-app"} |= "cert-token.airo." |= ".sso."`
- 2xx-but-unparseable CRM responses (worth investigating if non-zero): `{job="airo-app-builder-app"} |= "feedback.crm.case-client.post.parse_failed"`
- Best-effort skip from client (CRM failed but feedback succeeded): `{job="airo-app-builder-app"} |= "feedback.crm.case.save_failed"`

A non-zero `feedback.crm.case.submit.failed` rate above ~1% means investigate cert, endpoint, or CRM field validation. `feedback.crm.case-client.post.parse_failed` should be flat zero — non-zero indicates CRM API drift.

---

## 8. Deferred / Future Work

These were intentionally scoped out of the initial PR. Each is non-blocking and can be picked up independently.

- **Consolidate cert-token services.** `airo-cert-token.ts` duplicates a small amount of SSO-mint logic from `lib/product-graph/cert-token-service.ts`. A shared `CertTokenService` class would collapse them, with the airo singleton being the no-cache variant.
- **Description length cap on the textarea.** Server has the 4000-char defensive truncate; the form has no client-side `maxLength` yet. UX should hard-stop input.
- **Per-flow Switchboard flags.** Currently one flag gates both Get Support and Report Issue. Splitting into two would allow independent ramping.
- **Distinguish flows in CRM payload.** Add an `additionalData.flow: 'support' | 'issue'` field so support triage can route differently.
- **Topic-driven severity.** Currently pinned to S2 for all submissions. A topic→severity map would let "can't publish" become S1 and others S3, reducing queue noise.
- **Profile response cache.** Refetched per submission today. If submission volume grows, cache by `customerId` for ~1h.
- **Widen `extractCaseIds`.** Accept `parsed.data` as an array or a top-level string in case CRM contract drifts.
- **Playwright regression.** Stub `/api/crm/case` to fail in `tests/regression/`, assert Slack still fires.
- **Token cache + 401/403 invalidation.** If we ever bring back token caching, the cache should invalidate on a downstream 401/403 to recover from cert rotation or clock skew within the cached window.

---

## References

- Jira: [AIROBUILD-1663](https://godaddy-corp.atlassian.net/browse/AIROBUILD-1663)
- PR: [#3782](https://github.com/gdcorp-partners/airo-app-builder/pull/3782) `feat(feedback): open CRM case on Report Issue submit`
- Related: [`oauth-architecture.md`](./oauth-architecture.md), [`app/CLAUDE.md`](../app/CLAUDE.md) (Switchboard, Tiered Auth Levels), [`LOGGING-GUIDE.md`](../LOGGING-GUIDE.md).
