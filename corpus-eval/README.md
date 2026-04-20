# Corpus Evaluation System

Extensible corpus-based evaluation system for testing AI classification agents against labeled datasets.

## Overview

This is **NOT unit testing**. Unit tests mock dependencies and run in CI. Corpus eval runs against the **REAL agent** with real API calls, measures actual classification accuracy, and is run manually/scheduled due to time and cost.

| Aspect       | Unit Tests           | Corpus Eval                       |
| ------------ | -------------------- | --------------------------------- |
| Dependencies | Mocked               | Real agent, real API calls        |
| Speed        | Fast (< 1s)          | Minutes for full corpus           |
| Cost         | Free                 | Real API costs                    |
| CI           | Every PR             | Manual/scheduled only             |
| Purpose      | Test internal logic  | Measure classification accuracy   |
| Output       | Pass/fail assertions | Accuracy scores, confusion matrix |

## Architecture

This package is part of the **agents ecosystem**. It imports directly from `@airo/agents` and evaluates agent behavior against the same environment configuration the agent uses in development.

**Intentional coupling:** corpus-eval shares the agents service environment because evaluation should mirror real runtime conditions. This ensures test results reflect actual agent behavior.

**Extensibility:** The system uses a registry pattern allowing easy addition of new agent evaluators. Each agent type has its own evaluator class and corpus directory.

## Setup

### Prerequisites

1. Node.js 20.19+ or 22.12+
2. pnpm (workspace is configured)
3. Working agents environment (`agents/.env` configured)
4. AWS profile `airo-builder-dev-gocode` configured (for S2S auth)

### Environment

No separate configuration required. All eval scripts run through `agents/load-env.cjs` which handles:

- API key loading from `agents/.env`
- S2S authentication for GoCode proxy (via `AWS_PROFILE=airo-builder-dev-gocode`)
- Environment validation

**AWS Profile:** The eval scripts use `AWS_PROFILE=airo-builder-dev-gocode` for S2S authentication with GoCode. Ensure this profile is configured in your `~/.aws/credentials`.

## Quick Start

```bash
# From repo root
pnpm install

# Run full assessment corpus (538 cases)
pnpm --filter corpus-eval eval:assessment

# Run specific category
pnpm --filter corpus-eval eval:assessment:publish

# With verbose output
pnpm --filter corpus-eval eval:assessment:verbose

# Generate HTML report (JSON is always saved)
pnpm --filter corpus-eval eval run corpora/assessment-agent/ --html
```

## NPM Scripts

Scripts are namespaced by agent type for extensibility:

| Script                            | Description                               |
| --------------------------------- | ----------------------------------------- |
| `eval:skill-loader`               | Run all skill-loader corpora              |
| `eval:skill-loader:verbose`       | All skill-loader corpora, verbose output  |
| `eval:skill-loader:publishing`    | Publishing corpus only, verbose output    |
| `eval:skill-loader:custom-domain` | Custom-domain corpus only, verbose output |
| `eval:assessment`                 | Run full assessment corpus                |
| `eval:assessment:verbose`         | Full corpus with verbose output           |
| `eval:assessment:compare`         | Compare haiku vs sonnet models            |
| `eval:assessment:publish`         | Run publish cases only                    |
| `eval:assessment:domain`          | Run domain cases only                     |
| `eval:assessment:fix`             | Run fix cases only                        |
| `eval:assessment:general`         | Run general/edge cases only               |
| `eval:assessment:path`            | Run path-validation cases only            |

All `eval:*` scripts inherit environment from `agents/.env` via `load-env.cjs`.

## CLI Commands

### `eval run <corpus>`

Run evaluation against a corpus file or directory.

```bash
pnpm eval run corpora/assessment-agent/publish.yaml
pnpm eval run corpora/assessment-agent/   # All files in directory
```

Options:

- `--verbose, -v` - Show detailed progress
- `--model, -m <model>` - Override model (haiku, sonnet)
- `--tags, -t <tags>` - Filter cases by tags (comma-separated)
- `--html` - Also output HTML report
- `--no-report` - Skip saving reports
- `-o, --output <dir>` - Output directory (default: `./reports`)

### `eval compare <corpus>`

Compare evaluation results across multiple models.

```bash
pnpm eval compare corpora/assessment-agent/ -m haiku,sonnet
```

Options:

- `--models, -m <models>` - Models to compare (comma-separated)

## Available Corpora

### skill-loader/

Tests whether the `develop` agent correctly loads (or avoids loading) a skill in response to a user prompt. Each case provides a prompt and an `expectedSkill` — either a skill name the agent must load, or `null` meaning no skill should be loaded.

Cases run serially against a shared agent instance (parallelism is unsafe due to mutable state in the agent wrapper).

Each `eval:skill-loader*` script runs `scripts/sync-agents-assets.cjs` first so `agents/dist/prompts/` and `agents/dist/skills/**/skill.md` match `agents/src/` without a full agents build.

```bash
# Run all skill-loader corpora
pnpm --filter corpus-eval eval:skill-loader

# With per-case output
pnpm --filter corpus-eval eval:skill-loader:verbose

# Run publishing corpus only
pnpm --filter corpus-eval eval:skill-loader:publishing

# Run custom-domain corpus only
pnpm --filter corpus-eval eval:skill-loader:custom-domain
```

| File                 | Cases | Description                                      |
| -------------------- | ----- | ------------------------------------------------ |
| `publishing.yaml`    | 10    | Publishing/deploy intent vs unrelated UI prompts |
| `custom-domain.yaml` | 22    | Domain attach/purchase vs unrelated UI prompts   |

### assessment-agent/

Test corpus for the AssessmentAgent (568 test cases):

| File           | Cases | Description                                     |
| -------------- | ----- | ----------------------------------------------- |
| `publish.yaml` | 113   | Publish/deploy related prompts                  |
| `domain.yaml`  | 110   | Domain registration and management              |
| `fix.yaml`     | 115   | Bug fixes and troubleshooting                   |
| `general.yaml` | 230   | General requests + edge cases + initial prompts |

See `corpora/assessment-agent/README.md` for detailed corpus documentation.

## Corpus Format

Corpus files are YAML organized by expected task type:

```yaml
metadata:
  name: "Assessment Agent - Publish Cases"
  version: "1.0.0"
  agent: "assessment-agent"
  description: "Test cases for publish task type"

config:
  defaultModel: "haiku"
  timeoutMs: 5000

cases:
  - id: "publish-clear-001"
    prompt: "publish my app"
    expectedTaskType: "publish"
    expectedPath: "embedding"
    minConfidence: 80
    tags: ["clear-intent", "en-us"]
    rationale: "Direct publish request"

  # Multi-turn case
  - id: "publish-multi-001"
    previousMessage: "I need to deploy my website"
    prompt: "yes, make it live"
    expectedTaskType: "publish"
    expectedPath: "haiku"
    tags: ["multi-turn", "context-dependent"]
```

## Test Case Fields

| Field              | Required | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `id`               | Yes      | Unique identifier                                    |
| `prompt`           | Yes      | User message to classify                             |
| `expectedTaskType` | Yes      | Expected classification (publish/domain/fix/general) |
| `previousMessage`  | No       | Previous message for multi-turn context              |
| `expectedPath`     | No       | Expected classification path (embedding/haiku/any)   |
| `minConfidence`    | No       | Minimum confidence threshold (0-100)                 |
| `tags`             | No       | Tags for filtering                                   |
| `rationale`        | No       | Explanation of expected outcome                      |

## Metrics

The evaluation produces two types of metrics:

**Classification Metrics** (what matters for billing):

- **Accuracy**: Overall classification accuracy
- **Precision/Recall/F1**: Per task type
- **Confusion Matrix**: Misclassification patterns

**Path Efficiency Metrics** (cost/latency optimization):

- **Path Ratios**: % embedding (fast) vs % Haiku (fallback)
- **Path Warnings**: Cases that took an unexpected path
- **Latency Stats**: avg, p50, p95

**Note:** Path mismatches are tracked as warnings, not failures. A case passes if the classification is correct. This separates "correctness" from "efficiency".

## Reports

JSON reports are saved by default to `reports/`. HTML reports can be generated with `--html`.

```bash
# Default: saves JSON report
pnpm eval run corpora/assessment-agent/
# -> reports/eval-report-*.json

# Also generate HTML report (interactive dashboard)
pnpm eval run corpora/assessment-agent/ --html
# -> reports/eval-report-*.json + reports/eval-report-*.html

# Skip saving reports (console output only)
pnpm eval run corpora/assessment-agent/ --no-report
```

## Extensibility

### Adding New Agent Evaluators

The system uses a registry pattern for adding new agent evaluators:

```typescript
// src/evaluators/my-agent-evaluator.ts
import {
  BaseEvaluator,
  registerEvaluator,
  CaseResult,
} from "./base-evaluator.js";
import { TestCase } from "../corpus/types.js";

class MyAgentEvaluator extends BaseEvaluator {
  get name() {
    return "My Agent Evaluator";
  }
  get agentType() {
    return "my-agent";
  }

  async initialize() {
    /* Setup resources */
  }

  async evaluateCase(testCase: TestCase): Promise<CaseResult> {
    // Call your agent and compare results
    const result = await myAgent.process(testCase.prompt);
    return {
      caseId: testCase.id,
      prompt: testCase.prompt,
      expected: { taskType: testCase.expectedTaskType, minConfidence: 0 },
      actual: {
        taskType: result.type,
        confidence: result.confidence,
        path: result.path,
      },
      passed: result.type === testCase.expectedTaskType,
      failures: [],
      latencyMs: result.latencyMs,
    };
  }

  async cleanup() {
    /* Cleanup resources */
  }
}

registerEvaluator("my-agent", (config) => new MyAgentEvaluator(config));
```

### Creating a New Corpus

1. Create directory: `corpora/my-agent/`
2. Add YAML files organized by category
3. Create `corpora/my-agent/README.md` documenting the corpus
4. Add npm scripts: `eval:my-agent`, `eval:my-agent:verbose`, etc.

## Design Documentation

See `docs/plans/2026-04-06-corpus-eval-system-design.md` for:

- Full architecture details
- Extensibility patterns
- Phase 2 S3 support plans
- Implementation status
