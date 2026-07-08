# Release Pipeline Runbook

The automated release pipeline runs the Go `release-manager` binary in **headless mode** from GitHub Actions — the same binary an operator can run interactively as a TUI. See [`.github/workflows/release.yml`](../.github/workflows/release.yml) and [`.github/workflows/rollback.yml`](../.github/workflows/rollback.yml).

## TL;DR

- **Cadence:** 5×/weekday at **00/06/12/18/21 UTC** (Mon–Fri). The 21:00 train was added to split the US-afternoon merge peak (the 18→00 UTC window) off the 00:00 train, which otherwise shipped ~2× every other train's PR load; trains are 6h apart except the 18→21→00 stretch (3h each), so an un-approved release is now superseded within ~3h there rather than 6h. The `preflight` job skips cleanly when there are no commits since the last GitHub release.
- **Headless phases with an approval gate before prod:**
  `preflight → test-phase → [dark-phase] → approve-prod → prod-phase` (+ a `slack-failure` backstop).
  The test phase runs to completion and **exits**; the pipeline pauses at the `approve-prod` GitHub Environment. A reviewer approves in the browser and can **close the tab** — the prod phase runs unattended. The **dark phase** (on by default) dark-deploys the build to prod at 0% traffic and validates it live *before* the gate — see [Dark release](#dark-release).
- **Single Slack message, updated in place** (started → test done → **⏳ awaiting prod approval** → prod done → complete/FAILED), rendered by the binary. When the test phase finishes, the message shows a `:hourglass_flowing_sand: Awaiting prod approval — Review & approve` link to the run, so the channel is pinged that a reviewer needs to act before prod proceeds. The approvers listed under `release.approval_mentions` in `release-manager.yml` (plain Slack handles — usernames, or a user-group handle like `ask-airo-sre`) are pinged so they're notified directly. Two important details: (1) the ping is a **separate fresh message** — a broadcast reply in the release thread — *not* folded into the in-place status edit, because Slack only delivers `@`-mention notifications on a **new** message, never on a `chat.update` edit. (2) The binary resolves each handle to its Slack ID at run time via `users.list` / `usergroups.list` (a raw `@handle` renders as inert text — only the resolved `<@U…>` / `<!subteam^S…>` token notifies), which needs the bot's **`users:read` + `usergroups:read`** scopes; an unresolved handle or a missing scope simply drops that one mention (the release is never blocked). Credentials come from the `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` repo secrets (no AWS).
- **GHA-only.** Releases run only through Actions. The laptop TUI remains as emergency break-glass. On launch, a **real (non-dry-run) CLI release first shows a "use GitHub Actions" notice with the [workflow link](https://github.com/gdcorp-partners/airo-app-builder/actions/workflows/release.yml) and requires an explicit `y` to continue** — so the CLI isn't reached for by habit (`--dry-run` and `--auto-approve` skip the prompt; the headless `run --headless` GHA path never sees it). As a further guard, the TUI's preflight checks for an in-flight GHA release (via `gh`, using the operator's own auth — no AWS) and **refuses to start if a `release.yml` run is active**, including one paused at the `approve-prod` gate (run status `waiting`). Use `--force-lock` to override for genuine break-glass. This is one-directional: GHA does not detect an in-progress laptop release (that signal is the SSM lock, which CI intentionally avoids), so still don't kick off a manual release just before a scheduled one.
- **Dry-run:** Actions → Release Pipeline → Run workflow → `dry_run: true`. Stages print `[DRY RUN] would trigger …`, the prod gate is skipped so the whole flow runs end to end, and Slack is not posted.

## How it works

The two phases are separate processes (the approval Environment sits between them). To keep the single Slack message and the GitHub release body byte-identical across that gap, the **test phase serializes its pipeline state** (stages + outputs + values + rollback snapshot + release notes + Slack `ts`) to `state.json`, uploaded as the `release-phase-state` artifact. The **prod phase imports it**, re-hydrating the TEST section, then appends and runs the PROD stages, cuts the GitHub release, and finalizes the Slack message.

All release logic — stage ordering/parallelism, dispatch + wait, log-output parsing, health checks, release notes, Slack rendering, rollback discovery — lives in the binary (`release-manager/internal/{pipeline,render,headless,gh,slack}`), shared with the TUI. There is no duplicated bash.

## Workflows

### Orchestrators (this repo)

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`release.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/release.yml) | schedule + `workflow_dispatch` | The full release: test → (dark) → approval gate → prod. Invokes the headless `release-manager`. |
| [`rollback.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/rollback.yml) | `workflow_dispatch` | Restore the previous-good prod artifact + image tags. Invokes `release-manager --mode rollback`. |
| [`release-supersede.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/release-supersede.yml) | schedule | Rejects a release stuck `waiting` at the gate so the lock frees (see [Approve prod](#approve-prod)). |
| [`dark-release-dev.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/dark-release-dev.yml) | `workflow_dispatch` | Standalone dev dark release (NOT part of the auto pipeline). Pure GHA — see [Dark release](#dark-release). |

### Building-block workflows the orchestrators dispatch

The release-manager (and the dev dark-release GHA) dispatch and wait on these. Cross-repo dispatch into `gdcorp-commerce/pioneer-infra` uses the `PIONEER_INFRA_TOKEN` secret; in-repo dispatch uses the default `GITHUB_TOKEN`. (The `pioneer-infra` links assume the standard `.github/workflows/` location on `main` — adjust if that repo relocates them.)

| Workflow | Repo | Role |
| --- | --- | --- |
| [`aws-deploy-app.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/aws-deploy-app.yml) | `gdcorp-partners/airo-app-builder` | Deploy the Katana app (builds the app artifact; supports `strategy=dark_release`). |
| [`promote-artifact.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/promote-artifact.yml) | `gdcorp-partners/airo-app-builder` | Promote an app artifact to an environment (prod deploy, prod dark-deploy, rollback). |
| [`playwright-e2e.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/playwright-e2e.yml) | `gdcorp-partners/airo-app-builder` | E2E + regression suites (test, dark, and prod), incl. host-paas fan-out. |
| [`simulation_evaluation.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/simulation_evaluation.yml) | `gdcorp-partners/airo-app-builder` | Advisory agent-quality score gate (threshold 70). |
| [`combined-airo-app-build.yml`](https://github.com/gdcorp-commerce/pioneer-infra/blob/main/.github/workflows/combined-airo-app-build.yml) | `gdcorp-commerce/pioneer-infra` | Build agent + preview + publish container images (release pipeline). |
| [`agent`](https://github.com/gdcorp-commerce/pioneer-infra/blob/main/.github/workflows/docker-airo-app-builder-agent.yml) / [`preview`](https://github.com/gdcorp-commerce/pioneer-infra/blob/main/.github/workflows/docker-airo-app-builder-preview.yml) / [`publish`](https://github.com/gdcorp-commerce/pioneer-infra/blob/main/.github/workflows/docker-airo-app-builder-publish.yml) `docker-airo-app-builder-*.yml` | `gdcorp-commerce/pioneer-infra` | Per-component image builds (used by the **dev** dark release). |
| [`docker-promote.yml`](https://github.com/gdcorp-commerce/pioneer-infra/blob/main/.github/workflows/docker-promote.yml) | `gdcorp-commerce/pioneer-infra` | Promote built images into the prod ECR. |
| [`release-group-simple.yml`](https://github.com/gdcorp-commerce/pioneer-infra/blob/main/.github/workflows/release-group-simple.yml) | `gdcorp-commerce/pioneer-infra` | Create/bind (or tear down) a cohort-less **Release Group** for a dark build. |
| [`airo-preprov-management-unified.yml`](https://github.com/gdcorp-commerce/pioneer-infra/blob/main/.github/workflows/airo-preprov-management-unified.yml) | `gdcorp-commerce/pioneer-infra` | Upsert + reload pre-provisioned stacks with the new image tags. |
| [`airo-fleet-reload.yml`](https://github.com/gdcorp-commerce/pioneer-infra/blob/main/.github/workflows/airo-fleet-reload.yml) | `gdcorp-commerce/pioneer-infra` | Advisory fleet reload of the existing app fleet. |

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
- **Hard-cancel** (someone hits *Cancel workflow run* instead of *Reject*). If the run is cancelled **while a phase is running** (test or prod — the common case), that job's `if: cancelled()` cleanup step finalizes the message to `⛔ Release cancelled`. GitHub exposes no API for *who* clicked cancel, so it's unattributed (unlike a **Reject**, which names the reviewer). A cancel in the brief window while the run is *idle at the gate* (no phase running) can't be cleaned up that way — the message stays on "Awaiting prod approval" until the supersede janitor retires it. Prefer **Reject** at the gate over cancelling the run.

**Don't-approve ⇒ auto-superseded.** A release left sitting at the gate would otherwise hold the `airo-release-main` lock for up to 30 days, stalling the cadence. The **`release-supersede.yml`** janitor runs on the same cron and, in its own concurrency group (so it can act while the lock is held), finds any `release.yml` run still in `waiting` at the gate (older than `min_age_minutes`, default 30) and **rejects its pending deployment**. That makes `approve-prod` fail, which frees the lock (the next scheduled release, already queued behind it, starts) and triggers that run's own `gate-declined` job to finalize the Slack message to `⛔ Superseded — no approval before the next scheduled release`. It only targets `waiting` runs, so it never aborts an active deploy or a rollback.

> **Why reject, not cancel:** `gh run cancel` is a **no-op** against a run held by a required-reviewers gate — GitHub keeps it `waiting` until a reviewer acts or the 30-day timeout. Only rejecting the pending deployment frees it, and rejecting requires a **reviewer-authorized token** (the ambient `GITHUB_TOKEN` / `github-actions[bot]` isn't a `release-prod-approval` reviewer, so it 403s). The janitor uses the **`RELEASE_SUPERSEDE_TOKEN`** secret for the reject. **If that secret isn't set, the janitor can't free the lock itself** — it logs a warning with the run URL, and someone must **Reject the gate manually** (Actions → the stuck run → Review deployments → Reject). Manual reject via API: `gh api repos/$REPO/actions/runs/<run_id>/pending_deployments -X POST --input -` with body `{"environment_ids":[<id>],"state":"rejected","comment":"…"}`.

To pause auto-supersede (e.g. to hold a release at the gate over a weekend), disable the **Release Supersede** workflow in the Actions tab.

**Blocking vs advisory.** The validate stages — **E2E, Regression, Health Check** (plus **Simulation Evaluation** in the test phase) — are *advisory* in both phases: a failure shows ❌ in Slack + the approval summary, each stage runs to completion independently (a failure in one no longer cancels its siblings), and the failure does not hard-stop the phase. What "advisory" buys you differs by phase:

- **Test phase:** a failed validate stage still lets the pipeline **pause at the gate** for you to judge (a flaky e2e/sim-eval shouldn't hard-fail a release).
- **Prod phase:** prod is already live (images + app promoted) by the time these run, so a failed validate stage is surfaced but the **GitHub release tag is still cut**. The failure signals the live deploy needs a look — it doesn't withhold the release.

The hard blockers are the deploy stages: **`Deploy App to Test`** / **`Build Container Images`** in test (if either fails there's no artifact/images to promote, so the test phase fails and `approve-prod` never runs) and **`Promote Images`** / **`Promote App`** / **`Upsert + Reload Pre-Prov`** in prod (a failed promote means prod didn't actually update, so no release is cut). Fix forward and re-trigger.

## Dark release

A **dark release** deploys a new build to **production infrastructure at 0% traffic**. No real user is routed to it, but the team can reach it and validate it live before promoting it to the whole fleet.

**How you reach a dark build:** Katana's picker sets a persistent, non-HttpOnly `x_katana_version` cookie when a request hits a dark URL of the form `https://<host>/?x-katana-version=<selector>&cookie=1`. The `<selector>` is the **dark-released commit SHA**. Because the cookie is readable by the browser, the UI can show which version is pinned and let you exit dark mode (delete the cookie and reload onto the live build). Client helpers: `getDarkReleaseVersion()` / `exitDarkRelease()` in `app/src/lib/katana/dark-release.ts`.

**Two things make a dark build work:**

1. **Katana `dark_release` deploy** of the app artifact at 0% traffic (via `aws-deploy-app.yml` or `promote-artifact.yml` with `strategy=dark_release`).
2. **A cohort-less Release Group** (created via `release-group-simple.yml`) that binds the agent/preview/publish **image tags** to that commit SHA — so the dark stack (AI Chat, preview, publish) actually runs the new images, not the live ones. The images must exist in the prod ECR first (promoted via `docker-promote.yml`), or the bind references tags that aren't there and the dark stack is non-functional. Warm **RG-tagged pre-provs** are created so the dark stack is responsive on first load.

### Inside the automatic pipeline

The `dark-phase` job of `release.yml` runs the `prod-dark` environment from `release-manager.yml` **before** the approval gate, so the reviewer approves a live, already-tested dark build. It is on by default; a manual dispatch can opt out with `run_dark=false`, and scheduled runs always run it. In order, it:

1. **Promotes the images to the prod ECR first** (`dark-promote-images`) — so the bind has real images to reference.
2. **Dark-deploys the app** to prod at 0% traffic (`dark-deploy-app` → `promote-artifact.yml`, `strategy=dark_release`).
3. **Creates + binds a cohort-less Release Group** (`dark-create-rg`, advisory — a failed create must not block the release) with `preProvsPerInventoryTarget: 35`.
4. Runs **advisory dark E2E + regression** against the derived dark URL (`dark-e2e`, `dark-regression`) — surfaced in Slack, never gates the promote.

The dark URL + `katanaSelector` are **derived** from the pinned commit (not scraped). The dark Release Group is torn down at the start of the prod phase; if a hard cancel happens while paused at the gate, the bound RG self-heals via `rolloutPct=0` + the dark artifact's 24h TTL.

### Dev dark release — `dark-release-dev.yml`

[`dark-release-dev.yml`](https://github.com/gdcorp-partners/airo-app-builder/blob/main/.github/workflows/dark-release-dev.yml) is a **standalone, one-click** dev tool that reproduces the manual "Release Group Dark Release" steps in a single dispatch. It is **NOT** part of the automatic release pipeline and **does not** touch the release-manager binary — it is pure GHA that dispatches building-block workflows and waits on each. Use it to put an arbitrary branch/commit's build behind a dark URL in a non-prod (or prod) environment for hands-on testing.

**What it does (`action: Create + Reload`):**

1. **Resolve** the input `branch`/tag to a full commit SHA (so the build target and the `katanaSelector` reference the exact same commit).
2. **Build images** — dispatch the three per-component builds in `pioneer-infra` (`docker-airo-app-builder-{agent,preview,publish}.yml`). These are **pure builds** (no pre-prov-management, so they never touch the fleet / release train); each emits its own immutable `pi-<pioneer-sha>-ext-<airo-sha>` tag in its own run log. The workflow scrapes each tag and asserts its `-ext-<sha7>` matches the resolved commit (catching a mis-selected concurrent build).
3. **Katana dark release** — dispatch the in-repo `aws-deploy-app.yml` with `strategy=dark_release` at 0% traffic for the chosen `app_environment`. The dispatch `ref` is the branch (the API rejects a raw SHA), and the exact SHA is pinned via `-f sha`.
4. **Create + bind a cohort-less Release Group** — dispatch `release-group-simple.yml` in `pioneer-infra` with `katanaSelector=<SHA>` and the three scraped image tags, warming `preprov_count` RG-tagged pre-provs.
5. **Report** to the run summary: the commit, the three image tags, the Release Group ID, the warm-preprov count, and the ready-to-use **dark URL** for the target environment.

**Inputs:**

| Input | Default | Meaning |
| --- | --- | --- |
| `action` | `Create + Reload` | `Create + Reload` (build + dark-release + bind) or `Rollback` (tear the RG down). |
| `branch` | `main` | airo-app-builder branch/tag **name** to build + dark-release (not a raw SHA — it's the dispatch ref). |
| `publish_image` | `true` | Push built images to the registry. `true` guarantees the bind's tags exist in ECR; `false` builds only (assumes the commit's images are already in ECR, e.g. from CI). |
| `app_environment` | `pre-test` | Katana environment for the dark deploy: `pre-test`, `dev-private-ecs`, or `test`. |
| `mgmt_environment` | `mgmt-dev-private-us-west-2` | Management environment for the Release Group bind / rollback. |
| `composition_id` | `ai-builder` | Composition ID. |
| `composition_version` | `v4` | Composition version. |
| `preprov_count` | `5` | Warm RG-tagged pre-provs per inventory target (capped at the stable `target_count`). `5` suits dev; raise to cover more cells; `0` = none. |
| `release_group_id` | _(empty)_ | Release Group ID to roll back — **REQUIRED when `action=Rollback`**. |

**Environments → dark host** (`https://<host>/?x-katana-version=<SHA>&cookie=1`, mirroring `playwright-e2e.yml`'s env → base-URL map):

| `app_environment` | Dark host |
| --- | --- |
| `prod` | `airo-builder.godaddy.com` |
| `test` | `airo-builder.test-godaddy.com` |
| `pre-test` | `pre-test-airo-builder.test-godaddy.com` |
| `dev-private-ecs` | `airo-builder.dev-godaddy.com` |

**How to run it:** Actions → **Dark Release (dev)** → **Run workflow**; leave `action: Create + Reload`, set `branch`, pick an `app_environment`, adjust `preprov_count` if you need a warmer stack. When it finishes, open the **dark URL** from the run summary (the `x_katana_version` cookie pins you to the dark build), and **note the Release Group ID** — you need it to roll back.

**How to roll it back:** re-run the same workflow with `action: Rollback` and `release_group_id: <the ID from the summary>` (same `mgmt_environment`). This dispatches `release-group-simple.yml` with `action=Rollback` to tear the Release Group down. If you never captured the ID, it's linked as the "release-group run" in the create run's summary.

**Concurrency & safety notes:**

- Serializes **per-branch** (`concurrency: dark-release-dev-${{ inputs.branch }}`, `cancel-in-progress: false`) — different branches (⇒ different commits) can run concurrently; same-branch runs queue. A run that may have created a Release Group is never cancelled out from under itself (that would orphan the RG).
- Each waited-on child run must conclude `success` — a guard-**skipped** deploy fails the dev workflow rather than letting the RG bind a never-deployed stack.
- If `publish_image: false` and the dark URL 404s or shows the old build, the commit's images weren't in ECR — re-run with `publish_image: true`.

## Roll back

Actions → **Release Rollback** → Run workflow. The binary auto-discovers the previous-good artifact ID + image tags from prod history; override any of the four values via the inputs when the most recent successful run is the bad one. A free-text `reason` is recorded in the run summary.

## Re-running after a failure

A failed stage is terminal (no interactive retry — that's a TUI-only affordance). Re-run the failed phase from the Actions UI. The downstream workflows (`aws-deploy-app`, `combined-airo-app-build`, `docker-promote`, `promote-artifact`, `airo-preprov-management-unified`) are safe to re-invoke; the `airo-release-main` concurrency lock queues rather than deadlocks a re-run.

## Required setup

- **Repo secrets:** `PIONEER_INFRA_TOKEN` (dispatch + poll in `gdcorp-commerce/pioneer-infra`), `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`. The default `GITHUB_TOKEN` covers `gdcorp-partners/airo-app-builder`. The binary routes the pioneer token by repo owner automatically.
- **`RELEASE_SUPERSEDE_TOKEN` (optional but recommended):** a token (PAT or GitHub App installation token) belonging to a **`release-prod-approval` reviewer**, with `actions:write`. Used *only* by `release-supersede.yml` to reject a stuck gate's pending deployment — the one action `GITHUB_TOKEN` can't perform (a bot isn't a reviewer). Without it, auto-supersede degrades to a warning + manual reject (see "Don't-approve" above). Prefer a GitHub App token (no expiry, org-managed) over a personal PAT.
- **Environment:** `release-prod-approval` with required reviewers.
- **Self-hosted runners** (`airo-cicd-runners`): the test/prod phases run here because the health-check stages curl `airo-builder.{test-,}godaddy.com` (WAF-gated) from the runner, and the runner needs the `gh` CLI (≥ 2.87).

## Troubleshooting

- **"gh CLI not available" / auth errors at preflight:** the self-hosted runner is missing `gh` or `GH_TOKEN`/`PIONEER_INFRA_TOKEN` aren't set.
- **A dispatched run isn't found / wrong run attached:** the binary extracts the dispatched run from `gh workflow run` output. If a `gh` version regresses that behavior, validate via a `dry_run` first; this is the top thing to confirm on the first live run.
- **Slack didn't update:** Slack delivery is best-effort and never fails the release; check the repo secrets and the job logs.

## Related

- [`release-manager/`](../release-manager/) — the binary (TUI + headless), the single source of truth.
- [`.github/workflows/release-manager.yml`](../.github/workflows/release-manager.yml) — lint/test/build CI for the binary.
