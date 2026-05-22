# Agent Conversation Pagination & Streaming

## Problem

The debug-console Agent tab cannot view, JSON-download, or markdown-download conversations that have grown very large. The triggering case today is a single conversation with ~7.6K messages, which causes:

- **Show** — agents loads the entire conversation into memory and serializes it into a multi-MB JSON response. Panel either fails to render or freezes; agents process is at risk of OOM under the dev `--max-old-space-size=384` cap.
- **Raw** (JSON zip) — agents bulk-fetches messages for 50 conversations at a time into memory; on a 7K-message conversation this OOMs the agents process before the export can produce anything.
- **Text** (markdown) — agents loads every message of every conversation, then constructs the markdown string in memory. Same OOM.

The shared root cause is three agents-side endpoints that assume "all messages for a conversation" or "all messages for an app" fit in memory at once:

| Endpoint | Buffer | Used by |
|---|---|---|
| `GET /agent/conversations/:appId/:conversationId` | full conversation (`getMessages(cid)`) | debug-console Show |
| `GET /agent/conversations/:appId/messages?conversationIds=…` | N conversations (`getMessagesBatch(ids)`) | debug-console Raw export |
| `GET /diagnostics/conversations/export` (JOMAX) | entire app | debug-console Text export |
| `GET /api/conversations/export` (JWT) | entire app | nothing (dead) |
| `agents/scripts/export-chat.ts` (CLI) | entire app | local debugging |

The customer-app endpoint `GET /api/conversations/:id/messages/paginated` already paginates correctly via `getMessagesPaginated()`. We extend that pattern to the debug-console-facing single-conversation route, then move both download formats (JSON and markdown) into debug-console where they share one paginated pipeline.

`app/` calls none of the three at-risk endpoints. They are debug-console-only paths (or dead).

## Goals

- Debug-console Agent tab can open and browse any conversation regardless of message count, without OOMing the agents process or freezing the panel.
- Both Raw (JSON zip) and Text (markdown) downloads succeed on the same conversations, with bounded memory on agents and on debug-console.
- Single source of truth for the markdown formatter — it lives in debug-console only, no duplication.
- The export-chat CLI keeps working for support/debugging usage.
- No regression for the unchanged single-conversation GET when called without pagination params.

## Non-goals

- New endpoint variants. We extend or delete; we do not introduce parallel `*/paginated` siblings.
- Search / filter / jump-to-message UX in the panel.
- Frontend virtualization. 50–500 messages renders fine. If it doesn't, follow-up.
- Touching `/api/conversations/:id/messages/paginated`. Already paginated.
- Removing `GET /agent/conversations/:appId/messages` (bulk). Stop using it from the export, leave the endpoint in place; deletion is a separate cleanup PR.

## Design

### Path 1 — Show (single conversation detail)

**Agents service.** Extend `GET /agent/conversations/:appId/:conversationId` (`agents/src/server/routes/chat.ts`):

- Accept optional `limit` and `before` query params.
- When **either** is present, route through `messages.getMessagesPaginated(conversationId, appId, { limit, before })` and return:

  ```json
  {
    "conversation": { ... },
    "messages": [...],
    "pagination": { "total": 7600, "limit": 50, "hasMore": true, "nextCursor": "<oldestMessageId>" }
  }
  ```

- When **neither** is present, preserve the current full-load response shape `{ conversation, messages }`. Backwards compat for the export-chat CLI's eventual fallback path and any future direct caller.
- The existing `validateConversationOwnership('conversationId')` middleware runs first; pagination params evaluate only after ownership passes.

**Repository tweak.** `getMessagesPaginated` in `ConversationRepository` currently clamps `limit` at 100. Raise to 200: `Math.min(options.limit ?? 20, 200)`. The default of 20 stays. Only the export path bumps to 200.

**Debug-console proxy.** `debug-console/src/app/api/agent/conversations/[appId]/[conversationId]/route.ts`: read `limit` and `before` from `request.url.searchParams`, forward via `fetchAgentJson({ query })`. One-line change.

**Debug-console UI.** `debug-console/src/components/AIAgentPanel.tsx`:

- Initial fetch: `?limit=50` (no cursor). Render messages chronologically (the API returns oldest→newest within the page).
- Render a "Load older messages" button at the top of the message list when `pagination.hasMore`. On click, fetch with `before=<oldestId>` and **prepend** the result.
- Show `Loaded N of <total>` next to the existing per-conversation header.
- The existing `detailRunIdRef` discard pattern extends naturally — each "Load older" click bumps the run id and discards stale responses.

**Cursor semantics.** `getMessagesPaginated` orders by `cm.rowid DESC` then reverses to chronological for the page. `nextCursor` is the oldest message id of the page; passing it as `before=` returns the page just older than that. Standard chat-history "scroll up to load older" UX.

### Path 2 — Raw (JSON zip), Path 3 — Text (markdown)

Both downloads converge on a single client-side pipeline in debug-console.

**Move the markdown formatter to debug-console.** Create `debug-console/src/lib/conversation-markdown.ts` with:

- `formatHeader(appId: string): string`
- `formatConversation(conversation, messages, detail): string` — per-conversation markdown
- `formatFooter(): string`

Port the logic from `agents/src/services/conversation-exporter.ts` (≈80 LOC, self-contained tool-call summary/full helpers). Define minimal `Conversation` and `ConversationMessage` interfaces locally that match the JSON shape returned by `/agent/conversations/:appId/:conversationId`. Do not introduce a shared package.

**Unify the export route.** `debug-console/src/app/api/agent/conversations-export/[appId]/route.ts`:

- Delete `streamMarkdownDirect` and `fetchMessagesBatch`.
- Replace `generateJsonZip` with `generateExport(format, sink)` where:
  - `format='json'` → archiver zip; one `conversations/<id>.json` entry per conversation, plus `manifest.json`.
  - `format='markdown'` → `text/markdown` stream; header → per-conversation markdown → footer.
  - `sink` writes via `archive.append(...)` or `res.write(...)` accordingly.

Pseudocode for the unified body:

```ts
async function generateExport(
  appId: string,
  format: 'json' | 'markdown',
  detail: 'summary' | 'full',
  signal: AbortSignal,
  sink: ExportSink, // wraps either archiver or HTTP stream
) {
  if (format === 'markdown') sink.write(formatHeader(appId));

  let offset = 0;
  while (!signal.aborted) {
    const page = await fetchListPage(appId, LIST_PAGE_SIZE, offset, signal);
    if (page.conversations.length === 0) break;

    for (const conv of page.conversations) {
      if (signal.aborted) return;
      const messages = await collectAllMessages(appId, conv.id, signal);
      if (format === 'json') {
        sink.appendFile(`conversations/${safeId(conv.id)}.json`, JSON.stringify({ conversation: conv, messages }, null, 2));
      } else {
        sink.write(formatConversation(conv, messages, detail));
      }
    }

    if (!page.pagination?.hasMore) break;
    offset += page.conversations.length;
  }

  if (format === 'markdown') sink.write(formatFooter());
}

async function collectAllMessages(appId: string, conversationId: string, signal: AbortSignal) {
  const messages: ConversationMessage[] = [];
  let cursor: string | undefined;
  do {
    const { body } = await fetchAgentJson({
      appId,
      path: `/agent/conversations/${encodeURIComponent(appId)}/${encodeURIComponent(conversationId)}`,
      query: { limit: '200', ...(cursor ? { before: cursor } : {}) },
      signal,
    });
    messages.push(...body.messages);
    cursor = body.pagination?.hasMore ? body.pagination.nextCursor : undefined;
  } while (cursor && !signal.aborted);
  return messages;
}
```

For `format='json'` we still buffer one full conversation in debug-console memory before writing the zip entry, because the JSON is `JSON.stringify`ed in one shot. For the 7K-message outlier this is ~tens of MB — well within the Next.js process budget on `console.airo-builder.godaddy.com`. NDJSON-streamed entries are a follow-up.

For `format='markdown'` we write each conversation to the response as soon as it's collected. Memory ceiling is one conversation's messages.

**Delete the agents-side export endpoints.**
- Delete `GET /diagnostics/conversations/export` and its handler in `agents/src/server/routes/diagnostics.ts`. Its only consumer (debug-console) pivots to client-side markdown.
- Delete `GET /api/conversations/export` and its handler in `agents/src/server/routes/conversations.ts`. No callers.
- Delete `agents/src/server/routes/__tests__/conversations-export.test.ts`.

**Refactor the export-chat CLI to call debug-console.** `agents/scripts/export-chat.ts` becomes a thin HTTP client over the prod debug-console markdown export URL:

```
pnpm tsx agents/scripts/export-chat.ts <appId> [--detail=summary|full]
```

Implementation:
- Hardcode the base URL to `https://console.airo-builder.godaddy.com` (the dev environment is `https://console.airo-builder.test-godaddy.com`; not exposed via flag — operators who need dev edit the script).
- Read `JOMAX_TOKEN` from env (or `--token <value>`).
- `fetch(`${BASE}/api/agent/conversations-export/${appId}?format=markdown&detail=${detail}`, { headers: { Authorization: `Bearer ${token}` } })`.
- Pipe the response body to stdout.

This change means:
- The CLI now operates on **production** data via the debug-console proxy, instead of opening a local SQLite file. Anyone using the CLI for local-DB-only debugging loses that capability — but local debugging has stronger primitives (`scripts/debug-conversation-history.ts`, `scripts/view-summaries.ts`) that already work directly against SQLite.
- JOMAX validation is once, at the debug-console boundary, where `withAuth` already does it. The agents service sees a normal internal-service auth flow via `fetchAgentJson` — never touches JOMAX.

**Delete `agents/src/services/conversation-exporter.ts`** along with its tests. No more agents-side consumers after this refactor.

### Endpoint surface change summary

| Endpoint | Action |
|---|---|
| `GET /agent/conversations/:appId/:conversationId` | Extended (optional `limit`/`before`). |
| `GET /agent/conversations/:appId` | Unchanged. |
| `GET /agent/conversations/:appId/messages` | Unchanged. Stops being called from export, but kept. |
| `GET /api/conversations/:id/messages/paginated` | Unchanged. |
| `GET /api/conversations/export` | **Deleted.** |
| `GET /diagnostics/conversations/export` | **Deleted.** |

### Files touched

**agents/**
- `src/server/routes/chat.ts` — extend single-conv GET with optional pagination.
- `src/server/routes/conversations.ts` — remove `/api/conversations/export` handler.
- `src/server/routes/diagnostics.ts` — remove `/diagnostics/conversations/export` handler.
- `src/server/routes/__tests__/conversations-export.test.ts` — delete.
- `src/services/conversation-exporter.ts` — delete (with any sibling tests).
- `src/database/repositories/ConversationRepository.ts` — clamp 100 → 200 in `getMessagesPaginated`.
- `scripts/export-chat.ts` — rewrite as HTTP client.

**debug-console/**
- `src/lib/conversation-markdown.ts` — new; ported formatter.
- `src/app/api/agent/conversations/[appId]/[conversationId]/route.ts` — forward `limit`/`before`.
- `src/app/api/agent/conversations-export/[appId]/route.ts` — unify json/markdown into single paginated pipeline; remove `streamMarkdownDirect` and `fetchMessagesBatch`; remove JOMAX dependency on this route.
- `src/components/AIAgentPanel.tsx` — pagination state, "Load older" button, loaded/total counter.

## Backwards compatibility

- `/agent/conversations/:appId/:conversationId` without `limit`/`before` → unchanged response shape and behavior.
- `/agent/conversations/:appId/messages` (bulk) → unchanged.
- `/api/conversations/:id/messages/paginated` → unchanged.
- `/api/conversations/export` and `/diagnostics/conversations/export` deletions → **no remaining HTTP callers** anywhere in this repo. The CLI moves to call debug-console.
- `getMessagesPaginated` clamp 100 → 200: callers passing `limit > 100` previously got 100, now get up to 200. No caller currently passes anything above 100 (max 100 per existing query parsing). No regression.
- Markdown export response: format identical (header → per-conversation block → footer). The only observable difference is `Transfer-Encoding: chunked` instead of fixed `Content-Length`. Browser download and `curl -o` are agnostic.

## Testing

**agents/**
- `getMessagesPaginated` clamp boundary: `limit=500 → 200`.
- Single-conv GET pagination branch: with `limit=10`, returns paginated shape including `pagination.hasMore`. Without params, returns legacy shape.
- Delete `conversations-export.test.ts`.

**debug-console/**
- `conversation-markdown.ts` unit tests: summary detail, full detail, empty conversation, no title (mirrors the `exportConversations` test surface that gets deleted from agents).
- Integration test for unified export route on a small fixture (3 conversations × 250 messages, `LIST_PAGE_SIZE=2`, message limit 200): assert markdown response begins with header, ends with footer, contains all three `## …` headings in order; assert json zip contains 3 conversation files plus a `manifest.json`.

**Manual.**
- Open Show on the 7K-message app — agents heap stays under 384 MB; "Load older" works.
- Run Raw download — completes; agents heap stable.
- Run Text download — completes; agents heap stable.
- Run `pnpm tsx agents/scripts/export-chat.ts <appId> --env=dev --detail=full` against a known-good app on `dev-console`; markdown matches the previous CLI output for that app.

## Risks

- **Mid-stream failure for markdown export.** Streaming means a failure halfway through writes a partial markdown file before the response closes. Operator notices via truncation. Pre-existing risk class — JSON zip already streams the same way. No mitigation.
- **Per-conv buffering in JSON zip.** One conversation at a time in debug-console memory. The 7K-message conversation is ~tens of MB; well within Next.js budget. NDJSON streaming is a follow-up if a future conversation exceeds it.
- **export-chat CLI behavior change.** Previously read local SQLite; now hits debug-console URL with JOMAX. Anyone debugging from `agents/data/agents.db` directly via this CLI must switch to one of the existing SQLite-direct scripts (`debug-conversation-history.ts`, etc.). Worth a CHANGELOG line for whoever runs this regularly. Original CLI author: Joshua Eichorn (PR #1978) — flag on the PR.
- **Increased agents request rate during export.** Many small SQL paginated queries instead of one batch. SQLite per-app, no contention. Acceptable.

## Followups (not in this PR)

- Delete `GET /agent/conversations/:appId/messages` and its sole `chat.ts` integration test once we've confirmed no out-of-tree consumer relies on it.
- NDJSON-streamed message entries inside the JSON zip if any single conversation exceeds debug-console's per-conv buffer budget.
- Update the `export-chat.ts` man-page docstring and reference any operator-runbook entries that describe the old SQLite-based usage.
