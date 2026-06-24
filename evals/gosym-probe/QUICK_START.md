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

The example already enables S2S auth, so the defaults work as-is. For
reference, the relevant `.env` values are:

```dotenv
# GoCode (OpenAI-compatible endpoint), S2S sso-jwt gateway for dev.
# The /v1 suffix is required (the OpenAI client appends /chat/completions).
OPENAI_BASE_URL=https://api.gocode.caas.dev-gdcorp.tools/v1

# Authenticate via IAM S2S JWT using your AWS SSO session (step 1) instead
# of a static GoCode key. PROBE_OPENAI_API_KEY is not needed in this mode.
GOCODE_USE_S2S_AUTH=true
AWS_PROFILE=airobuild-dev-private-sso

OPENAI_MODEL=claude-sonnet-4-6

# Environment selector
GD_ENV=local.dev
```

Auth uses the IAM S2S JWT minted from your `airobuild-dev-private-sso` SSO
session (step 1) — no static GoCode key required. If you have a stale
`AWS_PROFILE` exported in your shell, unset it or it will shadow this value
(`tsx --env-file` does not override already-set environment variables).

---

## 4. Start airo-app-builder (AAB) Locally

> **Important:** Start the agents service with `AUTH_TYPE=mock`,
> `SOCKET_DIAGNOSTICS=true`, and `ENABLE_AI_DEVTOOLS=false`. The default
> JWT mode requires AWS Secrets Manager access that is not available
> locally. Socket diagnostics enables timing events used by the latency
> evaluator. Disabling AI devtools is required for graduation runs —
> the devtools middleware accumulates all AI SDK events in a single
> process-level store with no eviction; across 20 trials it exhausts
> the V8 heap and crashes the agents process mid-run.

From the repo root:

```bash
SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock ENABLE_AI_DEVTOOLS=false pnpm run dev
```

Or add all three variables to `agents/.env` so they persist across restarts.

Wait until both services are ready before running the harness.

See [Performance (Local Evals)](README.md#performance-local-evals) for
Docker resource allocation and concurrency tuning.

---

## 5. Run the Harness

Run from `evals/gosym-probe/`, or use `pnpm --filter gosym-probe run` from root.

**Smoke test (single scenario, 1 trial):**

```bash
pnpm run eval --scenario build-landing-page --trials 1
```

Use `build-landing-page` to verify the harness is wired up correctly. It
runs a single lightweight turn and confirms end-to-end connectivity.

**Regression gate (golden-light suite):**

```bash
pnpm run eval --suite golden-light --fan-out
```

`golden-light` is the signal-dense suite for gating agent regressions on
new code changes. Covers portfolio, business site, multipage catalog, and
ambiguity handling with evaluators tuned for structural correctness, JTBD
completion, and prompt efficiency. Drop `--fan-out` to run sequentially.

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
pnpm run eval --suite golden-light --concurrency 4
```

The override applies to that run only and is recorded in
`run-metadata.json` alongside the results.

Results are written to `results/` (see
[Result Storage](README.md#result-storage) for the full directory layout).

---

## Interactive UI

Use the **Probe tab** in the Dev Runner TUI (`pnpm run dev` from the repo root)
for interactive eval execution, menu-driven scenario browsing, and baseline
management. No flags to remember.

---

## 6. Regression Testing

The golden-light suite ships with committed baselines in `baselines/`. Run
the suite directly:

```bash
pnpm run eval --suite golden-light --fan-out
```

Regressions are flagged automatically per-evaluator against the saved
baselines. See
[Regression Gating](docs/regression-gating.md) for regression thresholds
and [Graduating a Scenario](README.md#graduating-a-scenario) for stability
levels and per-evaluator output.

**Updating baselines** — only needed when intentionally changing agent
behavior on a known-good branch:

```bash
# repo root, on the control branch (e.g. main)
SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock ENABLE_AI_DEVTOOLS=false pnpm run dev

# graduate to lock in the new baseline
pnpm run eval --graduate-suite golden-light --fan-out
```

Baseline files are gitignored (`baselines/**/*.json`). After graduation
completes, re-add them with `git add -f baselines/` before committing.

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

**Brand-logo scenario**

The `brand-logo` scenario calls an external logo generation API (via S2S)
that checks customer entitlements before generating. With mock auth, no
real customer ID is stored on the app record, so the entitlement check
fails. To fix this, set `EVAL_CUSTOMER_ID` in `local-control-plane/.env`:

```dotenv
EVAL_CUSTOMER_ID=<entitled-customer-id>
```

Also ensure `AUTH_TYPE=none` in `local-control-plane/.env` (not `mock` —
the control plane only understands `none` or `jwt`).

See `src/scenarios/brand-logo/README.md` for full details.
