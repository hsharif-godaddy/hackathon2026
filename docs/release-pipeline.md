# Release Pipeline Runbook

The automated release pipeline runs the Go `release-manager` binary in **headless mode** from GitHub Actions — the same binary an operator can run interactively as a TUI. See [`.github/workflows/release.yml`](../.github/workflows/release.yml) and [`.github/workflows/rollback.yml`](../.github/workflows/rollback.yml).

## TL;DR

- **Cadence:** every 6h on weekdays (00/06/12/18 UTC, Mon–Fri). The `preflight` job skips cleanly when there are no commits since the last GitHub release.
- **Two headless invocations with an approval gate between them:**
  `preflight → test-phase → approve-prod → prod-phase` (+ a `slack-failure` backstop).
  The test phase runs to completion and **exits**; the pipeline pauses at the `approve-prod` GitHub Environment. A reviewer approves in the browser and can **close the tab** — the prod phase runs unattended.
- **Single Slack message, updated in place** (started → test done → **⏳ awaiting prod approval** → prod done → complete/FAILED), rendered by the binary. When the test phase finishes, the message shows a `:hourglass_flowing_sand: Awaiting prod approval — Review & approve` link to the run, so the channel is pinged that a reviewer needs to act before prod proceeds. Credentials come from the `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` repo secrets (no AWS).
- **GHA-only.** Releases run only through Actions. The laptop TUI remains as emergency break-glass. As a guard, the TUI's preflight checks for an in-flight GHA release (via `gh`, using the operator's own auth — no AWS) and **refuses to start if a `release.yml` run is active**, including one paused at the `approve-prod` gate (run status `waiting`). Use `--force-lock` to override for genuine break-glass. This is one-directional: GHA does not detect an in-progress laptop release (that signal is the SSM lock, which CI intentionally avoids), so still don't kick off a manual release just before a scheduled one.
- **Dry-run:** Actions → Release Pipeline → Run workflow → `dry_run: true`. Stages print `[DRY RUN] would trigger …`, the prod gate is skipped so the whole flow runs end to end, and Slack is not posted.

## How it works

The two phases are separate processes (the approval Environment sits between them). To keep the single Slack message and the GitHub release body byte-identical across that gap, the **test phase serializes its pipeline state** (stages + outputs + values + rollback snapshot + release notes + Slack `ts`) to `state.json`, uploaded as the `release-phase-state` artifact. The **prod phase imports it**, re-hydrating the TEST section, then appends and runs the PROD stages, cuts the GitHub release, and finalizes the Slack message.

All release logic — stage ordering/parallelism, dispatch + wait, log-output parsing, health checks, release notes, Slack rendering, rollback discovery — lives in the binary (`release-manager/internal/{pipeline,render,headless,gh,slack}`), shared with the TUI. There is no duplicated bash.

## Trigger a release

- **Automatic:** nothing to do; the schedule fires.
- **Manual:** Actions → **Release Pipeline** → **Run workflow** → pick branch (default `main`) → Run.

## Approve prod

1. Open the run in **Actions → Release Pipeline**.
2. Read the **`test-phase`** job summary (per-stage results table **and the Manual Checklist** — the binary prints the checklist items as a tickable task list, so you can run through the manual QA before approving) and the Slack thread — including any **advisory** failures (see below).
3. On **`approve-prod`** → **Review deployments** → select `release-prod-approval` → **Approve and deploy** (or **Reject**).
4. Reviewers are configured in **Settings → Environments → `release-prod-approval`** (isolated from the `prod` Environment, so direct `promote-artifact.yml` runs are not gated).
5. After prod is cut, the **`prod-phase`** job summary prints the **prod** Manual Checklist (post-deploy verification on the live site).

**The gate decision is attributed in the same Slack message.** There's no separate post — the single release message is edited in place:

- **Approve** → once prod resumes, the footer credits you: `✅ Approved by @you · Deploying to prod…`, then `🏁 Complete (…) · approved by @you`.
- **Reject** → the `gate-declined` job edits the message to `⛔ Release rejected by @you — <your comment>` (the reviewer's rejection comment is pulled from the run's approval history). The `slack-failure` backstop is suppressed in this case, so you won't see a duplicate "Release pipeline failed" post.
- **Hard-cancel** (someone hits *Cancel workflow run* instead of *Reject*) cancels every job — including the finalizer — and GitHub exposes no API for who clicked it, so that case can't be attributed. The message is left as-is and the generic backstop post is the safety net. Prefer **Reject** at the gate over cancelling the run.

**Don't-approve ⇒ auto-superseded.** A release left sitting at the gate would otherwise hold the `airo-release-main` lock for up to 30 days, stalling the cadence. The **`release-supersede.yml`** janitor runs on the same cron and, in its own concurrency group (so it can act while the lock is held), cancels any `release.yml` run still in `waiting` at the gate (older than `min_age_minutes`, default 30) and edits its Slack message to `⛔ Superseded — no approval before the next scheduled release`. Cancelling frees the lock, so the next scheduled release — already queued behind it — starts. It only targets `waiting` runs, so it never aborts an active deploy or a rollback. To pause this (e.g. to hold a release at the gate over a weekend), disable the **Release Supersede** workflow in the Actions tab.

**Blocking vs advisory.** The validate stages — **E2E, Regression, Health Check** (plus **Simulation Evaluation** in the test phase) — are *advisory* in both phases: a failure shows ❌ in Slack + the approval summary, each stage runs to completion independently (a failure in one no longer cancels its siblings), and the failure does not hard-stop the phase. What "advisory" buys you differs by phase:

- **Test phase:** a failed validate stage still lets the pipeline **pause at the gate** for you to judge (a flaky e2e/sim-eval shouldn't hard-fail a release).
- **Prod phase:** prod is already live (images + app promoted) by the time these run, so a failed validate stage is surfaced but the **GitHub release tag is still cut**. The failure signals the live deploy needs a look — it doesn't withhold the release.

The hard blockers are the deploy stages: **`Deploy App to Test`** / **`Build Container Images`** in test (if either fails there's no artifact/images to promote, so the test phase fails and `approve-prod` never runs) and **`Promote Images`** / **`Promote App`** / **`Upsert + Reload Pre-Prov`** in prod (a failed promote means prod didn't actually update, so no release is cut). Fix forward and re-trigger.

## Roll back

Actions → **Release Rollback** → Run workflow. The binary auto-discovers the previous-good artifact ID + image tags from prod history; override any of the four values via the inputs when the most recent successful run is the bad one. A free-text `reason` is recorded in the run summary.

## Re-running after a failure

A failed stage is terminal (no interactive retry — that's a TUI-only affordance). Re-run the failed phase from the Actions UI. The downstream workflows (`aws-deploy-app`, `combined-airo-app-build`, `docker-promote`, `promote-artifact`, `airo-preprov-management-unified`) are safe to re-invoke; the `airo-release-main` concurrency lock queues rather than deadlocks a re-run.

## Required setup

- **Repo secrets:** `PIONEER_INFRA_TOKEN` (dispatch + poll in `gdcorp-commerce/pioneer-infra`), `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`. The default `GITHUB_TOKEN` covers `gdcorp-partners/airo-app-builder`. The binary routes the pioneer token by repo owner automatically.
- **Environment:** `release-prod-approval` with required reviewers.
- **Self-hosted runners** (`airo-cicd-runners`): the test/prod phases run here because the health-check stages curl `airo-builder.{test-,}godaddy.com` (WAF-gated) from the runner, and the runner needs the `gh` CLI (≥ 2.87).

## Troubleshooting

- **"gh CLI not available" / auth errors at preflight:** the self-hosted runner is missing `gh` or `GH_TOKEN`/`PIONEER_INFRA_TOKEN` aren't set.
- **A dispatched run isn't found / wrong run attached:** the binary extracts the dispatched run from `gh workflow run` output. If a `gh` version regresses that behavior, validate via a `dry_run` first; this is the top thing to confirm on the first live run.
- **Slack didn't update:** Slack delivery is best-effort and never fails the release; check the repo secrets and the job logs.

## Related

- [`release-manager/`](../release-manager/) — the binary (TUI + headless), the single source of truth.
- [`.github/workflows/release-manager.yml`](../.github/workflows/release-manager.yml) — lint/test/build CI for the binary.
