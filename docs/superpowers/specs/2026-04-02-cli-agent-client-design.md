# CLI Agent Client Design

A Go-based TUI client for interacting with the go-agent WebSocket server, designed as a developer debugging tool with pluggable tool renderers.

## Overview

- **Module**: `cli-agent-client/` at repo root (standalone Go module)
- **Framework**: Bubble Tea v2 + Lipgloss v2 (same as dev-runner)
- **Protocol**: Plain WebSocket to go-agent `/ws` endpoint (coder/websocket)
- **Purpose**: Developer tool for testing and debugging agent interactions, with detailed tool call inspection

## Module Structure

```
cli-agent-client/
├── cmd/cli-agent-client/main.go     # Entry point, flag parsing, Bubble Tea init
├── internal/
│   ├── client/
│   │   ├── websocket.go             # WebSocket connection to go-agent /ws
│   │   └── protocol.go             # Client/Server message types (mirrored from go-agent)
│   ├── tui/
│   │   ├── model.go                # Root Bubble Tea model (left/right panes + input)
│   │   ├── update.go               # Message handling, key bindings
│   │   ├── view.go                 # Layout rendering (split panes)
│   │   ├── styles.go               # Lipgloss styling
│   │   ├── chatpane.go             # Left pane: scrollable chat log
│   │   ├── toolpane.go             # Right pane: selected tool detail
│   │   └── input.go                # Bottom: text input area
│   └── renderer/
│       ├── registry.go             # ToolRenderer interface + registry
│       ├── default.go              # Default renderer (JSON pretty-print)
│       ├── file_read.go            # readFile: syntax-highlighted content
│       ├── file_edit.go            # str_replace_based_edit_tool: diff view
│       ├── grep.go                 # grepSearch: match list with context
│       ├── directory.go            # directoryListing: tree view
│       └── todo.go                 # todoList: task list with status indicators
├── go.mod
├── go.sum
└── Makefile
```

## CLI Flags

| Flag                | Default                  | Description                       |
| ------------------- | ------------------------ | --------------------------------- |
| `--url`             | `ws://localhost:4000/ws` | go-agent WebSocket endpoint       |
| `--app-id`          | _(none)_                 | Application ID (for multi-tenant) |
| `--conversation-id` | _(none)_                 | Resume existing conversation      |
| `--agent-id`        | `develop`                | Agent to use                      |

## Tool Renderer Interface

> **Note:** The current go-agent WebSocket protocol only sends `tool_start` (name + id)
> and `tool_result` (name + id + duration + success). It does not include tool input or
> output payloads in these messages. `RenderInput` is defined for future protocol
> extensions. All renderers handle nil input gracefully.

```go
// ToolRenderer renders tool execution details for the right pane.
type ToolRenderer interface {
    // RenderStart is called when tool_start arrives. Returns initial display.
    RenderStart(toolName string, toolID string) string

    // RenderInput is called when the full tool input is available (tool_call).
    RenderInput(toolName string, input json.RawMessage) string

    // RenderResult is called when tool_result arrives.
    RenderResult(toolName string, input json.RawMessage, output string, err string, duration time.Duration) string
}

// Registry maps tool names to renderers.
type Registry struct {
    renderers map[string]ToolRenderer
    fallback  ToolRenderer // DefaultRenderer
}

func (r *Registry) Register(toolName string, renderer ToolRenderer)
func (r *Registry) Get(toolName string) ToolRenderer
```

### Built-in Renderers (Phase 1)

| Tool                          | Renderer            | Display                                         |
| ----------------------------- | ------------------- | ----------------------------------------------- |
| `readFile`                    | `FileReadRenderer`  | File path, line range, content snippet          |
| `str_replace_based_edit_tool` | `FileEditRenderer`  | File path, old/new diff with red/green coloring |
| `grepSearch`                  | `GrepRenderer`      | Pattern, file matches with highlighted hits     |
| `directoryListing`            | `DirectoryRenderer` | Tree-style directory output                     |
| _(everything else)_           | `DefaultRenderer`   | Pretty-printed JSON input + raw output          |

Adding a new renderer: implement the `ToolRenderer` interface and register it in `main.go`.

## TUI Layout

```
┌─ Chat ──────────────────────────┬─ Tool Detail ──────────────────────┐
│ You: Build me a landing page    │ ▶ readFile                         │
│                                 │   Path: /app/src/pages/index.tsx   │
│ Agent: I'll start by reading    │   Lines: 1-45                      │
│ the existing page structure...  │                                    │
│                                 │   1 | import React from 'react'    │
│ 🔧 readFile (0.2s) ✓           │   2 | import { Header } from ...   │
│ 🔧 str_replace_based_edit ●    │   3 | ...                          │
│                                 │                                    │
│ Agent: Now I'll update the      │                                    │
│ header component to...          │                                    │
│                                 │                                    │
├─────────────────────────────────┴────────────────────────────────────┤
│ > Type a message...                                              ⏎  │
└──────────────────────────────────────────────────────────────────────┘
```

### Left Pane (Chat)

- Scrollable viewport showing interleaved user messages, agent text chunks, and tool call summary lines
- Tool calls displayed as one-liners: `🔧 toolName (duration) status`
- Selecting a tool line (arrow keys + Enter) loads its detail in the right pane
- Active tool (currently running) auto-selected
- `j/k` to scroll, `G/g` for bottom/top

### Right Pane (Tool Detail)

- Shows the selected tool's renderer output
- Updates live during streaming (tool_start -> input -> result)
- Scrollable independently
- Empty state when no tool selected

### Bottom (Input)

- Text input with line editing (bubbles/v2 textinput)
- Enter to send, Esc to cancel
- Disabled while agent is responding (shows spinner)

### Key Bindings

| Key                  | Action                                  |
| -------------------- | --------------------------------------- |
| `Tab`                | Switch focus between chat and tool pane |
| `↑/↓` or `j/k`       | Scroll focused pane                     |
| `Enter` on tool line | Select tool for right pane              |
| `q` or `Ctrl+C`      | Quit                                    |
| `/`                  | Focus input                             |
| `r`                  | Reconnect (when disconnected)           |

## WebSocket Client

```go
type WSClient struct {
    conn     *websocket.Conn
    program  *tea.Program
    url      string
    appID    string
    agentID  string
}

func (c *WSClient) Connect(ctx context.Context) error
func (c *WSClient) SendChat(message string) error
func (c *WSClient) SendCancel() error
func (c *WSClient) Close() error
```

### Connection Flow

1. CLI starts, connects to `ws://localhost:4000/ws`
2. Send `connect` message with optional `conversationId`, `appId`, `agentId`
3. Receive `connected` response with `conversationId`, `runStatus`
4. If active run exists, receive replay events
5. User types message, send `chat` message
6. Receive streamed events until `complete`

### Message Translation

The WS read loop deserializes `ServerMessage` and dispatches as Bubble Tea messages:

| Server Event  | Bubble Tea Message | Effect                                          |
| ------------- | ------------------ | ----------------------------------------------- |
| `connected`   | `wsConnectedMsg`   | Show connection status, store conversationId    |
| `chunk`       | `wsChunkMsg`       | Append text to chat pane                        |
| `tool_start`  | `wsToolStartMsg`   | Add tool line to chat, auto-select in tool pane |
| `tool_result` | `wsToolResultMsg`  | Update tool status, render result               |
| `complete`    | `wsCompleteMsg`    | Re-enable input, show summary                   |
| `error`       | `wsErrorMsg`       | Display error in chat pane                      |
| `pong`        | _(ignored)_        | Health check response                           |

No shared state between WS goroutine and TUI. All communication via Bubble Tea's message channel.

### Protocol Types (Mirrored from go-agent)

```go
// ClientMessage sent to the go-agent server.
type ClientMessage struct {
    Type string          `json:"type"` // connect, chat, cancel, ping
    ID   string          `json:"id,omitempty"`
    Data json.RawMessage `json:"data,omitempty"`
}

// ServerMessage received from the go-agent server.
type ServerMessage struct {
    Type    string          `json:"type"` // connected, chunk, tool_start, tool_result, complete, error, pong, server_config
    Content string          `json:"content,omitempty"`
    Data    json.RawMessage `json:"data,omitempty"`
}
```

## State Model

```go
type Model struct {
    // Connection
    wsClient    *WSClient
    connected   bool
    conversationID string

    // Panes
    chatPane    ChatPane    // left: scrollable chat log
    toolPane    ToolPane    // right: tool detail view
    input       Input       // bottom: text input

    // Focus
    focusedPane Pane // Chat | Tool | Input

    // Tools
    toolCalls   []ToolCall  // ordered list of tool calls in this session
    selectedTool int        // index into toolCalls, -1 if none
    renderers   *renderer.Registry

    // Layout
    width, height int
    splitRatio    float64   // left/right split (default 0.5)

    // State
    agentResponding bool   // true while streaming
    err             error
}

type ToolCall struct {
    ID       string
    Name     string
    Input    json.RawMessage
    Output   string
    Error    string
    Duration time.Duration
    Status   string // "running", "completed", "error"
}
```

## Phase 1 Scope

- WebSocket connection to go-agent with connect/chat/cancel
- Split-pane TUI with chat log + tool detail
- Pluggable tool renderer registry with 5 built-in renderers
- Keyboard navigation and scrolling
- Tool call selection and live detail updates
- Basic error display
- No auto-reconnect (manual `r` key)
- No conversation history replay from database (only live replay from active run)

## Dependencies

| Package                      | Version | Purpose                        |
| ---------------------------- | ------- | ------------------------------ |
| `charm.land/bubbletea/v2`    | v2.0.2  | TUI framework                  |
| `charm.land/lipgloss/v2`     | v2.0.2  | Terminal styling               |
| `charm.land/bubbles/v2`      | v2.1.0  | Viewport, textinput components |
| `github.com/coder/websocket` | v1.8.14 | WebSocket client               |
