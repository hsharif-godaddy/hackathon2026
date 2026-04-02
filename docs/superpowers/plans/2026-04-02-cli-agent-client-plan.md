# CLI Agent Client Implementation Plan

Based on: `docs/superpowers/specs/2026-04-02-cli-agent-client-design.md`

## Task 1: Module Scaffold & Dependencies

1. Create `cli-agent-client/` directory at repo root
2. Run `go mod init github.com/airo-ai-builder/cli-agent-client`
3. Set Go version to 1.25.0, toolchain go1.25.7 (matching dev-runner)
4. Add dependencies:
   - `charm.land/bubbletea/v2 v2.0.2`
   - `charm.land/lipgloss/v2 v2.0.2`
   - `charm.land/bubbles/v2 v2.1.0`
   - `github.com/coder/websocket v1.8.14`
5. Create `cmd/cli-agent-client/main.go` with flag parsing (--url, --app-id, --conversation-id, --agent-id) and placeholder Bubble Tea program
6. Create `Makefile` with build/run targets
7. Verify: `cd cli-agent-client && go build ./cmd/cli-agent-client`

## Task 2: Protocol Types & WebSocket Client

1. Create `internal/client/protocol.go`:

   - `ClientMessage{Type, ID, Data}` — mirrors go-agent's transport/protocol.go
   - `ServerMessage{Type, Content, Data}` — mirrors go-agent exactly (Data is `json.RawMessage`)
   - `ChatData{Message, AgentID}` — chat payload
   - `ConnectData{ConversationID, AppID, AgentID}` — connect payload
   - Message type constants: connect, chat, cancel, ping, connected, chunk, tool_start, tool_result, complete, error, pong, server_config
   - Typed data structs for server messages: `ToolStartData{ToolName, ToolID}`, `ToolResultData{ToolName, ToolID, DurationMs, Success}`, `CompleteData{Iterations, ToolsCalled, Cancelled, Reason}`, `ConnectedData{ConversationID, RunStatus}`

2. Create `internal/client/websocket.go`:

   - `WSClient` struct with `conn *websocket.Conn`, `program *tea.Program`, `url string`, `appID string`, `agentID string`, `conversationID string`
   - `NewWSClient(url, appID, agentID, conversationID string) *WSClient`
   - `Connect(ctx context.Context, program *tea.Program) error` — dials ws, stores conn+program, starts read loop goroutine
   - `SendConnect() error` — sends connect message with appID/conversationID/agentID
   - `SendChat(message string) error` — sends chat message
   - `SendCancel() error` — sends cancel message
   - `Close() error` — closes connection
   - Private `readLoop()` — reads messages, deserializes, sends Bubble Tea messages via `program.Send()`

3. Define Bubble Tea message types (in `internal/client/messages.go`):

   - `WSConnectedMsg{ConversationID, RunStatus}`
   - `WSChunkMsg{Content string}`
   - `WSToolStartMsg{ToolName, ToolID string}`
   - `WSToolResultMsg{ToolName, ToolID string, DurationMs int64, Success bool}`
   - `WSCompleteMsg{Iterations, ToolsCalled int, Cancelled bool, Reason string}`
   - `WSErrorMsg{Message string}`
   - `WSDisconnectedMsg{Err error}`

4. Verify: `go build ./...` compiles

## Task 3: Tool Renderer Registry & Built-in Renderers

1. Create `internal/renderer/registry.go`:

   - `ToolRenderer` interface with `RenderStart(toolName, toolID string) string`, `RenderInput(toolName string, input json.RawMessage) string`, `RenderResult(toolName string, input json.RawMessage, output string, errMsg string, duration time.Duration) string`
   - `Registry` struct with `renderers map[string]ToolRenderer` and `fallback ToolRenderer`
   - `NewRegistry() *Registry` — creates with DefaultRenderer as fallback
   - `Register(toolName string, r ToolRenderer)`
   - `Get(toolName string) ToolRenderer` — returns registered or fallback

2. Create `internal/renderer/default.go`:

   - `DefaultRenderer` struct implementing `ToolRenderer`
   - `RenderStart`: returns "Running {toolName}..."
   - `RenderInput`: pretty-prints JSON input with `json.MarshalIndent`
   - `RenderResult`: shows input + output/error, duration

3. Create `internal/renderer/file_read.go`:

   - `FileReadRenderer` — parses readFile input (path, offset, limit), shows file path and line range in header, content in body

4. Create `internal/renderer/file_edit.go`:

   - `FileEditRenderer` — parses str_replace_based_edit_tool input (command, path, old_str, new_str), shows diff with red (old) / green (new) styling via lipgloss

5. Create `internal/renderer/grep.go`:

   - `GrepRenderer` — parses grepSearch input (pattern, path, include), shows pattern and matches

6. Create `internal/renderer/directory.go`:

   - `DirectoryRenderer` — parses directoryListing input (path), shows tree output

7. Verify: `go build ./...` compiles; write a simple test for Registry.Get returning fallback

## Task 4: TUI Styles

1. Create `internal/tui/styles.go` following dev-runner's pattern:
   - Global style vars using `lipgloss.NewStyle()`
   - Colors: `chatPaneBorder`, `toolPaneBorder`, `inputBorder` (use lipgloss.Color hex/numeric)
   - `userMsgStyle` — bold, colored for user messages
   - `agentMsgStyle` — for agent text
   - `toolRunningStyle` — yellow dot + tool name
   - `toolCompletedStyle` — green checkmark + tool name
   - `toolErrorStyle` — red X + tool name
   - `headerStyle` — pane headers (bold, background)
   - `inputStyle` — input area
   - `statusStyle` — connection status bar
   - `focusedBorderStyle` / `unfocusedBorderStyle` — for pane focus indication

## Task 5: Chat Pane (Left)

1. Create `internal/tui/chatpane.go`:
   - `ChatPane` struct with `viewport viewport.Model`, `lines []ChatLine`, `toolLines map[string]int` (toolID → line index), `selectedToolIdx int`, `focused bool`
   - `ChatLine` type: `{Type: "user"|"agent"|"tool", Content string, ToolID string}`
   - `NewChatPane(width, height int) ChatPane`
   - `AppendUserMessage(msg string)` — adds styled user line
   - `AppendAgentChunk(text string)` — appends to last agent line or creates new
   - `AppendToolStart(toolName, toolID string)` — adds tool summary line with running indicator
   - `UpdateToolResult(toolID string, duration time.Duration, success bool)` — updates tool line with status
   - `SelectedToolID() string` — returns currently selected tool's ID
   - `SelectNext() / SelectPrev()` — navigate tool lines
   - `SetSize(w, h int)` — resize viewport
   - `SetFocused(bool)`
   - `View() string` — renders viewport content with border

## Task 6: Tool Pane (Right)

1. Create `internal/tui/toolpane.go`:
   - `ToolPane` struct with `viewport viewport.Model`, `content string`, `focused bool`, `title string`
   - `NewToolPane(width, height int) ToolPane`
   - `SetContent(title, content string)` — updates viewport content
   - `Clear()` — empties pane
   - `SetSize(w, h int)` — resize
   - `SetFocused(bool)`
   - `View() string` — renders with border and title

## Task 7: Input Area (Bottom)

1. Create `internal/tui/input.go`:
   - `Input` struct with `textInput textinput.Model`, `enabled bool`, `width int`
   - `NewInput(width int) Input`
   - `SetEnabled(bool)` — toggle input; when disabled show spinner text
   - `SetWidth(int)` — resize
   - `Value() string` — current text
   - `Reset()` — clear after send
   - `Update(msg tea.Msg) (Input, tea.Cmd)` — delegate to textinput
   - `View() string` — renders input with border

## Task 8: Root Model & View Composition

1. Create `internal/tui/model.go`:

   - `Pane` type (iota: PaneChat, PaneTool, PaneInput)
   - `Model` struct per design spec: wsClient, connected, conversationID, chatPane, toolPane, input, focusedPane, toolCalls []ToolCall, selectedTool, renderers, width, height, splitRatio, agentResponding, err
   - `ToolCall` struct: ID, Name, Input, Output, Error, Duration, Status
   - `NewModel(wsClient *WSClient, renderers *Registry) Model` — initializes all sub-components
   - `Init() (tea.Model, tea.Cmd)` — returns command to connect WebSocket

2. Create `internal/tui/view.go`:

   - `View() tea.View` — compose left/right/bottom layout:
     - Calculate left width = int(width \* splitRatio), right width = width - left width
     - Bottom height = 3 (input area)
     - Content height = height - 3
     - Resize sub-panes
     - `lipgloss.JoinHorizontal(lipgloss.Top, chatPane.View(), toolPane.View())`
     - `lipgloss.JoinVertical(lipgloss.Left, topSection, input.View())`
   - Return `tea.View` with `AltScreen = true`

3. Create `internal/tui/update.go`:
   - Handle `tea.WindowSizeMsg` — update width/height, resize all panes
   - Handle `tea.KeyPressMsg`:
     - `Tab` → cycle focus (Chat → Tool → Input → Chat)
     - `j/k` or `↑/↓` → scroll focused pane
     - `Enter` in chat pane → select tool, update tool pane content via renderer
     - `Enter` in input → send chat message via wsClient, disable input
     - `q` / `Ctrl+C` → quit
     - `/` → focus input
     - `r` → reconnect when disconnected
     - `g/G` → top/bottom of focused pane
   - Handle WS messages:
     - `WSConnectedMsg` → set connected, store conversationID, enable input
     - `WSChunkMsg` → chatPane.AppendAgentChunk(content)
     - `WSToolStartMsg` → chatPane.AppendToolStart(), add to toolCalls, auto-select, render start in tool pane
     - `WSToolResultMsg` → update toolCall, chatPane.UpdateToolResult(), render result in tool pane
     - `WSCompleteMsg` → set agentResponding=false, enable input
     - `WSErrorMsg` → display error in chat pane
     - `WSDisconnectedMsg` → set connected=false, show error

## Task 9: Wire Up main.go

1. Update `cmd/cli-agent-client/main.go`:

   - Parse flags (--url, --app-id, --conversation-id, --agent-id)
   - Create renderer Registry, register all built-in renderers
   - Create WSClient
   - Create TUI Model
   - Run `tea.NewProgram(model).Run()`
   - Handle exit cleanup (close WS)

2. Verify: `go build ./cmd/cli-agent-client` succeeds

## Task 10: Integration Test & Polish

1. Manually test against running go-agent (if available) or write a mock WebSocket server test
2. Verify: all key bindings work, tool selection populates right pane, text streams correctly
3. Run `go vet ./...` and fix any issues
4. Add a basic README.md with usage instructions
