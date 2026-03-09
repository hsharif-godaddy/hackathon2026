# Go Agent Service Design

Rewrite of the TypeScript agents service in Go to address memory spikes, observability gaps, and WebSocket/business logic coupling.

## Problem Statement

The current TypeScript agent service (~117K LOC across `agents/` and `packages/ai-lib/`) has three persistent issues:

1. **Memory spikes** — 1-2% of customers trigger sustained high-water marks that consume heap until OOM. Not a leak; specific usage patterns cause large allocations that are never released. Production runs at 1.5GB heap.
2. **Observability gaps** — Streaming issues are reported but can't be diagnosed. Unclear whether stalls originate in the LLM provider, agent event forwarding, or frontend client. Insufficient APM instrumentation to pinpoint the pipeline stage.
3. **WebSocket/business logic coupling** — The WebSocket server (~2,300 lines) mixes connection lifecycle, auth, agent orchestration, context management, and message persistence. Edge cases with poor networks and reconnection are hard to address because the transport layer is intertwined with LLM interaction logic.

## Key Decisions

| Aspect        | Decision                                               | Rationale                                                                                                   |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Language      | Go                                                     | Lower memory footprint, goroutine-based concurrency, predictable GC, existing Go expertise (dev-supervisor) |
| LLM provider  | Anthropic SDK directly                                 | Primary provider, system prompts are Anthropic-specific, no need for multi-provider abstraction             |
| Libraries     | Small task-specific packages                           | `gdauth`, `mdprompt`, etc. Not a monolithic ai-lib replacement                                              |
| Transport     | Native WebSocket, custom protocol                      | Drop Socket.IO — its reconnection logic has been mostly disabled. New client in app/                        |
| Database      | SQLite, same schema                                    | Enables rollback during migration; no data export/import needed                                             |
| Deployment    | One agent per app (unchanged)                          | Go's lower memory footprint makes this more viable. Security model preserved                                |
| Multi-tenancy | Supported, single DB                                   | AppID is key in all tables. Multi-tenant for local dev, single-tenant in production                         |
| Identity      | AppID only                                             | Drop SiteID concept — siteId === appId everywhere in practice                                               |
| Prompts       | Embedded markdown fragments                            | `go:embed` the same .md files. Shared with TS during cutover period                                         |
| Rollout       | Gradual — new apps on Go                               | Feature-flag in mhp-core. Existing apps stay on TS until migrated                                           |
| Tools         | Core native in Go, TS bridge for legacy, MCP long-term | Pragmatic — don't block launch on rewriting 52 tools                                                        |

## Architecture Overview

```
                    ┌──────────────────────────────────────────────────┐
                    │                   Go Agent                       │
                    │                                                  │
  WebSocket ───────▶│  Transport ──▶ Session ──▶ Run Engine           │
  Connection        │      │            │            │                 │
                    │      │            │            ├── Anthropic SDK │
                    │      │            │            ├── Tool Registry │
                    │      │            │            └── Prompt Loader │
                    │      │            │                              │
                    │      └────────────┴──────────▶ Event Bus ◀──────│
                    │                                   │              │
                    │                    ┌──────────────┼───────┐      │
                    │                    ▼              ▼       ▼      │
                    │               APM/Metrics    Logging  Persistence│
                    └──────────────────────────────────────────────────┘
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                         TS Bridge              MCP Servers
                       (Unix socket)          (stdio/SSE)
```

## Core Abstraction: The Run

A **Run** represents a single agent turn: user sends a message, the agent processes it through one or more LLM calls and tool executions, and produces a response.

Runs are **independent entities, decoupled from the transport layer**. A WebSocket connection is a viewport into a run, not its owner. If the client disconnects, the run continues. When the client reconnects, it reattaches and replays what it missed.

### Run Lifecycle

```
Created → Queued → Running → [Streaming | ToolExecuting]* → Completed
                      │                                         │
                      ├──── Cancelled ◀── user/budget/timeout   │
                      └──── Failed ◀── unrecoverable error      │
                                                                 │
                              Expired ◀── TTL after completed ───┘
```

### Run Structure

```go
type Run struct {
    ID             string
    AppID          string
    ConversationID string
    AgentID        string
    Status         RunStatus
    Budget         *Budget

    // The event log - append-only, source of truth
    Events         []RunEvent

    // Cancellation
    ctx            context.Context
    cancel         context.CancelFunc
}

type Budget struct {
    MaxTokens      int
    MaxToolCalls   int
    MaxDuration    time.Duration
    TokensUsed     int
    ToolCallsUsed  int
    StartedAt      time.Time
}
```

### Run Events

Every meaningful thing that happens during a run is an event. Events are the **single source of truth** — persistence, WebSocket streaming, APM, and logging all consume from this same stream.

```go
type RunEvent struct {
    ID        string
    Sequence  int64      // Monotonic, used for replay on reconnect
    Timestamp time.Time
    Type      EventType
    Data      any        // Typed per EventType
}

const (
    EventRunStarted       EventType = "run.started"
    EventPromptBuilt      EventType = "prompt.built"
    EventLLMRequestStart  EventType = "llm.request.start"
    EventLLMFirstToken    EventType = "llm.first_token"
    EventLLMToken         EventType = "llm.token"
    EventLLMStall         EventType = "llm.stall"
    EventLLMResponse      EventType = "llm.response"
    EventLLMLoopIteration EventType = "llm.loop_iteration"
    EventToolCallStart    EventType = "tool.call.start"
    EventToolOutput       EventType = "tool.output"
    EventToolCallResult   EventType = "tool.call.result"
    EventRunCompleted     EventType = "run.completed"
    EventRunCancelled     EventType = "run.cancelled"
    EventRunFailed        EventType = "run.failed"
    EventBudgetWarning    EventType = "budget.warning"
)
```

### Run Store

The event log is held in memory during execution and can be persisted to SQLite. The store supports subscribing from any offset, enabling reconnection replay:

```go
type RunStore interface {
    Append(runID string, event RunEvent)
    Subscribe(runID string, fromSequence int64) <-chan RunEvent
    Get(runID string) (*Run, error)
    Events(runID string, fromSequence int64) ([]RunEvent, error)
}
```

**Relationship to EventBus:** The `RunStore` and `EventBus` serve complementary roles. The `EventBus` is for live, fire-and-forget pub/sub — subscribers receive events as they happen but cannot replay history. The `RunStore` is the persistent record — it stores all events and supports replay from any sequence offset. The run engine publishes to the `EventBus`, and a built-in subscriber writes events to the `RunStore`. On reconnection, the session layer reads missed events from the `RunStore` (replay), then subscribes to the `EventBus` for live events going forward. If a live subscriber's buffer fills and events are dropped, it can re-read the gap from the `RunStore`.

### Budget Controls

Checked at natural breakpoints (before each LLM call, before each tool execution):

```go
type BudgetChecker interface {
    Check(run *Run) error  // returns ErrBudgetExceeded with reason
}
```

Token limits, tool call limits, wall-clock duration, and external cancellation all flow through the same mechanism.

## Event Bus

In-process typed pub/sub. All components publish and subscribe through it rather than calling each other directly.

```go
type EventBus interface {
    Publish(topic string, event RunEvent)
    Subscribe(topic string, bufferSize int) *Subscription
    SubscribeFrom(topic string, fromSeq int64, bufferSize int) *Subscription
}

type Subscription struct {
    Ch    <-chan RunEvent
    Close func()
}
```

Topic format: `run:{runID}` for all events on a run, or `run:{runID}:{eventType}` for filtered subscription.

### Built-in Subscribers

Each subscriber is independently registered, independently testable, and independently removable:

| Subscriber      | Purpose                                                                |
| --------------- | ---------------------------------------------------------------------- |
| WebSocket relay | Forwards events to connected client, filters to client-relevant events |
| Persistence     | Writes conversation messages incrementally; finalizes on RunCompleted  |
| APM/Tracing     | Creates OpenTelemetry spans for LLM calls, tool executions, full run   |
| Metrics         | Counters/histograms: tokens used, tool duration, run duration          |
| Token usage     | Tracks token consumption per app for billing                           |
| Logger          | Structured logging of run lifecycle                                    |

### Backpressure

Each subscription has a buffered channel. If a slow subscriber's buffer fills, events are dropped for that subscriber and a gap is recorded. The subscriber can detect the gap and re-read from the run store. The run engine is never blocked by a slow subscriber.

### Event Filtering for WebSocket

Not all internal events go to the client. The WebSocket relay subscriber transforms internal events to the client protocol:

| Internal Event          | Client Message  | Notes                               |
| ----------------------- | --------------- | ----------------------------------- |
| `EventLLMToken`         | `token`         | Streamed text                       |
| `EventToolCallStart`    | `tool_status`   | Tool name, "running"                |
| `EventToolOutput`       | `tool_output`   | Incremental tool output             |
| `EventToolCallResult`   | `tool_status`   | Tool name, "complete"               |
| `EventRunCompleted`     | `run_complete`  | Final message                       |
| `EventRunCancelled`     | `run_cancelled` | Cancellation reason                 |
| `EventRunFailed`        | `error`         | Terminal failure; unrecoverable run |
| `EventPromptBuilt`      | (not sent)      | APM/metrics only                    |
| `EventLLMRequestStart`  | (not sent)      | APM only                            |
| `EventLLMFirstToken`    | (not sent)      | APM only                            |
| `EventLLMStall`         | (not sent)      | Stall detection; APM/metrics only   |
| `EventLLMLoopIteration` | (not sent)      | Loop iteration; APM/metrics only    |
| `EventBudgetWarning`    | (not sent)      | Metrics/logging only                |

## Transport Layer (WebSocket)

Pure connection management. No knowledge of agents, runs, or LLM.

### Protocol

JSON-over-WebSocket with a minimal envelope:

```go
// Client → Server
type ClientMessage struct {
    Type string          `json:"type"`
    ID   string          `json:"id"`
    Data json.RawMessage `json:"data"`
}

// Server → Client
type ServerMessage struct {
    Type     string `json:"type"`
    ID       string `json:"id,omitempty"`
    Sequence int64  `json:"seq"`
    Data     any    `json:"data"`
}
```

**Client message types:** `connect`, `message`, `cancel`, `reauth`, `ping`

**Server message types:** `connected`, `token`, `tool_status`, `tool_output`, `run_complete`, `run_cancelled`, `error`, `replay_start`, `replay_end`, `pong`

### Authentication

JWT validation on the initial HTTP upgrade request. Transport validates the token and extracts AppID — passes it to the session layer as an authenticated identity. No per-message auth needed.

Token refresh: client sends a `reauth` message with a new JWT before the current one expires. Transport validates and swaps without dropping the connection.

### Connection Flow

Every connection starts with a `connect` message:

```go
type ConnectData struct {
    AppID          string `json:"appId"`
    ConversationID string `json:"conversationId,omitempty"`
    LastSequence   *int64 `json:"lastSeq,omitempty"`
}
```

### Reconnection Scenarios

```
Client connects with connect message
  │
  ├── Case 1: Has conversationId + lastSeq
  │   └── Normal replay from lastSeq
  │
  ├── Case 2: Has conversationId, no lastSeq (client lost local state)
  │   └── Run active → replay from beginning of current run
  │       No active run → send current state summary
  │
  ├── Case 3: Has appId only (tab refresh, app restart)
  │   └── Look up most recent conversation for app
  │       Active run → attach, replay from beginning
  │       No active run → send conversation metadata for UI restore
  │       No conversations → fresh state
  │
  └── Case 4: Fresh connection (new session)
      └── Normal auth, ready for first message
```

Server responds with:

```go
type ConnectResponse struct {
    ConversationID string `json:"conversationId"`
    RunID          string `json:"runId,omitempty"`
    RunStatus      string `json:"runStatus,omitempty"`
    ReplayFrom     *int64 `json:"replayFrom,omitempty"`
}
```

Replay (if any) follows bracketed by `replay_start` / `replay_end`, then live events continue.

## Session Layer

Bridges transport and runs. Owns the mapping between connections, conversations, and active runs.

```go
type Session struct {
    ConnectionID   string
    AppID          string
    ConversationID string
    ActiveRunID    string
    Subscription   *Subscription
    LastAckedSeq   int64
}
```

### Session Manager Responsibilities

| Event                      | Action                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| New connection + `connect` | Create session, resolve conversation/run per reconnection scenarios, subscribe to events |
| Client sends `message`     | Validate ownership (AppID), create new run via run engine, subscribe session             |
| Client sends `cancel`      | Look up active run, call `run.Cancel()`                                                  |
| Client disconnects         | Remove session, unsubscribe from event bus. Run continues.                               |
| Client reconnects          | New session, reattach to existing run if still active                                    |
| Run completes              | Notify session via event bus, clear ActiveRunID                                          |

### Tenant Isolation

Every operation validates: does the requested resource belong to this session's AppID? In single-tenant mode this is trivially true. In multi-tenant mode it's a check.

## Run Engine

The core agent execution loop. Runs as a goroutine, emits events, accepts cancellation via context.

```go
func (e *RunEngine) Execute(ctx context.Context, run *Run, input RunInput) {
    e.eventBus.Publish(run.Topic(), RunEvent{Type: EventRunStarted})

    // Build system prompt from markdown fragments
    agent, err := e.agentLoader.Load(run.AgentID)
    if err != nil {
        e.eventBus.Publish(run.Topic(), RunEvent{
            Type: EventRunFailed,
            Data: RunFailedData{Error: fmt.Sprintf("agent load failed: %v", err)},
        })
        return
    }

    systemPrompt := e.promptLoader.Compose(agent.PromptConfig, input.Context)

    e.eventBus.Publish(run.Topic(), RunEvent{
        Type: EventPromptBuilt,
        Data: PromptBuiltData{TokenCount: countTokens(systemPrompt)},
    })

    messages := e.buildMessages(run.ConversationID, input)

    // Agent loop
    for iteration := 0; ; iteration++ {
        if err := run.Budget.Check(); err != nil {
            e.eventBus.Publish(run.Topic(), RunEvent{Type: EventRunCancelled, Data: err})
            return
        }

        e.eventBus.Publish(run.Topic(), RunEvent{
            Type: EventLLMLoopIteration,
            Data: LoopIterationData{Iteration: iteration},
        })

        response, toolCalls := e.streamLLMCall(ctx, run, systemPrompt, messages)

        // streamLLMCall returns "", nil on cancellation or failure (events already emitted)
        if ctx.Err() != nil || (response == "" && toolCalls == nil) {
            return
        }

        if len(toolCalls) == 0 {
            e.eventBus.Publish(run.Topic(), RunEvent{Type: EventRunCompleted, Data: response})
            return
        }

        results := e.executeTools(ctx, run, toolCalls)
        messages = append(messages, toolCallMessages(toolCalls, results)...)

        if shouldStop(toolCalls) {
            e.eventBus.Publish(run.Topic(), RunEvent{Type: EventRunCompleted, Data: response})
            return
        }
    }
}
```

### Streaming LLM Calls

Each token from Anthropic is published as an event immediately. Timing events enable stall detection:

```go
func (e *RunEngine) streamLLMCall(ctx context.Context, run *Run, system string, messages []Message) (string, []ToolCall) {
    e.eventBus.Publish(run.Topic(), RunEvent{Type: EventLLMRequestStart})

    stream := e.llmClient.CreateMessageStream(ctx, &anthropic.MessageRequest{
        Model:    run.Model,
        System:   system,
        Messages: messages,
        Tools:    run.Tools,
    })

    var fullResponse strings.Builder
    var toolCalls []ToolCall
    var currentToolCall *ToolCall
    firstToken := true

    for event := range stream.Events() {
        if ctx.Err() != nil {
            stream.Close()
            e.eventBus.Publish(run.Topic(), RunEvent{Type: EventRunCancelled})
            return "", nil
        }

        switch ev := event.(type) {
        case *anthropic.ContentBlockStart:
            if ev.ContentBlock.Type == "tool_use" {
                currentToolCall = &ToolCall{
                    ID:   ev.ContentBlock.ID,
                    Name: ev.ContentBlock.Name,
                }
            }
        case *anthropic.ContentBlockDelta:
            if ev.Delta.Text != "" {
                if firstToken {
                    e.eventBus.Publish(run.Topic(), RunEvent{Type: EventLLMFirstToken})
                    firstToken = false
                }
                fullResponse.WriteString(ev.Delta.Text)
                e.eventBus.Publish(run.Topic(), RunEvent{
                    Type: EventLLMToken,
                    Data: TokenData{Text: ev.Delta.Text},
                })
            }
            if ev.Delta.PartialJSON != "" && currentToolCall != nil {
                currentToolCall.InputJSON += ev.Delta.PartialJSON
            }
        case *anthropic.ContentBlockStop:
            if currentToolCall != nil {
                toolCalls = append(toolCalls, *currentToolCall)
                currentToolCall = nil
            }
        }
    }

    if err := stream.Err(); err != nil {
        e.eventBus.Publish(run.Topic(), RunEvent{
            Type: EventRunFailed,
            Data: RunFailedData{Error: err.Error()},
        })
        return "", nil
    }

    e.eventBus.Publish(run.Topic(), RunEvent{
        Type: EventLLMResponse,
        Data: LLMResponseData{
            TokensIn:  stream.Usage().InputTokens,
            TokensOut: stream.Usage().OutputTokens,
            CacheRead: stream.Usage().CacheReadInputTokens,
        },
    })

    return fullResponse.String(), toolCalls
}
```

### Cancellation

`context.Context` flows through everything. User cancel, budget exceeded, and timeout all cancel the context. The LLM streaming loop checks `ctx.Err()` on every event. Tool execution uses `exec.CommandContext` for subprocess tools.

## Tool System

### Interface

Every tool — native Go, MCP, or legacy TS bridge — implements the same interface with streaming output support:

```go
type Tool interface {
    Name() string
    Description() string
    InputSchema() json.RawMessage
    Execute(ctx context.Context, input json.RawMessage, output ToolOutputStream) error
}

type ToolOutputStream interface {
    Write(chunk string)
    WriteError(chunk string)
    SetMetadata(key string, value any)
}
```

For simple tools that don't need streaming, a convenience wrapper:

```go
type SimpleToolFunc func(ctx context.Context, input json.RawMessage) (ToolResult, error)
```

### Tool Registry

Resolves tool names to implementations. Each agent declares which tools it uses:

```go
type ToolRegistry struct {
    tools map[string]Tool
}

func (r *ToolRegistry) ForAgent(agentID string) []Tool
func (r *ToolRegistry) Execute(ctx context.Context, call ToolCall, out ToolOutputStream) error
```

### Tool Execution

Parallel execution with per-tool event publishing:

```go
func (e *RunEngine) executeTools(ctx context.Context, run *Run, calls []ToolCall) []ToolResult {
    results := make([]ToolResult, len(calls))
    var wg sync.WaitGroup

    for i, call := range calls {
        wg.Add(1)
        go func(i int, call ToolCall) {
            defer wg.Done()

            stream := &eventBusToolStream{
                bus: e.eventBus, topic: run.Topic(), callID: call.ID, name: call.Name,
            }

            e.eventBus.Publish(run.Topic(), RunEvent{Type: EventToolCallStart, Data: ...})

            start := time.Now()
            err := e.toolRegistry.Execute(ctx, call, stream)

            results[i] = ToolResult{Content: stream.FullOutput(), IsError: err != nil}
            e.eventBus.Publish(run.Topic(), RunEvent{
                Type: EventToolCallResult,
                Data: ToolResultData{Name: call.Name, Duration: time.Since(start), Error: err},
            })
        }(i, call)
    }

    wg.Wait()
    return results
}
```

The `eventBusToolStream` captures full output for the LLM and publishes `EventToolOutput` chunks for live streaming to the client.

### Three Tool Backends

**Native Go tools (Phase 1):**

| Tool                                       | Notes                                        |
| ------------------------------------------ | -------------------------------------------- |
| `readFile`                                 | `os.ReadFile` with path validation           |
| `fileEdit` / `str_replace_based_edit_tool` | String replacement                           |
| `directoryListing`                         | `os.ReadDir` recursive with filtering        |
| `grepSearch`                               | Shell out to `rg` or implement with `regexp` |
| `terminalCommand`                          | `exec.CommandContext` with streaming output  |
| `serverStatus` / `serverRestart`           | HTTP to dev-supervisor Unix socket           |
| `publishClient` / `publishStatus`          | HTTP to publish service                      |
| `todoList`                                 | SQLite read/write                            |
| `memory`                                   | SQLite + Qdrant client                       |
| `appPlan`                                  | SQLite read/write                            |
| `setProjectName`                           | SQLite update                                |
| `viewLogs`                                 | Read from dev-supervisor log socket          |

**MCP tools:** Discovered at startup from configured MCP servers. Tools registered automatically.

**TS bridge:** Minimal Node process exposing legacy tools over Unix domain socket REST API with chunked transfer encoding for streaming:

```
Go Agent ──── POST /tools/{name} ────▶ TS Bridge
         ◀── 200 OK, chunked NDJSON
         ◀── {"chunk": "npm install...\n"}
         ◀── {"chunk": "added 47 packages\n"}
```

### Registration Precedence

```go
func BuildToolRegistry(config Config) *ToolRegistry {
    // 1. Native Go tools (highest priority)
    // 2. MCP tools (discovered from servers)
    // 3. Bridge tools (fallback for anything not yet native or MCP)
    // Native takes precedence — migrating a tool to Go automatically replaces the bridge version
}
```

## Prompt System

Markdown fragments embedded in the Go binary at compile time, composed at runtime. The `embed.FS` is declared in `go-agent/prompts/embed.go` (at the same directory level as the prompt files, since `go:embed` cannot traverse `..`), then passed to the loader:

```go
// go-agent/prompts/embed.go
//go:embed **/*.md
var FS embed.FS

type PromptConfig struct {
    BasePrompt   string              // e.g., "develop/core.md"
    Fragments    []string            // e.g., ["shared/filesystem.md", "shared/security.md"]
    Conditionals []ConditionalFragment
}

type PromptContext struct {
    AppID         string
    TemplateType  string
    EnabledSkills []string
    VisualContext *VisualContext
    FeatureFlags  map[string]bool
}
```

Composition: base prompt + static fragments + conditional fragments + template description + dynamic sections (skills, visual context).

During the cutover period, prompt `.md` files live in a shared location consumable by both Go (`embed`) and TS (filesystem read) agents. Prompt changes work for both.

## Observability

Built in from day one as event bus subscribers — not instrumentation sprinkled through business logic.

### APM Subscriber

Creates OpenTelemetry spans from run events:

- `agent.run` span wraps the full run lifecycle
- `llm.request` child spans for each LLM call with token counts, cache stats
- `tool.{name}` child spans for each tool execution with duration, error status

### Metrics Subscriber

Histograms and counters from run events:

- Run duration, LLM latency, tool duration (histograms)
- Tokens used, tool errors, active runs (counters/gauges)
- Loop iterations per run (histogram)

### Streaming Diagnostics

The LLM streaming path emits timing events that solve "where is streaming stalling":

- **Time to first token (TTFT):** `EventLLMFirstToken.Time - EventLLMRequestStart.Time`
- **Inter-token latency:** Gaps between consecutive `EventLLMToken` events
- **Stall detection:** `EventLLMStall` emitted if gap exceeds threshold
- **Total generation time:** `EventLLMResponse.Time - EventLLMRequestStart.Time`

Traces show exactly whether a stall was LLM-side (long TTFT, inter-token gaps), agent-side (events published but not forwarded), or client-side (WebSocket relay delivered but client didn't render).

### Structured Logging

Follows existing `domain.operation.lifecycle` convention with `begin/success/failure` lifecycle names and camelCase field names (per monorepo logging conventions):

```
level=INFO msg="run.begin" runId=abc agentId=develop appId=xyz
level=INFO msg="llm.request.begin" runId=abc iteration=0 model=claude-sonnet-4-6
level=INFO msg="tool.call.success" runId=abc tool=terminalCommand durationMs=1234
level=INFO msg="run.success" runId=abc totalDurationMs=8500 iterations=2 toolsCalled=3
level=ERROR msg="run.failure" runId=abc error="context cancelled"
```

### Future: Evaluation Events

The existing TypeScript evaluation SDK will be translated to Go and added as another event bus subscriber. The events it needs (`RunStarted`, `LLMResponse`, `ToolCallResult`, `RunCompleted`) are already being emitted.

## Project Structure

```
airo-ai-builder/
├── agents/                    # Existing TS agent (runs alongside during migration)
├── go-agent/                  # New Go agent service
│   ├── cmd/agent/main.go      # Entry point, wiring
│   ├── internal/
│   │   ├── transport/         # WebSocket server, protocol, auth
│   │   ├── session/           # Session manager, connection→run mapping
│   │   ├── run/               # Run engine, event types, run store, budget
│   │   ├── eventbus/          # In-process typed pub/sub
│   │   ├── agent/             # Agent definitions and configs
│   │   ├── tool/              # Tool interface, registry, native implementations
│   │   │   ├── registry.go
│   │   │   ├── fileops/       # readFile, fileEdit, directoryListing
│   │   │   ├── terminal/      # terminalCommand
│   │   │   ├── git/           # git operations
│   │   │   ├── grep/          # grepSearch
│   │   │   ├── appstate/      # todoList, appPlan, memory, serverStatus
│   │   │   └── publish/       # publishClient, publishStatus
│   │   ├── toolbridge/        # TS bridge client (Unix socket)
│   │   ├── mcpclient/         # MCP client for external tool servers
│   │   ├── prompt/            # Fragment loader, composer
│   │   ├── store/             # SQLite repositories
│   │   ├── observe/           # APM, metrics, logging subscribers
│   │   └── config/            # Env-based configuration
│   ├── prompts/               # Embedded .md fragments (shared with TS during cutover)
│   ├── Makefile
│   ├── go.mod
│   └── Dockerfile
│
├── ts-bridge/                 # Minimal TS process exposing legacy tools
│   ├── server.ts
│   └── package.json
│
├── pkg/                       # Small focused Go libraries (shared across services)
│   ├── gdauth/                # GoDaddy JWT validation
│   └── mdprompt/              # Markdown prompt composition
│
├── dev-supervisor/            # Existing Go service (unchanged)
├── app/                       # Existing Next.js BFF (new WS client added)
└── packages/                  # Existing TS packages
```

### Dependency Graph

```
eventbus ◀── run ◀── session ◀── cmd/agent
   ▲          │         │            │
   │          ▼         ▼            ▼
   ├──── transport    store      observe
   │
   └──── tool (interface)
            ▲
            ├── tool/* (native implementations)
            ├── toolbridge
            └── mcpclient
```

`eventbus` and `tool` (interface) are leaf dependencies. Business logic flows inward. `cmd/agent/main.go` wires everything together.

**`internal/`** — Everything specific to the agent service. Not importable by other Go modules.

**`pkg/`** — Libraries useful across services. Only extract when a second consumer exists. `gdauth` could replace JWT validation in dev-supervisor.

## Dual-Product Handling (AAB vs PaaS)

The codebase serves two products with different data flow patterns. The Go agent must handle both:

| Aspect             | AAB (AiroAppBuilder)              | PaaS (Headless)                |
| ------------------ | --------------------------------- | ------------------------------ |
| **App record**     | Exists in SQLite `apps` table     | May not exist                  |
| **Secrets/Tokens** | Stored via `/api/secrets` → alloc | Passed in API request body     |
| **Git config**     | `git_remote_config` table         | `repoUrl` + `token` in request |
| **Auth**           | GoDaddy SSO via app/ BFF          | Direct API auth                |

The Go agent follows the same conditional pattern as the TS agent:

```go
type RunInput struct {
    Message    string
    // PaaS-provided overrides (empty for AAB)
    Token      string `json:"token,omitempty"`
    RepoURL    string `json:"repoUrl,omitempty"`
}

// In tool execution or git operations:
if input.Token != "" && input.RepoURL != "" {
    // PaaS path: use values from request
} else {
    // AAB path: look up from database/config
}
```

Tools that need repository access (git, publish) accept these overrides through the run context rather than looking them up themselves.

## Authentication

JWT validation on WebSocket upgrade uses `pkg/gdauth`, a Go implementation of token validation. This is a new library because the existing `gd-auth` library is a Node.js npm package (`gd-auth@1.4.1`) that cannot be used from Go.

`pkg/gdauth` must maintain parity with the Node.js library's behavior:

- Support all auth types: basic, e2s, s2s, and delegation chain variants
- Enforce `use12HourExpiration: true` (IAT limits, skip VAT validation for e2s tokens)
- JWKS key fetching and caching
- The existing dev-supervisor already implements JWT validation in Go (`dev-supervisor/internal/auth/`), providing a starting point

**Phase 2 deliverable.** Phase 1 uses a simpler auth mechanism for internal testing (e.g., shared secret or dev-supervisor-style validation). Full `pkg/gdauth` with production parity ships in Phase 2.

## Conversation Persistence and Crash Safety

The persistence subscriber writes to SQLite at two points:

1. **Incremental writes during streaming** — assistant message rows are inserted when streaming begins and updated as content arrives. This ensures partial conversations survive crashes. Tool call results are written as they complete.
2. **Finalization on RunCompleted/RunFailed** — final token counts, status, and metadata are updated.

This matches the existing TS agent's behavior where messages are saved incrementally during streaming, not only at completion. The SQLite schema remains identical, so both agents can read each other's persisted conversations.

**Crash recovery:** If the service crashes mid-run, the conversation has partial messages persisted. On restart, the run is not resumed (runs are ephemeral), but the conversation history is intact for the next user message. The client reconnects, finds no active run, and gets conversation metadata for UI restore (reconnection scenario 3).

## Migration Strategy

### Phase 1: Foundation

**Goal:** Go agent handles basic conversations with DevelopAgent.

**Build:**

- Core runtime: `eventbus`, `run`, `transport`, `session`
- Anthropic SDK streaming integration
- Prompt loader with embedded markdown
- SQLite store (same schema, read/write compatible with TS agent)
- Native tools: `readFile`, `fileEdit`, `directoryListing`, `grepSearch`, `terminalCommand`
- TS bridge for all other tools
- Structured logging subscriber

**Not included:** Only DevelopAgent, no handoffs, no skills, no full OTel APM.

**Deployment:** Internal testing only. Engineers use for local dev, compare behavior to TS agent.

### Phase 2: Production Parity for New Apps

**Goal:** New apps created on Go agent with confidence.

**Add:**

- All agents (Initial, Develop, Marketing, Design, etc.) with handoff
- Full OpenTelemetry APM + metrics subscribers
- WebSocket reconnection (all 4 scenarios)
- New WebSocket client in `app/` (alongside existing Socket.IO client)
- `pkg/gdauth` for JWT validation
- Budget controls and cancellation
- Git tools native in Go
- MCP tool support

**Deployment:** Gradual rollout. New apps assigned Go or TS via feature flag in mhp-core. Percentage ramp.

### Phase 3: Tool Migration and TS Bridge Retirement

**Goal:** Remove dependency on TS bridge process.

**Add:**

- Remaining tools migrated to native Go or MCP servers
- Skills system in Go
- Evaluation events subscriber (once Go SDK exists)

**Deployment:** All new apps on Go. Begin migrating existing apps (same SQLite DB, swap the binary).

### Phase 4: Cleanup

- Remove TS agent code (`agents/`, `packages/ai-lib/`)
- Remove Socket.IO client from `app/`
- Prompts directory becomes Go-only
- `ts-bridge/` deleted

### Cutover Safety

Both agents read the same SQLite DB at every phase. An app can switch between Go and TS by changing which binary runs in the Nomad job. Rollback requires no data migration.

The WebSocket protocol change is the one breaking boundary. The `app/` BFF determines which client to use based on agent type returned by mhp-core:

```json
{
  "agentType": "go",
  "wsProtocol": "native"
}
```
