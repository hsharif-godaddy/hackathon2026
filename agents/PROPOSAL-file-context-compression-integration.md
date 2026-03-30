---
status: not-implemented
---

# Proposal: Integrate FileContextManager with Message Compression System

## Executive Summary

**Recommendation: Eliminate FileContextManager's separate tracking database and derive all hot file intelligence from tool call history in conversation messages.**

The data we need is already captured in tool calls - we just need a smart compression strategy to leverage it.

---

## Current State Analysis

### FileContextManager System

**What it does:**
- Maintains separate SQLite table `file_context` with tracking data
- Records file modifications and reads via explicit `recordFileModification()` / `recordFileRead()` calls
- Scores files based on recency and frequency
- Includes "hot files" (30k token budget) in conversation context
- Requires manual integration points in tool code

**Data tracked:**
```typescript
{
  path: string;
  lastModified: number;        // timestamp
  lastRead: number;            // timestamp  
  modificationCount: number;   // cumulative
  readCount: number;           // cumulative
  content?: string;            // cached
  size: number;
  tokenCount?: number;
  actualFileModTime?: number;  // for cache invalidation
}
```

**Current database:**
- Table: `file_context`
- Separate persistence layer (FileContextRepository)
- Requires pruning of old entries
- Additional maintenance burden

### Current Issues

1. **No actual callers found** - `recordFileModification()` and `recordFileRead()` have zero usage in the codebase
2. **Separate maintenance** - Another database table to manage, prune, and keep in sync
3. **Manual tracking** - Requires explicit instrumentation in tool code
4. **Potential staleness** - Tracking data can become stale if recording calls are missed
5. **Duplication** - Tool call history already contains this information

---

## Tool Call Data Available

### readFile Tool
```typescript
{
  path: string;           // ✅ We have this
  startLine?: number;
  numLines?: number;
}
// Result includes: content, totalLines, fileSize
```

### fileEdit Tool  
```typescript
{
  path: string;           // ✅ We have this
  mode: 'edit' | 'rewrite' | 'create';  // ✅ Tells us modification type
  edits?: Array<{old, new}>;
  content?: string;
}
// Result includes: success, diff, linesChanged
```

### What tool history gives us:
- ✅ **File path** - from tool arguments
- ✅ **Operation type** - read vs write (edit/rewrite/create)
- ✅ **Timestamp** - from message.segments[].timestamp
- ✅ **Success status** - from tool_result
- ✅ **Frequency** - count occurrences in history
- ✅ **Recency** - latest timestamp
- ✅ **File content** - from read tool results (can cache)

**We have ALL the data we need!**

---

## Proposed Solution

### Option A: Compression Strategy Approach (RECOMMENDED)

Create a new compression strategy: **`HotFileInclusionStrategy`**

**How it works:**

1. **Analysis Phase** (`analyzeMessages()`):
   - Scan all tool calls in conversation history
   - Extract file paths from `readFile` and `fileEdit` calls
   - Count read frequency, write frequency
   - Track most recent access timestamp
   - Score files using same algorithm as current FileContextManager

2. **Compression Phase** (`compress()`):
   - For duplicate `readFile` calls on "hot files", replace old reads with:
     ```
     [File already included in hot files context - see earlier message]
     ```
   - Keep only the FIRST successful read of each hot file
   - Drop subsequent reads to save tokens

3. **Context Injection**:
   - After compression, inject hot files at strategic point in conversation
   - Same format as current FileContextManager output
   - Respects 30k token budget

**Benefits:**
- ✅ No separate database table
- ✅ No manual tracking calls needed
- ✅ Always accurate (derived from actual tool usage)
- ✅ Automatically benefits from existing DuplicateFileReadStrategy
- ✅ Integrates with existing compression pipeline
- ✅ No additional maintenance
- ✅ Works retroactively on existing conversations

**Algorithm:**
```typescript
class HotFileInclusionStrategy implements CompressionStrategy {
  private hotFiles: Map<string, HotFileMetrics> = new Map();
  
  analyzeMessages(messages: LLMMessage[]): void {
    // Scan all tool calls for file operations
    for (const message of messages) {
      if (message.role === 'assistant' && message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === 'readFile') {
            const args = JSON.parse(toolCall.function.arguments);
            this.recordRead(args.path, toolCallTimestamp);
          }
          else if (toolCall.function.name === 'fileEdit') {
            const args = JSON.parse(toolCall.function.arguments);
            this.recordWrite(args.path, toolCallTimestamp);
          }
        }
      }
      
      // Find corresponding tool results
      if (message.role === 'tool') {
        // Track success/failure, file size, etc.
      }
    }
    
    // Score and identify hot files (top N by score within token budget)
    this.hotFiles = this.scoreAndSelectHotFiles();
  }
  
  canCompress(context: CompressionContext): boolean {
    // Compress readFile calls for files that are "hot"
    if (this.isReadFileCall(context.message)) {
      const filePath = this.extractFilePath(context.message);
      return this.hotFiles.has(filePath) && !this.isFirstRead(filePath, context.messageIndex);
    }
    return false;
  }
  
  compress(context: CompressionContext): LLMMessage | null {
    // Replace duplicate reads of hot files with placeholder
    const filePath = this.extractFilePath(context.message);
    const firstReadIndex = this.getFirstReadIndex(filePath);
    
    return {
      ...context.message,
      content: `[File "${filePath}" already included in hot files context - see message #${firstReadIndex}]`
    };
  }
}
```

### Option B: Hybrid Approach

Keep FileContextManager but populate it FROM tool history instead of manual recording:

```typescript
class FileContextManager {
  // Remove recordFileModification() and recordFileRead()
  
  async populateFromConversationHistory(appId: string, agentId: string): Promise<void> {
    const loader = new ConversationHistoryLoader(repo);
    const messages = await loader.loadDatabaseMessages(appId, agentId);
    
    // Analyze tool calls and populate database
    for (const message of messages) {
      // Extract file operations and populate tracking table
    }
  }
  
  // Keep existing getHotFilesContext() and scoring logic
}
```

**Benefits:**
- ✅ Keeps existing API
- ✅ Database caches analysis results
- ⚠️ Still requires separate table
- ⚠️ Must re-sync when conversation grows

### Option C: Real-time Tracking (Status Quo - NOT RECOMMENDED)

Keep current system but actually wire up the recording calls.

**Downsides:**
- ❌ Manual integration required in every tool
- ❌ Easy to miss recording calls
- ❌ Separate database to maintain
- ❌ Duplicate data that already exists in messages
- ❌ Additional complexity

---

## Recommended Implementation: Option A

### Phase 1: Create HotFileInclusionStrategy

```typescript
// src/services/compression/strategies/HotFileInclusionStrategy.ts

interface HotFileMetrics {
  path: string;
  firstReadIndex: number;
  lastAccessTime: number;
  readCount: number;
  writeCount: number;
  score: number;
  content?: string;
  tokenCount?: number;
}

export class HotFileInclusionStrategy implements CompressionStrategy {
  readonly name = 'hot-file-inclusion';
  
  private hotFiles: Map<string, HotFileMetrics> = new Map();
  private config = {
    maxTokens: 30000,
    recencyWindowMs: 10 * 60 * 1000, // 10 min
    minReadCount: 2,
    minWriteCount: 3
  };
  
  analyzeMessages(messages: LLMMessage[]): void {
    // Scan tool calls and build metrics
  }
  
  canCompress(context: CompressionContext): boolean {
    // Identify duplicate reads of hot files
  }
  
  compress(context: CompressionContext): LLMMessage | null {
    // Replace with placeholder
  }
  
  // Public API for getting hot files context (for injection)
  async getHotFilesContext(appPath: string): Promise<string> {
    // Load file contents for hot files
    // Format same as current FileContextManager
  }
}
```

### Phase 2: Register Strategy

```typescript
// In ConversationContextManager or ConversationHistoryLoader
loader.registerCompressionStrategy(new HotFileInclusionStrategy());
```

### Phase 3: Inject Hot Files Context

```typescript
// In buildMessages() before current user message
if (executionContext?.metadata?.appPath) {
  const hotFilesStrategy = loader.getStrategy('hot-file-inclusion') as HotFileInclusionStrategy;
  const hotFilesContext = await hotFilesStrategy.getHotFilesContext(appPath);
  if (hotFilesContext) {
    messages.push({ role: 'user', content: hotFilesContext });
  }
}
```

### Phase 4: Deprecate FileContextManager

- Mark FileContextManager as deprecated
- Remove file_context table in next schema migration
- Remove FileContextRepository
- Clean up imports

---

## Migration Path

### Step 1: Implement HotFileInclusionStrategy
- Create strategy with analysis and compression logic
- Add comprehensive tests
- Register in compression pipeline

### Step 2: A/B Test
- Run both systems in parallel
- Compare hot file selections
- Validate compression effectiveness
- Measure token savings

### Step 3: Switch Over
- Remove FileContextManager references from ConversationContextManager
- Keep FileContextManager code for 1 release (marked deprecated)
- Update documentation

### Step 4: Clean Up
- Drop file_context table
- Remove FileContextManager and FileContextRepository
- Remove unused imports

---

## Benefits Summary

### Token Savings
- **Eliminate duplicate file reads**: ~500-1000 tokens per duplicate
- **Smart hot file selection**: Only include truly active files
- **Automatic optimization**: Works with existing DuplicateFileReadStrategy
- **Combined with compression**: Compound token savings

### Code Quality
- **Single source of truth**: Tool call history
- **No separate tracking**: Eliminates entire subsystem
- **Always accurate**: Derived from actual usage
- **Less maintenance**: One less table to manage

### Developer Experience
- **No manual instrumentation**: Tools don't need to call recording functions
- **Automatic**: Works for all tools that read/write files
- **Retroactive**: Works on existing conversations
- **Testable**: Pure functions, easy to test

---

## Risk Analysis

### Potential Issues

1. **Performance**: Scanning all tool calls on every load
   - **Mitigation**: Analysis happens once, results cached in strategy instance
   - **Mitigation**: Can add memoization if needed

2. **Token budget exceeded**: Hot files might exceed 30k tokens
   - **Mitigation**: Same algorithm as current FileContextManager
   - **Mitigation**: Respects token budget during file selection

3. **Stale file content**: File may have changed since last read
   - **Mitigation**: Check file modification time before including
   - **Mitigation**: Same as current system

4. **Missing tool calls**: If conversation history truncated
   - **Mitigation**: Works with whatever history is available
   - **Mitigation**: Better than separate database that could be completely stale

### Migration Risks

1. **Behavior changes**: Different file selection vs current system
   - **Mitigation**: A/B test before full rollout
   - **Mitigation**: Use same scoring algorithm

2. **Performance regression**: Additional analysis time
   - **Mitigation**: Profile and optimize
   - **Mitigation**: Analysis is O(n) on messages, not expensive

---

## Conclusion

**Recommendation: Implement Option A (Compression Strategy Approach)**

The FileContextManager system is well-intentioned but solving a problem that's already solved by tool call history. By moving this logic into a compression strategy:

1. We eliminate an entire subsystem (database table, repository, manager)
2. We get accurate, real-time data from actual tool usage
3. We integrate seamlessly with existing compression pipeline
4. We reduce maintenance burden
5. We save even more tokens through intelligent deduplication

**The data is already there - we just need to use it.**

---

## Next Steps

1. Review and approve this proposal
2. Create HotFileInclusionStrategy implementation
3. Add comprehensive tests
4. A/B test in development
5. Roll out to production
6. Deprecate FileContextManager
7. Remove file_context table

**Estimated effort**: 2-3 days for full implementation and testing
**Token savings**: Additional 2,000-5,000 tokens per conversation
**Maintenance reduction**: -1 database table, -3 classes, -500 LOC
