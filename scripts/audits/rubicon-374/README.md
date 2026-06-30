# RUBICON-374 robots.txt audit

Measures how many published AAB apps are serving the correct `/robots.txt`:

- **Platform hosts** (`*.airoapp.ai`) should serve `Disallow: /` (block crawlers from indexing builder previews).
- **Custom domains** should serve `Allow: /` (customers want SEO).

The platform-host bad rate is the headline metric — that's the bug the rewriter is fixing.

## Files

```
audit.mjs        Node script that probes /robots.txt and writes results
dashboard.html   Static dashboard that reads results/
README.md        This doc
.gitignore       Excludes results/ and dashboard-preview.png from commits
results/         Per-run artifacts (CSVs + summary JSON + runs.jsonl)
                 — LOCAL ONLY, not committed. See "PII & sharing" below.
```

## PII & sharing

The audit output contains real customer data: `customer_id`, `app_id`, and `publish_url` (real customer domains). The source CSV from Athena contains even more (`app_initial_prompt`, app titles, MySQL host IPs, ceph paths). **None of this should be committed to the repo or shared in public channels.**

- `results/` is gitignored — each runner generates their own outputs locally.
- Share aggregate trends via the Confluence runbook or Slack screenshots of the dashboard, not by sharing CSVs.
- Don't commit the source `~/Downloads/rubicon-374-*.csv` either — same PII applies.

Coworkers running this script should: clone the repo, follow the *AWS access setup* and *Refresh the input CSV* sections below, and generate their own `results/` locally. Trend history doesn't carry across machines — that's fine; the source of truth for the project's bug-rate trend is the Confluence runbook's baselines table + any Slack updates.

## One-time AWS access setup

You need to query `hosting_paas_cln.airo_builder_provisioning_summary` from the lake. Skip this section if you already have access.

1. Confirm your role is granted via the lake catalog. The `airo_builder.prod` consumer is in [`gdcorp-dna/lake`](https://github.com/gdcorp-dna/lake) → `catalog/config/prod/us-west-2/hosting-paas-cln/airo-builder-provisioning-summary/table.yaml`. If it's not, file a PR adding `- !consumer airo_builder.prod` to the `permissions:` list.
2. Use the AAB **Ops** role (not ReadOnly) in account `644094189644` when querying Athena. ReadOnly's permission boundary blocks `athena:StartQueryExecution` and S3 writes to the results bucket.
3. Set the Athena query results location once: `s3://airo-builder-athena-results-prod/` (us-west-2). Athena → Settings → Manage → Location of query result.

## Refresh the input CSV

1. Sign into AWS via Okta → account `644094189644` (AiroBuilde Prod) → **Ops** role.
2. Switch region to **us-west-2 (Oregon)**.
3. Open Athena → Query editor. Make sure `Data source = AwsDataCatalog`, `Database = hosting_paas_cln`.
4. Run (substitute yesterday's partition date):

   ```sql
   SELECT
     customer_id, app_id, airo_subscription_id, airo_subscription_status,
     app_create_utc_ts, app_update_utc_ts, app_preview_url, tla_flag,
     publish_flag, hibernation_flag, publish_url, token_budget_id
   FROM hosting_paas_cln.airo_builder_provisioning_summary
   WHERE year = '2026' AND month = '06' AND day = '28';
   ```

   The table is a daily snapshot — always filter to a single partition. Athena is on engine v3 (Trino), so use `current_date - interval '1' day` if you want dynamic dates, NOT Hive's `date_sub()`.
5. Download results → save as `~/Downloads/rubicon-374-YYYY-MM-DD.csv` where `YYYY-MM-DD` is the partition date. The audit script parses this from the filename for the dashboard snapshot label.

## Run the audit

```bash
cd scripts/audits/rubicon-374
node audit.mjs --input ~/Downloads/rubicon-374-2026-06-28.csv
```

Optional flags:
- `--concurrency 30` (default) — parallel HTTP probes
- `--timeout 10000` (default, ms) — per-probe timeout
- `--dry-run` — print cohort size without probing

Probing ~25K URLs takes 10–15 minutes. The script writes:
- `results/summary-<ts>.json` — counts + rates
- `results/platform-incorrect-<ts>.csv` — platform hosts wrongly Allowing
- `results/custom-incorrect-<ts>.csv` — custom domains wrongly Disallowing
- `results/inconclusive-<ts>.csv` — timeouts, 5xx, SSL/DNS failures
- Appends a summary line to `results/runs.jsonl` (the dashboard reads this)

## View the dashboard

The dashboard uses `fetch()` to load `runs.jsonl` and per-run CSVs — `file://` won't work (browser blocks fetch from local files). Serve over HTTP:

```bash
cd scripts/audits/rubicon-374
python3 -m http.server 8765
```

Then open <http://localhost:8765/dashboard.html>. Two hero cards (platform bug %, custom-domain bad %), affected-app tables, run-history collapsible. Refresh after each new audit run.

Kill the server when done:
```bash
lsof -ti:8765 | xargs kill
```

## Re-run cadence

Re-run whenever you want a fresh data point — typical triggers:
- Before / after a rewriter rollout (compare platform bug %)
- Weekly until the platform bad rate drops near zero
- When a new partition lands in the lake (next-day after any AAB DB change is a good time)

The dashboard accumulates runs in `results/runs.jsonl`, so each run adds a row to the history table.

## Gotchas

- **`TABLE_NOT_FOUND`** with database in the FROM clause wrapped in quotes (`"hosting_paas_cln.airo_builder_provisioning_summary"`) — Athena treats the dotted name as a single identifier. Remove the quotes.
- **`FUNCTION_NOT_FOUND: date_sub`** — you're on Athena engine v3. Use `current_date - interval '1' day` instead. Hardcoded `WHERE year = '2026' AND month = '06' AND day = '28'` is the most portable.
- **`Access denied when writing to location: s3://airo-builder-athena-results-prod/...`** — you're on ReadOnly. Switch to Ops.
- **Dashboard shows nothing / blank cards** — you opened it via `file://`. Use the HTTP server step above.
- **CSV columns don't match script expectations** — script reads by header name, so extra columns are fine. Required headers: `customer_id`, `app_id`, `publish_url`, `publish_flag`, `tla_flag`, `hibernation_flag`.
