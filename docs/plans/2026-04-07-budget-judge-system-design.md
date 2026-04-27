# Budget Judge System Design

**Date:** 2026-04-07 (Updated: 2026-04-09)
**Status:** Draft v2
**Author:** ML + Claude + Evaluations Team

## Overview

This document outlines the design for an intelligent cost attribution system that splits AI agent execution costs between customers and GoDaddy. The system uses two complementary attribution signals:

1. **Intent-based rules (business decisions):** Certain intents (publish, domains) are subsidized features—GoDaddy pays regardless of execution quality.
2. **Execution-based rules (quality assessment):** For general requests, empirically-validated signals from execution behavior (errors, friction patterns) determine if GoDaddy should absorb costs due to agent misbehavior.

The evaluations team data shows intent doesn't predict _error-driven_ attribution, but there are still **intent-based business rules that override execution signals**.

**Key Insight:** Analysis of 51,742 traces shows that user intent has only **0.9% unique R²** after controlling for execution metrics. Cost attribution should be based on what the agent _did_, not what the user _asked for_.

## Goals

1. **Accurate Cost Attribution:** Use execution signals (errors, friction patterns) to attribute costs fairly
2. **Swear Jar Categorization:** Route GoDaddy-absorbed costs to engineering prioritization buckets
3. **Low Latency:** Judge Agent must complete in <100ms with deterministic rules
4. **Invariant Guarantee:** `budgetCost + godaddyCost == totalCost` (always, no exceptions)
5. **High Efficacy:** Target 79.3% precision/recall matching human-labeled benchmark

## Empirical Foundation

### The 44-Trace Billing Experiment

Human-labeled traces split into two distinct groups:

| Group               | % of airo | Characteristics                                              |
| ------------------- | --------- | ------------------------------------------------------------ |
| **Error-driven**    | ~76%      | frictionScore=0.0, hasErrors=true, agent failed or no output |
| **Friction-driven** | ~17%      | frictionScore > 0.10, agent looped without crashing          |

### Two Types of Attribution Signals

The Judge uses **both** intent and execution signals for attribution decisions:

#### 1. Intent-Based Attribution (Business Rules)

These are product decisions about which features GoDaddy subsidizes:

| Intent    | Business Rule           | Attribution                |
| --------- | ----------------------- | -------------------------- |
| `publish` | Free feature            | GoDaddy 100%               |
| `domains` | Free feature            | GoDaddy 100%               |
| `general` | Customer responsibility | Evaluate execution signals |

Intent-based rules are **deterministic overrides** — if the user asked to publish, GoDaddy pays regardless of execution quality.

#### 2. Execution-Based Attribution (Quality Rules)

For `general` intent, execution signals determine if GoDaddy should absorb due to agent misbehavior:

| Signal Combination                 | Attribution   | Rationale                         |
| ---------------------------------- | ------------- | --------------------------------- |
| errorCount > 0 AND hasOutput=false | GoDaddy 100%  | Agent failed completely           |
| frictionScore >= 0.15              | GoDaddy 100%  | Agent looped wastefully           |
| errorCount >= 4 AND hasOutput=true | GoDaddy 100%  | Significant errors despite output |
| Clean execution                    | Customer 100% | Agent performed well              |

The evaluations team's analysis shows execution signals (not intent) are predictive for _quality-based_ attribution:

| Model                                              | R²       | Interpretation                        |
| -------------------------------------------------- | -------- | ------------------------------------- |
| cost ~ llmRounds × contextPerRound                 | 99.7%    | The billing identity                  |
| Intent unique R² (after controlling for execution) | **0.9%** | Intent doesn't predict quality issues |

**Key insight:** Intent doesn't predict whether the agent will mess up. But intent DOES determine business subsidization rules.

#### Combined Attribution Logic

```
IF intent is publish OR domains:
    → GoDaddy pays 100% (business rule: free feature)
    → Label: airo-builder:{intent}

ELSE (intent is general):
    → Evaluate execution signals (quality rules)
    → IF execution failure OR high friction:
        → GoDaddy pays (agent misbehavior)
    → ELSE:
        → Customer pays (clean execution)
    → Label: airo-builder:general
```

The Judge LLM prompt includes guidance on:

1. **Intent-based subsidization:** Which intents are free features
2. **Quality-based attribution:** When to absorb costs due to agent issues
3. **Reasoning requirements:** Must cite both intent AND execution signals

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           EXECUTION FLOW (v2)                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         Phase 1: Pre-Check (Blocking)                     │   │
│  │                                                                           │   │
│  │  ┌───────────────┐    ┌────────────────────────────────────────────────┐ │   │
│  │  │ Budget Check  │    │  Assessment Agent                              │ │   │
│  │  │ + Session     │    │  (BLOCKING when budgetServiceEnabled=false)    │ │   │
│  │  │   Create      │    │  (NON-BLOCKING when budgetServiceEnabled=true) │ │   │
│  │  │               │    │                                                │ │   │
│  │  │               │    │  Detects intent: publish, domains, general     │ │   │
│  │  │               │    │  Fast-path: publish/domains → skip Judge       │ │   │
│  │  │               │    │                                                │ │   │
│  │  │               │    │  Output: { intent, isFastPath }                │ │   │
│  │  └───────────────┘    └────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                         │                                        │
│                                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                    Phase 2: Agent Execution                               │   │
│  │                                                                           │   │
│  │  ┌─────────────────────────────┐    ┌─────────────────────────────────┐  │   │
│  │  │  Main Agent Execution       │    │  Assessment Agent               │  │   │
│  │  │  (DevelopAgent, etc.)       │    │  (runs in parallel when         │  │   │
│  │  │                             │    │   budgetServiceEnabled=true)    │  │   │
│  │  │  ExecutionContextTracker:   │    │                                 │  │   │
│  │  │  - Tool calls recorded      │    │  Promise stored, awaited in     │  │   │
│  │  │  - Errors counted           │    │  Phase 3 before Judge           │  │   │
│  │  │  - LLM rounds counted       │    │                                 │  │   │
│  │  │  - Output presence tracked  │    │                                 │  │   │
│  │  │                             │    │                                 │  │   │
│  │  │  GoCode → BMS (sessionId)   │    │                                 │  │   │
│  │  └─────────────────────────────┘    └─────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                         │                                        │
│                                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                 Phase 3: Reconciliation (Blocking, <100ms)                │   │
│  │                                                                           │   │
│  │  1. Await Assessment Agent result → get intent + isFastPath              │   │
│  │  2. Query BMS for totalCost                                              │   │
│  │  3. IF isFastPath (publish/domains): Skip to report, 100% GoDaddy        │   │
│  │                                                                           │   │
│  │  ┌────────────────────┐    ┌────────────────────────────────────────┐    │   │
│  │  │  Friction Scorer   │───►│           Judge Agent                   │    │   │
│  │  │  (Deterministic)   │    │        (Hybrid: Rules + LLM)           │    │   │
│  │  │                    │    │                                         │    │   │
│  │  │  Analyzes:         │    │  Inputs:                                │    │   │
│  │  │  - Tool call seqs  │    │  - totalCost (from BMS)                 │    │   │
│  │  │  - File patterns   │    │  - intent (from Assessment Agent)       │    │   │
│  │  │  - Terminal cmds   │    │  - errorCount                           │    │   │
│  │  │                    │    │  - hasOutput                            │    │   │
│  │  │  Outputs:          │    │  - frictionScore                        │    │   │
│  │  │  - frictionScore   │    │  - firedPatterns[]                      │    │   │
│  │  │  - firedPatterns[] │    │  - llmRounds                            │    │   │
│  │  │                    │    │                                         │    │   │
│  │  │  (<10ms)           │    │  Outputs:                               │    │   │
│  │  │                    │    │  - budgetCost                           │    │   │
│  │  └────────────────────┘    │  - godaddyCost + category               │    │   │
│  │                            │  - label (from intent)                  │    │   │
│  │                            │  - reasoning                            │    │   │
│  │                            └────────────────────────────────────────┘    │   │
│  │                                                                           │   │
│  │  FAST PATH: If Assessment detected full override, skip Judge entirely    │   │
│  │             → Submit report with intent as label, 100% to GoDaddy        │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                         │                                        │
│                                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                    Phase 4: Budget Report to BMS                          │   │
│  │                                                                           │   │
│  │  POST /budget/:budgetId/session/:sessionId/report                        │   │
│  │  { reportItems: [{ budgetCost, productCost, label }] }                   │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Assessment Agent (Intent Detection + Fast Path)

**Purpose:**

1. **Intent Detection:** Classify user prompt to determine intent (publish, domains, general) — required for Judge input and BMS labeling
2. **Fast Path Detection:** Identify "full override" intents that bypass the Judge entirely

**Location:** `agents/src/agents/assessment-agent/` (existing, extended)

**Output:**

```typescript
interface AssessmentResult {
  intent: {
    category: IntentCategory; // publish, domains, general
    confidence: number; // 0-100
  };
  isFastPath: boolean; // True for publish/domains (skip Judge)
}
```

**Fast Path Intents (bypass Judge):**

| Intent    | Action       | Label                  |
| --------- | ------------ | ---------------------- |
| `publish` | 100% GoDaddy | `airo-builder:publish` |
| `domains` | 100% GoDaddy | `airo-builder:domains` |

**Why fast-path?** Publishing and domain configuration are product features we've committed to subsidizing. No need to evaluate execution signals for known-free operations.

#### Blocking vs Non-Blocking Behavior

| Flag                         | Phase 1                                                              | Phase 2                                                   | Phase 3                                  |
| ---------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| `budgetServiceEnabled=false` | **Blocking** — Assessment runs and completes before execution starts | N/A                                                       | N/A                                      |
| `budgetServiceEnabled=true`  | **Non-blocking** — Assessment fires, promise stored                  | Assessment runs in **parallel** with main agent execution | **Await** Assessment result before Judge |

**When `budgetServiceEnabled=true`:**

1. **Phase 1:** Assessment Agent fires asynchronously, promise stored in `assessmentPromises` Map
2. **Phase 2:** Main agent executes in parallel with Assessment Agent
3. **Phase 3:** Await Assessment result to get intent for Judge input (or fast-path bypass)

This allows Assessment to run without adding latency to the user experience while still providing intent to the Judge.

---

### 2. Execution Context Tracker

**Purpose:** Collect execution signals during agent execution for friction scoring and Judge input.

**Location:** `agents/src/server/execution-context-tracker.ts` (new)

**Signals Collected:**

```typescript
interface ExecutionSignals {
  // Error signals (primary attribution, ~76% of airo cases)
  errorCount: number; // Total error events
  hasOutput: boolean; // Did agent produce visible output?

  // For friction scoring
  toolCalls: ToolCallRecord[]; // All tool calls with timing, success, file paths

  // Context
  llmRounds: number; // LLM round-trips (agent_llm_start count)
  durationMs: number; // Total execution time

  // Token usage
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

interface ToolCallRecord {
  name: string; // Tool name (fileRead, fileEdit, terminalCommand, etc.)
  timestamp: number; // When the call started
  durationMs: number; // How long it took
  success: boolean; // Did it succeed?
  error?: string; // Error message if failed

  // For file-based patterns
  filePath?: string; // File path if applicable

  // For terminal patterns
  exitCode?: number; // Exit code for terminal commands

  // For grep patterns
  resultCount?: number; // Number of results (0 = empty)
}
```

**Integration Points:**

- Tool calls: Hook into ai-lib tool execution layer
- Errors: Capture from agent error handlers
- LLM rounds: Count `agent_llm_start` events
- Output: Check if final assistant message exists

---

### 3. Friction Scorer

**Purpose:** Compute friction score from tool call patterns. Deterministic, <10ms.

**Location:** `agents/src/agents/judge-agent/friction-scorer.ts` (new)

#### Friction Score Formula

```
frictionScore = Σ(weight_i × severity_i) / Σ(weight_i)
```

Only patterns that fired (severity > 0) contribute to numerator. Denominator is always sum of all weights.

#### The 5 Friction Patterns

| Pattern             | Fires When                          | Severity Formula                                           | Weight |
| ------------------- | ----------------------------------- | ---------------------------------------------------------- | ------ |
| `repeated_reads`    | Same file read ≥3×                  | `log(max_reads / 3) / log(5)`, capped at 1.0               | 1.0    |
| `repeated_edits`    | Same file edited ≥5×                | `log(max_edits / 5) / log(5)`, capped at 1.0               | 1.0    |
| `grep_spiral`       | ≥5 grep calls with high empty ratio | `(grep_count / 5) × empty_result_ratio`, capped at 1.0     | 1.5    |
| `terminal_failures` | ≥3 failed terminal commands         | `log(fail_count / 3) / log(5) × fail_ratio`, capped at 1.0 | 0.8    |
| `edit_read_loops`   | ≥3 edit→read→edit cycles            | `log(cycles / 3) / log(5)`, capped at 1.0                  | 1.2    |

**Weight Rationale:**

- `grep_spiral` (1.5): Empty searches produce zero value — pure waste
- `terminal_failures` (0.8): Some failures are legitimate (type-check → fix → retry)
- `edit_read_loops` (1.2): Each cycle is an avoidable full LLM round

#### Score Interpretation

| Range     | Meaning                                     |
| --------- | ------------------------------------------- |
| 0.00–0.04 | Clean — no meaningful friction              |
| 0.05–0.09 | Mild — typically one pattern, sub-threshold |
| 0.10–0.14 | Moderate — starting to look wasteful        |
| **0.15+** | **Attribution cutoff — GoDaddy absorbs**    |
| 0.30+     | Severe — unambiguous agent misbehavior      |

**Validation:** Cutoff validated on 2,000 traces (1,000 high-round + 1,000 normal): zero false positives at any cutoff ≥ 0.05.

#### Interface

```typescript
interface FrictionScorerInput {
  toolCalls: ToolCallRecord[];
}

interface FrictionScorerOutput {
  frictionScore: number; // 0.0 to ~0.5
  firedPatterns: FrictionPattern[];
  patternDetails: {
    [pattern: string]: {
      count: number;
      severity: number;
    };
  };
}

type FrictionPattern =
  | "repeated_reads"
  | "repeated_edits"
  | "grep_spiral"
  | "terminal_failures"
  | "edit_read_loops";
```

---

### 4. Judge Agent

**Purpose:** Determine cost split between customer and GoDaddy using tiered attribution logic.

**Location:** `agents/src/agents/judge-agent/`

**Architecture:** Hybrid — deterministic rules for clear cases, optional LLM for edge cases.

**SLA:** <100ms total (deterministic rules: <10ms, LLM fallback if needed: ~50-80ms)

#### Input Schema

```typescript
interface JudgeInput {
  // Core billing — the quantity being split
  totalCost: number; // Actual cost from BMS session (USD)

  // Intent (ATTRIBUTION signal for business rules + labeling)
  intent: {
    category: IntentCategory; // publish, domains, general
    confidence: number; // 0-100
  };

  // Execution signals (ATTRIBUTION signal for quality rules)
  // Only evaluated when intent is 'general'
  errorCount: number; // Total error events (0 = no errors)
  hasOutput: boolean; // Did agent produce visible output?
  frictionScore: number; // Composite 0.0-0.5
  firedPatterns: FrictionPattern[];

  // Context (for reasoning)
  llmRounds: number; // LLM round-trips
}

type IntentCategory = "publish" | "domains" | "general";
```

**Both signal types drive attribution:**

- `intent` → Business rules (publish/domains = free features) + BMS label
- `errorCount`, `hasOutput`, `frictionScore` → Quality rules (agent misbehavior detection)

#### Output Schema

```typescript
interface JudgeOutput {
  budgetCost: number; // Customer pays (USD)

  godaddyCost: {
    cost: number; // GoDaddy absorbs (USD)
    category: SwearJarCategory; // Engineering prioritization bucket
    primarySignal: string; // What triggered absorption
  };

  reasoning: string; // Human-readable explanation (must cite values)
}

// Invariant: budgetCost + godaddyCost.cost == totalCost (always)

type SwearJarCategory =
  | "none" // Customer pays — clean execution
  | "execution_failure" // Errors + no output
  | "error_with_output" // Errors but produced output
  | "repeated_reads" // Friction: file read pattern
  | "edit_loops" // Friction: edit/edit-read cycles
  | "grep_spiral" // Friction: empty search spiral
  | "terminal_failures"; // Friction: terminal command failures
// V2 additions (deferred):
// | 'round_spike'             // Rounds >> session median
// | 'cost_anomaly'            // High cost, no detected signals
```

#### Attribution Logic (Tiered)

**Important:** The evaluations team data shows intent doesn't predict _error-driven_ attribution, but there are still **intent-based business rules that override execution signals**. The tiered logic reflects both.

```
TIER 0 — Intent-Based Business Rules (highest priority, overrides all)
  intent.category == 'publish' OR intent.category == 'domains'?
    → GoDaddy absorbs 100% (free feature - business decision)
    → category = 'free_feature'
    → label = airo-builder:{intent.category}
    → reasoning: "Free feature: {intent.category} is fully subsidized"
    → SKIP execution signal evaluation

TIER 1 — Execution Failure (~76% of quality-driven airo cases)
  intent.category == 'general' AND errorCount > 0 AND hasOutput == false?
    → GoDaddy absorbs 100%
    → category = 'execution_failure'
    → label = airo-builder:general
    → reasoning cites: errorCount value + hasOutput=false

TIER 2 — Friction (~17% of quality-driven airo cases)
  intent.category == 'general' AND frictionScore >= 0.15?
    → GoDaddy absorbs 100%
    → category = dominant pattern from firedPatterns (by precedence)
    → label = airo-builder:general
    → reasoning cites: frictionScore value + firedPatterns list

TIER 3 — Errors with Output (moderate weight)
  intent.category == 'general' AND errorCount >= 4 AND hasOutput == true?
    → GoDaddy absorbs 100%
    → category = 'error_with_output'
    → label = airo-builder:general
    → reasoning explains why errorCount warrants absorption despite output

DEFAULT — Customer Pays
  intent.category == 'general' AND none of above quality issues
  → budgetCost = totalCost
  → category = 'none'
  → label = airo-builder:general
```

**Why this order?**

- Intent-based rules (Tier 0) are business decisions that apply regardless of execution quality
- Execution-based rules (Tiers 1-3) only apply to `general` intent where we need to assess agent quality

**Pattern Category Precedence** (when multiple patterns fire):

```
grep_spiral > edit_read_loops > repeated_reads > repeated_edits > terminal_failures
```

Ordered by cost impact Cohen's d: 1.560 → 1.321 → 1.196 → 1.163 → 1.012.

#### Critical Distinctions

1. **High llmRounds alone ≠ airo.** 31% of high-round traces have zero friction and zero errors — they are legitimately complex.

2. **errorCount > 0 alone ≠ airo.** 20% of not_airo traces have errors. The combination with hasOutput and magnitude provides the signal.

3. **frictionScore ≈ 0.0 with errors is expected.** Error-driven airo cases didn't loop, they crashed. A score of 0.0 with errorCount > 0 doesn't contradict itself.

---

### 5. Report Builder

**Purpose:** Transform Judge output to BMS report format.

**Location:** `agents/src/server/budget-report.ts` (existing, updated)

```typescript
interface ReportItem {
  budgetCost: number; // Charged to customer
  productCost: number; // Total cost for tracking
  label: string; // Category label
}
```

**Label Strategy:**

The label is derived from **intent** (what the user asked for), not from the attribution reason (why GoDaddy absorbed):

| Intent Category | Label                  |
| --------------- | ---------------------- |
| publish         | `airo-builder:publish` |
| domains         | `airo-builder:domains` |
| general         | `airo-builder:general` |

The SwearJarCategory (execution_failure, grep_spiral, etc.) is stored in `godaddyCost.category` for engineering prioritization but does NOT change the BMS label. This way:

- BMS sees costs categorized by what users were trying to do (product analytics)
- Engineering sees costs categorized by why they were absorbed (prioritization)

---

## Data Flow

```
User submits prompt
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ onMessageStart                                                       │
│   1. Budget pre-check (GET /budget/:budgetId)                       │
│   2. Create session (POST /budget/:budgetId/session)                │
│   3. Fire Assessment Agent (non-blocking when budgetServiceEnabled) │
│      └── Check for fast-path intents (publish, domains)             │
│   4. Initialize ExecutionContextTracker                             │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Agent Execution                                                      │
│   - Tool calls recorded by ExecutionContextTracker                  │
│   - Errors counted                                                   │
│   - LLM rounds counted                                               │
│   - GoCode reports costs to BMS session                             │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ beforeMessageComplete                                                │
│                                                                      │
│   1. Await Assessment Agent result                                  │
│      → Get intent (for labeling) + fast-path flag                   │
│                                                                      │
│   2. Query BMS session for actual cost:                             │
│      GET /budget/:budgetId/session/:sessionId → totalCost           │
│                                                                      │
│   3. IF fast-path intent (publish/domains):                         │
│      └── Skip to step 6 with intent as label, 100% GoDaddy          │
│                                                                      │
│   4. Collect execution signals:                                     │
│      - errorCount, hasOutput from tracker                           │
│      - llmRounds from agent metrics                                 │
│      - toolCalls from tracker                                       │
│                                                                      │
│   5. Run Friction Scorer (deterministic, <10ms):                    │
│      - Input: toolCalls                                             │
│      - Output: frictionScore, firedPatterns                         │
│                                                                      │
│   6. Run Judge Agent (<100ms):                                      │
│      - Input: totalCost, intent (for label), errorCount, hasOutput, │
│               frictionScore, firedPatterns, llmRounds               │
│      - Output: budgetCost, godaddyCost, category, reasoning         │
│      - Label derived from intent.category                           │
│      - Attribution derived from execution signals                   │
│                                                                      │
│   7. Submit report to BMS:                                          │
│      POST /budget/:budgetId/session/:sessionId/report               │
│      { reportItems: [{ budgetCost, productCost, label }] }          │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
Response returned to UI (budget entity reflects updated balance)
```

---

## File Structure

```
agents/src/
├── agents/
│   ├── assessment-agent/
│   │   ├── AssessmentAgent.ts      # Extended for fast-path detection
│   │   ├── fast-path-detector.ts   # NEW: Detects publish/domains intents
│   │   ├── embedding-classifier.ts
│   │   ├── keywords.ts
│   │   └── types.ts
│   │
│   └── judge-agent/
│       ├── index.ts
│       ├── JudgeAgent.ts           # Tiered attribution logic
│       ├── friction-scorer.ts      # NEW: Computes frictionScore
│       ├── types.ts                # JudgeInput, JudgeOutput, SwearJarCategory
│       └── __tests__/
│           ├── friction-scorer.test.ts
│           └── judge-agent.test.ts
│
├── server/
│   ├── ai-lib-websocket-server.ts  # Integration point
│   ├── execution-context-tracker.ts # NEW: Collects execution signals
│   ├── budget-pre-check.ts
│   └── budget-report.ts
│
└── services/
    └── budget-service-instance.ts
```

---

## Evaluation Criteria

### Invariant Tests (must always pass)

1. `budgetCost + godaddyCost.cost == totalCost` (exact, no rounding tolerance)
2. `budgetCost >= 0` and `godaddyCost.cost >= 0`
3. `godaddyCost.category == 'none'` if and only if `godaddyCost.cost == 0`
4. `reasoning` is non-empty and cites at least one input field by value
5. `godaddyCost.category` is a valid SwearJarCategory

### Attribution Accuracy Tests

#### Error-driven cases (Tier 1 + Tier 3)

| Test Case                          | Key Inputs                                        | Expected Output                                          |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Execution failure                  | errorCount=14, hasOutput=false, frictionScore=0.0 | godaddyCost.cost=totalCost, category='execution_failure' |
| Execution failure, low error count | errorCount=2, hasOutput=false                     | godaddyCost.cost=totalCost, category='execution_failure' |
| Errors with output, high count     | errorCount=6, hasOutput=true, frictionScore=0.04  | godaddyCost.cost=totalCost, category='error_with_output' |
| Errors with output, low count      | errorCount=2, hasOutput=true                      | budgetCost=totalCost, category='none'                    |

#### Friction-driven cases (Tier 2)

| Test Case                | Key Inputs                                                                                           | Expected Output                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Clean trace              | errorCount=0, hasOutput=true, frictionScore=0.0                                                      | budgetCost=totalCost, category='none'              |
| Legitimate complex task  | errorCount=0, hasOutput=true, frictionScore=0.04, llmRounds=20                                       | budgetCost=totalCost, category='none'              |
| Below cutoff             | errorCount=0, hasOutput=true, frictionScore=0.08, firedPatterns=['repeated_reads']                   | budgetCost=totalCost, category='none'              |
| At cutoff, multi-pattern | errorCount=0, hasOutput=true, frictionScore=0.16, firedPatterns=['repeated_reads','edit_read_loops'] | godaddyCost.cost=totalCost, category='edit_loops'  |
| Grep spiral              | errorCount=0, hasOutput=true, frictionScore=0.22, firedPatterns=['grep_spiral']                      | godaddyCost.cost=totalCost, category='grep_spiral' |

#### Combined signal cases

| Test Case                  | Key Inputs                                                                          | Expected Output                                                              |
| -------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Errors + friction together | errorCount=4, hasOutput=false, frictionScore=0.19                                   | godaddyCost.cost=totalCost, category='execution_failure' (Tier 1 precedence) |
| Friction only, no errors   | errorCount=0, hasOutput=true, frictionScore=0.21, firedPatterns=['edit_read_loops'] | godaddyCost.cost=totalCost, category='edit_loops'                            |

### Calibration Targets

- **Primary:** Match rule-based classifier benchmark of 79.3% precision and recall on airo detection (44 human-labeled traces)
- **Minimum bar:** Outperform frictionScore-only baseline (6.9% recall at threshold=0.15)
- **Scale validation:** All traces with frictionScore >= 0.15 in the 5,671-trace anomaly dataset should produce godaddyCost.cost > 0

---

## Implementation Design

### Design Principles

1. **Fail-safe to customer protection:** On any error, default to GoDaddy paying (customer never overcharged)
2. **Invariant enforcement:** `budgetCost + godaddyCost == totalCost` validated at every layer
3. **Graceful degradation:** Each component has a fallback that maintains correctness
4. **Latency budget:** Total Phase 3 must be <100ms; each component has a sub-budget

### Latency Budget Allocation

```
Phase 3 Total: <100ms
├── Await Assessment result: 0ms (already complete from Phase 2)
├── BMS session query: ~20-30ms (network)
├── Friction Scorer: <10ms (deterministic, CPU-bound)
├── Judge Agent (deterministic path): <5ms
├── Judge Agent (LLM fallback): ~50-60ms (rare edge cases only)
└── Report submission: ~20-30ms (network, can be async)
```

### Component Implementation Details

#### 1. Execution Context Tracker

**Location:** `agents/src/server/execution-context-tracker.ts`

```typescript
interface ExecutionContextTracker {
  // Called on each tool invocation
  recordToolCall(record: ToolCallRecord): void;

  // Called on agent errors
  recordError(error: ErrorRecord): void;

  // Called when LLM round completes
  incrementLlmRounds(): void;

  // Called when agent produces output
  setHasOutput(hasOutput: boolean): void;

  // Get collected signals for Judge
  getSignals(): ExecutionSignals;

  // Reset for new conversation turn
  reset(): void;
}

interface ExecutionSignals {
  toolCalls: ToolCallRecord[];
  errorCount: number;
  hasOutput: boolean;
  llmRounds: number;
  durationMs: number;
}
```

**Integration Points:**

- Hook into `ai-lib` tool execution wrapper (before/after each tool call)
- Hook into agent error handler
- Hook into `streamText` completion callback for LLM round counting
- Hook into message completion to check output presence

**Resilience:**

- Tracker failures are non-fatal — log and continue
- Missing data defaults to conservative values (hasOutput=true, errorCount=0)
- Memory-bounded: cap toolCalls array at 1000 entries

#### 2. Friction Scorer

**Location:** `agents/src/agents/judge-agent/friction-scorer.ts`

```typescript
interface FrictionScorerConfig {
  patterns: {
    repeated_reads: { threshold: 3, weight: 1.0 }
    repeated_edits: { threshold: 5, weight: 1.0 }
    grep_spiral: { threshold: 5, weight: 1.5 }
    terminal_failures: { threshold: 3, weight: 0.8 }
    edit_read_loops: { threshold: 3, weight: 1.2 }
  }
  totalWeight: 5.5  // Sum of all weights (denominator)
}

function computeFrictionScore(
  toolCalls: ToolCallRecord[],
  config?: FrictionScorerConfig
): FrictionScorerOutput {
  const startTime = performance.now()

  // Build file access maps (O(n) single pass)
  const fileReads = new Map<string, number>()
  const fileEdits = new Map<string, number>()
  const grepCalls: { empty: number, total: number } = { empty: 0, total: 0 }
  const terminalCalls: { failed: number, total: number } = { failed: 0, total: 0 }

  // Detect edit-read loops (requires sequence analysis)
  const editReadLoops = detectEditReadLoops(toolCalls)

  // Compute severities
  const severities = computeSeverities(...)

  // Weighted average
  const score = computeWeightedScore(severities, config)

  // Determine fired patterns
  const firedPatterns = getFiredPatterns(severities)

  return {
    frictionScore: score,
    firedPatterns,
    patternDetails: severities,
    durationMs: performance.now() - startTime
  }
}
```

**Performance Optimizations:**

- Single-pass O(n) analysis of tool calls
- Pre-computed log values for severity formulas
- No allocations in hot path (reuse maps)
- Early exit if no tool calls

**Resilience:**

- On any error: return `{ frictionScore: 0, firedPatterns: [] }` (conservative)
- Log error for debugging but don't fail the flow

#### 3. Assessment Agent (Intent Detection)

**Location:** `agents/src/agents/assessment-agent/`

**Async Pattern for Non-Blocking Execution:**

```typescript
// In ai-lib-websocket-server.ts onMessageStart
class AssessmentPromiseManager {
  private promises = new Map<string, Promise<AssessmentResult>>();
  private results = new Map<string, AssessmentResult>();

  // Fire and store promise (non-blocking)
  fire(socketId: string, prompt: string, context: AssessmentContext): void {
    const promise = this.runAssessment(prompt, context)
      .then((result) => {
        this.results.set(socketId, result);
        return result;
      })
      .catch((error) => {
        logger.error("assessment.failed", { socketId, error });
        const fallback = this.getFallback();
        this.results.set(socketId, fallback);
        return fallback;
      });

    this.promises.set(socketId, promise);
  }

  // Await with timeout (called in Phase 3)
  async getResult(
    socketId: string,
    timeoutMs: number = 5000,
  ): Promise<AssessmentResult> {
    // Check if already resolved
    if (this.results.has(socketId)) {
      return this.results.get(socketId)!;
    }

    const promise = this.promises.get(socketId);
    if (!promise) {
      return this.getFallback();
    }

    // Race against timeout
    return Promise.race([
      promise,
      this.timeout(timeoutMs).then(() => this.getFallback()),
    ]);
  }

  private getFallback(): AssessmentResult {
    return {
      intent: { category: "general", confidence: 0 },
      isFastPath: false,
      isFallback: true,
    };
  }
}
```

**Resilience:**

- Timeout after 5 seconds → fallback to `general` intent
- Any error → fallback to `general` intent
- Fallback is conservative: no fast-path bypass, Judge evaluates execution signals

#### 4. Judge Agent (Tiered Attribution)

**Location:** `agents/src/agents/judge-agent/JudgeAgent.ts`

```typescript
class JudgeAgent {
  /**
   * Main entry point - applies tiered attribution logic
   *
   * @throws Never - always returns a valid JudgeOutput
   */
  async judge(input: JudgeInput): Promise<JudgeOutput> {
    const startTime = performance.now();

    try {
      // Validate input
      this.validateInput(input);

      // Tier 0: Intent-based business rules
      if (this.isFreeFeature(input.intent)) {
        return this.createFreeFeatureResult(input);
      }

      // Tiers 1-3: Execution-based quality rules
      const result = this.evaluateExecutionSignals(input);

      // Validate output invariant
      this.validateInvariant(result, input.totalCost);

      return {
        ...result,
        durationMs: performance.now() - startTime,
      };
    } catch (error) {
      // Fail-safe: GoDaddy absorbs on any error
      logger.error("judge.error", { error, input });
      return this.createFailsafeResult(input, error);
    }
  }

  private validateInvariant(result: JudgeOutput, totalCost: number): void {
    const sum = result.budgetCost + result.godaddyCost.cost;
    if (Math.abs(sum - totalCost) > 0.0001) {
      throw new InvariantViolationError(
        `budgetCost(${result.budgetCost}) + godaddyCost(${result.godaddyCost.cost}) != totalCost(${totalCost})`,
      );
    }
  }

  private createFailsafeResult(input: JudgeInput, error: unknown): JudgeOutput {
    return {
      budgetCost: 0,
      godaddyCost: {
        cost: input.totalCost,
        category: "execution_failure",
        primarySignal: `Judge error: ${error instanceof Error ? error.message : "unknown"}`,
      },
      label: `airo-builder:${input.intent.category}`,
      reasoning: `Failsafe: GoDaddy absorbs due to Judge error. Customer protected.`,
    };
  }
}
```

**Deterministic vs LLM Path:**

```typescript
private evaluateExecutionSignals(input: JudgeInput): JudgeOutput {
  // Tier 1: Execution failure (deterministic)
  if (input.errorCount > 0 && !input.hasOutput) {
    return this.createTier1Result(input)
  }

  // Tier 2: Friction (deterministic)
  if (input.frictionScore >= 0.15) {
    return this.createTier2Result(input)
  }

  // Tier 3: Errors with output (deterministic threshold, optional LLM for edge cases)
  if (input.errorCount >= 4 && input.hasOutput) {
    return this.createTier3Result(input)
  }

  // Edge case: errorCount 2-3 with output - could use LLM for reasoning
  // For V1: deterministic, customer pays
  // For V2: optional LLM reasoning for borderline cases

  // Default: Customer pays
  return this.createDefaultResult(input)
}
```

#### 5. Integration in WebSocket Server

**Location:** `agents/src/server/ai-lib-websocket-server.ts`

```typescript
// Phase 1: onMessageStart
async onMessageStart(socket, message) {
  // Budget check + session create (existing)
  const session = await this.budgetPreCheck(context)

  // Fire Assessment Agent (non-blocking when budgetServiceEnabled)
  if (context.metadata.budgetServiceEnabled) {
    this.assessmentManager.fire(socket.id, message.content, {
      appId: context.metadata.appId,
      customerId: context.metadata.customerId
    })
  } else {
    // Blocking path for legacy
    const result = await this.assessmentAgent.classify(message.content)
    this.assessmentResults.set(socket.id, result)
  }

  // Initialize execution tracker
  this.executionTrackers.set(socket.id, new ExecutionContextTracker())
}

// Phase 2: During execution (hooks in ai-lib)
// Tool calls, errors, LLM rounds automatically tracked

// Phase 3: beforeMessageComplete
async beforeMessageComplete(socket, context) {
  const startTime = performance.now()

  // 1. Await Assessment result
  const assessment = await this.assessmentManager.getResult(socket.id)

  // 2. Query BMS for actual cost
  const totalCost = await this.budgetService.getSessionCost(
    context.metadata.bmsBudgetId,
    context.metadata.budgetSessionId
  )

  // 3. Fast-path check
  if (assessment.isFastPath) {
    return this.submitFastPathReport(context, assessment, totalCost)
  }

  // 4. Get execution signals
  const tracker = this.executionTrackers.get(socket.id)
  const signals = tracker?.getSignals() ?? this.getDefaultSignals()

  // 5. Compute friction score
  const friction = computeFrictionScore(signals.toolCalls)

  // 6. Run Judge
  const judgeInput: JudgeInput = {
    totalCost,
    intent: assessment.intent,
    errorCount: signals.errorCount,
    hasOutput: signals.hasOutput,
    frictionScore: friction.frictionScore,
    firedPatterns: friction.firedPatterns,
    llmRounds: signals.llmRounds
  }

  const judgeOutput = await this.judgeAgent.judge(judgeInput)

  // 7. Submit report
  await this.submitBudgetReport(context, judgeOutput)

  // Log timing
  logger.info('budget.reconciliation.complete', {
    durationMs: performance.now() - startTime,
    intent: assessment.intent.category,
    frictionScore: friction.frictionScore,
    attribution: judgeOutput.godaddyCost.category
  })
}
```

### Error Handling Matrix

| Component         | Error Type        | Fallback                                 | Customer Impact                          |
| ----------------- | ----------------- | ---------------------------------------- | ---------------------------------------- |
| Assessment Agent  | Timeout/Error     | `{ intent: general, isFastPath: false }` | None - evaluated by Judge                |
| Execution Tracker | Recording failure | Conservative defaults                    | None - may under-attribute to GoDaddy    |
| Friction Scorer   | Computation error | `{ frictionScore: 0 }`                   | None - other signals still evaluated     |
| BMS Session Query | Network error     | Retry 2x, then `totalCost: 0`            | Report submitted with $0 (customer safe) |
| Judge Agent       | Any error         | GoDaddy absorbs 100%                     | Protected - never overcharged            |
| Report Submission | Network error     | Retry 3x with backoff, then log          | Budget may be stale until next sync      |

### Observability

**Structured Logging:**

```typescript
// Assessment
logger.info("assessment.complete", {
  socketId,
  intent,
  confidence,
  isFastPath,
  durationMs,
});
logger.warn("assessment.fallback", { socketId, reason, durationMs });

// Friction Scorer
logger.debug("friction.computed", {
  socketId,
  score,
  firedPatterns,
  patternDetails,
  durationMs,
});

// Judge
logger.info("judge.attribution", {
  socketId,
  intent,
  tier: 0 | 1 | 2 | 3 | "default",
  budgetCost,
  godaddyCost,
  category,
  reasoning,
  durationMs,
});
logger.error("judge.failsafe", { socketId, error, input });

// End-to-end
logger.info("budget.reconciliation.complete", {
  socketId,
  totalCost,
  budgetCost,
  godaddyCost,
  category,
  phase3DurationMs,
});
```

**Metrics:**

| Metric                          | Type      | Description                    |
| ------------------------------- | --------- | ------------------------------ |
| `budget.assessment.duration_ms` | Histogram | Assessment Agent latency       |
| `budget.friction.duration_ms`   | Histogram | Friction Scorer latency        |
| `budget.judge.duration_ms`      | Histogram | Judge Agent latency            |
| `budget.phase3.duration_ms`     | Histogram | Total Phase 3 latency          |
| `budget.attribution.tier`       | Counter   | Attribution tier distribution  |
| `budget.attribution.category`   | Counter   | SwearJar category distribution |
| `budget.failsafe.count`         | Counter   | Failsafe activations           |

### Testing Strategy

#### Unit Tests

```typescript
// Friction Scorer
describe('FrictionScorer', () => {
  it('returns 0 for clean traces', () => {...})
  it('detects repeated_reads pattern', () => {...})
  it('detects grep_spiral with empty ratio', () => {...})
  it('computes weighted score correctly', () => {...})
  it('respects pattern precedence', () => {...})
  it('handles empty toolCalls', () => {...})
  it('handles malformed input gracefully', () => {...})
})

// Judge Agent
describe('JudgeAgent', () => {
  describe('Tier 0: Intent-based', () => {
    it('publish intent → GoDaddy 100%', () => {...})
    it('domains intent → GoDaddy 100%', () => {...})
  })

  describe('Tier 1: Execution failure', () => {
    it('errors + no output → GoDaddy 100%', () => {...})
    it('errors + output → NOT Tier 1', () => {...})
  })

  describe('Invariant', () => {
    it('budgetCost + godaddyCost == totalCost always', () => {...})
    it('failsafe maintains invariant', () => {...})
  })
})
```

#### Integration Tests

```typescript
describe('Budget Reconciliation E2E', () => {
  it('fast-path publish skips Judge', async () => {...})
  it('general intent with friction triggers Tier 2', async () => {...})
  it('Assessment timeout falls back gracefully', async () => {...})
  it('Judge error triggers failsafe', async () => {...})
  it('full flow completes under 100ms', async () => {...})
})
```

#### Calibration Tests

```typescript
describe("Calibration against labeled data", () => {
  it("matches 79.3% precision/recall on 44-trace dataset", async () => {
    const traces = loadLabeledTraces("billing_attribution_20260407.csv");
    const results = await Promise.all(traces.map(runJudge));
    const { precision, recall } = computeMetrics(results, traces);
    expect(precision).toBeGreaterThanOrEqual(0.793);
    expect(recall).toBeGreaterThanOrEqual(0.793);
  });
});
```

---

## Implementation Tasks

### Phase 1: Execution Context Tracker

- [ ] Create `execution-context-tracker.ts`
- [ ] Hook into tool execution layer to record ToolCallRecord
- [ ] Track errorCount, hasOutput, llmRounds
- [ ] Integration with ai-lib-websocket-server
- [ ] Add memory bounds and error handling

### Phase 2: Friction Scorer

- [ ] Implement 5 friction patterns with severity formulas
- [ ] Implement weighted score calculation
- [ ] Unit tests against known friction traces
- [ ] Benchmark: <10ms execution
- [ ] Error handling with conservative fallback

### Phase 3: Judge Agent v2

- [ ] New input schema with intent + execution signals
- [ ] Implement tiered attribution logic (Tiers 0-3 + default)
- [ ] SwearJarCategory output
- [ ] Reasoning generation (must cite values)
- [ ] Invariant validation at output
- [ ] Failsafe error handling

### Phase 4: Assessment Agent Updates

- [ ] Add fast-path detection for publish/domains
- [ ] Implement AssessmentPromiseManager for async pattern
- [ ] Non-blocking execution when budgetServiceEnabled
- [ ] Timeout handling with fallback

### Phase 5: Integration

- [ ] Wire up full flow in ai-lib-websocket-server
- [ ] End-to-end testing
- [ ] Calibration against labeled traces
- [ ] Performance benchmarking (<100ms Phase 3)
- [ ] Observability instrumentation

---

## Migration Notes

### What Changes from v1

| Aspect                  | v1                          | v2                                                  |
| ----------------------- | --------------------------- | --------------------------------------------------- |
| **Attribution signals** | Intent only                 | Intent (business rules) + Execution (quality rules) |
| **Intent role**         | Determines split directly   | Tier 0 override (free features) + BMS label         |
| **Execution role**      | Not used                    | Tiers 1-3 for `general` intent quality assessment   |
| **Label source**        | Intent                      | Intent (unchanged)                                  |
| **Assessment role**     | Blocking classification     | Non-blocking intent detection + fast-path           |
| **Multi-intent**        | Proportion-based cost split | Single attribution per trace                        |

### Key Insight: Two Attribution Signal Types

```
┌──────────────────────────────────────────────────────────────────┐
│                    JUDGE AGENT INPUT                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │  INTENT SIGNAL      │    │  EXECUTION SIGNALS              │ │
│  │  (from Assessment)  │    │  (from Tracker + Friction)      │ │
│  │                     │    │                                 │ │
│  │  • category         │    │  • errorCount                   │ │
│  │  • confidence       │    │  • hasOutput                    │ │
│  │                     │    │  • frictionScore                │ │
│  │  Used for:          │    │  • firedPatterns[]              │ │
│  │  • Tier 0 (free     │    │  • llmRounds                    │ │
│  │    features)        │    │                                 │ │
│  │  • BMS label        │    │  Used for:                      │ │
│  │                     │    │  • Tiers 1-3 (quality)          │ │
│  │                     │    │  • SwearJar category            │ │
│  └─────────────────────┘    └─────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    TIERED LOGIC                             │ │
│  │                                                             │ │
│  │  Tier 0: intent=publish|domains → GoDaddy (OVERRIDES ALL)  │ │
│  │  Tier 1: intent=general + errors + no output → GoDaddy     │ │
│  │  Tier 2: intent=general + friction >= 0.15 → GoDaddy       │ │
│  │  Tier 3: intent=general + errors >= 4 + output → GoDaddy   │ │
│  │  Default: intent=general + clean → Customer                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Why both signals?**

- Intent-based rules are **business decisions** (publish/domains are free features)
- Execution-based rules are **quality assessments** (agent misbehavior detection)
- The evaluations team data shows intent doesn't predict _error-driven_ attribution, but intent-based business rules still override execution signals

### What Stays the Same

- BMS session lifecycle (create → track → report)
- Report submission format (reportItems)
- Budget pre-check flow
- <100ms Judge SLA
- Intent categories (publish, domains, general)
- Label format (`airo-builder:<category>`)

### Backward Compatibility

The existing cost-split-rules.ts (intent-based) can remain for apps not yet on the new budget system. The feature flag `budgetServiceEnabled` determines which path is used.

---

## Future Considerations (V2)

1. **Session Spike Detection:** Add `sessionMedianRounds` and `sessionMedianCost` to catch high-cost traces with no errors/friction but abnormal round counts

2. **Cost Anomaly Detection:** Detect high cost without detected errors or friction — requires session baseline or improved pre-estimation

3. **Partial Splits:** V1 is binary (100% customer or 100% GoDaddy). V2 could introduce gradient splits for borderline Tier 3 cases

4. **Tier 3 Threshold Tuning:** The errorCount >= 4 threshold is provisional. Tune with more labeled data (current n=44 has ±0.14 std on k-fold)

---

## References

- DEFINITIVE_COST_ANALYSIS.md (51,742 traces)
- FRICTION_ANALYSIS_SUMMARY.md (62,259 traces, 2,000-trace validation)
- Billing attribution experiment (44 human-labeled traces)
- swear-jar-idea.md
