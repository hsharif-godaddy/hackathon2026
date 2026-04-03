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

```bash
# Authenticate AWS SSO (required before deploying)
aws sso login --profile airobuild-dev-private-sso
```

## CLI Flags

| Flag             | Short | Description                                                                                                |
| ---------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `--dry-run`      | `-n`  | Run full pipeline without triggering any workflows (read-only)                                             |
| `--auto-approve` |       | Skip interactive confirmations (combine with `--dry-run`)                                                  |
| `--branch`       |       | Branch to build from (default: `main`)                                                                     |
| `--fail-stage`   |       | Stage ID to simulate failure in dry-run (repeatable, e.g. `--fail-stage deploy-app --fail-stage e2e-test`) |
| `--no-slack`     |       | Disable Slack notifications                                                                                |
| `--force-lock`   |       | Break through an existing deploy lock held by another operator                                             |

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

| Field               | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `id`                | Unique stage identifier (used by `--fail-stage`)                            |
| `name`              | Display name in TUI and Slack                                               |
| `group`             | Stages with the same group run in parallel                                  |
| `type`              | Set to `checklist` for manual verification steps                            |
| `repo`              | GitHub `owner/repo`                                                         |
| `workflow`          | GitHub Actions workflow filename                                            |
| `ref`               | Git ref to trigger the workflow on; supports `{{branch}}` template          |
| `active_run_filter` | Only block on active runs whose `displayTitle` contains this string         |
| `inputs`            | Workflow inputs; supports `{{env.stage.output}}` and `{{branch}}` templates |
| `outputs`           | Parsed from run logs via regex (`from: run-log`, `pattern`, `job_match`)    |
| `matrix`            | List of input sets to run the same workflow multiple times in parallel      |
| `items`             | Checklist items (for `type: checklist` stages)                              |

## Pipeline Flow

1. **Preflight checks** — validates gh CLI, authentication, repo access, AWS CLI auth, active deploy workflows, and deploy lock
2. **Deploy lock** — acquires an SSM Parameter Store lock to prevent concurrent deploys
3. **Rollback snapshot** — fetches current production state from GitHub for verification
4. **Release notes** — lists merged PRs since the last production deploy (comparing the ext commit hash from the previous image tag against the target branch)
5. **Test deployment** — deploys app + builds images in parallel, then E2E tests + manual checklist
6. **Production gate** — confirmation prompt before prod deploy
7. **Production deployment** — promotes images, then promotes app + upserts pre-prov in parallel, then E2E + prod checklist
8. **Completion** — offers Done or Rollback options

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

During preflight, all deployment-related workflows (excluding E2E tests) are queried for `in_progress` or `queued` runs. Shared workflows like `docker-promote.yml` use the `active_run_filter` field to only match runs with a specific `displayTitle` (e.g. `"airo-builder"`).

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
