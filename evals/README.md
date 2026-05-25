# Evaluation Tools

This directory contains all evaluation, testing, and benchmarking tools for the Airo App Builder platform.

## Tools

### gosym-probe

Local, offline eval harness that drives a synthetic user (Claude Sonnet via GoCode) through scripted scenarios against a locally running AAB instance. Records transcripts, captures DOM snapshots via Playwright, and scores results with LLM-as-a-Judge evaluators. Supports baseline regression gating and graduation workflows.

**Type:** TypeScript (workspace package)

```bash
pnpm --filter gosym-probe start          # interactive CLI
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

### agentic-qa

Browser-based agentic QA framework using Stagehand. Runs goal-based (not step-based) test scenarios against live AAB deployments. Evaluates website quality across 9 dimensions: functional, content, visual, performance, accessibility, usability, SEO, security, and business-fit.

**Type:** TypeScript (workspace package)

```bash
pnpm --filter agentic-qa test scenarios/create-site.yaml
pnpm --filter agentic-qa test --all scenarios/golden-dataset/
pnpm --filter agentic-qa test -- --quality-only --url <url>
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

**Type:** YAML configuration (no package.json)

Triggered via GitHub Actions:
- `Run Brand Logo Eval Scenarios` workflow
- `Run Browser Testing Scenarios` workflow

### airo-baseline-set

Canonical 10-user baseline dataset for Airo agent regression testing. Contains synthetic user personas, paired scenarios, evaluator definitions, and JSON schemas. Consumed by `gosym-probe` (airo-baseline suite) and `goarena`.

**Type:** YAML dataset (no package.json)

## Architecture

```
evals/
  agentic-qa/           Browser-based goal-driven QA (Stagehand)
  agentic-qa-langfuse/  Langfuse trace evaluation pipeline
  airo-baseline-set/    Shared baseline dataset (personas + scenarios)
  corpus-eval/          Classification accuracy testing (corpora)
  goarena/              Synthia platform eval configs (YAML)
  gosym-probe/          End-to-end agent eval harness (local)
```
