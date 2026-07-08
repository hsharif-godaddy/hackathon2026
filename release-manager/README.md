# Release Manager

TUI tool for orchestrating the full Airo deployment pipeline across multiple GitHub Actions workflows and repositories. Built with [Bubble Tea v2](https://charm.sh/bubbletea/) for live stage monitoring and [Huh v2](https://charm.sh/huh/) for interactive prompts.

## Quick Start

```bash
# From repo root
pnpm run release

# Dry run (read-only, validates config and parsing against last successful runs)
pnpm run release --dry-run

# Or from the release-manager directory
make build && ./dist/release-manager
```

## Prerequisites

- **Go 1.24+**
- **gh CLI >= 2.87.0** — authenticated with access to both deployment repos
- **AWS CLI** — authenticated via SSO for Slack notifications and deploy locking
- **Access** — request the following before running releases:
  - **AWS Access:** either `JOMAX\DEV-Airo-Builders` or `JOMAX\SRE-Airo-Builders` ([ServiceNow request](https://godaddy.service-now.com/esc?id=sc_cat_item&sys_id=3bcb6decdb0f4dd0f1e6eba813961906))
  - **GitHub orgs:** `JOMAX\gdcorp-partners` and `JOMAX\gdcorp-commerce` ([ServiceNow request](https://godaddy.service-now.com/esc?id=sc_cat_item&sys_id=3bcb6decdb0f4dd0f1e6eba813961906))
  - After `gdcorp-commerce` access is granted, request membership to the [pioneer](https://github.com/orgs/gdcorp-commerce/teams/pioneer) team

```bash
# Authenticate AWS SSO (required before deploying)
aws sso login --profile airobuild-dev-private-sso
```

## CLI Flags

| Flag                     | Short | Description                                                                                                |
| ------------------------ | ----- | ---------------------------------------------------------------------------------------------------------- |
| `--dry-run`              | `-n`  | Run full pipeline without triggering any workflows (read-only)                                             |
| `--auto-approve`         |       | Skip interactive confirmations (combine with `--dry-run`)                                                  |
| `--branch`               |       | Branch to build from (default: `main`)                                                                     |
| `--fail-stage`           |       | Stage ID to simulate failure in dry-run (repeatable, e.g. `--fail-stage deploy-app --fail-stage dark-e2e`) |
| `--no-slack`             |       | Disable Slack notifications                                                                                |
| `--force-lock`           |       | Break through an existing deploy lock held by another operator                                             |
| `--rollback-artifact-id` |       | Override the previous-good app artifact ID (skips the GitHub lookup for it)                                |
| `--rollback-agent-tag`   |       | Override the previous-good agent image tag                                                                 |
| `--rollback-preview-tag` |       | Override the previous-good preview image tag                                                               |
| `--rollback-publish-tag` |       | Override the previous-good publish image tag                                                               |
| `--rollback-base-commit` |       | Override the base commit SHA used for release-notes comparison (bypasses ext-hash extraction)              |

### Overriding rollback values

When release-manager starts it fetches the current production state from GitHub (latest successful `promote-artifact.yml` run for the app artifact ID, and latest successful `airo-preprov-management-unified.yml` PROD run for the image tags). If any of those runs don't match the state actually deployed in production — e.g. a failed rollback left GH in an inconsistent state, or a hotfix bypassed the normal pipeline — use the `--rollback-*` flags to force the correct values:

```bash
./release-manager \
  --rollback-artifact-id 12345 \
  --rollback-agent-tag pi-abc123-ext-def456 \
  --rollback-preview-tag pi-abc123-ext-def456 \
  --rollback-publish-tag pi-abc123-ext-def456
```

Any flag that is set wins over whatever was discovered from GitHub. If `--rollback-artifact-id` is set, the artifact-ID GitHub lookup is skipped entirely. If all three image tag flags are set, the image-tags GitHub lookup is skipped entirely — so a broken PROD preprov-management history cannot block a release. Partial overrides are allowed; only the fields you set are replaced.

Overridden values still appear in the "Rollback Snapshot" confirmation step so you can double-check them before the release proceeds.

Release notes are cut by comparing the base commit against the target branch HEAD. The base is normally the ext hash embedded in the previous-good agent image tag (e.g. `pi-abc123-ext-def456` → base `def456`). Use `--rollback-base-commit <sha>` to override just that base — useful when the discovered or overridden agent tag has no embedded ext hash, or when notes should span a different base than the rollback image. Unlike the other overrides, this one doesn't mutate the snapshot; it only changes what `FetchReleaseNotes` compares.

## Configuration

All pipeline stages, workflow inputs, checklists, and rollback steps are defined in `release-manager.yml`. Copy to `release-manager.local.yml` for local overrides (gitignored).

### Top-level sections

```yaml
slack:
  secret_name: releases_slack_bot_token # AWS Secrets Manager secret name
  aws_profile: airobuild-dev-private-sso # AWS profile for fetching the secret

lock:
  ssm_parameter: /airo/release-manager/deploy-lock # SSM Parameter Store path
  aws_profile: airobuild-dev-private-sso

pipeline:
  environments: { ... }
  rollback: { ... }
```

### Stage fields

| Field               | Description                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`                | Unique stage identifier (used by `--fail-stage`)                                                          |
| `name`              | Display name in TUI and Slack                                                                             |
| `group`             | Stages with the same group run in parallel                                                                |
| `type`              | Set to `checklist` for manual verification steps                                                          |
| `repo`              | GitHub `owner/repo`                                                                                       |
| `workflow`          | GitHub Actions workflow filename                                                                          |
| `ref`               | Git ref to trigger the workflow on; use `{{branch}}` — GitHub rejects commit SHAs for `workflow_dispatch` |
| `active_run_check`  | Set to `false` to exclude this workflow from the preflight active-run blocker                             |
| `active_run_filter` | Only block on active runs whose `displayTitle` contains this string                                       |
| `inputs`            | Workflow inputs; supports `{{env.stage.output}}`, `{{commit}}`, and `{{branch}}`                          |
| `outputs`           | Parsed from run logs via regex (`from: run-log`, `pattern`, `job_match`)                                  |
| `matrix`            | List of input sets to run the same workflow multiple times in parallel                                    |
| `items`             | Checklist items (for `type: checklist` stages)                                                            |

## Pipeline Flow

1. **Preflight checks** — validates gh CLI, authentication, repo access, AWS CLI auth, active deploy workflows, and deploy lock
2. **Deploy lock** — acquires an SSM Parameter Store lock to prevent concurrent deploys
3. **Rollback snapshot** — fetches current production state from GitHub for verification
4. **Release notes + commit pinning** — resolves the target branch to a specific commit SHA, then lists merged PRs since the last production deploy. The pinned SHA is stored and used by all subsequent stages, ensuring deterministic builds even if the branch advances during the deploy.
5. **Test deployment** — deploys app + builds images in parallel, then PaaS E2E + health-check + sim-eval + manual checklist
6. **Dark phase** _(on by default; a manual dispatch can opt out with `run_dark=false`; scheduled runs always run it)_ — before the gate, **promotes the agent/preview/publish images to the prod ECR first** (so the bind has real images to reference), dark-deploys the build to prod via Katana `dark_release` (0% traffic), binds those images to the build's commit SHA via a cohort-less Release Group, and runs advisory dark E2E + regression against the dark URL, so the approver reviews a live, already-tested dark build
7. **Production gate** — confirmation prompt before prod deploy (the awaiting-approval Slack CTA + approver ping fire from the last pre-gate phase: test when `run_dark` is off, dark when on)
8. **Production deployment** — rolls back the dark Release Group first if one was created, then promotes images (**skipped when the dark phase already promoted them**), then promotes app + upserts pre-prov in parallel, then e2e-v2 shadow + health-check + prod checklist
9. **Completion** — offers Done or Rollback options

> **GHA dispatch toggles** (`.github/workflows/release.yml`): `run_dark` (default on) runs the dark phase above — uncheck to skip (scheduled runs always run it); `notify_slack` (default on) — uncheck to run silently, in which case the would-be Slack messages are printed to the GHA run log instead of posted.

## Commit SHA Pinning

The target branch (e.g. `main`) is resolved to a specific commit SHA at the start of the release notes phase. This pinned SHA is available via the `{{commit}}` template variable and prevents two classes of bugs:

- **Stale release notes** — if the operator waits before approving, new commits on `main` won't cause a mismatch between what was reviewed and what gets deployed
- **Non-deterministic parallel builds** — the `build-images` stage triggers three image builds in parallel; without pinning, a new commit landing mid-build could cause one image to be built from a different commit than the others

The pinned commit is displayed in the TUI release notes view and included in Slack notifications. The `{{commit}}` value defaults to the branch name if resolution fails, preserving backward compatibility.

### Usage: inputs vs. ref

`{{commit}}` must only be used in workflow **inputs**, never as the `ref` field. GitHub's `workflow_dispatch` API only accepts branch or tag names as `ref` — passing a raw commit SHA returns HTTP 422.

| Field    | Use                  | Example                                  |
| -------- | -------------------- | ---------------------------------------- |
| `ref`    | Always `{{branch}}`  | Triggers the workflow on the branch      |
| `inputs` | Can use `{{commit}}` | Workflow checks out the exact pinned SHA |

For example, `deploy-app` passes the pinned SHA as a `sha` input to `aws-deploy-app.yml`, which uses it for checkout and Docker image tagging. `build-images` passes it as `airo-app-builder-branch`. Rollback steps use `{{branch}}` for both `ref` and inputs since they deploy known-good artifacts and benefit from the latest workflow definition.

## Failure Handling

When any workflow fails, options are:

- **Retry** — re-trigger with same inputs
- **Continue** — skip and proceed
- **Rollback** — revert to previous production state (only available after prod deployment begins)
- **Abort** — stop the pipeline

Checklists can also be "cancelled" by submitting with unchecked items, which triggers the same failure prompt.

## Concurrency Guard

Two layers prevent multiple operators from deploying simultaneously:

### Layer 1: Active workflow check

During preflight, deployment workflows are queried for `in_progress` or `queued` runs. Stages can opt out with `active_run_check: false`, and shared workflows like `docker-promote.yml` use the `active_run_filter` field to only match runs with a specific `displayTitle` (e.g. `"airo-builder"`).

### Layer 2: SSM Parameter Store lock

A distributed lock is acquired after preflight checks pass. The lock stores the operator's username, branch, and timestamp as a JSON value in SSM Parameter Store. If another operator holds the lock, the deploy is blocked.

- **Lock acquisition** uses a write-wait-verify pattern for pseudo-atomicity (write → wait 2s → read back to confirm)
- **Lock release** happens automatically on all exit paths (completion, abort, rollback) with up to 3 retries
- **Stale locks** — if release fails after all retries, the lock becomes stale and the next operator can use `--force-lock` to override it
- **Dry-run** — the SSM lock is fully functional in dry-run mode for testing

## Slack Notifications

Deployment progress is posted to a Slack channel as a single, continuously-updated message using the Slack Web API (`chat.postMessage` / `chat.update`). The message includes:

- Operator username
- Release notes (merged PRs with authors)
- Per-stage status with emoji indicators and clickable GitHub Actions run links
- Artifact ID and image tags for PROD and ROLLBACK stages
- Job-level progress (e.g. "2/4 jobs done") for running workflows
- Final status (complete, aborted, or rollback)

Credentials (bot token + channel ID) are fetched from AWS Secrets Manager at startup. If AWS auth is expired or the secret is unavailable, the tool prompts whether to continue without notifications.

Updates are throttled to every 10 seconds and skipped entirely if the message content hasn't changed.

## Dry Run Mode

Dry-run mode (`--dry-run`) exercises the full pipeline without triggering any workflows:

- Preflight checks run against real GitHub and AWS APIs
- The SSM deploy lock is acquired and released (real lock, for testing)
- Rollback snapshot and release notes are fetched from real GitHub data
- Stage execution replays the last successful run for each workflow, including real log parsing
- Health check stages are skipped because live environments may not be running the dry-run commit
- Job-level progress is simulated by fetching actual job counts from past runs
- Simulated failures can be injected with `--fail-stage <stage-id>`
- Slack notifications fire with a `[DRY RUN]` prefix
- Combine with `--auto-approve` to skip all interactive prompts

## Logging

Every run writes a timestamped log file to `release-manager/logs/` (e.g. `release-2026-04-01_15-21-32.log`). Logs capture preflight results, lock acquisition/release, snapshot values, stage lifecycle events, polling status, user decisions, Slack updates, and errors. Previous logs are preserved across runs. The `logs/` directory is gitignored.

## Project Structure

```
release-manager/
├── cmd/release-manager/     # Entry point and CLI flag parsing
├── internal/
│   ├── config/              # YAML config loading, validation, template resolution
│   ├── gh/                  # GitHub CLI wrapper (Runner interface, DryRunner, LiveRunner)
│   ├── lock/                # AWS SSM Parameter Store distributed lock
│   ├── logger/              # Timestamped file logger
│   ├── pipeline/            # Pipeline orchestration, stage execution, output parsing
│   ├── slack/               # Slack Web API client (post, update, credential fetching)
│   └── tui/                 # Bubble Tea model, update loop, view rendering
├── release-manager.yml      # Pipeline configuration
├── Makefile                 # Build, test, lint targets
└── logs/                    # Runtime log files (gitignored)
```

## Development

```bash
make build    # Build binary
make test     # Run tests
make vet      # Go vet
make lint     # golangci-lint
make fmt      # Check formatting (gofumpt)
make fmt-fix  # Fix formatting
make check    # All of the above
make tidy     # go mod tidy
make clean    # Remove build artifacts
```
