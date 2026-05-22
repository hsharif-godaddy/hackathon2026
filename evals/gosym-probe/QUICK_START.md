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
PROBE_OPENAI_API_KEY=<your-gocode-api-key>
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

## 6. Bootstrap Regression Testing

Graduation records a baseline from a known-good AAB branch (your control).
Future eval runs compare against that baseline to detect regressions in a
test branch.

**Step 1: Graduate against the control branch**

Start AAB on the branch you trust (e.g. `main`):

```bash
# repo root, on main
SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock pnpm run dev
```

Graduate the golden-light suite to save baselines:

```bash
pnpm run eval --graduate-suite golden-light --fan-out
```

**Step 2: Gate the test branch**

Switch AAB to the branch under test and restart:

```bash
# repo root, on your feature branch
SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock pnpm run dev
```

Run the suite against the saved baselines:

```bash
pnpm run eval --suite golden-light --fan-out
```

Regressions are flagged automatically per-evaluator against the
graduated baseline. See
[Graduating a Scenario](README.md#graduating-a-scenario) for stability
levels, pass-rate thresholds, and per-evaluator output.

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
