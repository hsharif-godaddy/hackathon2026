# Corpus Evaluation System Design

## Status

Implemented (Phase 1)

## Context

An `AssessmentAgent` was introduced that classifies user prompts into task types (publish, domain, fix, general) for budget billing. The agent uses a two-tier classification approach: fast embeddings (~50-100ms) with Haiku LLM fallback for ambiguous cases (~1-2s).

The current unit tests mock dependencies and run in CI. We need a **different style of testing** that:
- Runs against the REAL agent (no mocks)
- Measures classification accuracy with labeled test cases
- Is too slow/expensive for CI (run manually or scheduled)
- Supports multi-turn conversation chains
- Eventually scales to larger S3-hosted corpus

This system is designed to be **extensible** for evaluating multiple agents beyond AssessmentAgent, including future Phase 2 agents:
- Preprocessing categorizer
- Cost estimator
- Post-execution judge agent

## Architecture

### Separation from Unit Tests

| Aspect | Unit Tests | Corpus Eval |
|--------|------------|-------------|
| Dependencies | Mocked | Real agent, real API calls |
| Speed | Fast (< 1s) | Slow (minutes for full corpus) |
| Cost | Free | Real API costs |
| CI | Runs on every PR | Manual/scheduled only |
| Purpose | Test internal logic | Measure classification accuracy |
| Output | Pass/fail assertions | Accuracy scores, confusion matrix |

### Package Structure

```
corpus-eval/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                    # CLI entry point (Commander.js)
│   ├── runner.ts                   # Main evaluation orchestration
│   ├── reporter.ts                 # JSON/HTML report generation
│   ├── types.ts                    # Core type definitions
│   ├── corpus/
│   │   ├── loader.ts               # Load YAML/JSON corpus files
│   │   └── types.ts                # Zod schemas for validation
│   ├── evaluators/
│   │   ├── base-evaluator.ts       # Abstract interface + registry
│   │   ├── assessment-evaluator.ts # AssessmentAgent evaluator
│   │   └── index.ts                # Exports
│   ├── metrics/
│   │   ├── index.ts                # Exports
│   │   ├── classification.ts       # Accuracy, precision, recall, F1
│   │   └── confusion-matrix.ts     # Per-category analysis
│   └── models/
│       └── config.ts               # Multi-model configuration
├── corpora/
│   └── assessment-agent/           # Agent-specific corpus directory
│       ├── README.md               # Corpus documentation
│       ├── publish.yaml            # 113 publish-related cases
│       ├── domain.yaml             # 110 domain-related cases
│       ├── fix.yaml                # 115 fix-related cases
│       └── general.yaml            # 200 general/edge cases
└── reports/                        # Generated evaluation reports
```

### Corpus Organization

Corpora are organized **by agent type**, then **by category** within each agent:

```
corpora/
├── assessment-agent/               # AssessmentAgent corpus
│   ├── publish.yaml               # Cases expecting "publish" classification
│   ├── domain.yaml                # Cases expecting "domain" classification
│   ├── fix.yaml                   # Cases expecting "fix" classification
│   └── general.yaml               # Cases expecting "general" + edge cases
├── preprocessor-agent/            # Future: Preprocessor corpus
│   └── ...
└── judge-agent/                   # Future: Judge agent corpus
    └── ...
```

This structure:
- Keeps each agent's test data isolated
- Allows category-specific evaluation runs
- Scales naturally as new agents are added

### Corpus Format

```yaml
metadata:
  name: "Assessment Agent - Publish Cases"
  version: "1.0.0"
  agent: "assessment-agent"
  description: "Test cases for publish task type classification"

config:
  defaultModel: "haiku"
  timeoutMs: 5000

cases:
  # Clear intent
  - id: "publish-clear-001"
    prompt: "publish my app"
    expectedTaskType: "publish"
    expectedPath: "embedding"
    minConfidence: 80
    tags: ["clear-intent", "en-us"]
    rationale: "Direct publish request"

  # Multi-turn with context
  - id: "publish-multi-001"
    previousMessage: "I need to deploy my website"
    prompt: "yes, make it live"
    expectedTaskType: "publish"
    expectedPath: "haiku"
    tags: ["multi-turn", "context-dependent"]
    rationale: "Follow-up requires conversation context"

  # Multilingual
  - id: "publish-es-001"
    prompt: "publica mi aplicación"
    expectedTaskType: "publish"
    tags: ["multilingual", "es-es"]

  # Complex/detailed prompts
  - id: "publish-complex-001"
    prompt: "I've been working on this app for weeks and I think it's finally ready. Can you publish it to the live site?"
    expectedTaskType: "publish"
    tags: ["complex", "long-form"]
```

### Test Case Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier within corpus |
| `prompt` | Yes | User message to classify |
| `expectedTaskType` | Yes | Expected classification (publish/domain/fix/general) |
| `previousMessage` | No | Previous message for multi-turn context |
| `expectedPath` | No | Expected path (embedding/haiku/any), default: any |
| `minConfidence` | No | Minimum confidence threshold (0-100) |
| `tags` | No | Tags for filtering and analysis |
| `rationale` | No | Explanation of expected outcome |

### Metrics

- **Classification**: Accuracy, precision, recall, F1 per task type
- **Path analysis**: % embedding-only vs % Haiku fallback
- **Latency**: avg, p50, p95
- **Confusion matrix**: [actual][predicted] counts

### CLI Interface

Scripts are namespaced by agent type for extensibility:

```bash
# Run all assessment-agent corpus files
pnpm --filter corpus-eval eval:assessment

# Run specific category
pnpm --filter corpus-eval eval:assessment:publish
pnpm --filter corpus-eval eval:assessment:domain
pnpm --filter corpus-eval eval:assessment:fix
pnpm --filter corpus-eval eval:assessment:general

# With specific model override
pnpm --filter corpus-eval eval run -m sonnet corpora/assessment-agent/

# Filter by tags
pnpm --filter corpus-eval eval run --tags "multilingual,negation" corpora/assessment-agent/

# Compare models
pnpm --filter corpus-eval eval compare corpora/assessment-agent/ -m haiku,sonnet

# Generate HTML report (JSON is always saved)
pnpm --filter corpus-eval eval run corpora/assessment-agent/ --html
```

---

## Extensibility Architecture

The system is designed for easy addition of new agent evaluators.

### Base Evaluator Interface

```typescript
// src/evaluators/base-evaluator.ts

export interface EvaluatorConfig {
  model?: string;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface CaseResult {
  caseId: string;
  prompt: string;
  expected: { taskType: string; path?: string; minConfidence: number };
  actual: { taskType: string; confidence: number; path: string };
  passed: boolean;
  failures: string[];
  latencyMs: number;
}

export abstract class BaseEvaluator {
  constructor(protected config: EvaluatorConfig) {}

  /** Display name for reports */
  abstract get name(): string;

  /** Agent type identifier (matches corpus directory name) */
  abstract get agentType(): string;

  /** Initialize resources (API clients, etc.) */
  abstract initialize(): Promise<void>;

  /** Evaluate a single test case */
  abstract evaluateCase(testCase: TestCase): Promise<CaseResult>;

  /** Cleanup resources */
  abstract cleanup(): Promise<void>;
}
```

### Evaluator Registry

```typescript
// src/evaluators/base-evaluator.ts

type EvaluatorFactory = (config: EvaluatorConfig) => BaseEvaluator;

const evaluatorFactories = new Map<string, EvaluatorFactory>();

export function registerEvaluator(agentType: string, factory: EvaluatorFactory): void {
  evaluatorFactories.set(agentType, factory);
}

export function createEvaluator(agentType: string, config: EvaluatorConfig = {}): BaseEvaluator {
  const factory = evaluatorFactories.get(agentType);
  if (!factory) {
    throw new Error(`No evaluator registered for agent type: ${agentType}`);
  }
  return factory(config);
}
```

### Adding a New Agent Evaluator

To add evaluation support for a new agent:

1. **Create the evaluator class:**

```typescript
// src/evaluators/my-agent-evaluator.ts
import { BaseEvaluator, registerEvaluator, CaseResult, EvaluatorConfig } from './base-evaluator.js';
import { TestCase } from '../corpus/types.js';

class MyAgentEvaluator extends BaseEvaluator {
  get name() { return 'My Agent Evaluator'; }
  get agentType() { return 'my-agent'; }

  async initialize() {
    // Initialize agent client, API connections, etc.
  }

  async evaluateCase(testCase: TestCase): Promise<CaseResult> {
    const start = Date.now();
    // Call your agent
    const result = await myAgent.process(testCase.prompt);
    const latencyMs = Date.now() - start;

    // Compare against expected
    const passed = result.type === testCase.expectedTaskType;

    return {
      caseId: testCase.id,
      prompt: testCase.prompt,
      expected: { taskType: testCase.expectedTaskType, minConfidence: testCase.minConfidence || 0 },
      actual: { taskType: result.type, confidence: result.confidence, path: result.path },
      passed,
      failures: passed ? [] : [`Expected ${testCase.expectedTaskType}, got ${result.type}`],
      latencyMs,
    };
  }

  async cleanup() {
    // Cleanup resources
  }
}

// Register with the factory
registerEvaluator('my-agent', (config) => new MyAgentEvaluator(config));
```

2. **Export from index:**

```typescript
// src/evaluators/index.ts
export * from './base-evaluator.js';
export * from './assessment-evaluator.js';
export * from './my-agent-evaluator.js';  // Add new evaluator
```

3. **Create corpus directory:**

```
corpora/my-agent/
├── README.md
├── category-a.yaml
├── category-b.yaml
└── edge-cases.yaml
```

4. **Add npm scripts (optional):**

```json
{
  "eval:my-agent": "... tsx src/index.ts run corpora/my-agent/",
  "eval:my-agent:verbose": "... tsx src/index.ts run corpora/my-agent/ --verbose"
}
```

### Corpus Schema Extensions

If a new agent requires additional test case fields, extend the base schema:

```typescript
// src/corpus/types.ts
import { z } from 'zod';

// Base test case schema
export const BaseTestCaseSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  tags: z.array(z.string()).optional().default([]),
  rationale: z.string().optional(),
});

// Assessment agent extends with classification fields
export const AssessmentTestCaseSchema = BaseTestCaseSchema.extend({
  expectedTaskType: z.enum(['publish', 'domain', 'fix', 'general']),
  expectedPath: z.enum(['embedding', 'haiku', 'any']).optional().default('any'),
  minConfidence: z.number().min(0).max(100).optional().default(0),
  previousMessage: z.string().optional(),
});

// Future: Cost estimator extends with different fields
export const CostEstimatorTestCaseSchema = BaseTestCaseSchema.extend({
  expectedCostTier: z.enum(['low', 'medium', 'high']),
  expectedTokenRange: z.object({ min: z.number(), max: z.number() }).optional(),
});
```

---

## Implementation Status

### Phase 1: Local Corpus (Complete)

| Component | Status |
|-----------|--------|
| Package setup | ✅ |
| Corpus types/loader | ✅ |
| Base evaluator + registry | ✅ |
| Assessment evaluator | ✅ |
| Metrics (accuracy, F1, confusion matrix) | ✅ |
| CLI (Commander.js) | ✅ |
| Reporter (JSON + HTML) | ✅ |
| Initial corpus (~538 cases) | ✅ |

### Phase 2: S3 Support (Future)

| Component | Description | Estimate |
|-----------|-------------|----------|
| CDK Stack | S3 bucket, IAM policies | 2-4 hours |
| S3 Loader | Download corpus, cache locally | 2-4 hours |
| Upload CLI | Script to upload to S3 | 1-2 hours |
| Results Storage | Upload results for history | 2-4 hours |
| Integration | End-to-end testing | 2-4 hours |

### Phase 3: Additional Agents (Future)

- Preprocessor evaluator
- Cost estimator evaluator
- Judge evaluator

---

## Critical Files

| File | Purpose |
|------|---------|
| `corpus-eval/src/evaluators/base-evaluator.ts` | Abstract interface + registry pattern |
| `corpus-eval/src/evaluators/assessment-evaluator.ts` | AssessmentAgent implementation |
| `corpus-eval/src/corpus/types.ts` | Zod schemas for validation |
| `corpus-eval/src/corpus/loader.ts` | YAML loading and validation |
| `corpus-eval/src/runner.ts` | Orchestrates evaluation runs |
| `corpus-eval/src/reporter.ts` | JSON/HTML report generation |
| `agents/src/agents/assessment-agent/` | Agent being evaluated |

## Related Documents

- `corpus-eval/README.md` - Package documentation
- `corpus-eval/corpora/assessment-agent/README.md` - Assessment corpus documentation
- `agents/docs/preprocessing-assessment-agent.md` - AssessmentAgent design
- `docs/plans/2026-02-25-eval-snapshots-design.md` - Eval snapshots system
