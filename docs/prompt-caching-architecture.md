# Prompt Caching Architecture

How we use Anthropic's prompt caching to reduce LLM input costs. Covers the message assembly pipeline, cache breakpoint placement, content block mechanics, and summary pinning.

## Anthropic Prompt Caching Primer

Anthropic caches message **prefixes** - the contiguous sequence of tokens from the start of the request. A cached prefix can be reused on subsequent requests if the prefix is identical.

**Key constraints:**

- Maximum **4 cache breakpoints** per request
- **Prefix-based invalidation**: if any token in the prefix changes, the cache is invalidated from that point forward
- **5-minute TTL**: cached prefixes expire after 5 minutes of inactivity
- **20-block lookback**: Anthropic's cache lookup walks at most 20 content blocks backward from each breakpoint to find a cached prefix match
- System messages must be **contiguous at the start** (cannot interleave with user/assistant)
- Cache breakpoints can be set on system, user, and assistant messages

**Cost model (Claude Sonnet 4.5, standard context):**

| Token type         | Price per million   |
| ------------------ | ------------------- |
| Input (uncached)   | $3.00               |
| Cache read (hit)   | $0.30 (90% savings) |
| Cache write (miss) | $3.75 (25% premium) |

## Message Segment Order

Messages are assembled in this order for each request:

```
+---------------------------------------------------------------------+
| SEGMENT 1: System Prompt (system role)                              |
| - Base agent instructions (markdown)                                |
| - Stable per agent type                                             |
| - Cache breakpoint set by addCacheControlToSystemPrompt()           |
+---------------------------------------------------------------------+
| SEGMENT 2: Template Description (system role)                       |
| - App template documentation (e.g., Next.js v8 patterns)           |
| - Stable per app                                                    |
| - insertionOrder: 'before_history'                                  |
| - No separate cache breakpoint (covered by system prefix)           |
+---------------------------------------------------------------------+
| SEGMENT 3: Memory Summary (user role) [cachePoint: ephemeral]       |
| - Summarized conversation history from LLM compaction               |
| - Changes only on re-summarization (infrequent)                     |
| - insertionOrder: 'before_history'                                  |
| - SECURITY: Must be user role to prevent prompt injection           |
+---------------------------------------------------------------------+
|                                                                     |
| SEGMENT 4: Conversation History                                     |
| - Previous user/assistant/tool message exchanges                    |
| - Append-only (new messages added to end each turn)                 |
| - Compressed and token-limited on load, but previously cached       |
|   prefix is protected via stableRegionEnd (see below)               |
| - Cache breakpoints:                                                |
|   - Intermediate stepping stone (within 18 blocks of segment 3)     |
|   - Last message (caches the full prefix)                           |
|                                                                     |
| ============== CACHE BOUNDARY (last history message) ============== |
|                                                                     |
+---------------------------------------------------------------------+
| SEGMENT 5: App Context (user role, 3 separate messages)             |
| - stable: package info, color scheme, dependency install status     |
| - secrets: live secrets with timestamps (more volatile)             |
| - media_slots: sorted media slot inventory (more volatile)          |
| - insertionOrder: 'after_history'                                   |
| - Placed after cache boundary: file edits (e.g., package.json)     |
|   would invalidate the entire conversation cache if before_history  |
+---------------------------------------------------------------------+
| SEGMENT 6: KnowB Results (user role)                                |
| - Knowledge base search results                                     |
| - Query-dependent (changes every request)                           |
| - insertionOrder: 'after_history'                                   |
+---------------------------------------------------------------------+
| SEGMENT 7: Todo Context (user role)                                 |
| - Current todo list state                                           |
| - insertionOrder: 'after_history'                                   |
+---------------------------------------------------------------------+
| SEGMENT 8: Dynamic Data (user role)                                 |
| - Date, user timezone, project title, preview URL                   |
| - insertionOrder: 'after_history'                                   |
+---------------------------------------------------------------------+
| SEGMENT 9: Current User Message                                     |
| - The actual user prompt for this request                           |
+---------------------------------------------------------------------+
```

## Cache Breakpoint Strategy

### Breakpoint Budget

Anthropic allows 4 breakpoints per request. We use up to 4 depending on conversation state:

| Slot | Breakpoint           | Set by                                               | Condition                                  |
| ---- | -------------------- | ---------------------------------------------------- | ------------------------------------------ |
| 1    | System Prompt        | `addCacheControlToSystemPrompt()`                    | When caching enabled and system prompt set |
| 2    | Memory Summary       | `context-manager.ts` via `cachePoint: ephemeral`     | When a summary exists                      |
| 3    | Intermediate         | `addCacheControlToMessages()` in `prompt-caching.ts` | When anchor-to-end gap > 20 blocks         |
| 4    | Last History Message | `addCacheControlToMessages()` in `prompt-caching.ts` | When not already cached (skipped on retry) |

On the very first turn (no conversation history), only the system prompt breakpoint is active. Slots 2-4 activate as the conversation grows.

### Stability and Placement

```
Segment                    Stability        Cache Point    Reason
---------------------------------------------------------------------
1. System Prompt           Very stable      YES (auto)     ai-lib handles
2. Template Description    Stable/app       No             Covered by prefix
3. Memory Summary          Slow-changing    YES            Changes infrequently
4. Conversation History    Append-only      YES (x2)       Intermediate + last
5. App Context             Stable (pkg)     No             After cache boundary
6. KnowB Results           Every request    No             After cache boundary
7. Todo Context            Variable         No             After cache boundary
8. Dynamic Data            Every request    No             After cache boundary
9. User Message            Every request    No             Always new
```

### Why These Placements?

**Memory Summary (Segment 3):**

- Generated by LLM summarization of conversation history
- Only regenerated when history exceeds token limits
- Caching saves re-reading ~30-50% of typical context

**Last History Message (Segment 4):**

- Conversation history is append-only: new messages added to end, previous messages never change
- Cache breakpoint on the last message means the entire prefix (system + template + memory + all history) is cached
- Each new request extends the cache by one turn

**Intermediate Breakpoint (within Segment 4):**

- Anthropic's cache lookback walks at most 20 **content blocks** backward from each breakpoint
- With long conversations (90+ messages, 200+ content blocks from tool call expansion), the gap between the memory summary breakpoint (~position 3) and the last message far exceeds 20 blocks
- An intermediate breakpoint is placed within ~18 content blocks of the memory summary breakpoint
- This creates a "stepping stone" chain: the intermediate's lookback finds the memory entry, and the last-message's lookback finds the previous turn's last-message entry
- Without this, first-request-per-turn caches only the system prompt (~37% hit rate)
- With this, first-request-per-turn caches system prompt + early conversation (~42-52% hit rate)
- The gap between intermediate and last-message breakpoints can still exceed 20 blocks in long conversations - this is an accepted limitation of the 4-breakpoint budget

**Segments 5-9 (after_history):**

- **CRITICAL:** These MUST be placed AFTER the cache boundary (last history message)
- App context is mostly stable but can change when the agent edits files (e.g., package.json)
- KnowB results are query-dependent and change every request
- If any of these are included in the cached prefix, cache is invalidated when they change
- Placing them in `after_history` ensures the stable prefix (system, template, memory, history) remains cached regardless of what changes in app context or search results

## Content Blocks vs Messages

Anthropic's 20-block lookback counts **content blocks**, not messages. This distinction matters because tool calls expand a single logical operation into multiple blocks.

### Tool Call Expansion

Each tool call in conversation history produces:

```
Message 1 (assistant): content array with tool-call parts
  - text part (if present and non-empty after trim)  = 1 block
  - tool-call part                                    = 1 block

Message 2 (tool): content array with tool-result
  - tool-result part                                  = 1 block
```

A single tool call = 2-3 content blocks. The space placeholder (`' '`) used in `processMessageSegments()` is filtered by `msg.content.trim()` in `formatMessagesForAISDK()`, so tool-call-only assistant messages produce 1 block (the tool-call part), not 2.

### Impact on Lookback

A conversation with 30 tool calls produces ~60-90 content blocks. The intermediate breakpoint placement counts blocks (not messages) from the anchor to correctly position within the 20-block lookback window:

```typescript
// From prompt-caching.ts
const MAX_BLOCKS = LOOKBACK_WINDOW - 2; // 18-block target with 2-block safety margin
let blockCount = 0;
for (let i = anchorIndex + 1; i < lastMessageIndex; i++) {
  const content = messages[i]?.content;
  blockCount += Array.isArray(content) ? content.length : 1;
  if (blockCount >= MAX_BLOCKS) {
    intermediateIndex = i;
    break;
  }
}
```

## Message Assembly Pipeline

The assembly happens in two stages across multiple files.

### Stage 1: Context Building (agents service)

```
AILibContextManager.buildContextMessages()
  |
  +-- Segment 2: getTemplateDescription()
  |     role: system, insertionOrder: before_history
  |
  +-- Segment 3: loadConversationSummary()
  |     role: user, insertionOrder: before_history, cachePoint: ephemeral
  |     Uses pinned summary from ConversationHistoryLoader (see Summary Pinning)
  |
  +-- Segment 5: buildAppContextMessage() -> app_context_stable/secrets/media_slots
  |     role: user, insertionOrder: after_history
  |
  +-- Context attachments (generic, via ContextAttachmentRegistry)
        role/insertionOrder/cachePoint determined by each renderer
        NOTE: Attachments using before_history + cachePoint will consume
        a breakpoint slot and participate in the cached prefix

ai-lib-websocket-server.ts (assembles remaining after_history)
  |
  +-- Segment 6: KnowB results
  +-- Segment 7: Todo context
  +-- Segment 8: Dynamic data
```

### Stage 2: Normalization and Caching (ai-lib)

```
defaultConvertToLlm(input)
  |
  +-- Split contextMessages by insertionOrder
  |     before_history: [template desc, memory summary, + any before_history attachments]
  |     after_history:  [app context, knowb, todo, dynamic, + any after_history attachments]
  |
  +-- normalizeContextMessages(beforeHistory)
  |     Converts cachePoint -> providerOptions.anthropic.cacheControl
  |
  +-- normalizeConversationMessages(conversationMessages)
  |     Same cachePoint conversion for history messages
  |
  +-- Build stable prefix: [...beforeNormalized, ...conversationNormalized]
  |
  +-- applyPromptCaching(stablePrefix, ...)
  |     Calls addCacheControlToMessages() which:
  |     1. Counts existing breakpoints (e.g., memory summary)
  |     2. Reserves 1 slot for system prompt
  |     3. Adds last-message breakpoint (highest priority)
  |     4. Adds intermediate stepping stone if gap > 20 blocks
  |     5. Enforces remaining slot budget
  |
  +-- Append after_history AFTER caching is applied
  |     [...cachedStablePrefix, ...afterNormalized]
  |
  +-- Append user message last
```

**Key insight:** `after_history` content is appended AFTER `addCacheControlToMessages()` runs. The cache breakpoint lands on the last conversation history message, not on any after_history content. This is what makes the boundary work - after_history content can change freely without invalidating the cache.

### cachePoint Normalization

Pipeline messages use `cachePoint: { type: 'ephemeral' }` as a storage format. Before reaching `addCacheControlToMessages()`, these are converted to the provider-specific format by `normalizeContextMessages()`:

```
Pipeline format:     { cachePoint: { type: 'ephemeral' } }
                          |
                   normalizeContextMessages()
                          |
Provider format:     { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
```

This means `addCacheControlToMessages()` only needs to check `providerOptions.anthropic.cacheControl` when counting existing breakpoints - not both formats.

## Summary Pinning for Cache Stability

When `BackgroundSummarizer` creates a new summary between turns, both the context manager (segment 3) and the history loader (segment 4 boundary) must use the **same** summary version. If they disagree, the memory summary content changes mid-conversation, invalidating the cache.

### How It Works

`ConversationHistoryLoader` maintains a pinned summary per app:

```
Turn 1: getPinnedOrLatestSummary() -> fetches latest summary S1, pins it
Turn 2: getPinnedOrLatestSummary() -> reuses S1 (pin active)
  [BackgroundSummarizer creates S2 between turns]
Turn 3: getPinnedOrLatestSummary() -> still uses S1 (pin active, turnCount < MAX)
...
Turn N: getPinnedOrLatestSummary() -> epoch expired, fetches S2, pins it
```

`AILibContextManager.loadConversationSummary()` reads the pinned ID via `getPinnedSummaryId()` and uses the same summary. This ensures both paths see the same content, keeping the cached prefix stable across turns within a pin epoch.

**Safety net:** If the pinned summary's `appId` doesn't match the current app (shouldn't happen, but defensive), falls back to `findLatestForApp()`.

**Edge cases that cause cache misses:**

- **Stale/deleted pin:** If the pinned summary was deleted from the database, the pin refreshes to the latest summary (different content = cache miss).
- **Missing messageRangeEnd:** `AILibContextManager` validates that the summary's `messageRangeEnd` message still exists. If it was deleted (e.g., conversation cleanup), the summary is not injected at all - the memory segment disappears, causing a cache miss.
- **Pin epoch expiry:** After `MAX_PINNED_TURNS` (5) turns, the pin refreshes. If a new summary was created in the interim, this causes a one-time cache miss.

## Stable Prefix Protection During Compression

Conversation history is compressed and token-limited on every load, but the loader protects the previously cached prefix from mutation.

`ConversationHistoryLoader` tracks `previousTurnMessageCount` per app - the post-token-limit message count from the prior turn. On the next turn, this count becomes `stableRegionEnd`, passed to the compressor as a boundary: messages before this index are not modified by compression strategies, preserving the byte-exact prefix that Anthropic has cached.

```
Turn N: load history -> compress(stableRegionEnd=undefined) -> token-limit -> 45 messages
         Store previousTurnMessageCount[appId] = 45

Turn N+1: load history -> compress(stableRegionEnd=45) -> token-limit -> 48 messages
           Messages 0-44 are untouched (cached prefix preserved)
           Messages 45-47 are new (appended after cache boundary)
           Store previousTurnMessageCount[appId] = 48
```

This prevents compression from altering tool result formatting or whitespace in earlier messages, which would silently invalidate the cache even though the logical content is unchanged.

## Anthropic API Constraints

### System Message Ordering

```
VALID:
  system -> system -> user -> user -> assistant -> user

INVALID:
  system -> user -> system -> user
  (Error: "Multiple system messages separated by user/assistant messages")
```

This is why:

- Template description is `system` role (segments 1-2 are contiguous system)
- Memory summary is `user` role (comes after system block)
- App context is `user` role and `after_history` (outside cached prefix)

### Breakpoint Slot Accounting

```
addCacheControlToMessages() slot math:

  ANTHROPIC_MAX = 4
  existing      = count of messages with providerOptions.anthropic.cacheControl
                  (e.g., memory summary = 1)
  systemReserve = 1 if cacheSystemPrompts is true
  remaining     = 4 - existing - systemReserve

  Typical: 4 - 1 (memory) - 1 (system) = 2 remaining
  Allocates: 1 for last-message, 1 for intermediate = 2 used

  If last message is already cached (within-turn retry):
    Skip it to avoid wasting a slot
```

## Security: Memory as User Role

Memory summaries are derived from user conversations. Placing user-derived content in system prompts creates a **prompt injection vulnerability**:

```
DANGEROUS (old approach):
  System Prompt: "You are a helpful assistant.

  # Memory
  [User-derived summary that could contain injected instructions]"

  -> Attacker crafts messages that survive summarization
  -> Malicious content appears in system prompt
  -> LLM treats it as trusted instructions

SAFE (current approach):
  System: "You are a helpful assistant."
  User: "# Memory\n\n[summary text from LLM compaction]"

  -> Summary clearly marked as user-provided context
  -> LLM treats it as user input, not system instructions
```

## Implementation Files

| Component        | File                                                 | Responsibility                                        |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Context Manager  | `agents/src/agents/ai-lib-agents/context-manager.ts` | Builds segments 2-3, 5                                |
| History Loader   | `agents/src/services/ConversationHistoryLoader.ts`   | Loads segment 4, manages summary pins                 |
| WebSocket Server | `agents/src/server/ai-lib-websocket-server.ts`       | Assembles segments 6-8 (after_history)                |
| Message Assembly | `packages/ai-lib/src/core/context-normalization.ts`  | Splits by insertionOrder, normalizes, applies caching |
| Prompt Caching   | `packages/ai-lib/src/utils/prompt-caching.ts`        | Breakpoint placement logic (intermediate + last)      |
| System Caching   | `packages/ai-lib/src/utils/prompt-caching.ts`        | `addCacheControlToSystemPrompt()` for slot 1          |
| App Context      | `agents/src/services/AppContextManager.ts`           | Generates stable/secrets/media_slots context          |

## Cache Behavior Examples

### Scenario 1: Normal Conversation

```
Request 1: "Hello" (first turn, no history yet)
  - Segments 1-2: NEW (cache miss, cache write)
  - Segments 5-9: NEW (after cache boundary)
  - Active breakpoints: system only (no summary, no history)

Request 2: "Tell me more" (second turn, 1 exchange in history)
  - Segments 1-4: Mostly CACHED (prefix stable, cache read)
  - Segments 5-9: NEW (after cache boundary)
  - Active breakpoints: system + last-history (no summary yet, gap too small for intermediate)

Request N: (long conversation, summary exists)
  - Segments 1-4: CACHED (all 4 breakpoints active)
  - Segments 5-9: NEW (after cache boundary)
  - Cost savings: ~60-70%
```

### Scenario 2: After Summarization

```
Request N: History exceeds token limit, triggers summarization
  - Memory summary regenerated (new content)
  - Cache INVALIDATED (prefix changed at segment 3)
  - This request: cache miss, cache write for new prefix
  - Next request: cache hit on new prefix
```

### Scenario 3: File Edit by Agent

```
Turn 5: Agent edits package.json via tool call
  - Segments 1-4: CACHED (history extended by one turn, prefix still matches)
  - Segment 5 (App Context): Different content (package.json changed)
  - No cache impact - app context is after cache boundary
```

### Scenario 4: Different KnowB Query

```
Request: "How do I deploy?"
  - Segments 1-4: CACHED
  - Segment 6 (KnowB): Different results for "deploy" query
  - No cache impact - segments 5-9 are after cache boundary
```

### Scenario 5: Long Conversation (200+ blocks)

```
After many tool calls, conversation has 250+ content blocks:
  - Memory summary breakpoint: position ~3
  - Intermediate breakpoint: position ~21 (18 blocks from memory)
  - Last-message breakpoint: position ~250
  - Gap between intermediate and last: ~229 blocks (exceeds 20-block lookback)
  - First request of a new turn: intermediate bridges memory -> early history
  - Subsequent requests in same turn: last-message breakpoint caches full prefix
  - Accepted limitation: no additional intermediates within 4-slot budget
```

## Monitoring

### Log Events

| Event                                        | Meaning                                            |
| -------------------------------------------- | -------------------------------------------------- |
| `prompt_caching.complete`                    | Breakpoint placement summary (positions, count)    |
| `prompt_caching.stats`                       | Per-request cache metrics (hit rate, savings)      |
| `context.summary.memory_injected`            | Memory summary loaded with token counts            |
| `conversation.history.summary_pin.refreshed` | Summary pin epoch rolled over                      |
| `context.app.build.success`                  | App context generated (stable/secrets/media sizes) |

### Anthropic API Response Fields

| Field                         | Meaning                                            |
| ----------------------------- | -------------------------------------------------- |
| `cache_creation_input_tokens` | Tokens written to cache (miss)                     |
| `cache_read_input_tokens`     | Tokens read from cache (hit - this is the savings) |

### AI SDK v6 Usage Fields

| Field                                | Meaning                                     |
| ------------------------------------ | ------------------------------------------- |
| `inputTokenDetails.cacheReadTokens`  | Tokens served from cache                    |
| `inputTokenDetails.cacheWriteTokens` | Tokens written to cache                     |
| `inputTokenDetails.noCacheTokens`    | Tokens after last breakpoint (never cached) |

## Known Limitations

1. **Long conversation gap**: With 200+ content blocks, the gap between intermediate and last-message breakpoints exceeds 20 blocks. First-request-per-turn hit rate is ~42-52%, not the theoretical ~80-90%. Additional intermediates would require more breakpoint slots.

2. **Tool call block expansion**: Each tool call produces 2-3 content blocks. Heavy tool use accelerates the long-conversation gap problem. Consolidating tool calls would save messages but not blocks (negligible cache benefit, medium risk to model behavior).

3. **Summary pin epochs**: When a pin epoch expires, the next request gets a cache miss as the memory summary content changes. This is intentional - the alternative (never updating) would cause stale context.

4. **5-minute TTL**: If the user is idle for >5 minutes, the cache expires and the next request is a full miss. No mitigation - this is an Anthropic platform constraint.

## References

- [Anthropic Prompt Caching Docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- PR #2465: Intermediate breakpoint stepping stone
- PR #2468: App context delivery fix + after_history move
- PR #2288, #2093: Original cache optimization (99%+ hit rate on subsequent requests)
- PR #1606: Security fix (memory as user role)
