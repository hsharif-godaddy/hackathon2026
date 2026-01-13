# Plan: Include Git Commit Hash in Complete Message

## Problem Statement

Currently, the `complete` WebSocket message has `commitHash: null` even when the agent made file changes during the conversation. This happens because:

1. **Git Hook Service** commits changes after each tool call (e.g., `{timestamp}-fileEdit`)
2. **Conversation Completion** runs `checkAndCommitChanges()` which finds no uncommitted changes and sets `commitHash = null`
3. **Complete Message** is sent with `commitHash: null`
4. **After Complete** the git hook's `handleConnectionEnd()` runs and performs the squash merge to main

The actual commit (squash merge to main) happens **after** the complete message is sent, so the client never receives the commit hash.

## Current Flow

```
Agent Run
  ↓
Tool Calls → Git Hook commits after each tool
  ↓
completeConversation()
  ├─ checkAndCommitChanges() → finds no changes → commitHash = null
  └─ Updates database
  ↓
publishToEventChannel('complete', {..., commitHash: null})
  ↓
onMessageComplete()
  ↓
gitHookService.handleConnectionEnd() → squash merge to main
  ↓
Client never receives the squash commit hash
```

## Proposed Solution

Add a `beforeMessageComplete` callback that executes git operations **before** `completeConversation()` runs. This allows capturing the squash commit hash before sending the complete message.

### New Flow

```
Agent Run
  ↓
Tool Calls → Git Hook commits after each tool
  ↓
beforeMessageComplete() → NEW
  ├─ gitHookService.handleConnectionEnd() → squash merge to main
  └─ Returns { commitHash: "abc123..." }
  ↓
completeConversation()
  ├─ Reads commitHash from context
  └─ Updates database
  ↓
publishToEventChannel('complete', {..., commitHash: "abc123..."})
  ↓
onMessageComplete() → No longer needs git operations
```

## Implementation Steps

### Step 1: Modify GitHookService to Return Commit Hash

**File**: `agents/src/services/git-hook-service.ts`

**Changes**:

- Change `handleConnectionEnd()` return type from `Promise<void>` to `Promise<string | null>`
- After squash merge, get the commit hash and return it
- Return `null` if no squash merge was performed or if an error occurred

**Code Changes**:

```typescript
// Line ~361: Change return type
async handleConnectionEnd(
  appId: string,
  reason: 'complete' | 'error' | 'disconnection',
  conversationId?: string,
  socketId?: string,
  userPrompt?: string
): Promise<string | null> {  // Changed from Promise<void>
  try {
    // ... existing code for checking branch, repo, etc ...

    // Step 3: Squash merge to main
    try {
      await gitUtils.switchBranch(app.path, 'main');
      await gitUtils.squashMerge(app.path, currentBranch, squashMessage);

      logger.info('git_hook.connection_end.squash_merged', {
        appId,
        socketId,
        featureBranch: currentBranch,
        squashMessage,
        reason
      });

      // NEW: Get the commit hash we just created
      const commits = await gitUtils.getCommitHistory(app.path, 1);
      const commitHash = commits[0]?.hash || null;

      logger.info('git_hook.connection_end.commit_hash', {
        appId,
        commitHash: commitHash ? commitHash.substring(0, 7) : 'unknown',
        reason
      });

      // ... existing cleanup code ...

      this.appBranches.delete(appId);

      // Return the commit hash
      return commitHash;

    } catch (error) {
      this.logGitError(appId, 'squashMerge', error as Error);
      this.appBranches.delete(appId);
      return null;  // Return null on error
    }

  } catch (error) {
    this.logGitError(appId, 'handleConnectionEnd', error as Error);
    this.appBranches.delete(appId);
    return null;  // Return null on error
  }
}
```

### Step 2: Add beforeMessageComplete Callback to WebSocketConfig

**File**: `packages/ai-lib/src/websocket/experimental-websocket-server.ts`

**Changes**:

- Add `beforeMessageComplete` to `WebSocketConfig` interface
- Call it in `handleMessageCompletion()` before `completeConversation()`
- Store the returned data in context

**Code Changes**:

```typescript
// Line ~122: Add to WebSocketConfig interface
export interface WebSocketConfig {
  // ... existing properties ...

  /**
   * Called BEFORE message completion to allow for pre-completion operations
   * (e.g., git commits that need to complete before the complete message is sent)
   *
   * @returns Object with optional commitHash and other data to merge into context
   */
  beforeMessageComplete?: (
    socketId: string,
    context: Record<string, unknown>,
  ) => Promise<{
    commitHash?: string | null;
    [key: string]: any;
  } | void>;

  onMessageComplete?: (
    socketId: string,
    result: {
      agentName: string;
      duration: string;
      usage?: TokenUsage;
      toolCalls: any[];
    },
    context?: Record<string, unknown>,
  ) => void;

  // ... rest of interface ...
}
```

```typescript
// Line ~2230: Modify handleMessageCompletion
private async handleMessageCompletion(
  socketId: string,
  agentName: string,
  startTime: number,
  processedContext?: Record<string, unknown>
): Promise<void> {
  const duration = `${Date.now() - startTime}ms`

  // NEW: Execute pre-completion operations (git commits, etc.)
  if (this.config.beforeMessageComplete) {
    try {
      const preCompletionResult = await this.config.beforeMessageComplete(
        socketId,
        processedContext || {}
      )

      if (preCompletionResult && processedContext) {
        // Merge pre-completion data into context
        Object.assign(processedContext, preCompletionResult)

        this.logger.debug('message.pre_completion.success', {
          socketId,
          hasCommitHash: !!preCompletionResult.commitHash
        })
      }
    } catch (error) {
      this.logger.error('message.pre_completion.error', {
        socketId,
        error: error instanceof Error ? error.message : String(error)
      })
      // Continue with completion even if pre-completion fails
    }
  }

  // Complete persistence FIRST (includes git commits) before sending complete event
  // Store commit hash if persistence layer provides it via context
  let commitHash: string | null = null
  const conversation = this.getConversation(socketId)
  if (conversation) {
    await this.config.messagePersistence.completeConversation(
      conversation.conversationId,
      conversation.streamingEvents,
      { agentName, duration },
      conversation.context
    )

    // Get commit hash from context (set by beforeMessageComplete or persistence layer)
    commitHash = (conversation.context as any).commitHash ?? null

    // Don't delete conversation - keep it active for next user message
    // Only cleanup happens on disconnect or error
  }

  // Publish final completion event - subscribers handle delivery and persistence
  // Always include commit hash (null if no commit was created)
  const handoffConversation = this.getConversation(socketId)
  await this.publishToEventChannel(socketId, 'complete', '', {
    totalSteps: 1,
    usage: undefined,
    toolCalls: [],
    agentId: agentName,
    duration,
    commitHash, // Now contains the squash merge commit hash
    messageId: handoffConversation?.context?.agentMessageId
  }, agentName)

  // Call completion handler
  this.config.onMessageComplete?.(socketId, {
    agentName,
    duration,
    usage: undefined,
    toolCalls: []
  }, processedContext)
}
```

### Step 3: Implement beforeMessageComplete in Agents Service

**File**: `agents/src/server/ai-lib-websocket-server.ts`

**Changes**:

- Add `beforeMessageComplete` callback implementation
- Call `gitHookService.handleConnectionEnd()`
- Return the commit hash

**Code Changes**:

```typescript
// Line ~730 (in setupAILibWebSocketServer config): Add beforeMessageComplete
const wsServer = new WebSocketServer(httpServer, {
  // ... existing config ...

  // NEW: Pre-completion callback for git operations
  beforeMessageComplete: async (
    socketId: string,
    context: Record<string, unknown>,
  ) => {
    const typedContext = context as AgentsAppContext;
    const siteId = typedContext?.appId;
    const conversationId = typedContext?.conversation?.conversationId;

    if (!siteId) {
      logger.debug("websocket.before_complete.no_app_id", { socketId });
      return { commitHash: null };
    }

    try {
      logger.debug("websocket.before_complete.begin", {
        socketId,
        appId: siteId,
        conversationId,
      });

      // Execute git squash merge and get commit hash
      const commitHash = await gitHookService.handleConnectionEnd(
        siteId,
        "complete",
        conversationId,
        socketId,
      );

      logger.info("websocket.before_complete.success", {
        socketId,
        appId: siteId,
        conversationId,
        commitHash: commitHash ? commitHash.substring(0, 7) : "none",
      });

      return { commitHash };
    } catch (error) {
      logger.error("websocket.before_complete.error", {
        socketId,
        appId: siteId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { commitHash: null };
    }
  },

  onMessageComplete: async (
    socketId: string,
    result: any,
    context?: Record<string, unknown>,
  ) => {
    // Git operations now happen in beforeMessageComplete
    // This callback can be simplified or used for other post-completion tasks

    const typedContext = context as AgentsAppContext;
    const siteId = typedContext?.appId;

    logger.debug("websocket.message.complete", {
      socketId,
      appId: siteId,
      duration: result.duration,
    });

    // Any other post-completion logic here
  },

  // ... rest of config ...
});
```

### Step 4: Remove Duplicate Git Operations from onMessageComplete

**File**: `agents/src/server/ai-lib-websocket-server.ts`

**Changes**:

- Remove the git hook call from `onMessageComplete` since it now runs in `beforeMessageComplete`
- Keep any other post-completion logic

**Code to Remove** (around line ~1168):

```typescript
// REMOVE THIS from onMessageComplete:
// Git hook: Final commit and squash merge to main on message completion
try {
  const conversationId = typedContext?.conversation?.conversationId;

  await gitHookService.handleConnectionEnd(
    siteId,
    "complete",
    conversationId,
    socketId,
  );

  contextLogger.debug("websocket.git_hook.connection_end.success", {
    socketId,
    appId: siteId,
  });
} catch (error) {
  contextLogger.warn("websocket.git_hook.connection_end.error", {
    socketId,
    appId: siteId,
    error: error instanceof Error ? error.message : String(error),
  });
}
```

### Step 5: Update completeConversation to Use Existing Commit Hash

**File**: `agents/src/server/conversation-persistence.ts`

**Changes**:

- Check if `commitHash` already exists in context (from `beforeMessageComplete`)
- Only run `checkAndCommitChanges()` if no commit hash is present

**Code Changes**:

```typescript
// Line ~731: Modify git commit section
// Create git commit if there are changes and store hash on context
if (context.appId) {
  // Check if commit hash was already set by beforeMessageComplete
  const existingCommitHash = (context as any).commitHash;

  if (existingCommitHash) {
    // Commit already created by git hook (squash merge)
    contextLogger.debug("conversation.complete.commit_hash_reused", {
      commitHash: existingCommitHash.substring(0, 7),
      source: "git_hook_squash_merge",
    });
  } else {
    // Fallback: check for uncommitted changes (safety net)
    const commitHash = await this.checkAndCommitChanges(
      context.appId,
      "conversation_complete",
    );
    (context as any).commitHash = commitHash;

    if (commitHash) {
      contextLogger.debug("conversation.complete.commit_hash_created", {
        commitHash: commitHash.substring(0, 7),
        source: "fallback_commit",
      });
    }
  }
} else {
  // No appId means no app to commit to - explicitly set null
  (context as any).commitHash = null;
}
```

## Testing Plan

### Unit Tests

1. **GitHookService Tests** (`agents/src/services/__tests__/git-hook-service.test.ts`)
   - Test that `handleConnectionEnd()` returns commit hash after squash merge
   - Test that it returns `null` when no branch exists
   - Test that it returns `null` on error

2. **WebSocket Server Tests** (`packages/ai-lib/src/websocket/__tests__/experimental-websocket-server.test.ts`)
   - Test that `beforeMessageComplete` is called before `completeConversation`
   - Test that commit hash from `beforeMessageComplete` is included in complete message
   - Test that completion succeeds even if `beforeMessageComplete` throws error

### Integration Tests

1. **Manual Testing**
   - Create a new app
   - Send a message that causes file edits
   - Verify the complete message contains `commitHash` (not null)
   - Check that the commit hash matches the latest commit on main branch

2. **E2E Testing**
   - Run through full conversation flow
   - Verify commit hash in complete message
   - Verify git history shows squash merge commit

## Rollout Considerations

### Backwards Compatibility

- ✅ **No breaking changes**: `beforeMessageComplete` is optional
- ✅ **Graceful fallback**: If callback fails, completion continues
- ✅ **Existing behavior preserved**: `checkAndCommitChanges()` still acts as safety net

### Risks

1. **Timing**: Git operations now block conversation completion
   - **Mitigation**: Git operations are already synchronous in current flow, just moved earlier

2. **Error handling**: If git squash merge fails, conversation should still complete
   - **Mitigation**: Wrap in try/catch, return `null` on error, log for debugging

3. **Order dependencies**: Code assumes git operations complete before DB updates
   - **Mitigation**: This is already the intended flow, just making it explicit

### Monitoring

Add logs to track:

- `websocket.before_complete.begin` - When pre-completion starts
- `websocket.before_complete.success` - With commit hash (truncated)
- `websocket.before_complete.error` - If git operations fail
- `conversation.complete.commit_hash_reused` - When using git hook's commit
- `conversation.complete.commit_hash_created` - When using fallback commit

## Success Criteria

1. ✅ `commitHash` in complete message is non-null when file changes were made
2. ✅ `commitHash` matches the squash merge commit on main branch
3. ✅ Git operations complete before complete message is sent
4. ✅ Conversation completion succeeds even if git operations fail
5. ✅ No performance regression (git operations already ran, just earlier now)

## Alternative Approaches Considered

### Option 2: Store hash after (in onMessageComplete)

❌ **Rejected**: Complete message already sent, can't include hash

### Option 3: Send separate git_commit message

❌ **Rejected**: Adds complexity, client must wait for two messages, breaks atomicity

### Option 4: Return last commit from history

❌ **Rejected**: Would return intermediate commit (e.g., `{timestamp}-fileEdit`), not the squash merge

## Implementation Order

1. ✅ Step 1: Modify `GitHookService.handleConnectionEnd()` to return commit hash
2. ✅ Step 2: Add `beforeMessageComplete` to `WebSocketConfig` interface
3. ✅ Step 3: Call `beforeMessageComplete` in `handleMessageCompletion()`
4. ✅ Step 4: Implement `beforeMessageComplete` in agents service
5. ✅ Step 5: Remove duplicate git calls from `onMessageComplete`
6. ✅ Step 6: Update `completeConversation()` to reuse existing commit hash
7. ✅ Test manually
8. ✅ Add unit tests
9. ✅ Add integration tests

## Files to Modify

1. `agents/src/services/git-hook-service.ts` (~30 lines modified)
2. `packages/ai-lib/src/websocket/experimental-websocket-server.ts` (~60 lines added)
3. `agents/src/server/ai-lib-websocket-server.ts` (~40 lines modified, ~20 lines removed)
4. `agents/src/server/conversation-persistence.ts` (~15 lines modified)

**Total**: ~165 lines of code changes across 4 files
