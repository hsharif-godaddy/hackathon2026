# Brand-Logo Scenario

Evaluates the logo-designer template flow: brand discovery conversation,
color/font selection, and logo generation.

## Prerequisites

The brand-logo scenario requires additional setup beyond the standard
gosym-probe configuration:

### 1. Mock auth for agents

In `agents/.env`:

```dotenv
AUTH_TYPE=mock
```

### 2. Customer ID with logo entitlements

Logo generation calls an external API that checks customer entitlements.
Mock auth doesn't provide a real customer ID, so you must supply one.

In `local-control-plane/.env`:

```dotenv
AUTH_TYPE=none
EVAL_CUSTOMER_ID=<your-entitled-customer-id>
```

The control plane passes this customer ID when registering apps with the
agents service. The logo tool reads it from the app record and includes
it in the S2S call to the logo agent API.

Without this, logo generation fails with:
"Unable to determine customer identity for logo generation"

### 3. Run

```bash
cd evals/gosym-probe
pnpm run eval --scenario brand-logo --trials 1 --skip-baseline
```

## What it tests

- Agent discovers brand identity through conversation before generating
- Agent generates a complete brand (logo, colors, typography)
- Brand output reflects the user's stated direction (calming, minimal, natural)

## Persona

Uses `brand-logo-yoga-studio` persona — a cooperative user with clear
brand vision (sage green, minimal, organic). Tests the happy path.

## Evaluators

- `jtbd-completion` — LLM judge scores whether goals were met
- `bug-hit-rate` — checks for unrecovered errors during the run
