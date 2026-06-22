# SupportPlane DynamoDB Migration (L1 Transcripts + Analytics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SQLite-backed L1 transcript and transcript analytics storage in `debug-console` with DynamoDB while preserving current API response contracts and UX behavior.

**Architecture:** Use a dedicated DynamoDB repository layer for transcript and upload lifecycle operations, and replace SQL-derived analytics with materialized analytics records keyed for known query patterns. Keep route response payloads unchanged and gate rollout with a feature flag plus rollback path.

**Tech Stack:** Next.js route handlers, TypeScript, AWS SDK v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`), Vitest, structured logger.

---

## Scope and Constraints

- In scope:
  - `L1 transcripts` data path
  - `L1 upload lifecycle` data path
  - `Transcript analytics` data path
- Out of scope:
  - `support-db` tickets
  - `feedback-db` storage
  - unrelated dashboard tabs
- Assumption:
  - no legacy pipeline data requires backfill
- Requirement:
  - API response structures must remain compatible with current SQL-driven endpoints

---

## File Structure

- `debug-console/src/lib/l1-transcript-db.ts` — current SQLite repository (to be replaced by store facade or compatibility wrapper)
- `debug-console/src/lib/l1-transcript-backup.ts` — SQLite/S3 backup logic (to retire for transcript path)
- `debug-console/src/lib/db-backup.ts` — SQLite backup scheduler (to remove transcript usage)
- `debug-console/src/lib/chat-tools.ts` — transcript query tools used by chat flow
- `debug-console/src/app/api/supportplane/transcripts/*.ts` — transcript route handlers that currently embed SQL assumptions
- `debug-console/src/app/api/supportplane/ask/route.ts` — transcript query tool for SupportPlane assistant
- `debug-console/src/app/api/supportplane/today/route.ts` — transcript counters in cross-domain daily rollup
- `debug-console/package.json` — add DynamoDB dependencies
- `debug-console/src/lib/dynamo/` (new) — Dynamo clients, schema, repositories, analytics writer/readers
- `debug-console/src/lib/supportplane-store/` (new) — stable interfaces + implementation selector
- `debug-console/src/lib/__tests__/` + route tests (new/updated) — parity and contract tests

---

## Target Data Model

### Table 1: `airo-builde-supportplane-l1-transcript-<env>`
- **PK:** `interaction_id`
- **SK:** `created_at`
- Attributes: existing transcript payload fields (`interaction_id`, `app_id`, `domain`, `shopper_id`, `customer_id`, `tags`, `conversation_summary`, `full_transcript`, `raw_data`, statuses, timestamps)
- **GSI1:** `shopperIndex` on `shopper_id`
- **GSI2:** `customerIndex` on `customer_id`
- **GSI3:** `appIndex` on `app_id`
- **GSI4:** `domainIndex` on `domain`
- **GSI5 (tagging queue):** `taggingStatusIndex` on `tagging_status`

### Table 2: `airo-builde-supportplane-l1-upload-<env>`
- **PK:** `upload_id`
- **SK:** `uploaded_at`
- Attributes: `upload_id`, `file_hash`, `file_name`, `s3_key`, `status`, `tagging_status`, counters, `source`
- **GSI1:** `fileHashIndex` on `file_hash`
- **GSI2:** `statusTaggingIndex` on `status_tagging`

### Table 3: `airo-builde-supportplane-l1-analytics-<env>`
- **PK:** `metric_type`
- **SK:** `created_at`
- Record categories:
  - category counts
  - sentiment buckets
  - resolution buckets
  - sub-intent / friction-point / product-line / inbound-driver
  - tag counts and tag-resolution counters
  - flow tuples (friction -> intent -> resolution)
  - calendar daily totals
- Rationale: analytics client reads are metric-first over time windows; `metric_type` as partition key keeps those queries single-partition where possible.

---

## Dedicated Flow (End-to-End)

1. Ingestion (`upload` / `sync-sharepoint`) writes transcript + upload rows into DynamoDB.
2. Tagging updates transcript `tags` and upload `tagging_status`.
3. Analytics materializer updates `airo-builde-supportplane-l1-analytics-<env>` counters for queryable dimensions.
4. Controllers read:
   - entity-level views from transcript/upload tables
   - aggregate views from analytics table
5. Controllers keep current response schema unchanged.

---

### Task 1: Create DynamoDB schema and infra bindings

**Files:**
- Create: `debug-console/src/lib/dynamo/client.ts`
- Create: `debug-console/src/lib/dynamo/schema.ts`
- Create: `debug-console/src/lib/dynamo/table-names.ts`
- Modify: `debug-console/package.json`

- [ ] **Step 1: Add dependencies**

Run:
`pnpm --filter debug-console add @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb`

Expected:
- dependencies added to `debug-console/package.json`

- [ ] **Step 2: Implement Dynamo client factory**

Create `debug-console/src/lib/dynamo/client.ts` with:
- region resolution from env
- optional endpoint override for local testing
- singleton `DynamoDBClient`
- singleton `DynamoDBDocumentClient` with sane marshalling options

- [ ] **Step 3: Define table name/env contract**

Create `debug-console/src/lib/dynamo/table-names.ts` with explicit env vars:
- `SP_L1_TRANSCRIPTS_TABLE`
- `SP_L1_UPLOADS_TABLE`
- `SP_L1_ANALYTICS_TABLE`

Throw clear startup errors when missing.

- [ ] **Step 4: Define key builders and record shapes**

Create `debug-console/src/lib/dynamo/schema.ts`:
- key builder helpers (PK/SK and GSIs)
- typed interfaces for transcript, upload, analytics records
- utility mappers from existing route-level types to Dynamo record types

- [ ] **Step 5: Validate build**

Run:
`pnpm --filter debug-console typecheck`

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add debug-console/package.json debug-console/src/lib/dynamo/client.ts debug-console/src/lib/dynamo/schema.ts debug-console/src/lib/dynamo/table-names.ts
git commit -m "feat(debug-console): add dynamodb client and schema for supportplane transcript stack"
```

---

### Task 2: Rewrite DB access layer for DynamoDB compatibility

**Files:**
- Create: `debug-console/src/lib/supportplane-store/types.ts`
- Create: `debug-console/src/lib/supportplane-store/dynamo-store.ts`
- Create: `debug-console/src/lib/supportplane-store/index.ts`
- Modify: `debug-console/src/lib/l1-transcript-db.ts`
- Modify: `debug-console/src/lib/chat-tools.ts`

- [ ] **Step 1: Define stable repository interfaces**

In `types.ts`, define method contracts equivalent to existing usage:
- insert/bulk insert/query/count/get-by-id/update-tags
- upload lifecycle create/update/get-by-id/get-by-hash
- untagged/tagging state queries
- analytics read helpers needed by routes

- [ ] **Step 2: Implement Dynamo transcript + upload repositories**

In `dynamo-store.ts`:
- implement idempotent writes (`interaction_id`, `upload_id` protection)
- implement query paths via GSIs for browse/ask filters
- implement pagination token translation compatible with existing `limit/offset` behavior

- [ ] **Step 3: Add analytics read/write abstraction**

In the same store:
- expose aggregate read methods consumed by analytics routes
- keep return payloads in current route-compatible shape

- [ ] **Step 4: Convert `l1-transcript-db.ts` to compatibility facade**

Keep exported function names unchanged, but delegate to store interface methods.
Do not change route call sites yet.

- [ ] **Step 5: Convert `chat-tools.ts` SQL calls to store calls**

Replace SQL blocks with repository calls for:
- `query_transcripts`
- `get_friction_points`
- `get_transcript_stats`

- [ ] **Step 6: Validate build and unit tests**

Run:
- `pnpm --filter debug-console typecheck`
- `pnpm --filter debug-console test`

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add debug-console/src/lib/supportplane-store debug-console/src/lib/l1-transcript-db.ts debug-console/src/lib/chat-tools.ts
git commit -m "refactor(debug-console): route transcript db api through dynamodb-backed supportplane store"
```

---

### Task 3: Wire controllers and enforce SQL-response parity

**Files:**
- Modify: `debug-console/src/app/api/supportplane/ask/route.ts`
- Modify: `debug-console/src/app/api/supportplane/today/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/analytics/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/browse/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/calendar/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/filters/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/flow/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/heatmap/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/stats/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/tag-bulk/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/tag-clusters/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/tag-resolution/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/tag-single/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/untagged-count/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/upload/route.ts`
- Modify: `debug-console/src/app/api/supportplane/transcripts/sync-sharepoint/route.ts`

- [ ] **Step 1: Replace direct SQL assumptions in each route**

For every transcript route:
- remove `db.prepare(...)` usage
- call store methods
- preserve existing response keys and value types

- [ ] **Step 2: Add contract tests for response parity**

Create or update route tests to assert:
- top-level keys unchanged
- nested key names unchanged
- nullability and array/object shapes unchanged

- [ ] **Step 3: Add failure behavior tests**

Assert route behavior when Dynamo read/write fails:
- stable error payload structure
- no unhandled throw

- [ ] **Step 4: Validate**

Run:
- `pnpm --filter debug-console typecheck`
- `pnpm --filter debug-console test`
- `pnpm --filter debug-console lint`

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add debug-console/src/app/api/supportplane debug-console/src/lib/__tests__
git commit -m "feat(debug-console): migrate supportplane transcript routes from sqlite calls to dynamodb store"
```

---

### Task 4: Rollout safeguards, observability, and cleanup

**Files:**
- Modify: `debug-console/src/lib/l1-transcript-backup.ts`
- Modify: `debug-console/src/lib/db-backup.ts`
- Modify: `debug-console/src/app/api/supportplane/services/health/route.ts`
- Create: `debug-console/src/lib/supportplane-store/flags.ts`

- [ ] **Step 1: Add feature flag and rollback path**

Implement `SUPPORTPLANE_TRANSCRIPTS_STORE=dynamo|sqlite`.
Default to `dynamo` for this migration, keep `sqlite` runtime fallback for one release cycle.

- [ ] **Step 2: Retire transcript SQLite backup coupling**

Stop invoking SQLite backup scheduler from transcript write paths.
Keep non-transcript backup paths untouched.

- [ ] **Step 3: Add health checks for Dynamo tables**

Update service health endpoint to validate:
- table reachability
- lightweight query/read path
- clear failure reason messaging

- [ ] **Step 4: Add migration readiness checklist**

Add internal runbook section:
- required env vars
- smoke-test endpoints
- rollback command (flip store flag)

- [ ] **Step 5: Validate and soak**

Run:
- `pnpm --filter debug-console typecheck`
- `pnpm --filter debug-console test`
- `pnpm --filter debug-console lint`
- manual smoke on SupportPlane transcripts dashboard

Expected:
- clean route behavior and stable UI rendering

- [ ] **Step 6: Commit**

```bash
git add debug-console/src/lib/supportplane-store/flags.ts debug-console/src/lib/l1-transcript-backup.ts debug-console/src/lib/db-backup.ts debug-console/src/app/api/supportplane/services/health/route.ts
git commit -m "chore(debug-console): add supportplane dynamodb rollout guards and retire transcript sqlite backup coupling"
```

---

## Acceptance Criteria

- All transcript and transcript-analytics routes read/write through DynamoDB-backed store.
- Route response payload structures remain backward compatible.
- Upload + tagging lifecycle works without SQL dependencies.
- Analytics endpoints return non-empty, correctly structured aggregates from materialized data.
- Feature flag enables instant runtime fallback if needed.

---

## Risks and Hiccups (One-Go Migration Warning)

- Missing GSI for a route filter can cause immediate runtime query failures.
- Replacing SQL analytics with direct scans can create latency spikes and throttling.
- Offset-based pagination semantics differ from Dynamo cursor semantics and can cause duplicate/missing page records if not normalized.
- Tagging flow can race with analytics updates without idempotent counters.
- Route payload shape drift can silently break frontend charts despite backend 200 responses.

---

## Execution Order Summary

1. Schema and client setup
2. Repository rewrite and compatibility facade
3. Route/controller integration with contract tests
4. Rollout safeguards and cleanup

This order is mandatory; these tasks are sequential dependencies, not independent execution streams.
