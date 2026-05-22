# Agent Conversation Pagination & Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the debug-console Agent tab usable on conversations with 7K+ messages by paginating the single-conversation GET, moving the markdown export pipeline into debug-console, and deleting the agents-side export endpoints that load entire apps into memory.

**Architecture:** Three threads of change — (1) extend the existing `/agent/conversations/:appId/:conversationId` agents endpoint with optional `limit`/`before` query params backed by `getMessagesPaginated`; (2) port the markdown formatter from `agents/src/services/conversation-exporter.ts` into `debug-console/src/lib/conversation-markdown.ts` so the export route is one paginated pipeline producing either JSON zip or streaming markdown; (3) rewrite `agents/scripts/export-chat.ts` as a thin JOMAX-bearing HTTP client over the prod debug-console URL, then delete the unused agents-side export endpoints and the now-orphaned formatter.

**Tech Stack:** TypeScript, Express (agents), Next.js App Router (debug-console), Vitest (both), better-sqlite3 (`getMessagesPaginated`), `archiver` (zip streaming), React (`AIAgentPanel`).

**Spec:** `docs/superpowers/specs/2026-05-21-agent-conversation-pagination-design.md`

---

## File Map

**agents/**
- Modify: `src/database/repositories/ConversationRepository.ts:583` — raise `limit` clamp 100 → 200.
- Modify: `src/database/repositories/__tests__/ConversationRepository.test.ts:579-590` — update clamp boundary test.
- Modify: `src/server/routes/chat.ts:227-251` — extend single-conversation GET with optional pagination.
- Add test: `src/server/routes/__tests__/chat-pagination.test.ts` (new file).
- Delete: `src/server/routes/conversations.ts:73-113` — `/api/conversations/export` handler. Keep file (other handlers remain).
- Delete: `src/server/routes/diagnostics.ts:248-303` — `/diagnostics/conversations/export` handler. Keep file (other handlers remain).
- Delete: `src/server/routes/__tests__/conversations-export.test.ts` (whole file).
- Delete: `src/services/conversation-exporter.ts` (whole file).
- Delete: any sibling test for `conversation-exporter.ts`.
- Rewrite: `scripts/export-chat.ts` — thin HTTP client over prod debug-console URL.

**debug-console/**
- Modify: `src/app/api/agent/conversations/[appId]/[conversationId]/route.ts` — forward `limit`/`before`.
- Add: `src/lib/conversation-markdown.ts` — ported markdown formatter.
- Add test: `src/lib/__tests__/conversation-markdown.test.ts`.
- Modify: `src/app/api/agent/conversations-export/[appId]/route.ts` — unify json/markdown paths into one paginated pipeline; remove `streamMarkdownDirect`, `fetchMessagesBatch`, JOMAX dependency.
- Modify: `src/components/AIAgentPanel.tsx` — pagination state, "Load older" button, loaded/total counter on `ConversationDetail`.

---

## Task 1: Raise `getMessagesPaginated` Limit Clamp

**Files:**
- Modify: `agents/src/database/repositories/ConversationRepository.ts`
- Modify: `agents/src/database/repositories/__tests__/ConversationRepository.test.ts`

- [ ] **Step 1: Update the existing clamp-boundary test**

Open `agents/src/database/repositories/__tests__/ConversationRepository.test.ts`, find the test at line 579 (`should enforce max limit of 100`), and replace it with:

```ts
    it('should enforce max limit of 200', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      for (let i = 1; i <= 250; i++) {
        await repo.addMessage(conv.id, 'user', `Message ${i}`)
      }

      const result = await repo.getMessagesPaginated(conv.id, 'app-123', { limit: 500 })

      expect(result.messages).toHaveLength(200)
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -t "should enforce max limit of 200"`
Expected: FAIL — current code returns 100 messages because the clamp is `Math.min(options.limit ?? 20, 100)`.

- [ ] **Step 3: Raise the clamp**

In `agents/src/database/repositories/ConversationRepository.ts:583`, change:

```ts
    const limit = Math.min(options.limit ?? 20, 100); // Enforce max 100
```

to:

```ts
    const limit = Math.min(options.limit ?? 20, 200); // Enforce max 200
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -t "should enforce max limit of 200"`
Expected: PASS.

- [ ] **Step 5: Run the full ConversationRepository test file to confirm no regression**

Run: `pnpm --filter @airo/agents test:unit ConversationRepository.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add agents/src/database/repositories/ConversationRepository.ts agents/src/database/repositories/__tests__/ConversationRepository.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): raise getMessagesPaginated clamp from 100 to 200

The export pipeline in debug-console will request 200-message pages so
each conversation completes in fewer round trips. No existing caller
passes limit > 100 today, so this is additive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Pagination to `/agent/conversations/:appId/:conversationId`

**Files:**
- Modify: `agents/src/server/routes/chat.ts`
- Add: `agents/src/server/routes/__tests__/chat-pagination.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/server/routes/__tests__/chat-pagination.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const fakeConversation = {
  id: 'conv-1',
  appId: 'test-app',
  agentId: 'develop',
  title: 'Test',
  createdAt: new Date('2026-03-09T10:00:00Z'),
  updatedAt: new Date('2026-03-09T10:05:00Z'),
};

const fullMessages = [
  { id: 'msg-1', conversationId: 'conv-1', sender: 'user', content: 'Hello', createdAt: new Date('2026-03-09T10:00:00Z') },
  { id: 'msg-2', conversationId: 'conv-1', sender: 'agent', content: 'Hi', createdAt: new Date('2026-03-09T10:01:00Z') },
];

const paginatedResult = {
  messages: [fullMessages[1]],
  hasMore: true,
  nextCursor: 'msg-1',
  total: 2,
};

const lifecycleMock = {
  getById: vi.fn().mockResolvedValue(fakeConversation),
};
const messagesMock = {
  getMessages: vi.fn().mockResolvedValue(fullMessages),
  getMessagesPaginated: vi.fn().mockResolvedValue(paginatedResult),
};

vi.mock('../../../memory/adapters/index.js', () => ({
  getConversationLifecycleStore: vi.fn(() => lifecycleMock),
  getMessageStore: vi.fn(() => messagesMock),
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnershipFromBody: () => (_req: any, _res: any, next: any) => next(),
  validateConversationOwnership: () => (_req: any, _res: any, next: any) => next(),
}));

import { chatRouter } from '../chat.js';

describe('GET /agent/conversations/:appId/:conversationId', () => {
  let app: express.Express;

  beforeEach(() => {
    lifecycleMock.getById.mockClear();
    messagesMock.getMessages.mockClear();
    messagesMock.getMessagesPaginated.mockClear();
    app = express();
    app.use('/agent', chatRouter);
  });

  it('returns the legacy full-load shape when no pagination params are provided', async () => {
    const res = await request(app).get('/agent/conversations/test-app/conv-1').expect(200);
    expect(res.body).toEqual({
      conversation: expect.objectContaining({ id: 'conv-1' }),
      messages: expect.any(Array),
    });
    expect(messagesMock.getMessages).toHaveBeenCalledWith('conv-1');
    expect(messagesMock.getMessagesPaginated).not.toHaveBeenCalled();
  });

  it('returns paginated shape when limit is present', async () => {
    const res = await request(app)
      .get('/agent/conversations/test-app/conv-1?limit=50')
      .expect(200);
    expect(res.body).toEqual({
      conversation: expect.objectContaining({ id: 'conv-1' }),
      messages: expect.any(Array),
      pagination: { total: 2, hasMore: true, nextCursor: 'msg-1' },
    });
    expect(messagesMock.getMessagesPaginated).toHaveBeenCalledWith('conv-1', 'test-app', {
      limit: 50,
      before: undefined,
    });
    expect(messagesMock.getMessages).not.toHaveBeenCalled();
  });

  it('forwards before cursor when present', async () => {
    await request(app)
      .get('/agent/conversations/test-app/conv-1?limit=200&before=msg-99')
      .expect(200);
    expect(messagesMock.getMessagesPaginated).toHaveBeenCalledWith('conv-1', 'test-app', {
      limit: 200,
      before: 'msg-99',
    });
  });

  it('triggers paginated path when only before is present (defaults limit)', async () => {
    await request(app)
      .get('/agent/conversations/test-app/conv-1?before=msg-99')
      .expect(200);
    expect(messagesMock.getMessagesPaginated).toHaveBeenCalledWith('conv-1', 'test-app', {
      limit: 50,
      before: 'msg-99',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit chat-pagination`
Expected: FAIL — current handler ignores pagination params and always calls `getMessages`.

- [ ] **Step 3: Wire pagination into the handler**

In `agents/src/server/routes/chat.ts`, replace the handler at lines 227-251 with:

```ts
router.get('/conversations/:appId/:conversationId', validateAppIdParam, validateConversationOwnership('conversationId'), async (req, res) => {
  const appId = req.params.appId!; // Validated by validateAppIdParam
  const conversationId = req.params.conversationId!; // Validated by validateConversationOwnership

  const { limit, before } = req.query;
  const paginated = limit !== undefined || before !== undefined;

  try {
    const conversation = await lifecycle.getById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (paginated) {
      const limitNum = limit !== undefined ? parseInt(limit as string, 10) : 50;
      if (Number.isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ error: 'Invalid limit' });
      }
      const result = await messages.getMessagesPaginated(conversationId, appId, {
        limit: limitNum,
        before: typeof before === 'string' ? before : undefined,
      });
      return res.json({
        conversation,
        messages: result.messages,
        pagination: {
          total: result.total,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        },
      });
    }

    const msgs = await messages.getMessages(conversationId);
    return res.json({ conversation, messages: msgs });
  } catch (error) {
    logger.error('conversation.fetch.failure', {
      conversationId,
      paginated,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});
```

Note: the default of 50 lives at the route layer; the repository default of 20 is unchanged but unreachable through this route (route always passes a limit when paginating).

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit chat-pagination`
Expected: All four tests PASS.

- [ ] **Step 5: Run the existing chat route tests to confirm no regression**

Run: `pnpm --filter @airo/agents test:unit chat.test`
Expected: PASS (existing chat.ts tests).

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/routes/chat.ts agents/src/server/routes/__tests__/chat-pagination.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): paginate /agent/conversations/:appId/:conversationId

Accept optional limit and before query params and route through
getMessagesPaginated when present. Without params, behavior is
unchanged (full load). Unblocks debug-console Show on conversations
with thousands of messages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Forward Pagination Params from Debug-Console Proxy

**Files:**
- Modify: `debug-console/src/app/api/agent/conversations/[appId]/[conversationId]/route.ts`

- [ ] **Step 1: Forward `limit` and `before` to the upstream call**

Replace the file contents with:

```ts
import { NextRequest, NextResponse } from 'next/server';

import { fetchAgentJson } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const LIMIT_RE = /^\d{1,4}$/;
const CURSOR_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const GET = withAuth<{ appId: string; conversationId: string }>(async function getConversation(request: NextRequest, _auth, context) {
    const { appId, conversationId } = await context.params;
    if (!APP_ID_RE.test(appId)) {
        return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }
    if (!CONVERSATION_ID_RE.test(conversationId)) {
        return NextResponse.json({ error: 'Invalid conversationId' }, { status: 400 });
    }

    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit') ?? undefined;
    const beforeParam = url.searchParams.get('before') ?? undefined;
    if (limitParam !== undefined && !LIMIT_RE.test(limitParam)) {
        return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
    }
    if (beforeParam !== undefined && !CURSOR_RE.test(beforeParam)) {
        return NextResponse.json({ error: 'Invalid before cursor' }, { status: 400 });
    }

    try {
        const { status, body } = await fetchAgentJson({
            appId,
            path: `/agent/conversations/${encodeURIComponent(appId)}/${encodeURIComponent(conversationId)}`,
            query: {
                ...(limitParam !== undefined ? { limit: limitParam } : {}),
                ...(beforeParam !== undefined ? { before: beforeParam } : {}),
            },
        });
        return NextResponse.json(body, { status });
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        logger.error('agent.conversations.get.error', { appId, conversationId }, { error: error as Error });
        return NextResponse.json(
            { error: 'Failed to fetch conversation' },
            { status: 502 }
        );
    }
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter debug-console typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm --filter debug-console lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add debug-console/src/app/api/agent/conversations/[appId]/[conversationId]/route.ts
git commit -m "$(cat <<'EOF'
feat(debug-console): forward limit/before to agent conversation route

Lets the AIAgentPanel paginate conversations through the existing
proxy. Validates limit (digits) and before (id-shape) at the proxy
boundary so we don't pass arbitrary user input upstream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add "Load Older" UI to `AIAgentPanel`

**Files:**
- Modify: `debug-console/src/components/AIAgentPanel.tsx`

- [ ] **Step 1: Update the `DetailResponse` and detail state to track pagination**

Open `debug-console/src/components/AIAgentPanel.tsx`. Find the `DetailResponse` interface near line 44 and replace with:

```ts
interface DetailPagination {
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
}

interface DetailResponse {
    conversation: ConversationSummary;
    messages: ConversationMessage[];
    pagination: DetailPagination;
}
```

Add a new constant near `LIST_LIMIT` (around line 77):

```ts
const DETAIL_PAGE_SIZE = 50;
```

- [ ] **Step 2: Replace `loadDetail` with paginated version**

Find the `loadDetail` callback near line 270 and replace it with:

```ts
    const loadDetail = useCallback(async function loadDetail() {
        if (!globalAppId || !selectedId) return;
        const runId = ++detailRunIdRef.current;
        setDetailLoading(true);
        setDetailError(null);
        try {
            const res = await fetch(
                `/api/agent/conversations/${encodeURIComponent(globalAppId)}/${encodeURIComponent(selectedId)}?limit=${DETAIL_PAGE_SIZE}`,
                { credentials: 'include', cache: 'no-store' }
            );
            const data = await res.json().catch(function safe() { return null; });
            if (detailRunIdRef.current !== runId) return;
            if (!res.ok) {
                throw new Error((data && (data.error as string)) || `HTTP ${res.status}`);
            }
            setDetail((data || {}) as DetailResponse);
        } catch (err) {
            if (detailRunIdRef.current !== runId) return;
            setDetailError(err instanceof Error ? err.message : String(err));
            setDetail(null);
        } finally {
            if (detailRunIdRef.current === runId) {
                setDetailLoading(false);
            }
        }
    }, [globalAppId, selectedId]);

    const loadOlderDetail = useCallback(async function loadOlderDetail() {
        if (!globalAppId || !selectedId || !detail || !detail.pagination.hasMore || !detail.pagination.nextCursor) return;
        const runId = ++detailRunIdRef.current;
        const cursor = detail.pagination.nextCursor;
        setDetailLoading(true);
        setDetailError(null);
        try {
            const res = await fetch(
                `/api/agent/conversations/${encodeURIComponent(globalAppId)}/${encodeURIComponent(selectedId)}?limit=${DETAIL_PAGE_SIZE}&before=${encodeURIComponent(cursor)}`,
                { credentials: 'include', cache: 'no-store' }
            );
            const data = await res.json().catch(function safe() { return null; });
            if (detailRunIdRef.current !== runId) return;
            if (!res.ok) {
                throw new Error((data && (data.error as string)) || `HTTP ${res.status}`);
            }
            const next = (data || {}) as DetailResponse;
            setDetail(function merge(prev) {
                if (!prev) return next;
                return {
                    conversation: next.conversation,
                    messages: [...next.messages, ...prev.messages],
                    pagination: next.pagination,
                };
            });
        } catch (err) {
            if (detailRunIdRef.current !== runId) return;
            setDetailError(err instanceof Error ? err.message : String(err));
        } finally {
            if (detailRunIdRef.current === runId) {
                setDetailLoading(false);
            }
        }
    }, [globalAppId, selectedId, detail]);
```

- [ ] **Step 3: Pass `loadOlderDetail` to `ConversationDetail` and render the button**

Find the `ConversationDetail` invocation near line 494 and update the prop list:

```tsx
                    {!listError && selectedId !== null && (
                        <ConversationDetail
                            summary={conversations?.find((c) => c.id === selectedId) ?? null}
                            detail={detail}
                            error={detailError}
                            loading={detailLoading}
                            onRender={loadDetail}
                            onLoadOlder={loadOlderDetail}
                        />
                    )}
```

Find the `ConversationDetail` component (function declaration around line 783). Update its prop type to include `onLoadOlder`:

```ts
function ConversationDetail({
    summary,
    detail,
    error,
    loading,
    onRender,
    onLoadOlder,
}: {
    summary: ConversationSummary | null;
    detail: DetailResponse | null;
    error: string | null;
    loading: boolean;
    onRender: () => void;
    onLoadOlder: () => void;
}) {
```

Inside `ConversationDetail`, update the messages-count display so it reads from `detail.pagination.total` when loaded. Find the `messageCount` derivation around line 803:

```ts
    const messages = detail?.messages ?? null;
    const totalMessages = detail?.pagination?.total ?? null;
    const loadedCount = messages !== null ? messages.length : null;
    const displayCount = totalMessages !== null
        ? `${loadedCount}/${totalMessages}`
        : (typeof summary?.messageCount === 'number' ? `${summary.messageCount}` : null);
    const userCount = messages?.filter((m) => m.sender === 'user').length ?? null;
    const agentCount = messages !== null && userCount !== null ? messages.length - userCount : null;
```

Update the `Messages:` row near line 841 to use `displayCount`:

```tsx
                            <span style={metadataKeyStyle}>Messages:</span>
                            <span>
                                {displayCount === null
                                    ? '—'
                                    : userCount !== null && agentCount !== null
                                        ? `${displayCount} (${userCount} user, ${agentCount} agent)`
                                        : displayCount}
                            </span>
```

Insert the "Load older" button just before the message list block (`{detail && messages && (` near line 860):

```tsx
            {detail && detail.pagination.hasMore && (
                <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'center' }}>
                    <button
                        type="button"
                        onClick={onLoadOlder}
                        disabled={loading}
                        style={{
                            ...secondaryButtonStyle,
                            opacity: loading ? 0.6 : 1,
                            cursor: loading ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {loading ? 'Loading older messages…' : 'Load older messages'}
                    </button>
                </div>
            )}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter debug-console typecheck`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `pnpm --filter debug-console lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add debug-console/src/components/AIAgentPanel.tsx
git commit -m "$(cat <<'EOF'
feat(debug-console): paginate the Agent tab Show flow

Initial render fetches the most recent 50 messages and shows a "Load
older messages" button when more exist. Older pages are prepended via
the nextCursor returned by the agents endpoint. Header now reads
"Messages: N/total" once a page has loaded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Port Markdown Formatter to Debug-Console

**Files:**
- Add: `debug-console/src/lib/conversation-markdown.ts`
- Add: `debug-console/src/lib/__tests__/conversation-markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `debug-console/src/lib/__tests__/conversation-markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    formatExportHeader,
    formatExportFooter,
    formatConversationMarkdown,
    type Conversation,
    type ConversationMessage,
} from '../conversation-markdown';

const conversation: Conversation = {
    id: 'conv-1',
    appId: 'test-app',
    agentId: 'develop',
    title: 'Login bug',
    createdAt: '2026-03-09T10:00:00.000Z',
    updatedAt: '2026-03-09T10:05:00.000Z',
};

const messages: ConversationMessage[] = [
    {
        id: 'msg-1',
        conversationId: 'conv-1',
        sender: 'user',
        content: 'Hello',
        createdAt: '2026-03-09T10:00:00.000Z',
    },
    {
        id: 'msg-2',
        conversationId: 'conv-1',
        sender: 'agent',
        content: 'Hi there!',
        createdAt: '2026-03-09T10:01:00.000Z',
        toolCalls: [
            { id: 'tc-1', toolName: 'readFile', toolArgs: { path: '/index.html' }, toolResult: '<html/>', status: 'success', durationMs: 100 },
        ],
    },
];

describe('formatExportHeader', () => {
    it('includes app id and exported date', () => {
        const out = formatExportHeader('test-app');
        expect(out).toContain('# App Conversations: test-app');
        expect(out).toMatch(/Exported: \d{4}-\d{2}-\d{2}/);
    });
});

describe('formatExportFooter', () => {
    it('returns the trailing separator', () => {
        expect(formatExportFooter()).toContain('---');
    });
});

describe('formatConversationMarkdown', () => {
    it('summary mode renders user, agent, and one-line tool call summary', () => {
        const out = formatConversationMarkdown(conversation, messages, 'summary');
        expect(out).toContain('## develop — Login bug');
        expect(out).toContain('Hello');
        expect(out).toContain('Hi there!');
        expect(out).toContain('readFile');
        expect(out).not.toContain('<details>');
    });

    it('full mode expands tool calls', () => {
        const out = formatConversationMarkdown(conversation, messages, 'full');
        expect(out).toContain('<details>');
        expect(out).toContain('readFile');
        expect(out).toContain('/index.html');
    });

    it('handles legacy snake_case tool calls', () => {
        const legacy: ConversationMessage[] = [
            {
                id: 'msg-3',
                conversationId: 'conv-1',
                sender: 'agent',
                content: 'Done',
                createdAt: '2026-03-09T10:02:00.000Z',
                toolCalls: [
                    { id: 'tc-2', name: 'writeFile', input: { path: '/a.txt' }, result: 'ok', status: 'completed', duration: 50 },
                ],
            },
        ];
        const out = formatConversationMarkdown(conversation, legacy, 'summary');
        expect(out).toContain('writeFile');
    });

    it('renders Untitled when title is missing', () => {
        const noTitle = { ...conversation, title: '' };
        const out = formatConversationMarkdown(noTitle, [], 'summary');
        expect(out).toContain('## develop — Untitled');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter debug-console test conversation-markdown`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the formatter module**

Create `debug-console/src/lib/conversation-markdown.ts` with the ported logic:

```ts
/**
 * Per-conversation and per-app markdown formatter for the debug-console
 * Agent Text export. Ported from the deleted
 * agents/src/services/conversation-exporter.ts so the formatter has
 * exactly one home and the agents service no longer needs to render
 * markdown.
 *
 * Types match the JSON shape returned by GET /agent/conversations/:appId
 * and GET /agent/conversations/:appId/:conversationId — ISO date strings,
 * camelCase fields. We accept legacy snake_case tool-call fields as a
 * last-resort migration shim.
 */

export type ExportDetail = 'summary' | 'full';

export interface Conversation {
    id: string;
    appId: string;
    agentId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

export interface ToolCall {
    id?: string;
    toolName?: string;
    name?: string;
    tool_name?: string;
    toolArgs?: unknown;
    tool_args?: unknown;
    input?: unknown;
    toolResult?: unknown;
    tool_result?: unknown;
    result?: unknown;
    durationMs?: number;
    duration_ms?: number;
    duration?: number;
    status?: string;
    error?: string;
}

export interface ConversationMessage {
    id: string;
    conversationId: string;
    sender: 'user' | 'agent' | string;
    content?: string;
    messageType?: string | null;
    toolCalls?: ToolCall[];
    createdAt: string;
}

interface NormalizedToolCall {
    id?: string;
    toolName: string;
    toolArgs: unknown;
    toolResult: unknown;
    durationMs: number | undefined;
    status: string;
    error: string | undefined;
}

function normalizeToolCall(tc: ToolCall): NormalizedToolCall {
    return {
        id: tc.id,
        toolName: tc.toolName ?? tc.tool_name ?? tc.name ?? 'unknown',
        toolArgs: tc.toolArgs ?? tc.tool_args ?? tc.input,
        toolResult: tc.toolResult ?? tc.tool_result ?? tc.result,
        durationMs: tc.durationMs ?? tc.duration_ms ?? tc.duration,
        status: tc.status === 'completed' ? 'success' : (tc.status ?? 'unknown'),
        error: tc.error,
    };
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function formatToolCallSummary(tc: ToolCall): string {
    const n = normalizeToolCall(tc);
    const status = n.status === 'success' ? '✓' : n.status === 'error' ? '✗' : '·';
    const duration = typeof n.durationMs === 'number' ? ` (${n.durationMs}ms)` : '';
    return `> **${n.toolName}** ${status}${duration}`;
}

function formatToolCallFull(tc: ToolCall): string {
    const n = normalizeToolCall(tc);
    const lines: string[] = [];
    lines.push(`<details><summary><strong>${n.toolName}</strong> [${n.status}]</summary>`);
    lines.push('');
    if (n.toolArgs !== undefined) {
        lines.push('Arguments:');
        lines.push('```json');
        lines.push(safeStringify(n.toolArgs));
        lines.push('```');
    }
    if (n.toolResult !== undefined) {
        lines.push('Result:');
        lines.push('```');
        lines.push(typeof n.toolResult === 'string' ? n.toolResult : safeStringify(n.toolResult));
        lines.push('```');
    }
    if (n.error) {
        lines.push(`Error: ${n.error}`);
    }
    if (typeof n.durationMs === 'number') {
        lines.push(`Duration: ${n.durationMs}ms`);
    }
    lines.push('');
    lines.push('</details>');
    return lines.join('\n');
}

export function formatExportHeader(appId: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `# App Conversations: ${appId}\n\nExported: ${date}\n\n`;
}

export function formatExportFooter(): string {
    return '---\n';
}

export function formatConversationMarkdown(
    conversation: Conversation,
    messages: ConversationMessage[],
    detail: ExportDetail,
): string {
    const lines: string[] = [];
    lines.push('---');
    lines.push('');
    const title = conversation.title || 'Untitled';
    lines.push(`## ${conversation.agentId} — ${title}`);
    lines.push('');
    lines.push(`Created: ${conversation.createdAt}`);
    lines.push('');

    const visible = detail === 'summary'
        ? messages.filter((m) => !m.messageType)
        : messages;

    for (const message of visible) {
        const time = message.createdAt.split('T')[1]?.split('.')[0] ?? '';
        const role = message.sender === 'user' ? 'User' : 'Agent';
        lines.push(`**${role}** (${time}):`);
        if (message.content) {
            lines.push(message.content);
        }
        if (message.toolCalls && message.toolCalls.length > 0) {
            lines.push('');
            for (const tc of message.toolCalls) {
                lines.push(detail === 'summary' ? formatToolCallSummary(tc) : formatToolCallFull(tc));
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter debug-console test conversation-markdown`
Expected: All four tests PASS.

- [ ] **Step 5: Commit**

```bash
git add debug-console/src/lib/conversation-markdown.ts debug-console/src/lib/__tests__/conversation-markdown.test.ts
git commit -m "$(cat <<'EOF'
feat(debug-console): port markdown conversation formatter

Adds conversation-markdown.ts with header/footer/per-conversation
formatters, ported from the agents service. Accepts both camelCase
and legacy snake_case tool-call shapes. Agents-side formatter and
its export endpoints will be deleted in a follow-up commit once the
debug-console export route is wired to use this.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Unify Debug-Console Export Route Around Paginated Pipeline

**Files:**
- Modify: `debug-console/src/app/api/agent/conversations-export/[appId]/route.ts`

- [ ] **Step 1: Replace the route file**

Open `debug-console/src/app/api/agent/conversations-export/[appId]/route.ts` and replace its contents with:

```ts
/**
 * Conversations export endpoints for an app.
 *
 *   ?format=markdown - paginates /agent/conversations/:appId then for each
 *                       conversation pages messages via /agent/conversations/:appId/:cid?limit=…&before=…
 *                       and writes the markdown body straight to the response.
 *   ?format=json     - same pagination, but writes one JSON file per conversation
 *                       into a streaming zip archive plus a manifest.json.
 *
 * Both formats are streamed: agents service never holds an entire app in
 * memory, and debug-console buffers at most one conversation's messages
 * at a time before writing.
 */

import archiver from 'archiver';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';

import { fetchAgentJson } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import {
    formatConversationMarkdown,
    formatExportFooter,
    formatExportHeader,
    type Conversation,
    type ConversationMessage,
    type ExportDetail,
} from '@/lib/conversation-markdown';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter, { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const LIST_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 200;
const PAGE_FETCH_TIMEOUT_MS = 30_000;

interface ListPage {
    conversations: Conversation[];
    pagination?: { total?: number; hasMore?: boolean; offset?: number; limit?: number };
}

interface DetailPage {
    conversation: Conversation;
    messages: ConversationMessage[];
    pagination: { total: number; hasMore: boolean; nextCursor: string | null };
}

function timestampSlug(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function safeFilename(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function fetchListPage(appId: string, limit: number, offset: number, signal: AbortSignal): Promise<ListPage> {
    const { status, body } = await fetchAgentJson({
        appId,
        path: `/agent/conversations/${encodeURIComponent(appId)}`,
        query: { limit: String(limit), offset: String(offset) },
        timeoutMs: PAGE_FETCH_TIMEOUT_MS,
        signal,
    });
    if (status !== 200 || !body || typeof body !== 'object') {
        throw new Error(`Conversation list failed (HTTP ${status})`);
    }
    return body as ListPage;
}

async function fetchDetailPage(
    appId: string,
    conversationId: string,
    cursor: string | undefined,
    signal: AbortSignal,
): Promise<DetailPage> {
    const { status, body } = await fetchAgentJson({
        appId,
        path: `/agent/conversations/${encodeURIComponent(appId)}/${encodeURIComponent(conversationId)}`,
        query: {
            limit: String(MESSAGE_PAGE_SIZE),
            ...(cursor ? { before: cursor } : {}),
        },
        timeoutMs: PAGE_FETCH_TIMEOUT_MS,
        signal,
    });
    if (status !== 200 || !body || typeof body !== 'object') {
        throw new Error(`Conversation detail failed (HTTP ${status})`);
    }
    return body as DetailPage;
}

async function collectAllMessages(
    appId: string,
    conversationId: string,
    signal: AbortSignal,
): Promise<ConversationMessage[]> {
    const all: ConversationMessage[] = [];
    let cursor: string | undefined;
    do {
        if (signal.aborted) return all;
        const page = await fetchDetailPage(appId, conversationId, cursor, signal);
        // The endpoint returns the page in chronological order; older pages
        // arrive on subsequent calls via `before=cursor`. We unshift each
        // older page in front so the final array is overall chronological.
        if (cursor === undefined) {
            all.push(...page.messages);
        } else {
            all.unshift(...page.messages);
        }
        cursor = page.pagination.hasMore && page.pagination.nextCursor ? page.pagination.nextCursor : undefined;
    } while (cursor && !signal.aborted);
    return all;
}

interface JsonSink {
    kind: 'json';
    archive: archiver.Archiver;
    index: Array<{
        id: string;
        agentId: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messageCount: number;
    }>;
}

interface MarkdownSink {
    kind: 'markdown';
    write: (chunk: string) => void;
}

type ExportSink = JsonSink | MarkdownSink;

async function generateExport(
    appId: string,
    detail: ExportDetail,
    signal: AbortSignal,
    sink: ExportSink,
): Promise<void> {
    if (sink.kind === 'markdown') sink.write(formatExportHeader(appId));

    let offset = 0;
    let total: number | undefined;
    while (true) {
        if (signal.aborted) return;
        const page = await fetchListPage(appId, LIST_PAGE_SIZE, offset, signal);
        const list = page.conversations ?? [];
        total = page.pagination?.total ?? total;
        if (list.length === 0) break;

        for (const conversation of list) {
            if (signal.aborted) return;
            const messages = await collectAllMessages(appId, conversation.id, signal);
            if (sink.kind === 'json') {
                sink.archive.append(
                    JSON.stringify({ conversation, messages }, null, 2),
                    { name: `conversations/${safeFilename(conversation.id)}.json` },
                );
                sink.index.push({
                    id: conversation.id,
                    agentId: conversation.agentId,
                    title: conversation.title,
                    createdAt: conversation.createdAt,
                    updatedAt: conversation.updatedAt,
                    messageCount: messages.length,
                });
            } else {
                sink.write(formatConversationMarkdown(conversation, messages, detail));
            }
        }

        if (page.pagination?.hasMore !== true) break;
        offset += list.length;
    }

    if (sink.kind === 'markdown') {
        sink.write(formatExportFooter());
    } else {
        const manifest = {
            appId,
            format: 'json',
            exportedAt: new Date().toISOString(),
            total: total ?? sink.index.length,
            conversations: sink.index,
        };
        sink.archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    }
}

async function streamMarkdown(
    request: NextRequest,
    appId: string,
    detail: ExportDetail,
): Promise<NextResponse> {
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const encoder = new TextEncoder();
            const sink: MarkdownSink = {
                kind: 'markdown',
                write: (chunk) => controller.enqueue(encoder.encode(chunk)),
            };
            const abortController = new AbortController();
            const onAbort = () => abortController.abort();
            if (request.signal.aborted) onAbort();
            else request.signal.addEventListener('abort', onAbort, { once: true });
            try {
                await generateExport(appId, detail, abortController.signal, sink);
                controller.close();
            } catch (error) {
                if (abortController.signal.aborted) {
                    controller.close();
                    return;
                }
                logger.error('agent.export.markdown.error', { appId }, { error: error as Error });
                try {
                    controller.enqueue(encoder.encode(`\n<!-- export error: ${error instanceof Error ? error.message : String(error)} -->\n`));
                } catch { /* controller already closed */ }
                controller.close();
            } finally {
                request.signal.removeEventListener('abort', onAbort);
            }
        },
    });

    const filename = `conversations-${safeFilename(appId)}-${timestampSlug()}.md`;
    logger.info('agent.export.markdown.stream.begin', { appId, detail });
    return new NextResponse(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

async function streamJsonZip(
    request: NextRequest,
    appId: string,
    detail: ExportDetail,
): Promise<NextResponse> {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const abortController = new AbortController();
    const onClientAbort = () => {
        logger.info('agent.export.json.client_abort', { appId });
        abortController.abort();
        archive.destroy(new Error('Client disconnected'));
    };
    if (request.signal.aborted) onClientAbort();
    else request.signal.addEventListener('abort', onClientAbort, { once: true });

    archive.on('warning', function onWarning(err) {
        logger.warn('agent.export.archive.warning', { appId, message: err.message });
    });
    archive.on('error', function onError(err) {
        logger.error('agent.export.archive.error', { appId }, { error: err });
    });

    const sink: JsonSink = { kind: 'json', archive, index: [] };

    void (async function generate() {
        try {
            await generateExport(appId, detail, abortController.signal, sink);
            await archive.finalize();
        } catch (error) {
            if (abortController.signal.aborted) return;
            logger.error('agent.export.json.error', { appId }, { error: error as Error });
            archive.append(error instanceof Error ? error.message : String(error), { name: 'error.txt' });
            try {
                await archive.finalize();
            } catch (finalizeError) {
                logger.error('agent.export.finalize.destroy', { appId }, { error: finalizeError as Error });
                archive.destroy(finalizeError as Error);
            }
        }
    })();

    const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
    const filename = `conversations-${safeFilename(appId)}-${timestampSlug()}.zip`;
    logger.info('agent.export.json.stream.begin', { appId, detail });
    return new NextResponse(webStream, {
        status: 200,
        headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

export const GET = withAuth<{ appId: string }>(async function exportConversations(request: NextRequest, _auth, context) {
    const { appId } = await context.params;
    if (!APP_ID_RE.test(appId)) {
        return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }

    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'json';
    if (format !== 'json' && format !== 'markdown') {
        return NextResponse.json({ error: 'format must be "json" or "markdown"' }, { status: 400 });
    }

    const detailParam = url.searchParams.get('detail');
    const detail: ExportDetail = detailParam === 'summary' ? 'summary' : 'full';

    // Resolve the agent_url before committing 200 + streaming headers so
    // missing agent allocations surface as a real 404.
    try {
        await mgmtControlPlaneAdapter.getAgentUrl(appId);
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        logger.error('agent.export.resolve.error', { appId }, { error: error as Error });
        return NextResponse.json({ error: 'Failed to resolve agent for app' }, { status: 502 });
    }

    if (format === 'markdown') return streamMarkdown(request, appId, detail);
    return streamJsonZip(request, appId, detail);
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter debug-console typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm --filter debug-console lint`
Expected: PASS.

- [ ] **Step 4: Run debug-console test suite**

Run: `pnpm --filter debug-console test`
Expected: PASS (existing tests + the conversation-markdown tests added in Task 5).

- [ ] **Step 5: Commit**

```bash
git add debug-console/src/app/api/agent/conversations-export/[appId]/route.ts
git commit -m "$(cat <<'EOF'
refactor(debug-console): unify json+markdown export through paginated pipeline

Both download formats now share one generator that lists conversations
50-at-a-time and pages each conversation's messages 200-at-a-time
through the agents single-conversation endpoint. Markdown writes
straight to a streaming response; json appends one zip entry per
conversation. Removes the JOMAX-token pass-through (markdown no longer
proxies an agents-side endpoint) and the bulk-fetch helper. Memory
ceiling on agents is now one paginated query; debug-console buffers
one conversation at a time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Rewrite `agents/scripts/export-chat.ts` as HTTP Client

**Files:**
- Modify: `agents/scripts/export-chat.ts`

- [ ] **Step 1: Replace the script**

Open `agents/scripts/export-chat.ts` and replace its contents with:

```ts
/**
 * Conversation Export CLI
 *
 * Streams the markdown export of an app's conversations from the prod
 * debug-console (https://console.airo-builder.godaddy.com). Operators
 * authenticate with a JOMAX token; the debug-console boundary handles
 * JOMAX, the agents service sees only its normal internal-service auth.
 *
 * For the dev environment, edit BASE_URL to
 *   https://console.airo-builder.test-godaddy.com
 *
 * Usage:
 *   JOMAX_TOKEN=<token> pnpm tsx scripts/export-chat.ts <appId> [--detail=summary|full]
 *   pnpm tsx scripts/export-chat.ts <appId> --token=<token> [--detail=summary|full]
 *
 * Output is written to stdout. Pipe to a file:
 *   ... | tee conversations.md
 */

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE_URL = 'https://console.airo-builder.godaddy.com';

const args = process.argv.slice(2);
const appId = args.find((a) => !a.startsWith('--'));
const detailArg = args.find((a) => a.startsWith('--detail='));
const tokenArg = args.find((a) => a.startsWith('--token='));

if (!appId) {
  console.error('Usage: pnpm tsx scripts/export-chat.ts <appId> [--detail=summary|full] [--token=<jomax>]');
  process.exit(1);
}

const detail = (detailArg?.split('=')[1] as 'summary' | 'full' | undefined) ?? 'full';
if (detail !== 'summary' && detail !== 'full') {
  console.error('Error: --detail must be "summary" or "full"');
  process.exit(1);
}

const token = tokenArg?.split('=')[1] ?? process.env.JOMAX_TOKEN;
if (!token) {
  console.error('Error: provide a JOMAX token via JOMAX_TOKEN env or --token=<value>');
  process.exit(1);
}

const url = `${BASE_URL}/api/agent/conversations-export/${encodeURIComponent(appId)}?format=markdown&detail=${detail}`;

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!response.ok) {
  const text = await response.text().catch(() => '');
  console.error(`Export failed (HTTP ${response.status}): ${text || response.statusText}`);
  process.exit(1);
}

if (!response.body) {
  console.error('Export returned no body');
  process.exit(1);
}

await pipeline(Readable.fromWeb(response.body as any), process.stdout);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS. (`conversation-exporter.ts` still exists but has no importer after this rewrite — Task 8 deletes it.)

- [ ] **Step 3: Commit**

```bash
git add agents/scripts/export-chat.ts
git commit -m "$(cat <<'EOF'
refactor(agents): rewrite export-chat CLI as HTTP client over debug-console

Previously the CLI opened the local SQLite DB and reused
agents/src/services/conversation-exporter.ts. It now hits the prod
debug-console URL with a JOMAX token, so the markdown formatter only
needs to live in one place. Operators who relied on the local-SQLite
mode should switch to scripts/debug-conversation-history.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Delete Unused Agents Endpoints, Tests, and Formatter

**Files:**
- Modify: `agents/src/server/routes/conversations.ts` — remove the export handler.
- Modify: `agents/src/server/routes/diagnostics.ts` — remove the export handler.
- Delete: `agents/src/server/routes/__tests__/conversations-export.test.ts`.
- Delete: `agents/src/services/conversation-exporter.ts`.
- Delete (if exists): any `agents/src/services/__tests__/conversation-exporter.test.ts` sibling test.

- [ ] **Step 1: Remove the `/api/conversations/export` handler**

In `agents/src/server/routes/conversations.ts`, delete lines 72-113 (the entire JSDoc comment and `router.get('/api/conversations/export', …)` block). Also remove the now-unused imports — at the top of the file, delete:

```ts
import { exportConversations } from '../../services/conversation-exporter.js';
import type { ExportDetail } from '../../services/conversation-exporter.js';
```

- [ ] **Step 2: Remove the `/diagnostics/conversations/export` handler**

In `agents/src/server/routes/diagnostics.ts`, delete lines 247-303 (the JSDoc comment plus the `router.get('/conversations/export', …)` block). Remove any imports that become unused as a result — typically:

```ts
import { exportConversations, type ExportDetail } from '../../services/conversation-exporter.js';
```

(Keep `lifecycle`, `messages`, `workspaceScopeFromAppId`, `authenticateJomaxToken` — they're used by other handlers in the same file.)

- [ ] **Step 3: Delete the export test file and the formatter**

Run:

```bash
rm agents/src/server/routes/__tests__/conversations-export.test.ts
rm agents/src/services/conversation-exporter.ts
ls agents/src/services/__tests__/conversation-exporter.test.ts 2>/dev/null && rm agents/src/services/__tests__/conversation-exporter.test.ts || true
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS — no remaining importer of `conversation-exporter.js` after Tasks 7 and 8.

- [ ] **Step 5: Run the agents test suite**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS. The deleted test files are no longer present; remaining tests should be unaffected.

- [ ] **Step 6: Lint**

Run: `pnpm --filter @airo/agents lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agents/src/server/routes/conversations.ts agents/src/server/routes/diagnostics.ts
git rm agents/src/server/routes/__tests__/conversations-export.test.ts agents/src/services/conversation-exporter.ts
git rm agents/src/services/__tests__/conversation-exporter.test.ts 2>/dev/null || true
git commit -m "$(cat <<'EOF'
refactor(agents): remove unused conversation export endpoints

Deletes /api/conversations/export, /diagnostics/conversations/export,
and the conversation-exporter service. After the export pipeline
moved into debug-console (and the export-chat CLI moved to HTTP),
agents has zero consumers of the markdown formatter. The bulk
endpoint /agent/conversations/:appId/messages stays in place for
now — removal is a separate cleanup once we confirm no out-of-tree
caller depends on it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Full repo typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Full repo lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Full agents tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS.

- [ ] **Step 4: Full debug-console tests**

Run: `pnpm --filter debug-console test`
Expected: PASS.

- [ ] **Step 5: Full repo build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Start the local stack:

```bash
pnpm run dev
```

In a browser:

1. Open the debug-console at `https://dev-console.airo-builder.godaddy.com/`.
2. Navigate to a known app's `Conversations → Agent` tab.
3. Click `Show` on a conversation. Verify it loads the most recent 50 messages and that the header reads `Messages: 50/<total>`.
4. If `<total>` > 50, confirm a `Load older messages` button appears at the top of the message list. Click it; verify older messages prepend and the count updates.
5. Click `Raw` (download). Confirm a zip downloads and contains one `conversations/<id>.json` per conversation plus `manifest.json`. Open one of the JSON files and confirm `messages` is an array.
6. Click `Text` (download). Confirm a markdown file downloads, opens cleanly, and contains one `## …` heading per conversation followed by user/agent message bodies.
7. (If you have a JOMAX token for the prod debug-console:) `JOMAX_TOKEN=<token> pnpm tsx agents/scripts/export-chat.ts <appId>` against an app on the prod console — confirm the same markdown content streams to stdout.
