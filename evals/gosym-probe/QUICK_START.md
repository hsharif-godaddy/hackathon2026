# Quick Start

Get the eval harness running locally against AAB in under 10 minutes.

---

## Prerequisites

- Node.js ≥ 20 and pnpm installed
- AWS SSO access to `airobuild-dev-private-sso`
- AAB able to run locally (`pnpm run dev` from repo root)

---

## 1. AWS SSO Login

Both GoCode (the LLM proxy) and AAB read credentials from the same AWS SSO
profile.

```bash
aws sso login --profile airobuild-dev-private-sso
```

Verify access:

```bash
aws sts get-caller-identity --profile airobuild-dev-private-sso
```

---

## 2. Install Dependencies

From the repo root:

```bash
pnpm install
npx playwright install chromium   # one-time, required for DOM capture
```

---

## 3. Configure Environment

From `evals/gosym-probe/`, copy the example env file and fill in the GoCode credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
# GoCode (OpenAI-compatible endpoint)
OPENAI_BASE_URL=https://caas-gocode-prod.caas-prod.prod.onkatana.net/v1
OPENAI_API_KEY=<your-gocode-api-key>
OPENAI_MODEL=claude-sonnet-4-6

# Environment selector
GD_ENV=local.dev
```

The GoCode API key is a static bearer token — ask a teammate or retrieve it
from the team's shared secrets store.

---

## 4. Start airo-app-builder (AAB) Locally

> **Important:** Start the agents service with `AUTH_TYPE=mock` and
> `SOCKET_DIAGNOSTICS=true`. The default JWT mode requires AWS Secrets
> Manager access that is not available locally. Socket diagnostics
> enables timing events used by the latency evaluator.

From the repo root:

```bash
SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock pnpm run dev
```

Or add both variables to `agents/.env` so they persist across restarts.

Wait until both services are ready before running the harness.

See [Performance (Local Evals)](README.md#performance-local-evals) for
Docker resource allocation and concurrency tuning.

---

## 5. Run the Harness

Run from `evals/gosym-probe/`, or use `pnpm --filter gosym-probe run` from root.

**Single scenario, 3 trials (default):**

```bash
pnpm run eval --scenario build-landing-page
```

**Override trial count:**

```bash
pnpm run eval --scenario build-landing-page --trials 1
```

**All scenarios in a suite:**

```bash
pnpm run eval --suite smoke
```

**All scenarios in a suite, running concurrently (1 trial each):**

```bash
pnpm run eval --suite smoke --parallel-suites
```

**All scenarios:**

```bash
pnpm run eval
```

**Concurrency:**

Trial concurrency is governed by `config.eval.maxConcurrency` and `--concurrency`.
Default `maxConcurrency` per environment:

| Environment  | Default |
| ------------ | ------- |
| `local.dev`  | 2       |
| `local.test` | 2       |
| `local.prod` | 4       |

Override for a single run with `--concurrency N`:

```bash
pnpm run eval --suite smoke --concurrency 4
```

The override applies to that run only and is recorded in
`run-metadata.json` alongside the results.

Results are written to `results/` (see
[Result Storage](README.md#result-storage) for the full directory layout).

---

## Interactive CLI

```bash
pnpm start
```

A terminal UI for running evals, browsing results, managing baselines,
and editing config without remembering flags. Single-keypress
navigation, tab autocomplete on scenario names, and inline `.env`
editing.

See [docs/cli-ui.md](docs/cli-ui.md) for the full menu map and
keyboard reference.

---

## 6. Graduate a Scenario

New scenarios have no baseline and are informational (results never block
runs). Once behavior is stable, **graduate** the scenario to save a
baseline. From that point on the scenario gates future runs automatically
— no code change required.

```bash
pnpm run eval --graduate build-landing-page
```

By default graduation uses the scenario's stability level (`medium` = 5
trials). Override with `--stability` for more or fewer trials:

```bash
pnpm run eval --graduate build-landing-page --stability high   # 10 trials
pnpm run eval --graduate build-landing-page --stability low    # 1 trial
```

To graduate all scenarios in a suite:

```bash
pnpm run eval --graduate-suite smoke
```

Graduation runs N trials, computes a pass rate per evaluator, and
**saves a baseline only on successful promotion**. If every evaluator
reaches the pass-rate threshold (default 90%), the scenario is promoted:

```
✓ Scenario "build-landing-page" promoted [medium / 5 trials]
  Baseline saved.
  Min pass rate: 100% (threshold: 90%)
```

If the threshold is not met, no baseline is saved and per-evaluator
rates are shown:

```
✗ Scenario "build-landing-page" not promoted [medium / 5 trials]
  Baseline not saved (scenario did not meet pass-rate threshold).
  Per-evaluator pass rates (threshold: 90%):
    bug-hit-rate: 100% ✓
    jtbd-completion: 60% ✗
```

Improve the failing evaluators and rerun graduation. See
[Graduating a Scenario](README.md#graduating-a-scenario) in the README
for full details.

---

## Troubleshooting

**Turn times out / no response from AAB**

The most common cause is a missing or invalid `appId`. Each scenario's
`setup()` registers a fresh app via `AgentsApiClient`; check that
`AUTH_TYPE=mock` is set when starting the agents service.

**GoCode 502 errors**

The GoCode proxy occasionally returns 502. The agents service retries
internally, which can stall a turn for the full `turnTimeoutMs` window
(default 20 min). Restart the harness if a run is hung.

**Playwright / HTTPS errors**

AAB's Next.js UI uses a self-signed cert on `:8443`. The harness sets
`ignoreHTTPSErrors: true` automatically — no action needed. If `chromium`
is not found, run `npx playwright install chromium`.

**Wrong environment config loaded**

`GD_ENV` selects the config file (`local.dev` → `config/environments/local.dev.ts`).
Override with `--env local.test` or set `GD_ENV` in `.env`.
