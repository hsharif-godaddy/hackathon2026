---
status: implemented
---

# Conversation Export Tool

Export app conversations as human-readable markdown at two detail levels.

## Components

### 1. ConversationExporter service (`agents/src/services/conversation-exporter.ts`)

Pure formatting module: takes conversations + messages, returns markdown string.

**Detail levels:**

- `summary` — Clean transcript. User and agent text messages with timestamps. Tool calls collapsed to a single summary line listing tool names and count.
- `full` — Same structure, but each tool call expanded in a `<details>` block showing arguments, result, status, and duration.

### 2. CLI script (`agents/scripts/export-chat.ts`)

```
pnpm tsx scripts/export-chat.ts <appId> [--detail=summary|full]
```

Connects directly to SQLite via `ConversationRepository`. Defaults to `summary`. Outputs to stdout.

### 3. API endpoint

```
GET /api/conversations/export?detail=summary|full
```

Returns `text/markdown` content type. Uses existing app-scoped middleware.

## Markdown Format

### Summary

```markdown
# App Conversations: <appId>

Exported: <date>

---

## <Agent Name> — <Title or "Untitled">

Created: <date>

**User** (<HH:MM:SS>):
<message content>

**Agent** (<HH:MM:SS>):
<text content>

> Tools used: generateCode, editFile (x2)

---
```

### Full

Same as summary, but tool calls expanded:

````markdown
**Agent** (<HH:MM:SS>):
<text content>

<details><summary>Tool: generateCode (success, 1.2s)</summary>

**Arguments:**
\```json
{ ... }
\```

**Result:**
\```json
{ ... }
\```

</details>
````

## Scope

- Exports all conversations for an app, grouped by conversation
- Ordered chronologically within each conversation
- No JSON output format
- No file output flag (pipe stdout as needed)
- No filtering by agent or conversation
