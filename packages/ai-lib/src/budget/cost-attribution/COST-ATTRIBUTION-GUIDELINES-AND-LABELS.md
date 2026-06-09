# Cost Attribution: BMS Report Labels

The cost attribution system detects tool failures, patterns, and causal chains during agent execution to fairly attribute costs between the customer and GoDaddy. Each report sent to BMS (Budget Management Service) includes one or more report items describing what happened.

## How Cost Attribution Works

### Key Concept: Labels Do NOT Mean "GoDaddy Pays"

A label describes **what happened** during an agent execution. It does NOT automatically mean the cost is attributed to GoDaddy. The attribution system produces **report items** that split costs between two fields:

- **`budgetCost`** — amount charged to the **customer's budget** (customer pays)
- **`productCost`** — amount absorbed by **GoDaddy** (product cost, customer doesn't pay)

A single session can produce **multiple report items** with different labels. For example, a publish session where some tools also failed might produce:

```
{ budgetCost: "0.05", productCost: "0",    label: "airo-builder:general" }        ← customer pays for productive work
{ budgetCost: "0",    productCost: "0.02", label: "airo-builder:publish-task" }   ← GoDaddy pays for publish
{ budgetCost: "0",    productCost: "0.01", label: "airo-builder:tool-failure" }   ← GoDaddy pays for failures
```

### The `General` Label Means Customer Pays

The `airo-builder:general` label is the **customer-charged** label. When you see it in a report item, the cost in `budgetCost` is deducted from the customer's budget. This is normal, productive AI work.

### Attribution Flow

```
Agent execution completes
        │
        ▼
┌─────────────────────────────┐
│  1. Check session overrides │  CareAgent / TestAccounts → 100% productCost
└────────────┬────────────────┘
             │ (not an override)
             ▼
┌─────────────────────────────┐
│  2. Analyze execution steps │  Extract failures, patterns, causal chains,
│                             │  cost overrides (publish/domain), infrastructure
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  3. Per-call attribution    │  Each LLM call is individually attributed:
│                             │  • Was it part of a failure pattern? → GoDaddy
│                             │  • Was it a publish/domain action? → GoDaddy
│                             │  • Was it infrastructure overhead? → GoDaddy
│                             │  • Was it productive work? → Customer
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  4. Generate report items   │  Customer cost → { budgetCost: X, label: "general" }
│                             │  GoDaddy cost  → { productCost: X, label: "<reason>" }
│                             │  (one item per distinct label)
└─────────────────────────────┘
```

### Attribution Paths

The system takes one of these paths depending on the session:

| Path | Condition | Result |
|------|-----------|--------|
| `override_session` | Care agent or test account | 100% `productCost` (GoDaddy pays all) |
| `per_call` | Failures, cost overrides, or infrastructure detected | Mixed — each call attributed individually |
| `no_value` | Agent ran but produced nothing (not user-aborted) | 100% `productCost` (GoDaddy pays all) |
| `user_aborted` | User clicked Stop before output | 100% `budgetCost` (customer pays — their choice) |
| `default` | Clean execution, no failures or overrides | 100% `budgetCost` (customer pays — productive work) |
| `attribution_failed` | Attribution code threw an exception | 100% `budgetCost` with `General` label (safe fallback — indicates a bug) |

### Per-Call Attribution (the common case with failures)

When the `per_call` path is taken, every LLM call in the session is individually evaluated:

1. Is this call in the GoDaddy set? (failed calls, pattern calls, cost override calls, infrastructure calls)
   - **Yes** → `productCost` with a specific label explaining why
   - **No** → `budgetCost` with the `general` label (productive work, customer pays)

This means a **single session is typically split**: some calls charged to the customer (productive work), some absorbed by GoDaddy (wasted/overhead work). The customer only pays for calls that delivered value.

### Example Scenarios

**Scenario: Clean session (no failures)**
- Path: `default`
- Result: `[{ budgetCost: "0.10", productCost: "0", label: "airo-builder:general" }]`
- Meaning: Customer pays full cost — all work was productive

**Scenario: Session with some tool failures**
- Path: `per_call`
- Result:
  - `{ budgetCost: "0.07", productCost: "0", label: "airo-builder:general" }` — productive calls
  - `{ budgetCost: "0", productCost: "0.03", label: "airo-builder:tool-failure" }` — failed calls
- Meaning: Customer pays for 7 of the 10 cents; GoDaddy absorbs the 3 cents wasted on failures

**Scenario: Care agent session**
- Path: `override_session`
- Result: `[{ budgetCost: "0", productCost: "0.10", label: "airo-builder:care-agent" }]`
- Meaning: GoDaddy pays everything — this was a care agent acting on behalf of the customer

### allowOverage

The `allowOverage` flag appears in two BMS API calls and serves a specific purpose: **it lets the report succeed even when `budgetCost` exceeds the customer's remaining credits.**

**Where it's used:**

1. **Session creation** (`createSession`) — passed as `allowOverage: true` only for sessions we know ahead of time will be fully attributed to GoDaddy (CareAgent, TestAccounts). This bypasses the BMS capacity gate so the session can open even when the customer's budget is at $0 — since the customer will never be charged, there's no reason to block on their balance.

2. **Report creation** (`createReport`) — always passed as `allowOverage: true`. This ensures that if the agent's LLM spend exceeded the remaining budget capacity mid-session (which is normal — we can't predict exact costs before execution completes), the report still gets created rather than failing with a 402. The overage is recorded as `productCost` under the server-generated `"allowed-overage"` label — GoDaddy absorbs whatever exceeded the customer's available credits and is blocked on the next turn.

**What BMS does when `allowOverage: true`:**

- If `budgetCost` in the report items exceeds available credits, BMS does NOT reject the request
- Instead, BMS adjusts the report item's stored `budgetCost` to reflect only the actually allocatable amount
- BMS appends a server-generated report item with the reserved label `"allowed-overage"` (`budgetCost: 0`, `productCost: remainder`) to capture the excess
- The customer is never charged more than their available credits; the overage becomes product cost

**Important:** Callers must NOT use `"allowed-overage"` as a label in `reportItems` — it is reserved for the server-generated overage line and will be rejected by the API.

**Why we always send `allowOverage: true` on reports:** Agent execution is non-deterministic. We open a session, the agent runs, and tokens are consumed. By the time we calculate the report, the total cost may exceed what was available. Rather than losing the report (and the cost data), we let BMS record it and handle the overage gracefully.

## Report Labels

### Session-Level Overrides (100% GoDaddy)

| Label | Value | Trigger | Rationale |
|-------|-------|---------|-----------|
| CareAgent | `airo-builder:care-agent` | `isBmsOverride(subscriptionId)` — care agent session | Customer shouldn't pay when GoDaddy care agents use the builder on their behalf |
| TestAccounts | `airo-builder:test-accounts` | `isBmsOverride(subscriptionId)` — test account session | Internal/test accounts shouldn't consume customer budget |

### Cost Override Actions (100% GoDaddy)

| Label | Value | Trigger | Rationale |
|-------|-------|---------|-----------|
| PublishTask | `airo-builder:publish-task` | Publish tool detected in execution steps | Publishing is a platform operation, cost attributed separately from user-directed work |
| DomainTask | `airo-builder:domain-task` | Domain tool detected in execution steps | Domain configuration is infrastructure work, not creative AI usage |

### Infrastructure (100% GoDaddy)

| Label | Value | Trigger | Rationale |
|-------|-------|---------|-----------|
| InfrastructureOverhead | `airo-builder:infrastructure-overhead` | `suggestedResponse` or `todoList` tools used | System-initiated tools, not user-requested, always charged to GoDaddy |

### Failure Patterns (GoDaddy absorbs wasted tokens)

| Label | Value | Trigger | Rationale |
|-------|-------|---------|-----------|
| CausalChain | `airo-builder:causal-chain` | Agent edit caused a problem, then agent fixed it within the same execution | Customer shouldn't pay for self-inflicted cleanup work |
| TerminalFailures | `airo-builder:terminal-failures` | 3+ tool failures without recovery | Agent hit a wall repeatedly — wasted tokens with no value delivered |
| EditReadLoop | `airo-builder:edit-read-loop` | 3+ cycles of edit-then-read with failures | Agent stuck in a loop editing and re-reading without making progress |
| GrepSpiral | `airo-builder:grep-spiral` | 5+ grep/search calls | Agent searching aimlessly without finding what it needs |
| RepeatedEdits | `airo-builder:repeated-edits` | 5+ repeated edit calls | Agent rewriting the same thing over and over, no forward progress |
| RepeatedReads | `airo-builder:repeated-reads` | 3+ repeated read calls | Agent re-reading files it already read — confusion, not progress |
| ToolRetry | `airo-builder:tool-retry` | 3+ retries of same tool/target | Agent retrying a failing operation instead of trying a different approach |
| ToolFailure | `airo-builder:tool-failure` | Direct tool execution error in steps | A tool outright failed — tokens leading to that call produced no value |

### No-Value Cases (100% GoDaddy)

| Label | Value | Trigger | Rationale |
|-------|-------|---------|-----------|
| NoOutput | `airo-builder:no-output` | Agent ran but produced no output or successful tool calls | Tokens consumed with nothing delivered |

### Default

| Label | Value | Trigger | Rationale |
|-------|-------|---------|-----------|
| General | `airo-builder:general` | No failures or overrides detected; also used for user-aborted sessions | Normal productive work — standard billing applies |

## Priority Hierarchy

### Session-Level (checked before per-call attribution)

1. **Override sessions** — CareAgent / TestAccounts (entire session is 100% GoDaddy)
2. **No value delivered** — NoOutput (agent ran, produced nothing, not user-aborted → 100% GoDaddy)
3. **User aborted** — General (user clicked Stop → 100% Customer)

### Per-Call Attribution Order (code order in `determineAttribution`)

When per-call attribution runs, each call is checked in this order — first match wins:

1. **Cost override actions** — PublishTask / DomainTask (publish/domain tool calls + follow-ups)
2. **Failure patterns** — highest-severity detected pattern wins (severity is computed at runtime, not a static ranking; the pattern with the highest score is selected)
3. **Causal chains** — CausalChain (edit caused problem → agent fixed it)
4. **Infrastructure overhead** — InfrastructureOverhead (suggestedResponse, todoList)
5. **Direct tool errors** — ToolFailure (fallback for GoDaddy-attributed calls not matched above)
6. **Productive work** — General (call not in the GoDaddy set → customer pays)

> **Note:** In practice, infrastructure tools (suggestedResponse/todoList) and pattern tools (edit/read/grep/terminal) are disjoint — no single call can match both sets. The ordering matters for correctness guarantees, but won't produce different results today.

## Pattern Detection Thresholds

Defined in `types.ts` as `PATTERN_THRESHOLDS`:

| Pattern | Minimum Count |
|---------|---------------|
| Terminal failures | 3 |
| Edit-read loop cycles | 3 |
| Grep spiral calls | 5 |
| Repeated reads | 3 |
| Repeated edits | 5 |
| Tool retries | 3 |

## Core Principle

Customers pay for productive AI work. GoDaddy absorbs cost when the agent wastes tokens through its own failures, performs platform-initiated operations, or delivers no value.
