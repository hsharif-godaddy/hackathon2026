---
title: "refactor: runtime performance quick wins"
type: refactor
status: active
date: 2026-03-20
origin: docs/brainstorms/2026-03-20-runtime-perf-quick-wins-requirements.md
---

> **[EDIT 2026-06-05]** References below to `elastic-apm-node` are historical. The agents service has since been migrated to OpenTelemetry (PR #4030); env-var precedence and tracing config now go through `OTEL_*` variables.

# Runtime Performance Quick Wins

6 independent, low-risk performance improvements across agents/ and app/. Each ships as its own PR. No user-facing behavior changes.

(see origin: `docs/brainstorms/2026-03-20-runtime-perf-quick-wins-requirements.md`)

## Enhancement Summary

**Deepened on:** 2026-03-24 (third pass)
**Sections enhanced:** 6/6
**Agents used:** 20 review/research agents, 3 Context7 framework doc queries, 6 targeted deepening agents

### Corrections from Deepening (all passes)

1. **R5 is NOT already enabled.** Socket.IO defaults `perMessageDeflate: false` since v3.0.0 (confirmed via Context7 docs + codebase grep: zero hits for `perMessageDeflate`). The first deepening's claim that "ws v8.x enables it by default" was incorrect — ws defaults don't apply because Socket.IO explicitly sets `false`.
2. **R5 config bug:** Plan had `memLevel: 4` at top-level of `perMessageDeflate`. It belongs inside `zlibDeflateOptions` per the ws `PerMessageDeflateOptions` type. At top-level it would be silently ignored.
3. **R5 `threshold` doesn't work as expected.** ws `threshold` parameter ONLY applies when `serverNoContextTakeover: true`. Without it, every message gets compressed regardless of size — meaning all small streaming chunks (50-500 bytes) would be compressed, potentially making them larger. This significantly changes the risk/reward of R5.
4. **R5 disables engine.io pre-encoded frame optimization.** Enabling perMessageDeflate prevents engine.io from caching pre-encoded frames, which is a hidden performance cost for broadcast scenarios.
5. **R6 has a two-layer caching bug.** Removing `initialized` from `KnowBDriver` is necessary but insufficient. `KnowBTokenProvider.initialize()` also has a `!this.cachedS2SToken` guard (line 118) that prevents re-fetching. Both guards must be removed.
6. **R6 `needsInitialization()` already exists** (line 142). Plan incorrectly described adding it. Simplification: remove `initialized` flag AND `needsInitialization()` entirely — just have `ensureInitialized()` always call `initialize()` for S2S mode.
7. **R6 PR #2167 does NOT obsolete R6.** PR #2167 adds a parallel `KnowledgeServiceDriver` with env var toggle (`USE_KNOWLEDGE_SERVICE`). KnowBDriver remains the default. R6 is still valuable. The new driver also has per-call instantiation — R6's token fix pattern should be applied there too.
8. **R3 has more config values than documented.** The plan omitted `spanCompressionExactMatchMaxDuration: '0ms'`, `spanCompressionSameKindMaxDuration: '0ms'`, and `spanStackTraceMinDuration: '0ms'` which also need removal. These triple-disable span compression and enable expensive span stack traces on every span.
9. **R3 acceptance criteria contradict the plan body.** AC says "dev/test retain full body capture" but removing hardcoded `captureBody: 'all'` switches dev/test to `'off'`. Fixed below.
10. **R3 Nomad config is external.** No `.nomad` or `.hcl` files exist in this repo. Production Nomad job templates are in the mhp-core repo. PR must document exact env vars but cannot include the deployment config change.
11. **R3 `captureHeaders: true` (line 138) also leaks PII.** Authorization headers containing JWTs and tokens are captured. Evaluate removing or adding `sanitizeFieldNames`.
12. **R1 scope was incomplete in conversations.ts.** The file has 4 `new ConversationRepository()` calls (lines 27, 84, 126, 195), not just line 27. All must be replaced.
13. **R1 `messageAddedHooks` claim is overstated.** `registerMessageAddedHook` has zero callers. The hook infra exists but is unused. Singleton switch is still correct for consistency + future-proofing, but it's not fixing a manifesting bug.
14. **R4 is dead code.** App UI calls `GET /agent/conversations/:appId` (chat.ts), NOT `GET /api/conversations` (conversations.ts). `AgentService.ts` confirms: lines 36, 81, 109 all use `/agent/conversations/:appId`. The conversations.ts route has zero production consumers. Recommend dropping R4 or converting to a delete-dead-code PR.
15. **R2 loading fallback can't show `{children}`.** `next/dynamic`'s `loading` prop receives no props. The raw-code fallback must be handled differently (see updated approach below).
16. **R2 two components differ in branching.** MarkdownRenderer has 2-way branching (`!inline && match` → SyntaxHighlighter, else → `<code>`). markdownComponents has 3-way branching (SyntaxHighlighter, inline code, plain block code). The extracted CodeBlock must handle both patterns. markdownComponents also does NOT spread `{...props}` and uses different classNames.
17. **R2 `'use client'` directive required.** The extracted CodeBlock file MUST have `'use client'` since it uses `next/dynamic` with `ssr: false`.

### Key Improvements from First Deepening (retained)

1. **R6 approach corrected:** `getToken()` MUST stay sync — `GoKnowbClientImpl` calls it in a sync axios interceptor.
2. **R3 simplification:** `elastic-apm-node` has native env var support. No custom env vars needed.
3. **R4 caution:** `getConversationsWithMessageCount()` is also used by `chat.ts` — create a new method.
4. **R2 confirmed:** Module-level `dynamic()` import required for streaming stability.

### Security Findings

- **S1 (High):** `captureBody: 'all'` is actively leaking GitHub PATs, OAuth tokens, and user messages to APM backend. **R3 should ship first.**
- **S2 (Medium):** 30-min S2S token expiry (R6 Part A fixes this).
- **Recommendation:** Even with `captureBody: 'errors'`, add an `apm.addFilter()` to redact `token`, `password`, `secret`, `authorization` fields from error-path bodies. Also evaluate `captureHeaders: true` (line 138) which may expose Authorization headers.

### Open PRs That May Conflict

| PR | Status | Impact |
|----|--------|--------|
| **#2103** (Agent AuthZ) | Active (updated 2026-03-24) | Touches `ai-lib-websocket-server.ts` + `app.ts` — conflicts with R1, R3, R5, R6 |
| **#2167** (Replace knowb with knowledge-service) | Updated 2026-03-20 | Adds parallel driver behind env var toggle. Does NOT replace KnowBDriver. R6 still valuable. Flag token fix pattern to #2167 author. |
| **#1920** (Anthropic compaction) | Stale (2026-03-05) | Touches `ai-lib-websocket-server.ts` + `ConversationRepository.ts` |

---

## R1. Singleton Repositories in WebSocket Hot Path

**Files:**
- `agents/src/server/ai-lib-websocket-server.ts` (lines 55, 63, 77, 859, 871, 943)
- `agents/src/server/routes/conversations.ts` (lines 3, 27, 84, 126, 195)

**Change:**
1. Replace `import { ... AppRepository ... }` class import with `import { appRepository, conversationRepository } from '../../database/repositories/index.js'`
2. In `ai-lib-websocket-server.ts`: remove `new AppRepository()` at lines 63, 859 and `new ConversationRepository()` at lines 871, 943. Remove the class import.
3. In `conversations.ts`: replace all 4 `new ConversationRepository()` calls (lines 27, 84, 126, 195) with the barrel singleton import
4. Use imported singletons directly

**Why safe:** Repos are stateless wrappers. `getDatabase()` returns a module-level memoized SQLite instance. `better-sqlite3` is synchronous — no concurrent query interleaving. Multiple other files already use barrel singletons (`conversation-persistence.ts`, `chat.ts`, `health.ts`, `share.ts`).

### Research Insights (Second Deepening)

**Performance impact is near-zero.** Constructor cost is single-digit microseconds (creates lightweight object, calls `getDatabase()` which returns memoized instance). This is a consistency and correctness fix, not a meaningful performance optimization.

**`messageAddedHooks` is unused.** `registerMessageAddedHook` has zero callers in the codebase. The hook infrastructure exists (ConversationRepository line 353) but nobody registers hooks. The singleton switch future-proofs against this bug but does not fix a currently manifesting issue.

**`appRepo` rename is unnecessary churn.** The barrel exports `appRepository`. Importing it gives you that name automatically. Don't hunt for additional rename opportunities in the file — just use the barrel import name. Line 63's `const appRepo = new AppRepository()` naturally disappears when switching to the barrel import.

**~60+ non-test call sites** still use `new XRepository()` instead of barrel singletons (not ~15 as originally estimated). Out of scope but worth a follow-up tracking issue.

**Barrel re-exports classes AND singletons** (`index.ts` lines 27-35). This invites the anti-pattern being fixed. Consider a follow-up to remove class re-exports or add a linting rule.

**Verify `registerMessageAddedHook` call sites** before the PR. If any code registers hooks on ad-hoc instances expecting instance-scoped isolation, the singleton switch could change behavior. Current grep shows zero callers, so this is safe.

### Acceptance Criteria

- [ ] No `new AppRepository()` or `new ConversationRepository()` in `ai-lib-websocket-server.ts`
- [ ] No `new ConversationRepository()` in `conversations.ts` route (all 4 call sites fixed)
- [ ] Imports use barrel exports from `repositories/index.ts`
- [ ] `pnpm --filter @airo/agents test:unit` passes
- [ ] `pnpm typecheck` passes

---

## R2. Dynamic-Import react-syntax-highlighter

**Files:**
- `app/src/app/develop/components/MarkdownRenderer.tsx` (lines 5-6)
- `app/src/app/develop/components/preview/markdownComponents.tsx` (lines 2-3)

**Current imports:**
```typescript
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
```

**Approach:** `markdownComponents.tsx` exports a plain object (not a React component), so `next/dynamic` can't wrap the file itself. Instead:

1. Extract a `CodeBlock` client component to `app/src/components/ui/CodeBlock.tsx`:
   - **Must have `'use client'` directive** (uses browser-only SyntaxHighlighter)
   - Must handle the union of both consumers' branching logic:
     - MarkdownRenderer: 2-way (`!inline && match` → SyntaxHighlighter, else → `<code>`)
     - markdownComponents: 3-way (`!inline && match` → SyntaxHighlighter, `inline` → inline code, else → plain block code)
   - Type props properly: `{ className?: string; children: React.ReactNode; inline?: boolean }` (not `any`)
   - Note: markdownComponents does NOT spread `{...props}` and uses different classNames
   - Hoist `const LANGUAGE_RE = /language-(\w+)/` to module level (both files recreate this in render path)
2. In both `markdownComponents.tsx` and `MarkdownRenderer.tsx`, use `next/dynamic` with `ssr: false` to import `CodeBlock` **at module level**:
   ```typescript
   const DynamicCodeBlock = dynamic(() => import('@/components/ui/CodeBlock'), { ssr: false })
   ```
3. The `code` component override in both files should render `<pre><code>{children}</code></pre>` as the SSR/loading fallback inline, and `<DynamicCodeBlock>` once loaded. Do NOT rely on `next/dynamic`'s `loading` prop for the content-aware fallback — `loading` receives no props.

**IMPORTANT:** Both files must be converted. If only one is converted, the library stays in the initial bundle via the other import.

**Reference pattern:** `app/src/app/develop/components/preview/PreviewCode.tsx` (lines 4, 30-39) — Monaco dynamic import.

### Research Insights (Second Deepening)

**`loading` prop cannot show raw code.** `next/dynamic`'s `loading` callback receives no props — it cannot access `children` from the parent. The fallback must be handled differently: the `code` override function should conditionally render raw `<pre><code>` when the dynamic component hasn't resolved yet, or use a generic placeholder (the Monaco pattern in `PreviewCode.tsx` uses a spinner). Best approach: render raw `<pre><code>{children}</code></pre>` inline for the `!inline && match` case, and let `CodeBlock` replace it once loaded.

**Hoist the language regex.** Both files create `/language-(\w+)/` inside the render path (line 83 of MarkdownRenderer, line 25 of markdownComponents). Hoist to module level: `const LANGUAGE_RE = /language-(\w+)/`. Free fix during extraction.

**Existing anti-pattern in MarkdownRenderer.tsx (out of R2 scope but related).** Lines 63-68 have a derived-state-in-effect: `const [displayContent, setDisplayContent] = useState(content)` + `useEffect(() => setDisplayContent(content), [content])`. This creates an unnecessary re-render on every streaming chunk. The `processedContent` useMemo should derive directly from the `content` prop. Consider bundling this fix since the file is already being modified.

**Bundle impact: ~500KB parsed JS** removed from initial load. Estimated 100-300ms improvement in Time-to-Interactive on mid-range hardware.

**Type the CodeBlock props.** Both files currently use `(props: any)`. When extracting, type properly using `className`, `children`, `inline` from react-markdown's component props.

**Package versions:** react-syntax-highlighter 15.6.3, react-markdown 10.1.0, Next.js 14.2.35.

### Acceptance Criteria

- [ ] `react-syntax-highlighter` no longer in initial client bundle (compare `.next/static/chunks` sizes before/after)
- [ ] Both `MarkdownRenderer.tsx` and `markdownComponents.tsx` use dynamic import (not one, both)
- [ ] Code blocks render correctly in chat messages (manual test)
- [ ] Streaming markdown: code blocks do NOT flash/remount when new tokens arrive
- [ ] `pnpm --filter website build` passes
- [ ] `pnpm typecheck` passes

---

## R3. Reduce APM Overhead in Production

**File:** `agents/src/server/app.ts` (lines 123-155)

**PRIORITY: Ship first.** `captureBody: 'all'` is actively sending GitHub PATs, OAuth tokens, and user messages to the APM backend at 100% sample rate. This is a High-severity security issue.

**Current config (hardcoded for all envs):**

| Setting | Current | Library Default | Action |
|---------|---------|-----------------|--------|
| `transactionSampleRate` | `1.0` | `1.0` | Remove (same as default) |
| `captureBody` | `'all'` | `'off'` | Remove (behavior change: dev/test → `'off'`) |
| `transactionMaxSpans` | `500` | `500` | Remove (same as default) |
| `spanCompressionEnabled` | `false` | `true` | Remove (behavior change: enables compression) |
| `spanCompressionExactMatchMaxDuration` | `'0ms'` | `'50ms'` | Remove (behavior change: enables compression) |
| `spanCompressionSameKindMaxDuration` | `'0ms'` | `'0ms'` | Remove (no change) |
| `stackTraceLimit` | `50` | `50` | Remove (same as default) |
| `spanStackTraceMinDuration` | `'0ms'` | `'-1s'` | Remove (behavior change: stops capturing span stack traces) |
| `captureSpanStackTraces` | `false` | deprecated | Remove |

**Values that MUST stay in JS config** (not library defaults, not tuning knobs):
- `serviceName`, `active`, `secretToken`, `serverUrl`, `environment` — identity/connectivity
- `usePathAsTransactionName: true` — Express-specific (default is `false`)
- `opentelemetryBridgeEnabled: true` — required for Vercel AI SDK telemetry bridge (default is `false`)
- `instrument: true`, `instrumentIncomingHTTPRequests: true` — structural
- `globalLabels` — runtime value from `process.env.SITE_ID` (no pure env var equivalent)
- `captureHeaders` — **should be removed or set to `false`.** Currently `true` (line 138), actively capturing Authorization headers containing JWTs and tokens. Same PII category as `captureBody`.

**Approach:**
1. Remove the tuning-knob values listed above from the JS config object
2. Remove `captureHeaders: true` (or set to `false`) — it leaks Authorization headers
3. Keep structural/identity values in JS
4. Set production values via deployment env vars (Nomad job spec in **mhp-core** repo — external):
   ```
   ELASTIC_APM_TRANSACTION_SAMPLE_RATE=0.1
   ELASTIC_APM_CAPTURE_BODY=errors
   ELASTIC_APM_TRANSACTION_MAX_SPANS=128
   ```
5. Dev/test: accept library defaults (`captureBody: 'off'`, `spanCompression: true`, `spanStackTraces: none`)

**Deployment note:** No `.nomad` or `.hcl` files exist in this repo. Nomad job templates are in the mhp-core repo. The PR description must document the exact env vars needed, and a separate mhp-core PR (or ops request) sets them in production.

**Dev/test behavior changes (accepted):**

| Setting | Before | After | Impact |
|---------|--------|-------|--------|
| `captureBody` | `'all'` | `'off'` | No bodies in local APM traces. Acceptable — local debugging rarely uses APM. |
| `spanCompressionEnabled` | `false` | `true` | Consecutive identical spans merge. Slightly less granular traces. |
| `spanStackTraceMinDuration` | `'0ms'` (all spans) | `'-1s'` (no spans) | No span stack traces. Improves dev perf. |

If any of these are unacceptable, set the corresponding `ELASTIC_APM_*` env var in dev/test config.

**Not in scope:** The global fetch monkey-patch (lines 27-116), `apm.addSpanFilter()` (line 158+). These are imperative code that stays in JS.

### Research Insights (Third Deepening)

**Env var precedence:** Env vars BEAT inline JS config (higher precedence per elastic-apm-node docs). So setting env vars in production is reliable even if some JS config remains.

**Distributed tracing is unaffected.** `transactionSampleRate` only applies to new traces. Incoming requests with a `traceparent` header respect the upstream sampling decision regardless of local sample rate.

**The fetch monkey-patch (lines 27-116) is the bigger CPU cost.** Every fetch call goes through this wrapper, creating spans for all LLM API calls. Even at 10% sampling, the wrapper executes for 100% of calls. Flag as fast-follow.

**Estimated production impact:** 20-40% CPU reduction from APM overhead. Significant memory reduction from fewer span objects and no body capture on success paths.

**Exact current config (18 key-value pairs at lines 123-155):** All confirmed by code inspection. Only 1 filter exists: `apm.addSpanFilter()` for CSP at line 158. No `sanitizeFieldNames` configured — meaning no redaction of sensitive field names in captured bodies/headers.

**Full config values to remove (11 values):**
1. `transactionSampleRate: 1.0` — same as library default
2. `captureBody: 'all'` — **HIGH SEVERITY PII LEAK**
3. `transactionMaxSpans: 500` — same as library default
4. `spanCompressionEnabled: false` — disabling a useful optimization
5. `spanCompressionExactMatchMaxDuration: '0ms'` — redundant when compression disabled
6. `spanCompressionSameKindMaxDuration: '0ms'` — same as library default
7. `stackTraceLimit: 50` — same as library default
8. `spanStackTraceMinDuration: '0ms'` — expensive: captures stack traces on ALL spans
9. `captureSpanStackTraces: false` — deprecated in favor of `spanStackTraceMinDuration`
10. `captureHeaders: true` — **MEDIUM SEVERITY: captures Authorization headers**
11. `captureErrorLogStackTraces: 'always'` — acceptable default, remove for consistency

**Consider adding `apm.addFilter()`** to redact sensitive fields from error-path bodies (when `captureBody: 'errors'` is set via env var in production). Fields: `token`, `password`, `secret`, `authorization`, `pat`.

### Acceptance Criteria

- [ ] All 11 tuning-knob config values removed from JS
- [ ] `captureHeaders` removed or set to `false`
- [ ] Structural config values remain in JS (serviceName, active, globalLabels, usePathAsTransactionName, opentelemetryBridgeEnabled)
- [ ] PR description documents exact production env vars for mhp-core Nomad job spec
- [ ] `pnpm --filter @airo/agents test:unit` passes
- [ ] `pnpm typecheck` passes

---

## R4. ~~Fix N+1 in Conversations List~~ DEAD CODE — Recommend Drop or Delete

**Status: DEPRIORITIZED.** Investigation confirms `GET /api/conversations` is dead code with zero production consumers.

**Files:**
- `agents/src/server/routes/conversations.ts` (lines 27-49)
- `agents/src/database/repositories/ConversationRepository.ts` (line 934+)

**Finding:** App UI calls `GET /agent/conversations/:appId` (chat.ts:98), NOT `GET /api/conversations` (conversations.ts). `AgentService.ts` confirms all 3 conversation endpoints (lines 36, 81, 109) use `/agent/conversations/:appId`. Chat.ts already uses `getConversationsWithMessageCount()` — a single JOIN query with no N+1. The `GET /api/conversations` route has **zero production consumers**.

**Only actively used route in conversations.ts:** `PATCH /api/conversations/:id/tools/:toolId` (lines 170-282) — called by 3 social post widget components.

**Recommendation:** Convert R4 from "optimize" to "delete dead code." Remove the `GET /api/conversations` handler (lines 27-49) and its `POST /api/conversations` sibling (lines 52-80) if also unused. This is lower effort and higher value than optimizing dead code. Alternatively, drop R4 entirely.

**Current flow:** Route loads all conversations via `getByAppId()`, then `Promise.all` loads ALL messages for EACH conversation (including full content, tool_calls, segments, metadata) just to count them and extract last user message snippet. For 20 conversations with 100 messages each, this materializes ~10MB of transient data.

**Approach:**
1. Create a new method `listConversationSummaries(appId)` (specific name, not generic `getConversationsWithDetails`) that extends the existing `getConversationsWithMessageCount()` query with a correlated subquery for last user message:
   ```sql
   (SELECT SUBSTR(content, 1, 100) FROM conversation_messages
    WHERE conversation_id = c.id AND sender = 'user'
    ORDER BY created_at DESC LIMIT 1) as last_user_message
   ```
2. Replace the N+1 loop in the route with a single call to the new method
3. Also switch from `new ConversationRepository()` to singleton import (R1 overlap — coordinate PR ordering)

### Research Insights (Second Deepening)

**Consider adding a composite index.** Current schema only has `idx_conversation_messages_conversation_id` (simple `conversation_id` index). The correlated subquery `WHERE conversation_id = ? AND sender = 'user' ORDER BY created_at DESC LIMIT 1` would benefit from `(conversation_id, sender, created_at)`. Without it, SQLite scans all messages for the conversation, filters by sender, and sorts. With it, SQLite does a single index lookup. Not required at current data volumes but cheap insurance.

**NULL vs undefined pitfall.** Current code: `lastUserMessage?.content?.slice(0, 100)` yields `undefined` when no user messages exist (from `.pop()` on empty array). SQL correlated subquery returns `NULL` → better-sqlite3 returns `null`. Consumers checking `if (conversation.lastMessage)` are unaffected, but `=== undefined` checks would break. Handle explicitly in the mapping layer.

**Date type pitfall.** Route currently calls `.toISOString()` on Date fields. The new repository method returns Date objects (from `new Date(row.created_at)`), but the route serializes them. Keep the route responsible for the `.toISOString()` transformation.

**Main win is memory, not query count.** The N+1 with better-sqlite3 (synchronous, in-process) is not the classic network-round-trip problem. The real cost is materializing and JSON-parsing full message content (`tool_calls`, `segments`, `metadata`, `context_attachments`) for every message across all conversations, only to discard everything except a count and a 100-char snippet.

**Integration test exists.** `conversation-history-integration.integration.test.ts:122` calls `getConversationsWithMessageCount()`. Not a unit test and not for the new method, but it exists. The plan's "no existing tests" claim is inaccurate.

### Acceptance Criteria

- [ ] Verified who consumes `GET /api/conversations` (document the consumer)
- [ ] `GET /api/conversations` returns same response shape (`messageCount` + `lastMessage`)
- [ ] `lastMessage` returns `null` (not `undefined`) when no user messages exist — verify consumers handle both
- [ ] Single SQL query instead of N+1
- [ ] Add at least one unit test for the new method's return shape
- [ ] `pnpm --filter @airo/agents test:unit "conversations"` passes
- [ ] `pnpm typecheck` passes

---

## R5. Enable WebSocket Per-Message Compression

**Files:**
- `agents/src/server/ai-lib-websocket-server.ts` (Socket.IO server init, ~line 1150)

**IMPORTANT:** Only modify the agents service config. Do NOT modify `packages/ai-transport/src/experimental-websocket-server.ts` — changing the transport package would affect all consumers.

**Approach:** Add `perMessageDeflate` to `socketOptions` in the agents service override:

```typescript
socketOptions: {
  maxHttpBufferSize: 10 * 1024 * 1024,
  perMessageDeflate: {
    threshold: 1024,  // only compress messages > 1KB
    zlibDeflateOptions: { level: 1, memLevel: 4 },  // fast compression, reduced memory
  },
  cors: { origin: '*', credentials: true },
}
```

**Note:** `memLevel` is a property of `zlibDeflateOptions`, NOT a top-level `perMessageDeflate` property. Placing it at the wrong level will be silently ignored.

**Key decisions (see origin):** If testing reveals CPU/memory issues on the 384MB container, drop R5 from this batch rather than expanding scope. Drop threshold: p99 latency increase >20ms or memory baseline rise >30MB.

**CRITICAL: `threshold` requires `serverNoContextTakeover: true`.** Without `serverNoContextTakeover`, ws ignores the `threshold` parameter and compresses ALL messages regardless of size. This means every streaming AI chunk (50-500 bytes) gets compressed, potentially making them *larger* due to zlib framing overhead. The plan's original assumption that "most streaming chunks skip compression" is WRONG without this flag.

**Updated config must include `serverNoContextTakeover: true`:**
```typescript
perMessageDeflate: {
  threshold: 1024,
  serverNoContextTakeover: true,  // REQUIRED for threshold to work
  zlibDeflateOptions: { level: 1, memLevel: 4 },
},
```

**Trade-off:** `serverNoContextTakeover` frees zlib context between messages (good for memory) but prevents cross-message dictionary reuse (worse compression ratio). For our use case (independent JSON messages), this is acceptable — cross-message dictionary benefit is minimal.

**Additional gotchas:**
- `perMessageDeflate` defaults to `false` in Socket.IO since v3.0.0 (confirmed). This PR enables it, not tunes it.
- Enabling perMessageDeflate **disables engine.io's pre-encoded frame optimization.** Engine.io normally caches pre-encoded frames for efficiency; compression makes each frame unique, eliminating this cache. Impact is proportional to broadcast ratio (low for 1-5 connections per deployment).
- zlib context memory is allocated per-connection at handshake time, regardless of threshold. With `memLevel: 4` + `serverNoContextTakeover`: context allocated/freed per message (~transient, no persistent cost).
- At 1-5 connections per deployment (typical), bandwidth savings are negligible. The main beneficiaries are history replay (20-50 messages in rapid succession) and large tool results.
- No CRIME/BREACH risk — WebSocket messages don't contain CSRF tokens or secrets in compressed payloads, and frame sizes aren't observable cross-origin

### Research Insights (Third Deepening)

**R5 is the weakest item in this batch.** After deeper investigation:
- `threshold` requires `serverNoContextTakeover: true` to function (see above)
- Enabling compression disables engine.io pre-encoded frame optimization
- 1-5 connections per deployment means minimal bandwidth savings
- Streaming chunks (the hot path) are below threshold and get zero benefit
- Only history replay and large tool results benefit (3-5x compression on JSON/text)

**Recommendation: Consider dropping R5 entirely** or deferring to a future batch when connection counts increase. If kept, it's a low-impact, moderate-risk change that should ship last with careful monitoring.

**Socket.IO docs (Context7 confirmed):**
- `perMessageDeflate` disabled by default since v3.0.0
- `threshold` defaults to 1024 (plan's value matches)
- `memLevel` defaults to 8 (plan reduces to 4 for memory savings)
- `concurrencyLimit` defaults to 10 (controls max concurrent compressions)
- `serverNoContextTakeover` defaults to `false` (MUST be set to `true` for threshold to work)

### Acceptance Criteria

- [ ] WebSocket frames >1KB are compressed (verify via `Sec-WebSocket-Extensions: permessage-deflate` in upgrade response + browser Network tab)
- [ ] No `RSV1` or WebSocket errors in client console
- [ ] Streaming AI responses work correctly
- [ ] Recovery replay works correctly
- [ ] Container memory stays within acceptable range
- [ ] `pnpm --filter @airo/agents test:unit` passes
- [ ] `pnpm typecheck` passes

---

## R6. Singleton KnowBDriver

**Files:**
- `agents/src/server/ai-lib-websocket-server.ts` (lines 55, 77)
- `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts` (lines 117-121, 142-144, 169, 192-197, 440)

**PR #2167 does NOT block R6.** PR #2167 adds a parallel `KnowledgeServiceDriver` behind an env var toggle (`USE_KNOWLEDGE_SERVICE`). KnowBDriver remains the default path. R6 is still valuable — it fixes a production bug (30-min token expiry) that affects the default path. The new `KnowledgeServiceDriver` also has per-call instantiation; the Part A token fix pattern should be applied there too (flag for the #2167 author).

**Current state:**
- Line 55: `import { KnowBDriver } from '../tools/ai-lib-tools/drivers/knowb-driver.js'` (imports the class)
- Line 77: `const knowBDriver = new KnowBDriver()` (inside `searchKnowBDocumentation`, called per message)
- Line 440 of driver: `export const knowBDriver = new KnowBDriver()` (singleton already exists)

**Change (two parts):**

**Part A — Fix token refresh (required prerequisite):**

The singleton is NOT safe without this fix. S2S tokens expire after 30 minutes. Two guards prevent re-fetching:

1. `KnowBDriver.initialized` flag (line 169) — set `true` once, never reset
2. `KnowBTokenProvider.initialize()` guard `!this.cachedS2SToken` (line 118) — skips refresh when token is non-null (even if expired)

**Critical constraint:** `getToken()` MUST remain synchronous. `GoKnowbClientImpl` (from `@godaddy/goknowb-client@1.0.8`) calls `getToken()` in a sync axios request interceptor at `client.ts:108-112`. The `TokenProvider` interface defines `getToken(): string` (not Promise).

**Simplified fix (remove indirection, don't add it):**

```typescript
// KnowBDriver.ensureInitialized() — remove initialized flag, remove needsInitialization() call
private async ensureInitialized(): Promise<void> {
  if (this.tokenProvider.useS2S) {
    await this.tokenProvider.initialize();
  }
}

// KnowBTokenProvider.initialize() — remove !this.cachedS2SToken guard
async initialize(): Promise<void> {
  if (this.useS2S) {
    this.cachedS2SToken = await getS2SToken({ ssoHost: this.ssoHost });
  }
}
```

Remove: `initialized` boolean, `needsInitialization()` method. Both are unnecessary because `getS2SToken()` handles its own caching.

**Why this works:** `getS2SToken()` in `packages/ai-lib/src/utils/s2s-auth.ts` has module-level TTL cache (60s pre-expiry buffer) + promise deduplication. Calling it on every `ensureInitialized()` is zero-cost when valid (a single `Date.now()` comparison). Every KnowBDriver method calls `await ensureInitialized()` before any sync `getToken()` read, so `cachedS2SToken` is always fresh when the axios interceptor reads it. Node.js event loop guarantees no interleaving between the await resolution and the subsequent synchronous code.

**Part B — Switch to singleton import:**

1. Line 55: `import { knowBDriver } from '../tools/ai-lib-tools/drivers/knowb-driver.js'` (import singleton instance)
2. Remove line 77

### Research Insights (Second Deepening)

**Why per-message `new KnowBDriver()` accidentally worked:** Each new instance created a fresh `KnowBTokenProvider` with `cachedS2SToken = null`, forcing `initialize()` to call `getS2SToken()` (bypassing the `!this.cachedS2SToken` guard). Since `getS2SToken()` has its own TTL cache, it returned fresh tokens when needed. The per-message pattern was an accidental workaround.

**Affected code beyond this PR:** `ImageAnalysisService.ts` and `design-rag/src/knowb-client.ts` use the singleton and have the same latent 30-min token expiry bug. The Part A fix benefits all consumers.

**6 token service implementations** exist in the codebase (`s2s-auth.ts`, `cert-token-service.ts`, `testpilot/token-service.ts`, `proxy/sso-client.ts`, `insights-auth.ts`, `knowb-driver.ts`). `s2s-auth.ts` is the most robust (TTL + buffer + dedup). `knowb-driver.ts` is the only one with the boolean flag bug.

**Race safety confirmed.** `getS2SToken()` uses promise deduplication (`tokenRefreshPromise` variable) — concurrent calls wait on the same promise, `finally` block clears it. The Node.js single-threaded event loop guarantees `cachedS2SToken` is populated by the time the sync interceptor reads it after an `await`.

### Acceptance Criteria

- [ ] `initialized` boolean and `needsInitialization()` method removed from KnowBDriver/KnowBTokenProvider
- [ ] `initialize()` always calls `getS2SToken()` (no `!this.cachedS2SToken` guard)
- [ ] `getToken()` stays synchronous, reads from `this.cachedS2SToken`
- [ ] No `new KnowBDriver()` in `ai-lib-websocket-server.ts`
- [ ] Import uses singleton export from driver module
- [ ] KnowB search works after 30+ minutes in a long-running session (manual test)
- [ ] Add unit test: mock `getS2SToken()` with short TTL, verify `ensureInitialized()` re-fetches
- [ ] `pnpm --filter @airo/agents test:unit` passes
- [ ] `pnpm typecheck` passes

---

## Implementation Order

Revised based on security audit, dead-code analysis, git history, and PR conflict analysis:

1. **R3** (APM config) — **Ship first.** High-severity PII leak (captureBody + captureHeaders). Dormant code. No competing PRs. Highest performance impact (20-40% CPU reduction estimate). Requires companion mhp-core PR for production env vars.
2. **R2** (dynamic import) — Dormant files (no changes in 7-9 weeks). No competing PRs. User-facing improvement (100-300ms TTI). Extract shared CodeBlock component.
3. **R1** (singleton repos) — Coordinate with PR #2103 (AuthZ) which actively touches `ai-lib-websocket-server.ts`. Ship before or immediately after #2103.
4. **R6** (KnowBDriver + token fix) — Fixes production bug (30-min token expiry). PR #2167 does NOT block this. Flag token fix pattern to #2167 author for the new KnowledgeServiceDriver.
5. **R4** (dead code) — **CHANGED: Delete dead `GET /api/conversations` route** instead of optimizing it. Minimal effort, zero risk. Or drop entirely.
6. **R5** (WS compression) — **Weakest item.** `threshold` requires `serverNoContextTakeover`, disables engine.io frame optimization, 1-5 connections means negligible bandwidth savings. **Consider dropping entirely.** Ship last if kept, with careful monitoring.

**Cross-PR coordination:**
- R1 + R4 both touch `conversations.ts` — ship R1 first, R4 rebases
- R1 + R6 both touch `ai-lib-websocket-server.ts` imports — ship R1 first, R6 rebases
- R3 + R1 have minimal overlap (different regions of different files)

## Unresolved Questions

- R4: Delete dead route or drop R4 entirely? Also confirm `POST /api/conversations` (lines 52-80) is equally dead.
- R5: Drop R5 from this batch? Cost/benefit is poor after threshold + engine.io findings.
- R3: Who owns the mhp-core Nomad job spec? Need a companion PR there for production env vars.
- R3: Does anyone rely on APM request body capture in dev/test dashboards? (Default: accept `'off'`)
- R3: Remove `captureHeaders` entirely or add `sanitizeFieldNames` for Authorization?
- R6: Flag token fix pattern to #2167 author — does `KnowledgeServiceDriver` have same per-call instantiation?
- General: Establish performance baseline before starting?

## Sources

- **Origin document:** [docs/brainstorms/2026-03-20-runtime-perf-quick-wins-requirements.md](../brainstorms/2026-03-20-runtime-perf-quick-wins-requirements.md) — 6 items from proactive runtime audit
- **Socket.IO docs (Context7):** `perMessageDeflate` defaults to `false` since v3.0.0, threshold defaults to 1024
- **elastic-apm-node docs (Context7):** env vars override JS config, `captureBody` default is `'off'`
- **Next.js docs (Context7):** `next/dynamic` with `ssr: false` is idiomatic for client-only heavy components
- Singleton barrel: `agents/src/database/repositories/index.ts`
- Dynamic import pattern: `app/src/app/develop/components/preview/PreviewCode.tsx:30-39`
- KnowBDriver singleton: `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts:440`
- S2S token cache: `packages/ai-lib/src/utils/s2s-auth.ts` (TTL + promise dedup)
- Local APM setup: `docs/LOCAL_APM_SETUP.md`
