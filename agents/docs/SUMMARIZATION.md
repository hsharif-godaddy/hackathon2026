# Conversation Summarization Architecture

This document describes the summarization system that manages conversation context in long-running agent sessions.

## Overview

The summarization system compresses conversation history to maintain context within LLM token limits while preserving critical information about work performed. It operates in the background, automatically triggered when a single LLM call exceeds the max prompt size and then debounced.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Conversation Flow                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LLM Call ──► Token Usage Callback ──► BackgroundSummarizer                 │
│                                          (debounced, async)                 │
│                                                     │                       │
│                                                     ▼                       │
│                                    Last-Call Token Threshold Check          │
│                                                     │                       │
│                              ┌──────────────────────┴───────────────────┐   │
│                              │                                          │   │
│                              ▼                                          ▼   │
│                    Threshold Exceeded                          Under Limit  │
│                              │                                     (skip)   │
│                              ▼                                              │
│                    SummarizationStrategy                                    │
│                    (LLM or Detailed-LLM)                                    │
│                              │                                              │
│                              ▼                                              │
│                    SummaryRepository.create()                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. BackgroundSummarizer

**Location:** `agents/src/services/summarization/BackgroundSummarizer.ts`

Orchestrates the summarization process with these responsibilities:

- **Debouncing**: Waits 30 seconds after last trigger to avoid summarizing mid-conversation
- **Token counting**: Uses last-call token usage from the LLM provider
- **Threshold checking**: Triggers summarization when a single call exceeds `maxPromptTokens`
- **Recent turns preservation**: Keeps the last 4 user/assistant turns unsummarized for immediate context

**Configuration defaults:**

```typescript
{
  maxPromptTokens: 40000, // Target max prompt size (summary + new messages)
  debounceMs: 30000,      // Wait for conversation lulls
  keepRecentTurns: 4      // Preserve immediate context
}
```

### 2. Summarization Strategies

The system uses a strategy pattern for pluggable summarization implementations:

#### LLMSummarizationStrategy

**Location:** `agents/src/services/summarization/LLMSummarizationStrategy.ts`

Lightweight summarization producing ~2000 token summaries with sections:

- **State**: Current project status (1-2 sentences)
- **Completed**: Files modified and features built
- **Decisions**: Technical choices made
- **Pending**: Outstanding work

Uses Claude Sonnet ('full' tier) for 6x better compression than Haiku.

### Compression Metrics

`summaryTokenCount` vs `originalTokenCount` reflects the **cumulative** compression ratio for the summarized range, not the per-run reduction of the incremental slice.

#### DetailedLLMSummarizationStrategy

**Location:** `agents/src/services/summarization/DetailedLLMSummarizationStrategy.ts`

Comprehensive summarization (~2000 tokens) with additional sections:

- API Endpoints (top 5)
- Database Schema (top 3 tables)
- Pages & Routes (top 5)
- Known Issues / Tech Debt
- Next Steps

Includes intelligent batching for conversations exceeding 25k tokens per batch.

#### SimpleSummarizationStrategy

**Location:** `agents/src/services/summarization/SimpleSummarizationStrategy.ts`

Non-LLM strategy for testing. Concatenates messages with basic formatting.

### 3. Operation Log System

Persists a cumulative record of operations that survives message compression.

#### OperationLogExtractor

**Location:** `agents/src/services/summarization/OperationLogExtractor.ts`

Extracts structured entries from tool calls:

- `file_edit`: Files created/modified/deleted with modes
- `read_file`: Files read
- `terminal`: Commands executed
- `grep`: Search patterns used
- `git`: Git operations performed

Output format:

```
Files modified: Button.tsx, api.ts, schema.prisma
Files read: config.json, package.json
Commands run: npm install; npm run build
```

#### OperationLogPruner

**Location:** `agents/src/services/summarization/OperationLogPruner.ts`

Prevents unbounded growth with prioritized pruning:

- Maximum 500 operations retained
- 75% allocation for file operations (most important)
- 25% allocation for other operations
- Unused quota redistributed to fill limit

### 4. Compression Strategies

**Location:** `agents/src/services/compression/`

Work alongside summarization to reduce token usage:

#### Strategy Types

| Type          | When Runs                    | Purpose                                    |
| ------------- | ---------------------------- | ------------------------------------------ |
| `removal`     | Always                       | Correctness - removes stale/redundant data |
| `compression` | When no active summarization | Token savings - compresses verbose content |

#### Key Strategies

- **AppContextRemovalStrategy**: Removes stale app context (directory structure, secrets)
- **SecretOperationCompressionStrategy**: Removes ephemeral secret operation messages
- **TodoListRemovalStrategy**: Removes redundant todo list snapshots
- **DuplicateFileReadStrategy**: Deduplicates repeated file reads
- **FileEditCompressionStrategy**: Compresses verbose file edit results
- **CssSuggestCompressionStrategy**: Compresses CSS suggestion outputs

### 5. ConversationHistoryLoader

**Location:** `agents/src/services/ConversationHistoryLoader.ts`

Reconstructs conversation history for the agent:

1. Loads latest summary from database
2. Injects operation log (if available)
3. Injects summary as `[CONVERSATION SUMMARY]` user message
4. Appends messages after summary range
5. Applies compression strategies
6. Enforces token limit with priority:
   - Summary messages always included first
   - Recent messages added newest-first until limit

## Incremental vs Full Regeneration

### Incremental Mode (Default)

- Processes only new messages since last summary
- Merges into existing summary text
- 5-10x cheaper than full regeneration
- Cost: ~$0.02 per summarization (2-5k input tokens)

### Full Regeneration

Triggered when `incrementalUpdateCount >= 5` to prevent quality degradation:

- Uses `fullMessageHistory` (complete history before recent turns)
- Produces fresh summary from scratch
- Resets `incrementalUpdateCount` to 0
- Cost: ~$0.10 per summarization (25k+ input tokens)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Summarization Mode Selection                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  incrementalUpdateCount >= 5?                                   │
│           │                                                     │
│           ├── YES ──► Use fullMessageHistory                    │
│           │           Clear existingSummary                     │
│           │           Reset counter to 0                        │
│           │                                                     │
│           └── NO ───► Use messages (incremental delta)          │
│                       Merge with existingSummary                │
│                       Increment counter                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

**Table:** `conversation_summaries`

| Column                       | Type     | Description                                 |
| ---------------------------- | -------- | ------------------------------------------- |
| `id`                         | TEXT     | Primary key (UUID)                          |
| `app_id`                     | TEXT     | Foreign key to apps                         |
| `conversation_id`            | TEXT     | Optional, for single-conversation summaries |
| `summary_text`               | TEXT     | The generated summary                       |
| `message_range_start`        | TEXT     | First message ID covered                    |
| `message_range_end`          | TEXT     | Last message ID covered                     |
| `message_count`              | INTEGER  | Number of messages summarized               |
| `original_token_count`       | INTEGER  | Tokens before summarization                 |
| `summary_token_count`        | INTEGER  | Tokens after summarization                  |
| `model_used`                 | TEXT     | Model that generated summary                |
| `operation_log`              | TEXT     | Cumulative operation log                    |
| `incremental_update_count`   | INTEGER  | Updates since last full regeneration        |
| `last_full_summarization_at` | DATETIME | Timestamp of last full regeneration         |
| `created_at`                 | DATETIME | Creation timestamp                          |

## Initialization

```typescript
import { initializeBackgroundSummarization } from './services/summarization/index.js';

await initializeBackgroundSummarization({
  maxPromptTokens: 30000, // Lower for aggressive summarization
  debounceMs: 10000, // 10 second debounce
  keepRecentTurns: 2, // Keep last 2 turns
  strategy: 'detailed-llm', // Use detailed strategy
});
```

This registers a hook on `ConversationRepository` that triggers `checkAndSummarize()` after each message is added.

## Cost Analysis

### Model Selection: Sonnet vs Haiku

| Metric                  | Haiku                  | Sonnet        |
| ----------------------- | ---------------------- | ------------- |
| Compression ratio       | ~60 tokens/msg         | ~9 tokens/msg |
| Token budget compliance | Poor (exceeds targets) | Good          |
| Output quality          | Includes thinking text | Clean         |
| Cost to generate        | $0.05                  | $0.15         |
| Summary size            | ~1200 tokens           | ~200 tokens   |

**Total cost over conversation lifetime:**

- Haiku: $0.05 + (1200 tokens × 100 reads × $3/1M) = $0.41
- Sonnet: $0.15 + (200 tokens × 100 reads × $3/1M) = $0.21

**Recommendation:** Always use Sonnet ('full' tier) for summarization.

### Incremental vs Full History

| Mode         | Input Tokens | Cost per Summarization |
| ------------ | ------------ | ---------------------- |
| Incremental  | 2-5k         | ~$0.02                 |
| Full History | 25k+         | ~$0.10                 |

Incremental mode is 5-10x cheaper and used by default.

## Message Flow Example

```
Initial conversation (1000 messages, 50k tokens):
├── Messages 1-900 (45k tokens) → Summarized
├── Summary (~500 tokens) + Operation Log (~200 tokens)
└── Messages 901-1000 (5k tokens) → Kept as recent turns

After 5 incremental updates:
├── Full regeneration triggered
├── Messages 1-950 → Re-summarized from scratch
└── Messages 951-1000 → Kept as recent turns
```

## Testing

**Test files:**

- `SimpleSummarizationStrategy.test.ts` - Strategy interface tests
- `OperationLogExtractor.test.ts` - Extraction logic tests
- `OperationLogPruner.test.ts` - Pruning logic tests

Run tests:

```bash
pnpm --filter @airo/agents test src/services/summarization
```

## Logging Events

Key events for monitoring:

| Event                                       | Description                 |
| ------------------------------------------- | --------------------------- |
| `summarization.background.begin`            | Summarization started       |
| `summarization.background.complete`         | Summarization finished      |
| `summarization.llm.regenerate_from_scratch` | Full regeneration triggered |
| `summarization.llm.complete`                | LLM strategy completed      |
| `operation_log.pruning.complete`            | Operation log pruned        |
| `compression.batch.complete`                | Compression pass finished   |

## Troubleshooting

### Summary not being applied

1. Check if `enableSummarization` is true in `loadMessagesWithSummarization()`
2. Verify summary exists: `SELECT * FROM conversation_summaries WHERE app_id = ?`
3. Check `message_range_end` matches a message ID in the conversation

### Context loss after regeneration

Ensure both strategies use `fullMessageHistory` when `shouldRegenerateFromScratch` is true. The strategies should NOT use `context.messages` (incremental delta) for regeneration.

### Operation log growing too large

Operation log is pruned to 500 entries. If still too large:

1. Check `OperationLogPruner` is being called
2. Verify pruning thresholds in `BackgroundSummarizer`
3. Consider reducing the 500 operation limit

### Summary exceeds token budget

DetailedLLMSummarizationStrategy logs warnings when summaries exceed 2000 tokens:

```
summarization.detailed_llm.token_budget_exceeded
```

The LLM prompt includes strict token budget instructions, but compliance varies. Monitor and adjust prompts if needed.
