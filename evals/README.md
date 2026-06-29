# Evaluation Tools

This directory contains all evaluation, testing, and benchmarking tools for the Airo App Builder platform.

## Tools

### gosym-probe

Local, offline eval harness that drives a synthetic user (Claude Sonnet via GoCode) through scripted scenarios against a locally running AAB instance. Records transcripts, captures DOM snapshots via Playwright, and scores results with LLM-as-a-Judge evaluators. Supports baseline regression gating and graduation workflows.

**Type:** TypeScript (workspace package)

```bash
pnpm run dev                             # Dev Runner TUI (use the Probe tab for interactive evals)
pnpm --filter gosym-probe eval           # headless eval runner
pnpm --filter gosym-probe save-baseline <run-id>
```

### corpus-eval

Corpus-based evaluation system for AI classification agents. Tests the assessment-agent and skill-loader against labeled YAML corpora using real API calls. Measures classification accuracy, precision/recall/F1, confusion matrices, and path efficiency.

**Type:** TypeScript (workspace package)

```bash
pnpm --filter corpus-eval eval:assessment          # full assessment corpus
pnpm --filter corpus-eval eval:skill-loader        # skill-loader corpus
pnpm --filter corpus-eval eval:assessment:compare  # compare models
```

### agentic-qa-langfuse

Automated Langfuse trace evaluation pipeline. Processes production traces from Langfuse and runs LLM-as-judge evaluators (error detection, intent classification, vertical analysis) to score agent behavior at scale.

**Type:** TypeScript (workspace package)

```bash
pnpm --filter agentic-qa-langfuse start             # process last 4h of traces
pnpm --filter agentic-qa-langfuse start -- --hours 24
```

### goarena

Simulation evaluation suite for the Synthia platform. Defines synthetic users, evaluators, and scenarios for browser-based website quality testing. Consumed by GitHub Actions workflows that dispatch runs to the Synthia service.

**Production online evaluators** (`goarena/online-evaluators/`) score Langfuse traces via Synthia batch runners. Load with the **Load Online Evaluators** workflow.

**Type:** YAML configuration (no package.json)

Triggered via GitHub Actions:
- `Run Brand Logo Eval Scenarios` workflow
- `Run Browser Testing Scenarios` workflow
- `Load Online Evaluators` workflow (production trace evaluators)

### airo-baseline-set

Canonical 10-user baseline dataset for Airo agent regression testing. Contains synthetic user personas, paired scenarios, evaluator definitions, and JSON schemas. Consumed by `gosym-probe` (airo-baseline suite) and `goarena`.

**Type:** YAML dataset (no package.json)

### llm-bench

LLM hardware load-test and replay harness. Replays a real captured mitmproxy LLM
workload (the agent's own `chat/completions` traffic) against an
OpenAI-compatible endpoint at ramping concurrency to find the level at which
candidate GPU hardware degrades. Reports time-to-first-token, decode and
end-to-end tokens/sec, request rate, and error rate per step, plus a comparison
against the baseline recorded in the dump.

**Type:** Rust (standalone Cargo crate, outside the pnpm/Turborepo workspace)

```bash
cd evals/llm-bench
cargo run --release -- --dump-only workload.flow          # inspect a capture
cargo run --release -- --ramp --ramp-start 1 --ramp-end 32 --ramp-step 4 \
  --ramp-step-duration 60 --target http://<gpu-host>:8000 workload.flow
```

## Architecture

```
evals/
  agentic-qa-langfuse/  Langfuse trace evaluation pipeline
  airo-baseline-set/    Shared baseline dataset (personas + scenarios)
  corpus-eval/          Classification accuracy testing (corpora)
  goarena/              Synthia platform eval configs (YAML)
  gosym-probe/          End-to-end agent eval harness (local)
  llm-bench/            LLM hardware load-test & replay harness (Rust)
```
