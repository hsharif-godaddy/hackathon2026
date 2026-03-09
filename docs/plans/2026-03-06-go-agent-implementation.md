# Go Agent Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Go agent handles basic DevelopAgent conversations — accept WebSocket connection, run the agent loop with core tools, stream responses, persist to SQLite.

**Architecture:** Bottom-up build following the dependency graph: event types → event bus → tool interface → native tools → TS bridge → prompt loader → Anthropic streaming → run engine → SQLite store → session manager → WebSocket transport → logging subscriber → config → main wiring.

**Tech Stack:** Go 1.25, `github.com/anthropics/anthropic-sdk-go`, `github.com/coder/websocket`, `modernc.org/sqlite` (pure Go, no CGO), `log/slog` for logging, `github.com/stretchr/testify` for tests.

**Reference:** Design doc at `docs/plans/2026-03-06-go-agent-design.md`

---

## Task 1: Project Scaffolding

**Files:**

- Create: `go-agent/go.mod`
- Create: `go-agent/Makefile`
- Create: `go-agent/.golangci.yml`
- Create: `go-agent/cmd/agent/main.go`

**Step 1: Initialize Go module**

```bash
cd /home/jeichorn/s/airo-ai-builder
mkdir -p go-agent/cmd/agent
cd go-agent
go mod init github.com/gdcorp-partners/airo-app-builder/go-agent
```

**Step 2: Create minimal main.go**

```go
// go-agent/cmd/agent/main.go
package main

import (
    "fmt"
    "os"
)

var Version = "dev"

func main() {
    fmt.Fprintf(os.Stderr, "go-agent %s\n", Version)
}
```

**Step 3: Create Makefile**

Mirror dev-supervisor patterns. Key targets: `build`, `test`, `lint`, `fmt`, `vet`, `check`.

```makefile
# go-agent/Makefile
BINARY_NAME := go-agent
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
DIST_DIR := dist

export GOTOOLCHAIN := go1.25.7

.PHONY: build test lint fmt fmt-fix vet check clean

build:
	@mkdir -p $(DIST_DIR)
	go build -ldflags="-w -s -X main.Version=$(VERSION)" -o $(DIST_DIR)/$(BINARY_NAME) ./cmd/agent

test:
	go test -race -count=1 ./...

test-coverage:
	go test -race -count=1 -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

lint:
	golangci-lint run --timeout=5m ./...

fmt:
	@test -z "$$(gofmt -l .)" || (echo "Files need formatting:"; gofmt -l .; exit 1)

fmt-fix:
	go fmt ./...
	gofmt -s -w .

vet:
	go vet ./...

check: fmt-fix vet lint test

clean:
	rm -rf $(DIST_DIR) coverage.out coverage.html
```

**Step 4: Create .golangci.yml**

```yaml
# go-agent/.golangci.yml
version: "2"
linters:
  enable:
    - gosec
    - errcheck
    - revive
    - gocritic
    - gocyclo
    - goconst
    - govet
    - staticcheck
  settings:
    gocyclo:
      min-complexity: 15
    govet:
      disable:
        - fieldalignment
formatters:
  enable:
    - gofmt
  settings:
    gofmt:
      simplify: true
output:
  formats:
    - format: colored-line-number
linters-settings: {}
```

**Step 5: Verify**

```bash
cd go-agent && go build ./cmd/agent && ./cmd/agent
# Expected: "go-agent dev"
```

**Step 6: Commit**

```bash
git add go-agent/
git commit -m "feat(go-agent): project scaffolding with build tooling"
```

---

## Task 2: Event Types and Run Types

**Files:**

- Create: `go-agent/internal/run/types.go`
- Create: `go-agent/internal/run/types_test.go`

These are pure data types with no dependencies. Define them first so everything else can import them.

**Step 1: Write tests for event and run types**

```go
// go-agent/internal/run/types_test.go
package run

import (
    "testing"
    "time"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestRunStatus(t *testing.T) {
    assert.Equal(t, RunStatus("created"), StatusCreated)
    assert.Equal(t, RunStatus("running"), StatusRunning)
    assert.Equal(t, RunStatus("completed"), StatusCompleted)
    assert.Equal(t, RunStatus("cancelled"), StatusCancelled)
    assert.Equal(t, RunStatus("failed"), StatusFailed)
}

func TestNewRunEvent(t *testing.T) {
    ev := NewRunEvent(EventLLMToken, TokenData{Text: "hello"})
    assert.Equal(t, EventLLMToken, ev.Type)
    assert.NotEmpty(t, ev.ID)
    assert.False(t, ev.Timestamp.IsZero())
    data, ok := ev.Data.(TokenData)
    require.True(t, ok)
    assert.Equal(t, "hello", data.Text)
}

func TestRunTopic(t *testing.T) {
    r := &Run{ID: "run_abc"}
    assert.Equal(t, "run:run_abc", r.Topic())
}

func TestBudgetCheck(t *testing.T) {
    b := &Budget{MaxToolCalls: 5}
    b.ToolCallsUsed = 4
    assert.NoError(t, b.Check())
    b.ToolCallsUsed = 5
    assert.ErrorIs(t, b.Check(), ErrBudgetExceeded)
}
```

**Step 2: Run tests to verify they fail**

```bash
cd go-agent && go test ./internal/run/...
# Expected: FAIL — types not defined
```

**Step 3: Implement types**

```go
// go-agent/internal/run/types.go
package run

import (
    "errors"
    "fmt"
    "time"

    "github.com/gdcorp-partners/airo-app-builder/go-agent/internal/id"
)

// RunStatus represents the lifecycle state of a run.
type RunStatus string

const (
    StatusCreated   RunStatus = "created"
    StatusQueued    RunStatus = "queued"
    StatusRunning   RunStatus = "running"
    StatusCompleted RunStatus = "completed"
    StatusCancelled RunStatus = "cancelled"
    StatusFailed    RunStatus = "failed"
)

// EventType identifies what happened in a run event.
type EventType string

const (
    EventRunStarted      EventType = "run.started"
    EventPromptBuilt     EventType = "prompt.built"
    EventLLMRequestStart EventType = "llm.request.start"
    EventLLMFirstToken   EventType = "llm.first_token"
    EventLLMToken        EventType = "llm.token"
    EventLLMStall        EventType = "llm.stall"
    EventLLMResponse     EventType = "llm.response"
    EventLLMLoopIter     EventType = "llm.loop_iteration"
    EventToolCallStart   EventType = "tool.call.start"
    EventToolOutput      EventType = "tool.output"
    EventToolCallResult  EventType = "tool.call.result"
    EventRunCompleted    EventType = "run.completed"
    EventRunCancelled    EventType = "run.cancelled"
    EventRunFailed       EventType = "run.failed"
    EventBudgetWarning   EventType = "budget.warning"
)

// RunEvent is the fundamental unit of the run's event log.
type RunEvent struct {
    ID        string
    Sequence  int64
    Timestamp time.Time
    Type      EventType
    Data      any
}

func NewRunEvent(eventType EventType, data any) RunEvent {
    return RunEvent{
        ID:        id.New("evt"),
        Timestamp: time.Now(),
        Type:      eventType,
        Data:      data,
    }
}

// Event data types

type RunStartedData struct {
    AgentID string
    AppID   string
}

type PromptBuiltData struct {
    TokenCount int
}

type TokenData struct {
    Text string
}

type LLMResponseData struct {
    TokensIn  int
    TokensOut int
    CacheRead int
    Iteration int
}

type ToolStartData struct {
    Name string
    ID   string
}

type ToolOutputData struct {
    Name  string
    ID    string
    Chunk string
}

type ToolResultData struct {
    Name     string
    ID       string
    Duration time.Duration
    Error    error
}

type RunCompletedData struct {
    FinalMessage string
    Iterations   int
    ToolsCalled  int
}

type CancelledData struct {
    Reason string
}

// Run represents a single agent turn.
type Run struct {
    ID             string
    AppID          string
    ConversationID string
    AgentID        string
    Status         RunStatus
    Model          string
    Budget         Budget
    CreatedAt      time.Time
}

func (r *Run) Topic() string {
    return fmt.Sprintf("run:%s", r.ID)
}

// Budget controls for a run.
type Budget struct {
    MaxTokens    int
    MaxToolCalls int
    MaxDuration  time.Duration

    TokensUsed    int
    ToolCallsUsed int
    StartedAt     time.Time
}

var ErrBudgetExceeded = errors.New("budget exceeded")

func (b *Budget) Check() error {
    if b.MaxTokens > 0 && b.TokensUsed >= b.MaxTokens {
        return fmt.Errorf("%w: token limit %d reached", ErrBudgetExceeded, b.MaxTokens)
    }
    if b.MaxToolCalls > 0 && b.ToolCallsUsed >= b.MaxToolCalls {
        return fmt.Errorf("%w: tool call limit %d reached", ErrBudgetExceeded, b.MaxToolCalls)
    }
    if b.MaxDuration > 0 && !b.StartedAt.IsZero() && time.Since(b.StartedAt) >= b.MaxDuration {
        return fmt.Errorf("%w: duration limit %s reached", ErrBudgetExceeded, b.MaxDuration)
    }
    return nil
}
```

This also needs a tiny ID generation helper:

```go
// go-agent/internal/id/id.go
package id

import (
    "crypto/rand"
    "encoding/hex"
    "fmt"
)

func New(prefix string) string {
    b := make([]byte, 8)
    _, _ = rand.Read(b)
    return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(b))
}
```

**Step 4: Run tests**

```bash
cd go-agent && go test ./internal/run/... -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add go-agent/internal/
git commit -m "feat(go-agent): run types, event types, and budget controls"
```

---

## Task 3: Event Bus

**Files:**

- Create: `go-agent/internal/eventbus/eventbus.go`
- Create: `go-agent/internal/eventbus/eventbus_test.go`

**Step 1: Write tests**

```go
// go-agent/internal/eventbus/eventbus_test.go
package eventbus

import (
    "sync"
    "testing"
    "time"

    "github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestPublishSubscribe(t *testing.T) {
    bus := New()
    sub := bus.Subscribe("run:abc", 10)
    defer sub.Close()

    ev := run.NewRunEvent(run.EventLLMToken, run.TokenData{Text: "hi"})
    bus.Publish("run:abc", ev)

    select {
    case received := <-sub.Ch:
        assert.Equal(t, run.EventLLMToken, received.Type)
    case <-time.After(100 * time.Millisecond):
        t.Fatal("timed out waiting for event")
    }
}

func TestSubscribeDoesNotReceiveOtherTopics(t *testing.T) {
    bus := New()
    sub := bus.Subscribe("run:abc", 10)
    defer sub.Close()

    bus.Publish("run:xyz", run.NewRunEvent(run.EventLLMToken, nil))

    select {
    case <-sub.Ch:
        t.Fatal("should not receive events from other topics")
    case <-time.After(50 * time.Millisecond):
        // Expected: no event
    }
}

func TestMultipleSubscribers(t *testing.T) {
    bus := New()
    sub1 := bus.Subscribe("run:abc", 10)
    sub2 := bus.Subscribe("run:abc", 10)
    defer sub1.Close()
    defer sub2.Close()

    bus.Publish("run:abc", run.NewRunEvent(run.EventRunStarted, nil))

    for _, sub := range []*Subscription{sub1, sub2} {
        select {
        case ev := <-sub.Ch:
            assert.Equal(t, run.EventRunStarted, ev.Type)
        case <-time.After(100 * time.Millisecond):
            t.Fatal("subscriber did not receive event")
        }
    }
}

func TestCloseUnsubscribes(t *testing.T) {
    bus := New()
    sub := bus.Subscribe("run:abc", 10)
    sub.Close()

    bus.Publish("run:abc", run.NewRunEvent(run.EventRunStarted, nil))
    // Channel should be closed, read returns zero value
    _, ok := <-sub.Ch
    assert.False(t, ok)
}

func TestBackpressureDropsEvents(t *testing.T) {
    bus := New()
    sub := bus.Subscribe("run:abc", 2) // Tiny buffer
    defer sub.Close()

    // Publish more events than buffer can hold
    for i := 0; i < 10; i++ {
        bus.Publish("run:abc", run.NewRunEvent(run.EventLLMToken, run.TokenData{Text: "x"}))
    }

    // Should get at most buffer-size events without blocking
    count := 0
    for {
        select {
        case _, ok := <-sub.Ch:
            if !ok {
                goto done
            }
            count++
        case <-time.After(50 * time.Millisecond):
            goto done
        }
    }
done:
    assert.LessOrEqual(t, count, 10)
    assert.GreaterOrEqual(t, count, 2)
}

func TestConcurrentPublish(t *testing.T) {
    bus := New()
    sub := bus.Subscribe("run:abc", 100)
    defer sub.Close()

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            bus.Publish("run:abc", run.NewRunEvent(run.EventLLMToken, nil))
        }()
    }
    wg.Wait()

    count := 0
    for {
        select {
        case <-sub.Ch:
            count++
        case <-time.After(50 * time.Millisecond):
            goto done2
        }
    }
done2:
    assert.Equal(t, 10, count)
}
```

**Step 2: Run tests to verify they fail**

```bash
cd go-agent && go test ./internal/eventbus/... -v
# Expected: FAIL
```

**Step 3: Implement event bus**

```go
// go-agent/internal/eventbus/eventbus.go
package eventbus

import (
    "sync"

    "github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
)

type Subscription struct {
    Ch     <-chan run.RunEvent
    ch     chan run.RunEvent
    Close  func()
    Dropped int64
}

type Bus struct {
    mu          sync.RWMutex
    subscribers map[string][]*subscriber
}

type subscriber struct {
    ch      chan run.RunEvent
    closed  bool
    mu      sync.Mutex
    dropped int64
}

func New() *Bus {
    return &Bus{
        subscribers: make(map[string][]*subscriber),
    }
}

func (b *Bus) Publish(topic string, event run.RunEvent) {
    b.mu.RLock()
    subs := b.subscribers[topic]
    b.mu.RUnlock()

    for _, s := range subs {
        s.mu.Lock()
        if s.closed {
            s.mu.Unlock()
            continue
        }
        select {
        case s.ch <- event:
        default:
            s.dropped++
        }
        s.mu.Unlock()
    }
}

func (b *Bus) Subscribe(topic string, bufferSize int) *Subscription {
    ch := make(chan run.RunEvent, bufferSize)
    s := &subscriber{ch: ch}

    b.mu.Lock()
    b.subscribers[topic] = append(b.subscribers[topic], s)
    b.mu.Unlock()

    return &Subscription{
        Ch: ch,
        ch: ch,
        Close: func() {
            s.mu.Lock()
            defer s.mu.Unlock()
            if !s.closed {
                s.closed = true
                close(s.ch)
            }
            b.mu.Lock()
            subs := b.subscribers[topic]
            for i, sub := range subs {
                if sub == s {
                    b.subscribers[topic] = append(subs[:i], subs[i+1:]...)
                    break
                }
            }
            b.mu.Unlock()
        },
    }
}
```

**Step 4: Run tests**

```bash
cd go-agent && go test ./internal/eventbus/... -v -race
# Expected: PASS
```

**Step 5: Commit**

```bash
git add go-agent/internal/eventbus/
git commit -m "feat(go-agent): event bus with pub/sub and backpressure"
```

---

## Task 4: Tool Interface and Registry

**Files:**

- Create: `go-agent/internal/tool/tool.go`
- Create: `go-agent/internal/tool/registry.go`
- Create: `go-agent/internal/tool/registry_test.go`
- Create: `go-agent/internal/tool/stream.go`

**Step 1: Write tests**

```go
// go-agent/internal/tool/registry_test.go
package tool

import (
    "context"
    "encoding/json"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

type echoTool struct{}

func (e *echoTool) Name() string                    { return "echo" }
func (e *echoTool) Description() string             { return "Echoes input" }
func (e *echoTool) InputSchema() json.RawMessage     { return json.RawMessage(`{"type":"object"}`) }
func (e *echoTool) Execute(ctx context.Context, input json.RawMessage, out OutputStream) error {
    out.Write(string(input))
    return nil
}

func TestRegistryRegisterAndGet(t *testing.T) {
    reg := NewRegistry()
    reg.Register(&echoTool{})

    tool, ok := reg.Get("echo")
    require.True(t, ok)
    assert.Equal(t, "echo", tool.Name())
}

func TestRegistryGetMissing(t *testing.T) {
    reg := NewRegistry()
    _, ok := reg.Get("missing")
    assert.False(t, ok)
}

func TestRegistryForAgent(t *testing.T) {
    reg := NewRegistry()
    reg.Register(&echoTool{})

    tools := reg.ForAgent([]string{"echo", "missing"})
    assert.Len(t, tools, 1)
    assert.Equal(t, "echo", tools[0].Name())
}

func TestRegistryExecute(t *testing.T) {
    reg := NewRegistry()
    reg.Register(&echoTool{})

    out := &BufferedStream{}
    err := reg.Execute(context.Background(), "echo", json.RawMessage(`"hello"`), out)
    require.NoError(t, err)
    assert.Equal(t, `"hello"`, out.String())
}

func TestRegistryExecuteUnknown(t *testing.T) {
    reg := NewRegistry()
    out := &BufferedStream{}
    err := reg.Execute(context.Background(), "nope", nil, out)
    assert.Error(t, err)
}

func TestBufferedStream(t *testing.T) {
    s := &BufferedStream{}
    s.Write("hello ")
    s.Write("world")
    assert.Equal(t, "hello world", s.String())

    s.SetMetadata("key", "value")
    assert.Equal(t, "value", s.Metadata()["key"])
}
```

**Step 2: Run tests to verify they fail**

```bash
cd go-agent && go test ./internal/tool/... -v
# Expected: FAIL
```

**Step 3: Implement tool interface, stream, and registry**

```go
// go-agent/internal/tool/tool.go
package tool

import (
    "context"
    "encoding/json"
)

type Tool interface {
    Name() string
    Description() string
    InputSchema() json.RawMessage
    Execute(ctx context.Context, input json.RawMessage, output OutputStream) error
}

type OutputStream interface {
    Write(chunk string)
    WriteError(chunk string)
    SetMetadata(key string, value any)
}

type Result struct {
    Content  string
    IsError  bool
    Metadata map[string]any
}
```

```go
// go-agent/internal/tool/stream.go
package tool

import (
    "strings"
    "sync"
)

type BufferedStream struct {
    mu       sync.Mutex
    buf      strings.Builder
    errBuf   strings.Builder
    metadata map[string]any
}

func (s *BufferedStream) Write(chunk string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.buf.WriteString(chunk)
}

func (s *BufferedStream) WriteError(chunk string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.errBuf.WriteString(chunk)
}

func (s *BufferedStream) SetMetadata(key string, value any) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.metadata == nil {
        s.metadata = make(map[string]any)
    }
    s.metadata[key] = value
}

func (s *BufferedStream) String() string {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.buf.String()
}

func (s *BufferedStream) ErrorString() string {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.errBuf.String()
}

func (s *BufferedStream) Metadata() map[string]any {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.metadata
}
```

```go
// go-agent/internal/tool/registry.go
package tool

import (
    "context"
    "encoding/json"
    "fmt"
    "sync"
)

type Registry struct {
    mu    sync.RWMutex
    tools map[string]Tool
}

func NewRegistry() *Registry {
    return &Registry{
        tools: make(map[string]Tool),
    }
}

func (r *Registry) Register(t Tool) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.tools[t.Name()] = t
}

func (r *Registry) Get(name string) (Tool, bool) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    t, ok := r.tools[name]
    return t, ok
}

func (r *Registry) ForAgent(toolNames []string) []Tool {
    r.mu.RLock()
    defer r.mu.RUnlock()
    var tools []Tool
    for _, name := range toolNames {
        if t, ok := r.tools[name]; ok {
            tools = append(tools, t)
        }
    }
    return tools
}

func (r *Registry) Execute(ctx context.Context, name string, input json.RawMessage, out OutputStream) error {
    t, ok := r.Get(name)
    if !ok {
        return fmt.Errorf("unknown tool: %s", name)
    }
    return t.Execute(ctx, input, out)
}

func (r *Registry) All() map[string]Tool {
    r.mu.RLock()
    defer r.mu.RUnlock()
    result := make(map[string]Tool, len(r.tools))
    for k, v := range r.tools {
        result[k] = v
    }
    return result
}
```

**Step 4: Run tests**

```bash
cd go-agent && go test ./internal/tool/... -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add go-agent/internal/tool/
git commit -m "feat(go-agent): tool interface, output stream, and registry"
```

---

## Task 5: Native Tools — readFile and directoryListing

**Files:**

- Create: `go-agent/internal/tool/fileops/read_file.go`
- Create: `go-agent/internal/tool/fileops/read_file_test.go`
- Create: `go-agent/internal/tool/fileops/directory_listing.go`
- Create: `go-agent/internal/tool/fileops/directory_listing_test.go`
- Create: `go-agent/internal/tool/fileops/file_edit.go`
- Create: `go-agent/internal/tool/fileops/file_edit_test.go`

Reference the TS implementations for input schemas and output formats:

- `agents/src/tools/ai-lib-tools/read-file.ts` — Line-numbered output, optional startLine/numLines
- `agents/src/tools/ai-lib-tools/directory-listing.ts` — Tree output, pattern/search/maxDepth/showHidden
- `agents/src/tools/ai-lib-tools/file-edit.ts` — str_replace style: old/new pairs with exact match

**Step 1: Write read_file tests**

Test cases: read full file with line numbers, read partial file with startLine/numLines, file not found error, path traversal rejection (attempts to read outside app root).

Input schema matches TS:

```json
{
  "path": "relative/to/app/root",
  "startLine": 1,
  "numLines": 10
}
```

Output format matches TS:

```
File: {path}
Lines {start}-{end} of {totalLines}
File size: {bytes}

Content (with line numbers):
     1|line content
     2|line content
```

**Step 2: Run tests to verify they fail**

```bash
cd go-agent && go test ./internal/tool/fileops/... -v
```

**Step 3: Implement readFile tool**

- Parse JSON input with `path`, optional `startLine`, optional `numLines`
- Validate path does not escape the app root (reject `..` traversal)
- Read file, split into lines, format with line numbers
- Stream the formatted output

**Step 4: Write directory_listing tests**

Test cases: list root, filter by pattern, directoriesOnly, maxDepth, showHidden.

**Step 5: Implement directoryListing tool**

- Recursive `os.ReadDir` with depth tracking
- Pattern matching via `filepath.Match`
- Tree-formatted output

**Step 6: Write file_edit tests (str_replace_based_edit_tool)**

Test cases: single replacement, multiple replacements in one file, replacement not found (error), create new file, path traversal rejection.

Input schema — use the Anthropic native text editor pattern:

```json
{
  "command": "str_replace",
  "path": "relative/path",
  "old_str": "text to find",
  "new_str": "replacement text"
}
```

Also support `"command": "create"` with `"file_text"` and `"command": "view"`.

**Step 7: Implement file_edit tool**

- `str_replace`: find exact match of old_str in file, replace with new_str, write back
- `create`: write file_text to path (creating directories as needed)
- `view`: delegate to readFile behavior
- Error if old_str not found or found multiple times

**Step 8: Run all fileops tests**

```bash
cd go-agent && go test ./internal/tool/fileops/... -v
# Expected: PASS
```

**Step 9: Commit**

```bash
git add go-agent/internal/tool/fileops/
git commit -m "feat(go-agent): native tools — readFile, directoryListing, fileEdit"
```

---

## Task 6: Native Tools — grepSearch

**Files:**

- Create: `go-agent/internal/tool/grep/grep.go`
- Create: `go-agent/internal/tool/grep/grep_test.go`

Reference: `agents/src/tools/ai-lib-tools/grep-search.ts`

**Step 1: Write tests**

Test cases: literal search, regex search, case insensitive, context lines, max results, include/exclude patterns, grouped-by-file output format.

Input schema matches TS:

```json
{
  "query": "searchterm",
  "paths": ["src/"],
  "regex": false,
  "caseSensitive": false,
  "contextLines": 3,
  "maxResults": 50,
  "includePatterns": ["*.go"],
  "excludePatterns": ["vendor/"]
}
```

**Step 2: Implement grepSearch**

Use `os.ReadDir` recursive walk + `regexp` or `strings.Contains` for matching. Format output grouped by file with line numbers and context lines, matching the TS tool's `formatForLLM` output.

Alternatively, shell out to `rg` (ripgrep) if available, falling back to pure Go implementation if not. The TS tool uses its own implementation, not ripgrep, so pure Go is fine.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add go-agent/internal/tool/grep/
git commit -m "feat(go-agent): native grepSearch tool"
```

---

## Task 7: Native Tools — terminalCommand

**Files:**

- Create: `go-agent/internal/tool/terminal/terminal.go`
- Create: `go-agent/internal/tool/terminal/terminal_test.go`

Reference: `agents/src/tools/ai-lib-tools/terminal-command.ts`

The TS tool routes through dev-supervisor. For Phase 1 local dev, we can execute commands directly. In production, the Go agent IS the container process, so direct exec is appropriate.

**Step 1: Write tests**

Test cases: simple command (`echo hello`), command with working dir, command timeout, streaming output (writes chunks as command produces output), command failure (nonzero exit).

Input schema:

```json
{
  "command": "npm install",
  "workingDir": "preview/",
  "timeout": 30000
}
```

**Step 2: Implement terminalCommand**

- Parse input, validate command against dangerous command blocklist (from `dev-supervisor/internal/validation/`)
- Create `exec.CommandContext` with timeout from context
- Pipe stdout/stderr to the `OutputStream` in real-time using `io.Copy` with a custom writer
- Return combined output on completion

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add go-agent/internal/tool/terminal/
git commit -m "feat(go-agent): native terminalCommand tool with streaming output"
```

---

## Task 8: TS Bridge Client

**Files:**

- Create: `go-agent/internal/toolbridge/bridge.go`
- Create: `go-agent/internal/toolbridge/bridge_test.go`
- Create: `ts-bridge/server.ts`
- Create: `ts-bridge/package.json`

**Step 1: Write Go bridge client tests**

Test using a mock HTTP server over Unix socket. Test cases: successful tool call, streaming response (NDJSON chunks), tool error, bridge unavailable, context cancellation.

**Step 2: Implement Go bridge client**

```go
// go-agent/internal/toolbridge/bridge.go
package toolbridge

// BridgeTool implements tool.Tool by calling the TS bridge over Unix socket.
// Each BridgeTool wraps one legacy TypeScript tool.
//
// Protocol: POST /tools/{name} with JSON body
// Response: NDJSON stream — each line is {"chunk":"..."} or {"error":"..."}
```

- Configure `http.Client` with Unix socket transport (`net.Dial("unix", socketPath)`)
- `Execute` sends POST, reads NDJSON response line by line, writes each chunk to the `OutputStream`
- On context cancellation, close the response body

**Step 3: Implement TS bridge server**

Minimal Express server that imports existing tool implementations:

```typescript
// ts-bridge/server.ts
// Exposes legacy TS tools over Unix socket REST API
// POST /tools/:name — executes tool, returns NDJSON stream
// GET /tools — returns list of available tools with schemas
```

- Listen on Unix socket (path from env: `TS_BRIDGE_SOCKET_PATH`)
- Import tool implementations from `@airo/agents` (workspace dependency)
- Stream results as NDJSON for tools that support streaming

**Workspace dependency:** `ts-bridge/package.json` must declare `"@airo/agents": "workspace:*"` as a dependency so pnpm resolves the import correctly. The bridge is a separate workspace package in the monorepo, not a loose script importing across package boundaries. Add `"ts-bridge"` to the root `pnpm-workspace.yaml` packages list.

**Step 4: Write discovery function**

```go
// DiscoverTools connects to the bridge and fetches available tool names/schemas
func DiscoverTools(socketPath string) ([]BridgeTool, error)
```

Calls `GET /tools` on the bridge to get tool names and input schemas.

**Step 5: Run tests, verify pass**

**Step 6: Commit**

```bash
git add go-agent/internal/toolbridge/ ts-bridge/
git commit -m "feat(go-agent): TS bridge client and server for legacy tools"
```

---

## Task 9: Prompt Loader

**Files:**

- Create: `go-agent/prompts/embed.go` (declares `//go:embed **/*.md` at the correct directory level)
- Create: `go-agent/internal/prompt/loader.go`
- Create: `go-agent/internal/prompt/loader_test.go`
- Create: `go-agent/prompts/` (copy of `agents/src/prompts/` markdown files)

Reference: `agents/src/base/base-agent.ts` and `agents/src/prompts/` directory structure.

**Step 1: Write tests**

Test cases: load single base prompt, compose with fragments, conditional fragment (included when condition true, excluded when false), template description injection, unknown fragment returns error.

Use `testing/fstest.MapFS` to create an in-memory filesystem for tests rather than depending on real prompt files.

**Step 2: Implement prompt embedding and loader**

The `go:embed` directive resolves paths relative to the source file's directory, and does not support `..` traversal. Since prompt files live at `go-agent/prompts/`, the `embed.FS` variable must be declared in a file at that same level — not inside `internal/prompt/`.

```go
// go-agent/prompts/embed.go
package prompts

import "embed"

//go:embed **/*.md
var FS embed.FS
```

The loader accepts any `fs.FS`, so it's testable with `testing/fstest.MapFS` and wired to `prompts.FS` in production:

```go
// go-agent/internal/prompt/loader.go
package prompt

import (
    "io/fs"
)

type Loader struct {
    fs fs.FS
}

type Config struct {
    BasePrompt   string
    Fragments    []string
    Conditionals []ConditionalFragment
}

type ConditionalFragment struct {
    Fragment  string
    Condition func(Context) bool
}

type Context struct {
    AppID         string
    TemplateType  string
    EnabledSkills []string
    FeatureFlags  map[string]bool
}

func (l *Loader) Compose(config Config, ctx Context) (string, error) {
    // 1. Read base prompt
    // 2. Append static fragments
    // 3. Append conditional fragments where condition(ctx) is true
    // 4. Append template description if ctx.TemplateType is set
    // 5. Append dynamic sections (skills list)
    // Return assembled string
}
```

**Step 3: Copy prompt files**

Copy `agents/src/prompts/` to `go-agent/prompts/` so they can be embedded. During cutover, keep both in sync (or symlink).

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git add go-agent/prompts/embed.go go-agent/internal/prompt/ go-agent/prompts/
git commit -m "feat(go-agent): prompt loader with embedded markdown fragments"
```

---

## Task 10: Anthropic Streaming Client

**Files:**

- Create: `go-agent/internal/llm/anthropic.go`
- Create: `go-agent/internal/llm/anthropic_test.go`
- Create: `go-agent/internal/llm/types.go`

**Step 1: Add Anthropic SDK dependency**

```bash
cd go-agent && go get github.com/anthropics/anthropic-sdk-go
```

**Step 2: Define LLM types**

```go
// go-agent/internal/llm/types.go
package llm

type Message struct {
    Role    string    // "user" or "assistant"
    Content []Content
}

type Content struct {
    Type      string // "text", "tool_use", "tool_result"
    Text      string
    ToolUseID string
    ToolName  string
    Input     json.RawMessage
}

type ToolCall struct {
    ID    string
    Name  string
    Input json.RawMessage
}

type StreamCallback func(event StreamEvent)

type StreamEvent struct {
    Type      string // "token", "tool_call", "response", "error"
    Text      string
    ToolCall  *ToolCall
    Usage     *Usage
    Error     error
}

type Usage struct {
    InputTokens  int
    OutputTokens int
    CacheRead    int
}
```

**Step 3: Write tests**

Test the client wrapper with a mock HTTP server that returns SSE responses matching Anthropic's streaming format. Test cases: text-only response, response with tool calls, streaming cancellation via context, API error handling.

**Step 4: Implement Anthropic client wrapper**

```go
// go-agent/internal/llm/anthropic.go
package llm

// Client wraps the Anthropic SDK and provides streaming with callbacks
type Client struct {
    client *anthropic.Client
}

func NewClient(apiKey string) *Client

// StreamMessage sends a message and calls the callback for each streaming event.
// Returns the complete response and any tool calls.
func (c *Client) StreamMessage(
    ctx context.Context,
    model string,
    system string,
    messages []Message,
    tools []tool.Tool,
) (string, []ToolCall, *Usage, error)
```

The wrapper translates between our internal types and the Anthropic SDK types, and handles the streaming event loop. It publishes nothing to the event bus — that's the run engine's job.

**Step 5: Run tests, verify pass**

**Step 6: Commit**

```bash
git add go-agent/internal/llm/
git commit -m "feat(go-agent): Anthropic streaming client wrapper"
```

---

## Task 11: SQLite Store

**Files:**

- Create: `go-agent/internal/store/db.go`
- Create: `go-agent/internal/store/conversations.go`
- Create: `go-agent/internal/store/conversations_test.go`
- Create: `go-agent/internal/store/messages.go`
- Create: `go-agent/internal/store/messages_test.go`
- Create: `go-agent/internal/store/apps.go`
- Create: `go-agent/internal/store/apps_test.go`
- Create: `go-agent/internal/store/token_usage.go`
- Create: `go-agent/internal/store/token_usage_test.go`

Reference: `agents/src/database/schema.ts` for exact table definitions, `agents/src/database/repositories/` for query patterns.

**Step 1: Implement database connection**

```go
// go-agent/internal/store/db.go
package store

import (
    "database/sql"
    _ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
    db, err := sql.Open("sqlite", path)
    // Set pragmas: WAL mode, foreign keys ON, synchronous=NORMAL, cache_size=1000
    // Run schema migrations (CREATE TABLE IF NOT EXISTS for all tables)
    return db, err
}
```

Use the same schema as the TS agent (`agents/src/database/schema.ts`) so both can read/write the same DB.

**Step 2: Write conversation repository tests**

Test cases: create conversation, list conversations for app, get conversation by ID, update conversation.

**Step 3: Implement conversation repository**

**Step 4: Write message repository tests**

Test cases: add message, list messages for conversation (ordered by createdAt), message with tool calls (JSON field), message with metadata (JSON field).

**Step 5: Implement message repository**

**Step 6: Write app repository tests**

Test cases: get app by ID, create app, update app status.

**Step 7: Implement app repository**

**Step 8: Write token usage repository tests**

Test cases: record token usage, query usage by app.

**Step 9: Implement token usage repository**

**Step 10: Run all store tests**

```bash
cd go-agent && go test ./internal/store/... -v
# Expected: PASS
```

**Step 11: Commit**

```bash
git add go-agent/internal/store/
git commit -m "feat(go-agent): SQLite store — conversations, messages, apps, token usage"
```

---

## Task 12: Run Store (In-Memory Event Log)

**Files:**

- Create: `go-agent/internal/run/store.go`
- Create: `go-agent/internal/run/store_test.go`

**Step 1: Write tests**

Test cases: append events with auto-incrementing sequence, subscribe from beginning, subscribe from offset (replay + live), subscribe from offset with no events yet (blocks until events arrive), get run, multiple concurrent subscribers, events after all subscribers close.

**Step 2: Implement in-memory run store**

```go
// go-agent/internal/run/store.go
package run

// Store holds the in-memory event log for active runs.
// Supports append, subscribe-from-offset, and get.
type Store struct {
    // map[runID]*runLog
}

type runLog struct {
    run     *Run
    events  []RunEvent
    seq     int64
    subs    []*logSubscription
    mu      sync.RWMutex
}

func NewStore() *Store
func (s *Store) Create(run *Run)
func (s *Store) Append(runID string, event RunEvent) // Auto-assigns sequence
func (s *Store) Subscribe(runID string, fromSeq int64) (<-chan RunEvent, func())
func (s *Store) Get(runID string) (*Run, error)
func (s *Store) Events(runID string, fromSeq int64) ([]RunEvent, error)
func (s *Store) Remove(runID string) // Cleanup after TTL
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add go-agent/internal/run/store.go go-agent/internal/run/store_test.go
git commit -m "feat(go-agent): in-memory run store with subscribe-from-offset"
```

---

## Task 13: Run Engine

**Files:**

- Create: `go-agent/internal/run/engine.go`
- Create: `go-agent/internal/run/engine_test.go`

This is the core agent loop. It depends on: event bus, tool registry, prompt loader, LLM client, run store.

**Step 1: Write tests**

Use mock/fake implementations for all dependencies:

- Fake LLM client that returns canned responses (text-only, with tool calls, multi-iteration)
- Fake tools that return predetermined results
- Real event bus (it's simple enough to use directly)
- Real run store

Test cases:

1. Simple text response — one LLM call, no tools, emits RunStarted → PromptBuilt → LLMRequestStart → LLMToken(s) → LLMResponse → RunCompleted
2. Single tool call iteration — LLM returns tool call, tool executes, second LLM call returns text
3. Multi-iteration loop — LLM returns tool calls twice before final text
4. Cancellation via context — verify RunCancelled event emitted
5. Budget exceeded — verify RunCancelled with budget reason
6. Tool error — tool returns error, error is sent to LLM as tool result, LLM handles it
7. Stop-after tool — tool named in stop list causes run to complete immediately

**Step 2: Implement run engine**

```go
// go-agent/internal/run/engine.go
package run

type Engine struct {
    eventBus     *eventbus.Bus
    store        *Store
    llmClient    LLMClient
    toolRegistry *tool.Registry
    promptLoader *prompt.Loader
    agentConfigs map[string]AgentConfig
}

type LLMClient interface {
    StreamMessage(ctx context.Context, model string, system string,
        messages []llm.Message, tools []tool.Tool,
        onEvent func(llm.StreamEvent),
    ) (string, []llm.ToolCall, *llm.Usage, error)
}

type AgentConfig struct {
    ID           string
    PromptConfig prompt.Config
    Tools        []string
    StopAfter    []string
    Model        string
}

func (e *Engine) Execute(ctx context.Context, run *Run, userMessage string)
```

Follow the design doc's Execute pseudocode. Key implementation details:

- Create a child context with cancel for the run
- Publish events to the event bus at every step
- Execute tools in parallel with `sync.WaitGroup`
- Check budget before each LLM call and each tool batch
- Track iterations, tool calls used, tokens used in the budget

Also implement `eventBusToolStream` — the adapter that bridges the `tool.OutputStream` interface to event bus `EventToolOutput` events:

```go
// eventBusToolStream implements tool.OutputStream by publishing EventToolOutput
// events to the event bus and accumulating full output for the LLM tool result.
type eventBusToolStream struct {
    bus      *eventbus.Bus
    topic    string
    callID   string
    name     string
    buf      strings.Builder
    metadata map[string]any
}

func (s *eventBusToolStream) Write(chunk string) {
    s.buf.WriteString(chunk)
    s.bus.Publish(s.topic, run.RunEvent{
        Type: run.EventToolOutput,
        Data: ToolOutputData{CallID: s.callID, Name: s.name, Chunk: chunk},
    })
}

func (s *eventBusToolStream) WriteError(chunk string) { s.Write(chunk) }
func (s *eventBusToolStream) SetMetadata(key string, value any) {
    if s.metadata == nil {
        s.metadata = make(map[string]any)
    }
    s.metadata[key] = value
}
func (s *eventBusToolStream) FullOutput() string { return s.buf.String() }
```

Test `eventBusToolStream` alongside the engine tests: verify that tool output chunks appear as `EventToolOutput` events and that `FullOutput()` returns the concatenated result.

**Step 3: Run tests, verify pass**

```bash
cd go-agent && go test ./internal/run/... -v
# Expected: PASS
```

**Step 4: Commit**

```bash
git add go-agent/internal/run/engine.go go-agent/internal/run/engine_test.go
git commit -m "feat(go-agent): run engine — agent loop with streaming, tools, cancellation"
```

---

## Task 14: Agent Definitions

**Files:**

- Create: `go-agent/internal/agent/agents.go`
- Create: `go-agent/internal/agent/agents_test.go`

Phase 1 only needs DevelopAgent. Other agents come in Phase 2.

**Step 1: Write tests**

Test: DevelopAgent config has expected tool list, prompt config points to valid fragments.

**Step 2: Implement agent configs**

```go
// go-agent/internal/agent/agents.go
package agent

import (
    "github.com/gdcorp-partners/airo-app-builder/go-agent/internal/prompt"
    "github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
)

func DevelopAgent() run.AgentConfig {
    return run.AgentConfig{
        ID:    "develop",
        Model: "claude-sonnet-4-6",
        PromptConfig: prompt.Config{
            BasePrompt: "develop/core.md",
            Fragments: []string{
                "shared/filesystem.md",
                "shared/security.md",
                "shared/communication.md",
                // ... other fragments matching TS DevelopAgent
            },
        },
        Tools: []string{
            "readFile",
            "str_replace_based_edit_tool",
            "directoryListing",
            "terminalCommand",
            "grepSearch",
            "todoList",
            "setProjectName",
            "serverRestart",
            "viewLogs",
            "publishClient",
            "publishStatus",
            "suggestedResponse",
        },
        StopAfter: []string{"suggestedResponse"},
    }
}

func AllAgents() map[string]run.AgentConfig {
    return map[string]run.AgentConfig{
        "develop": DevelopAgent(),
    }
}
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add go-agent/internal/agent/
git commit -m "feat(go-agent): DevelopAgent config with tools and prompt fragments"
```

---

## Task 15: Config System

**Files:**

- Create: `go-agent/internal/config/config.go`
- Create: `go-agent/internal/config/config_test.go`

**Step 1: Write tests**

Test: defaults are sensible, env vars override defaults, required vars (ANTHROPIC_API_KEY) cause error when missing.

**Step 2: Implement config**

```go
// go-agent/internal/config/config.go
package config

import "os"

type Config struct {
    Port              string // Default: "4000"
    AnthropicAPIKey   string // Required
    DatabasePath      string // Default: "data/agents.db"
    AppRootPath       string // Default: "/tmp/airo-app-builder/{appId}/preview"
    BridgeSocketPath  string // Default: "/tmp/ts-bridge.sock"
    LogLevel          string // Default: "info"
    MaxOldSpaceSize   int    // For reference/metrics, not used by Go
    MultiTenant       bool   // Default: false
}

func Load() (*Config, error) {
    // Read from environment variables
    // Validate required fields
    // Apply defaults
}
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add go-agent/internal/config/
git commit -m "feat(go-agent): environment-based configuration"
```

---

## Task 16: Session Manager

**Files:**

- Create: `go-agent/internal/session/manager.go`
- Create: `go-agent/internal/session/manager_test.go`

**Step 1: Write tests**

Test cases:

1. HandleConnect (Case 4 — fresh) — creates session, returns empty ConnectResponse
2. HandleConnect (Case 1 — has conversationId + lastSeq) — returns active run info, triggers replay
3. HandleMessage — creates run, subscribes session to run events
4. HandleCancel — cancels active run
5. HandleDisconnect — removes session, run continues
6. Reconnect — new session attaches to existing run
7. Ownership validation — rejects messages for wrong appID

**Step 2: Implement session manager**

```go
// go-agent/internal/session/manager.go
package session

type Manager struct {
    sessions   map[string]*Session // connectionID → session
    runsByConv map[string]string   // appID:conversationID → runID
    eventBus   *eventbus.Bus
    runEngine  *run.Engine
    runStore   *run.Store
    convStore  *store.ConversationRepo
    mu         sync.RWMutex
}

type Session struct {
    ConnectionID   string
    AppID          string
    ConversationID string
    ActiveRunID    string
    LastAckedSeq   int64
}

func (m *Manager) HandleConnect(connID string, appID string, data ConnectData) (*ConnectResponse, error)
func (m *Manager) HandleMessage(connID string, message string) error
func (m *Manager) HandleCancel(connID string) error
func (m *Manager) HandleDisconnect(connID string)
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add go-agent/internal/session/
git commit -m "feat(go-agent): session manager with reconnection scenarios"
```

---

## Task 17: WebSocket Transport

**Files:**

- Create: `go-agent/internal/transport/server.go`
- Create: `go-agent/internal/transport/server_test.go`
- Create: `go-agent/internal/transport/protocol.go`

**Step 1: Add WebSocket dependency**

```bash
cd go-agent && go get github.com/coder/websocket
```

**Step 2: Define protocol types**

```go
// go-agent/internal/transport/protocol.go
package transport

type ClientMessage struct {
    Type string          `json:"type"`
    ID   string          `json:"id"`
    Data json.RawMessage `json:"data"`
}

type ServerMessage struct {
    Type     string `json:"type"`
    ID       string `json:"id,omitempty"`
    Sequence int64  `json:"seq"`
    Data     any    `json:"data"`
}

type ConnectData struct {
    AppID          string `json:"appId"`
    ConversationID string `json:"conversationId,omitempty"`
    LastSequence   *int64 `json:"lastSeq,omitempty"`
}

type ConnectResponse struct {
    ConversationID string `json:"conversationId"`
    RunID          string `json:"runId,omitempty"`
    RunStatus      string `json:"runStatus,omitempty"`
    ReplayFrom     *int64 `json:"replayFrom,omitempty"`
}
```

**Step 3: Write transport tests**

Use `httptest.NewServer` with WebSocket upgrade. Test cases:

1. Connect, send `connect` message, receive `connected` response
2. Send `message`, receive streamed `token` events and `run_complete`
3. Send `ping`, receive `pong`
4. Send `cancel`, verify run cancellation
5. Invalid message type returns `error`
6. Connection without valid JWT rejected (401 on upgrade)

**Step 4: Implement WebSocket server**

```go
// go-agent/internal/transport/server.go
package transport

type Server struct {
    sessionMgr *session.Manager
    eventBus   *eventbus.Bus
    // JWT validation function (pluggable for testing)
    authFunc   func(r *http.Request) (appID string, err error)
}

func (s *Server) Handler() http.Handler
// Returns an http.Handler that upgrades to WebSocket

// Per-connection goroutine:
// 1. Validate JWT on upgrade
// 2. Read loop: parse ClientMessage, dispatch to session manager
// 3. Write loop: subscribe to run events via event bus, send ServerMessages
```

The transport server subscribes to the event bus for the active run and translates internal events to the client protocol (EventLLMToken → `token`, EventToolCallStart → `tool_status`, etc.).

**Step 5: Run tests, verify pass**

**Step 6: Commit**

```bash
git add go-agent/internal/transport/
git commit -m "feat(go-agent): WebSocket transport with protocol and auth"
```

---

## Task 18: Logging Subscriber

**Files:**

- Create: `go-agent/internal/observe/logger.go`
- Create: `go-agent/internal/observe/logger_test.go`

**Step 1: Write tests**

Test: subscribing to a run's events produces structured log output with correct field names following `domain.operation.lifecycle` convention.

**Step 2: Implement logging subscriber**

```go
// go-agent/internal/observe/logger.go
package observe

import "log/slog"

type LogSubscriber struct {
    logger *slog.Logger
}

// Subscribe listens to all events on a run topic and logs them.
func (l *LogSubscriber) Subscribe(bus *eventbus.Bus, runID string, appID string, agentID string)
```

Event → log mapping:

- `EventRunStarted` → `slog.Info("run.begin", "runId", ..., "agentId", ..., "appId", ...)`
- `EventLLMRequestStart` → `slog.Info("llm.request.begin", "runId", ..., "iteration", ...)`
- `EventToolCallStart` → `slog.Info("tool.call.begin", "runId", ..., "tool", ...)`
- `EventToolCallResult` → `slog.Info("tool.call.success", "runId", ..., "tool", ..., "durationMs", ...)`
- `EventLLMResponse` → `slog.Info("llm.response.success", "runId", ..., "tokensIn", ..., "tokensOut", ...)`
- `EventRunCompleted` → `slog.Info("run.success", "runId", ..., "totalDurationMs", ...)`
- `EventRunCancelled` → `slog.Warn("run.cancel", "runId", ..., "reason", ...)`
- `EventRunFailed` → `slog.Error("run.failure", "runId", ..., "error", ...)`

Use JSON handler for structured output (matching dev-supervisor's non-terminal behavior).

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add go-agent/internal/observe/
git commit -m "feat(go-agent): structured logging subscriber for run events"
```

---

## Task 19: Main Wiring and Health Endpoint

**Files:**

- Modify: `go-agent/cmd/agent/main.go`

**Step 1: Write integration test**

Test: start server, hit `/health`, get 200 with basic metrics. Connect via WebSocket, send a message (with mock LLM), receive streamed response.

Create `go-agent/cmd/agent/main_test.go` with a test that wires everything together using fakes for external deps (LLM client).

**Step 2: Implement main.go wiring**

```go
// go-agent/cmd/agent/main.go
package main

func main() {
    // 1. Load config
    cfg, err := config.Load()

    // 2. Open SQLite
    db, err := store.Open(cfg.DatabasePath)

    // 3. Create components
    bus := eventbus.New()
    runStore := run.NewStore()
    toolReg := tool.NewRegistry()
    promptLoader := prompt.NewLoader(prompt.EmbeddedPrompts)
    llmClient := llm.NewClient(cfg.AnthropicAPIKey)

    // 4. Register native tools
    toolReg.Register(fileops.NewReadFile(cfg.AppRootPath))
    toolReg.Register(fileops.NewFileEdit(cfg.AppRootPath))
    toolReg.Register(fileops.NewDirectoryListing(cfg.AppRootPath))
    toolReg.Register(grep.NewGrepSearch(cfg.AppRootPath))
    toolReg.Register(terminal.NewTerminalCommand(cfg.AppRootPath))

    // 5. Discover and register bridge tools
    if bridgeTools, err := toolbridge.DiscoverTools(cfg.BridgeSocketPath); err == nil {
        for _, bt := range bridgeTools {
            toolReg.Register(&bt)
        }
    }

    // 6. Create run engine
    engine := run.NewEngine(bus, runStore, llmClient, toolReg, promptLoader, agent.AllAgents())

    // 7. Create session manager
    sessMgr := session.NewManager(bus, engine, runStore, store.NewConversationRepo(db))

    // 8. Create transport
    transport := transport.NewServer(sessMgr, bus, authFunc)

    // 9. HTTP server
    mux := http.NewServeMux()
    mux.HandleFunc("/health", healthHandler(db))
    mux.Handle("/ws", transport.Handler())

    // 10. Start
    server := &http.Server{Addr: ":" + cfg.Port, Handler: mux}
    // Graceful shutdown on SIGTERM/SIGINT
}
```

**Step 3: Verify build and health endpoint**

```bash
cd go-agent && go build ./cmd/agent
# Start with mock config, hit /health
```

**Step 4: Commit**

```bash
git add go-agent/cmd/agent/
git commit -m "feat(go-agent): main wiring — health endpoint, WebSocket, all components"
```

---

## Task 20: End-to-End Smoke Test

**Files:**

- Create: `go-agent/e2e/smoke_test.go`

**Step 1: Write end-to-end test**

A single test that:

1. Starts the full Go agent (with a fake LLM client that returns a canned response with one tool call)
2. Connects via WebSocket
3. Sends a `connect` message
4. Sends a `message`
5. Asserts it receives: `token` events, `tool_status` (start), `tool_output`, `tool_status` (complete), more `token` events, `run_complete`
6. Verifies the conversation and messages were persisted to SQLite
7. Disconnects and reconnects, verifies reconnection replay

**Step 2: Implement and run**

```bash
cd go-agent && go test ./e2e/... -v -count=1
# Expected: PASS
```

**Step 3: Commit**

```bash
git add go-agent/e2e/
git commit -m "test(go-agent): end-to-end smoke test — full agent loop with WebSocket"
```

---

## Task 21: Monorepo Integration (CI/CD, Build Paths)

**Files:**

- Modify: `.github/workflows/` (CI pipeline for go-agent)
- Modify: root `Makefile` or `package.json` scripts (if applicable)
- Modify: `dev-supervisor/` Nomad/Docker build configuration

This task ensures the `go-agent/` module is visible to the existing build pipeline and deployment tooling.

**Step 1: CI/CD pipeline**

Add a GitHub Actions workflow (or extend existing) to build and test `go-agent/`:

- `go test -race ./...` in `go-agent/`
- `golangci-lint run` in `go-agent/`
- Build binary: `make -C go-agent build`
- Trigger on changes to `go-agent/**`

**Step 2: Root-level tooling**

If the monorepo has root-level scripts or Makefile targets that build/test all services, add `go-agent` entries. At minimum, ensure `pnpm build` or equivalent does not need to know about the Go module (it's independent), but document how to build it.

**Step 3: Docker/Nomad build paths**

Update the Dockerfile used by dev-supervisor or Nomad job templates to include the `go-agent` binary:

- Add a build stage in the multi-stage Dockerfile that compiles `go-agent`
- Ensure the Nomad job template can select between TS agent and Go agent binaries based on `agentType` configuration
- Document the Nomad job template differences (environment variables, ports, health check endpoints)

**Step 4: Commit**

```bash
git add .github/workflows/ dev-supervisor/
git commit -m "ci(go-agent): add CI pipeline and Docker/Nomad build integration"
```

---

## Task Summary

| Task | Component                   | Dependencies        | Parallel Group |
| ---- | --------------------------- | ------------------- | -------------- |
| 1    | Project scaffolding         | None                | A              |
| 2    | Event types, run types      | Task 1              | B              |
| 3    | Event bus                   | Task 2              | B              |
| 4    | Tool interface and registry | Task 1              | B              |
| 5    | Native tools: fileops       | Task 4              | C              |
| 6    | Native tools: grep          | Task 4              | C              |
| 7    | Native tools: terminal      | Task 4              | C              |
| 8    | TS bridge                   | Task 4              | C              |
| 9    | Prompt loader               | Task 1              | B              |
| 10   | Anthropic client            | Task 1              | B              |
| 11   | SQLite store                | Task 1              | B              |
| 12   | Run store                   | Task 2, 3           | C              |
| 13   | Run engine                  | Task 2, 3, 4, 9, 10 | D              |
| 14   | Agent definitions           | Task 9, 13          | E              |
| 15   | Config                      | Task 1              | B              |
| 16   | Session manager             | Task 3, 11, 12, 13  | E              |
| 17   | WebSocket transport         | Task 16             | F              |
| 18   | Logging subscriber          | Task 3              | C              |
| 19   | Main wiring                 | All above           | G              |
| 20   | E2E smoke test              | Task 19             | G              |
| 21   | Monorepo integration (CI/CD)| Task 1              | B              |

**Parallel groups** (tasks in the same group can be worked on concurrently):

- **A**: Scaffolding (must be first)
- **B**: Leaf components (types, eventbus, tool interface, prompt, llm, store, config, CI/CD)
- **C**: Tools and subscribers (depend on B)
- **D**: Run engine (depends on B + C interfaces)
- **E**: Agent configs and session manager (depend on D)
- **F**: Transport (depends on E)
- **G**: Integration (depends on everything)
