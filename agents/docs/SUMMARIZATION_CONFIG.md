# Conversation Summarization Configuration

## Overview

The conversation summarization system automatically compresses older conversation history while keeping recent messages intact. This reduces token usage and can help prevent context-related bugs.

## Current Configuration

**Location**: `agents/src/server/ai-lib-websocket-server.ts`

```typescript
initializeBackgroundSummarization({
  tokenThreshold: 10000,      // Trigger when > 10k tokens
  debounceMs: 5000,           // Wait 5 seconds after last message
  modelName: 'claude-3-5-sonnet',
  keepRecentTurns: 3,         // Keep last 3 user/assistant turns unsummarized
});
```

## Configuration Options

### `tokenThreshold` (default: 10000)

**What it does**: Triggers summarization when total conversation tokens exceed this threshold.

**Recommended values**:
- **10,000 tokens** (current) - Aggressive summarization, good for reducing bugs
- **20,000 tokens** - Moderate summarization
- **50,000 tokens** - Conservative, only summarize very long conversations

**Example**: With 10k threshold, summarization triggers after ~5-10 conversation turns (depending on message length).

### `keepRecentTurns` (default: 3)

**What it does**: Number of recent user/assistant message pairs to keep in full detail (not summarized).

**How it works**:
- Counts backwards from the most recent message
- Keeps the last N user prompts and their corresponding assistant responses
- Everything older gets summarized

**Recommended values**:
- **3 turns** (current) - Good balance: detailed recent context + compressed history
- **5 turns** - More detailed recent context
- **1 turn** - Maximum compression (only current conversation in detail)

**Example with keepRecentTurns: 3**:
```
[SUMMARY] ... older messages summarized ...
User: "Can you add a login page?"
Assistant: "Sure! I'll create a login page with..."
User: "Make it use email instead of username"
Assistant: "Updated to use email for login..."
User: "Add a forgot password link"  ← Current turn
Assistant: [generating response]
```

### `debounceMs` (default: 5000)

**What it does**: Waits this many milliseconds after the last message before triggering summarization.

**Why it matters**: Prevents redundant summarization work when messages arrive in quick succession.

**Recommended values**:
- **5000ms (5 seconds)** - Good default
- **10000ms (10 seconds)** - More conservative, less frequent checks
- **1000ms (1 second)** - More responsive, but may do redundant work

### `modelName` (default: 'claude-3-5-sonnet')

**What it does**: Model name used for token counting and summarization.

**Options**:
- `'claude-3-5-sonnet'` - Default, good balance of speed and quality
- `'gpt-4'` - Alternative if using OpenAI
- `'claude-3-opus'` - Higher quality summaries (slower, more expensive)

## How It Works

### 1. Message Flow

```
User sends message
    ↓
Message saved to database
    ↓
Hook triggers: checkAndSummarize(appId)
    ↓
Debounce timer starts (5 seconds)
    ↓
After debounce:
    - Load all messages for app
    - Count total tokens
    - If > threshold:
        → Identify messages to summarize (excluding recent turns)
        → Generate summary via LLM
        → Save summary to database
```

### 2. History Loading

```
Agent needs conversation history
    ↓
loadMessagesWithSummarization() called
    ↓
Load summaries from database
    ↓
Build message array:
    [SUMMARY] ... compressed older messages ...
    User: "Recent message 1"
    Assistant: "Response 1"
    User: "Recent message 2"  ← Full detail
    Assistant: "Response 2"   ← Full detail
```

### 3. Example Scenario

**Initial state**: 50 messages, 15,000 tokens total

**With current config**:
- Threshold: 10,000 tokens ✓ (exceeded)
- Keep recent: 3 turns (last 6 messages)
- Summarize: First 44 messages

**Result**:
- 44 messages → 1 summary message (~500 tokens)
- 6 recent messages → kept in full (~3,000 tokens)
- **Total: ~3,500 tokens** (down from 15,000)
- **Savings: 76% reduction**

## Adjusting Configuration

### To summarize more aggressively:

```typescript
initializeBackgroundSummarization({
  tokenThreshold: 5000,       // Lower threshold
  keepRecentTurns: 1,         // Keep only current turn
  debounceMs: 3000,
  modelName: 'claude-3-5-sonnet',
});
```

### To summarize less frequently:

```typescript
initializeBackgroundSummarization({
  tokenThreshold: 30000,      // Higher threshold
  keepRecentTurns: 5,         // Keep more recent context
  debounceMs: 10000,
  modelName: 'claude-3-5-sonnet',
});
```

### To disable summarization:

```typescript
// Comment out or remove the initializeBackgroundSummarization() call
// Or set a very high threshold:
initializeBackgroundSummarization({
  tokenThreshold: 1000000,    // Effectively disabled
  keepRecentTurns: 100,
  debounceMs: 5000,
  modelName: 'claude-3-5-sonnet',
});
```

## Testing Your Configuration

### 1. View Existing Summaries

```bash
# View all summaries for an app (formatted, easy to read)
pnpm view:summaries <your-app-id>

# View only the latest summary
pnpm view:summaries <your-app-id> --latest

# View with full summary text (not truncated)
pnpm view:summaries <your-app-id> --verbose

# View statistics only
pnpm view:summaries <your-app-id> --stats

# Export as JSON
pnpm view:summaries <your-app-id> --json
```

### 2. Dry Run Test (No DB Changes)

```bash
# Test what would be summarized with current config
pnpm test:summarization <your-app-id>

# Test with custom threshold
pnpm test:summarization <your-app-id> "" llm 5000
```

### 3. Manual Trigger

```bash
# Manually trigger summarization with current config
pnpm trigger:summarization <your-app-id>

# Then view the created summary
pnpm view:summaries <your-app-id> --latest
```

### 4. Monitor Logs

Look for these log events when using the app:

```
summarization.hook.triggered          - Hook fired after message added
summarization.background.token_check  - Token count checked
summarization.background.trigger      - Summarization started
summarization.llm.complete            - Summary generated
conversation.history.loader.summaries_applied - Summary used in history
```

### 5. Check Database (Advanced)

```bash
# View all summaries
litecli -e "SELECT id, app_id, message_count, original_token_count, summary_token_count, created_at FROM conversation_summaries ORDER BY created_at DESC" data/apps.db

# Calculate compression ratio
litecli -e "SELECT app_id, message_count, original_token_count, summary_token_count, ROUND(100.0 * summary_token_count / original_token_count, 2) as compression_pct FROM conversation_summaries" data/apps.db
```

## Troubleshooting

### Summaries not being created?

1. **Check token count**: Your conversation might be below the threshold
   ```bash
   pnpm test:summarization <app-id>
   ```

2. **Check recent turns**: All messages might be within `keepRecentTurns`
   - Try lowering `keepRecentTurns` to 1

3. **Check logs**: Look for `summarization.background.token_check` events

### Too many summaries being created?

1. **Increase threshold**: Set `tokenThreshold` higher (e.g., 20000)
2. **Increase debounce**: Set `debounceMs` higher (e.g., 10000)

### Losing too much context?

1. **Increase recent turns**: Set `keepRecentTurns` higher (e.g., 5)
2. **Increase threshold**: Set `tokenThreshold` higher

### Summary quality issues?

1. **Try different model**: Use `'claude-3-opus'` for better quality
2. **Check summary text**: Use test script to review generated summaries
3. **Adjust prompt**: Modify `LLMSummarizationStrategy.ts` system prompt

## Performance Impact

### Token Savings

With current config (10k threshold, 3 recent turns):
- **Typical savings**: 60-80% token reduction
- **Example**: 20,000 tokens → 5,000 tokens

### Cost Savings

- **LLM API costs**: Proportional to token reduction (60-80% savings)
- **Summarization cost**: Small one-time cost per summary (~1,000 tokens)
- **Net savings**: Significant for long conversations

### Latency Impact

- **Background summarization**: No impact (runs asynchronously)
- **History loading**: Minimal (summaries load faster than full messages)
- **First summarization**: ~2-5 seconds (one-time per threshold crossing)

## Best Practices

1. **Start aggressive, tune as needed**: Current config (10k/3 turns) is a good starting point
2. **Monitor logs**: Watch for summarization events to understand behavior
3. **Test before deploying**: Use dry-run tests to preview summaries
4. **Adjust based on use case**:
   - Short conversations: Higher threshold (20k+)
   - Long conversations: Lower threshold (5k-10k)
   - Context-sensitive tasks: More recent turns (5+)
   - General tasks: Fewer recent turns (1-3)

## Advanced: Per-App Configuration

To set different configs for different apps, you can modify the hook in `ConversationContextManager`:

```typescript
conversationRepository.registerMessageAddedHook(async (message, conversationId) => {
  const conversation = await conversationRepository.getById(conversationId);
  if (conversation) {
    // Custom logic based on app
    const app = await appRepository.findById(conversation.appId);
    
    if (app?.metadata?.summarizationConfig) {
      // Use app-specific config
      backgroundSummarizer.updateConfig(app.metadata.summarizationConfig);
    }
    
    await backgroundSummarizer.checkAndSummarize(conversation.appId);
  }
});
```

## Evaluation Tools

### View Summaries Script

The `view:summaries` script provides a formatted view of summaries for easy evaluation:

```bash
# Basic usage - shows all summaries with truncated text
pnpm view:summaries <app-id>

# Show only the latest summary
pnpm view:summaries <app-id> --latest

# Show full summary text (for quality evaluation)
pnpm view:summaries <app-id> --verbose

# Show statistics only (quick overview)
pnpm view:summaries <app-id> --stats

# Export as JSON (for programmatic analysis)
pnpm view:summaries <app-id> --json
```

**Example Output**:

```
═══════════════════════════════════════════════════════════════════════════════
Summary 1 of 2
═══════════════════════════════════════════════════════════════════════════════

📋 Summary Details:
   ID:                abc123...
   Created:           Jan 15, 2024, 10:30:45 AM
   Updated:           Jan 15, 2024, 10:30:45 AM

📊 Statistics:
   Messages:          25 messages
   Message Range:     msg001... → msg025...
   Original Tokens:   8,450 tokens
   Summary Tokens:    1,200 tokens
   Token Savings:     7,250 tokens (85.8% reduction)
   Compression Ratio: 14.2%
   Model Used:        claude-3-5-sonnet

📝 Summary Text:
────────────────────────────────────────────────────────────────────────────
   The user requested a login page with email authentication. The assistant
   created a React component with form validation and error handling...
   
   [Use --verbose to see full summary text]
────────────────────────────────────────────────────────────────────────────
```

**Stats Output** (`--stats` flag):

```
═══════════════════════════════════════════════════════════════════════════════
Summary Statistics
═══════════════════════════════════════════════════════════════════════════════

📊 Overall Stats:
   Total Summaries:        3
   Total Messages:         75
   Avg Messages/Summary:   25.0

💾 Token Usage:
   Original Tokens:        24,500
   Summary Tokens:         3,200
   Total Savings:          21,300 tokens
   Avg Compression:        86.9% reduction

📈 Per-Summary Breakdown:

   #  | Messages | Original  | Summary  | Savings  | Reduction | Created
   ────────────────────────────────────────────────────────────────────────
    1 |       25 |      8.5k |    1.2k |    7.3k |      86% | Jan 15, 2024
    2 |       30 |     10.0k |    1.5k |    8.5k |      85% | Jan 15, 2024
    3 |       20 |      6.0k |    0.5k |    5.5k |      92% | Jan 16, 2024
```

### Workflow for Evaluation

1. **Generate summaries** for your test app:
   ```bash
   pnpm trigger:summarization <app-id>
   ```

2. **View the results**:
   ```bash
   pnpm view:summaries <app-id> --verbose
   ```

3. **Evaluate quality**:
   - Are key decisions captured?
   - Is technical context preserved?
   - Are recent changes reflected?
   - Is the summary concise but complete?

4. **Check statistics**:
   ```bash
   pnpm view:summaries <app-id> --stats
   ```
   - Verify compression ratios (target: 80-90%)
   - Check token savings
   - Ensure consistent performance

5. **Compare with original**:
   - Use `pnpm test:summarization <app-id>` to see what would be summarized
   - Review the full message history vs. summary
   - Verify no critical information is lost

## Summary

The current configuration provides **aggressive summarization** to reduce token usage and potential bugs:

- ✅ Triggers at 10k tokens (relatively low threshold)
- ✅ Keeps last 3 user/assistant turns in full detail
- ✅ Summarizes everything older automatically
- ✅ Runs in background without blocking
- ✅ Saves 60-80% of tokens in long conversations

**Quick Reference Commands**:

```bash
# View summaries (formatted, easy to read)
pnpm view:summaries <app-id>

# Test what would be summarized (dry run)
pnpm test:summarization <app-id>

# Manually trigger summarization
pnpm trigger:summarization <app-id>

# View statistics
pnpm view:summaries <app-id> --stats
```

Adjust `tokenThreshold` and `keepRecentTurns` in `ai-lib-websocket-server.ts` to tune for your needs!

