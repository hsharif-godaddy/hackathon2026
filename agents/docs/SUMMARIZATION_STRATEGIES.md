# Summarization Strategies

## Overview

The conversation summarization system supports multiple strategies for generating summaries. Each strategy has different characteristics and use cases.

## Available Strategies

### 1. `llm` - Baseline LLM Strategy (Default)

**Best for**: General use, balanced compression

**Characteristics**:
- Uses LLM to generate concise summaries
- Focuses on key decisions and outcomes
- Good compression ratio (typically 85-95%)
- Moderate token usage for summary generation
- Simple, narrative format

**Summary Structure**:
```
Brief narrative summary covering:
- User goals
- Key actions taken
- Technical decisions
- Current state
- Next steps
```

**Example Output**:
```
# Conversation Summary: Kanban Board Application Development

## User Goal
Create a Kanban board application with drag-and-drop functionality...

## Key Actions Taken
1. Initial Kanban Board Creation
   - Built single-page kanban board with 4 columns
   - Implemented drag-and-drop using React state
   
2. Color Scheme Implementation
   - Selected "Dark Productivity" theme
   - Applied dark colors throughout

## Current State
- Functional kanban board with drag-and-drop UI
- Database schema defined
- Partial API implementation
```

**Configuration**:
```typescript
initializeBackgroundSummarization({
  strategy: 'llm',
  // ... other config
});
```

---

### 2. `detailed-llm` - Structured Detailed Strategy

**Best for**: Complex applications, codebase documentation, evaluation

**Characteristics**:
- Uses LLM with structured prompts
- Captures specific technical artifacts
- Lower compression ratio (typically 70-85%)
- Higher token usage for summary generation
- Structured sections for easy parsing

**Summary Structure**:
```
# Conversation Summary: [Title]

## User Goals
- Specific goals and requirements

## Key Actions & Implementations
- Chronological list of implementations

## API Endpoints
- METHOD /path - Description
- Includes request/response details

## Database Tables
- **table_name**: columns, relationships, purpose
- Schema changes and migrations

## Pages & Routes
- /route/path - Page name and purpose
- Component names

## Technical Decisions
- Architecture decisions
- Library choices
- Design patterns

## Current State
- Current application state

## Next Steps
- Outstanding tasks
```

**Example Output**:
```
# Conversation Summary: Kanban Board Application

## User Goals
- Create a Kanban board with drag-and-drop functionality
- Implement database persistence for tasks
- Apply dark theme

## Key Actions & Implementations
- Built single-page kanban board (`src/pages/index.tsx`)
- Created database schema (`src/server/db/schema.ts`)
- Implemented drag-and-drop using React state
- Applied Dark Productivity color scheme

## API Endpoints
- `GET /api/columns` - Fetch all columns with nested tasks
- `PUT /api/tasks/move` - Move task between columns, update order
- `POST /api/tasks` - Create new task (planned)
- `DELETE /api/tasks/:id` - Delete task (planned)

## Database Tables
- **columns**: id, title, order, createdAt, updatedAt
  - Represents kanban columns (To Do, In Progress, Review, Done)
- **tasks**: id, columnId (FK), title, description, priority, assignee, order, createdAt, updatedAt
  - Foreign key to columns table
  - Priority enum: low, medium, high
  - Order for drag-and-drop positioning

## Pages & Routes
- `/` - Main kanban board page (index.tsx)
  - Components: TaskCard, Column, KanbanBoard
  - Drag-and-drop functionality
  - Dark Productivity theme applied

## Technical Decisions
- **State Management**: React state for drag-and-drop (will migrate to React Query)
- **Database**: Drizzle ORM with PostgreSQL
- **Styling**: Tailwind CSS with custom dark theme
- **Drag-and-Drop**: Native HTML5 drag-and-drop API

## Current State
- Functional UI with drag-and-drop
- Database schema defined
- Partial API implementation (GET, PUT)
- Header with "Create" link restored

## Next Steps
- Complete CRUD API endpoints
- Integrate React Query for data fetching
- Add loading states and error handling
- Implement task creation modal
```

**Configuration**:
```typescript
initializeBackgroundSummarization({
  strategy: 'detailed-llm',
  // ... other config
});
```

---

### 3. `simple` - Non-LLM Test Strategy

**Best for**: Testing, debugging, development

**Characteristics**:
- No LLM calls (instant, free)
- Simple concatenation of messages
- No compression (summary ≈ original size)
- Useful for testing summarization flow
- Not suitable for production

**Summary Structure**:
```
Summary of N messages from [start] to [end]:
user: [message content]
assistant: [message content]
...
```

**Configuration**:
```typescript
initializeBackgroundSummarization({
  strategy: 'simple',
  // ... other config
});
```

---

## Choosing a Strategy

### Use `llm` (Baseline) when:
- ✅ You want balanced compression and detail
- ✅ Token usage is a concern
- ✅ You need general conversation summaries
- ✅ You want faster summarization
- ✅ You're in production

### Use `detailed-llm` (Structured) when:
- ✅ You need detailed technical documentation
- ✅ You want structured, parseable summaries
- ✅ You're building complex applications
- ✅ You need to track API endpoints, DB schemas, pages
- ✅ You're evaluating summary quality
- ✅ Token usage is less critical

### Use `simple` (Test) when:
- ✅ You're testing the summarization system
- ✅ You're debugging summarization issues
- ✅ You want to see raw message flow
- ✅ You don't want to use LLM tokens

---

## Configuration

### Production Configuration

**File**: `agents/src/server/ai-lib-websocket-server.ts`

```typescript
await initializeBackgroundSummarization({
  tokenThreshold: 10000,
  debounceMs: 5000,
  modelName: 'claude-3-5-sonnet',
  keepRecentTurns: 3,
  strategy: 'llm', // Change to 'detailed-llm' for more detail
});
```

### Testing Different Strategies

Use the test script to compare strategies:

```bash
# Test baseline strategy
pnpm test:summarization <app-id> "" llm

# Test detailed strategy
pnpm test:summarization <app-id> "" detailed-llm

# Test simple strategy (no LLM)
pnpm test:summarization <app-id> "" simple
```

---

## Performance Comparison

| Strategy | Compression | Speed | Token Cost | Detail Level | Structure |
|----------|-------------|-------|------------|--------------|-----------|
| `llm` | 85-95% | Fast | Low | Medium | Narrative |
| `detailed-llm` | 70-85% | Medium | Medium | High | Structured |
| `simple` | 0% | Instant | None | Low | Raw |

### Token Usage Examples

**50,000 token conversation**:

| Strategy | Summary Tokens | Compression | Cost (approx) |
|----------|----------------|-------------|---------------|
| `llm` | ~500-750 | 98-99% | $0.02 |
| `detailed-llm` | ~1000-1500 | 97-98% | $0.04 |
| `simple` | ~50,000 | 0% | $0.00 |

---

## Switching Strategies

### For Production

Edit `agents/src/server/ai-lib-websocket-server.ts`:

```typescript
await initializeBackgroundSummarization({
  // ... other config
  strategy: 'detailed-llm', // Change here
});
```

Then restart the server.

### For Testing

Use the test script with the strategy parameter:

```bash
# Compare baseline vs detailed
pnpm test:summarization <app-id> "" llm > baseline.txt
pnpm test:summarization <app-id> "" detailed-llm > detailed.txt
diff baseline.txt detailed.txt
```

---

## Evaluation Workflow

### 1. Generate Summaries with Both Strategies

```bash
# Baseline
pnpm test:summarization <app-id> "" llm

# Detailed
pnpm test:summarization <app-id> "" detailed-llm
```

### 2. Compare Output

Look for:
- **API Endpoints**: Are they captured in detailed but missing in baseline?
- **Database Tables**: Is schema information preserved?
- **Pages/Routes**: Are all pages documented?
- **Compression**: How much smaller is the baseline?
- **Readability**: Which is easier to understand?

### 3. Check Token Usage

```bash
pnpm view:summaries <app-id> --stats
```

Compare `summary_token_count` between strategies.

### 4. Decide Based on Needs

- **Need detailed docs?** → Use `detailed-llm`
- **Need max compression?** → Use `llm`
- **Need both?** → Use `detailed-llm` and accept slightly lower compression

---

## Custom Strategies

You can create your own summarization strategy by implementing the `SummarizationStrategy` interface:

```typescript
import type { SummarizationStrategy, SummarizationContext, SummarizationResult } from './SummarizationStrategy.js';

export class CustomSummarizationStrategy implements SummarizationStrategy {
  readonly name = 'custom';

  async summarize(context: SummarizationContext): Promise<SummarizationResult> {
    const { appId, messages, existingSummary, messageRange, originalTokenCount } = context;
    
    // Your custom summarization logic here
    const summaryText = '...';
    const summaryTokenCount = estimateTokens(summaryText);
    
    return {
      summaryText,
      summaryTokenCount,
      modelUsed: 'custom',
      messageRange,
      messageCount: messages.length,
      originalTokenCount,
    };
  }
}
```

Then register it in `initialize.ts`:

```typescript
case 'custom':
  summarizationStrategy = new CustomSummarizationStrategy();
  break;
```

---

## Best Practices

1. **Start with baseline** (`llm`) in production
2. **Test with detailed** (`detailed-llm`) to evaluate quality
3. **Use simple** (`simple`) only for debugging
4. **Monitor compression ratios** - if too low, switch to baseline
5. **Check summary quality** regularly using `view:summaries --verbose`
6. **Adjust based on use case**:
   - Documentation-heavy apps → `detailed-llm`
   - Chat-heavy apps → `llm`
   - Simple apps → `llm`

---

## Summary

- **`llm`**: Default, balanced, production-ready ✅
- **`detailed-llm`**: Structured, detailed, evaluation-friendly 📊
- **`simple`**: Testing only, no LLM 🔧

Choose based on your needs for compression vs. detail!

