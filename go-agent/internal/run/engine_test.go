package run

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/eventbus"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/prompt"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// --- Fake LLM Client ---

// fakeLLMCall represents a single canned LLM response.
type fakeLLMCall struct {
	response  string
	toolCalls []ToolCall
	usage     *Usage
	err       error
	tokens    []string // streamed token chunks
}

// fakeLLM returns canned responses in sequence.
type fakeLLM struct {
	mu    sync.Mutex
	calls []fakeLLMCall
	idx   int
}

func (f *fakeLLM) StreamMessage(
	ctx context.Context,
	_ string,
	_ string,
	_ []Message,
	_ []tool.Tool,
	onEvent func(StreamEvent),
) (string, []ToolCall, *Usage, error) {
	f.mu.Lock()
	if f.idx >= len(f.calls) {
		f.mu.Unlock()
		return "", nil, nil, errors.New("no more canned responses")
	}
	call := f.calls[f.idx]
	f.idx++
	f.mu.Unlock()

	if call.err != nil {
		return "", nil, nil, call.err
	}

	for _, tok := range call.tokens {
		if ctx.Err() != nil {
			return "", nil, nil, ctx.Err()
		}
		onEvent(StreamEvent{Type: "token", Text: tok})
	}

	return call.response, call.toolCalls, call.usage, nil
}

// --- Fake Tool ---

type fakeTool struct {
	name   string
	output string
	err    error
}

func (t *fakeTool) Name() string                 { return t.name }
func (t *fakeTool) Description() string          { return "fake tool" }
func (t *fakeTool) InputSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (t *fakeTool) Execute(
	_ context.Context,
	_ json.RawMessage,
	out tool.OutputStream,
) error {
	if t.err != nil {
		out.WriteError(t.err.Error())
		return t.err
	}
	out.Write(t.output)
	return nil
}

// --- Test Helpers ---

func newPromptFS() fstest.MapFS {
	return fstest.MapFS{
		"base.md": &fstest.MapFile{Data: []byte("You are a helpful assistant.")},
	}
}

func setupEngine(tools ...tool.Tool) (*Engine, *eventbus.Bus, *Store) {
	bus := eventbus.New()
	store := NewStore()
	registry := tool.NewRegistry()
	for _, t := range tools {
		registry.Register(t)
	}

	loader := prompt.NewLoader(newPromptFS())
	configs := map[string]AgentConfig{
		"develop": {
			ID: "develop",
			PromptConfig: prompt.Config{
				BasePrompt: "base.md",
			},
			Tools: toolNames(tools),
			Model: "test-model",
		},
	}

	engine := NewEngine(bus, store, registry, loader, configs)
	return engine, bus, store
}

func setupEngineWithStopAfter(
	stopAfter []string,
	tools ...tool.Tool,
) (*Engine, *eventbus.Bus, *Store) {
	bus := eventbus.New()
	store := NewStore()
	registry := tool.NewRegistry()
	for _, t := range tools {
		registry.Register(t)
	}

	loader := prompt.NewLoader(newPromptFS())
	configs := map[string]AgentConfig{
		"develop": {
			ID: "develop",
			PromptConfig: prompt.Config{
				BasePrompt: "base.md",
			},
			Tools:     toolNames(tools),
			StopAfter: stopAfter,
			Model:     "test-model",
		},
	}

	engine := NewEngine(bus, store, registry, loader, configs)
	return engine, bus, store
}

func newTestRunForEngine() *Run {
	return &Run{
		ID:             "run1",
		AppID:          "app1",
		ConversationID: "conv1",
		AgentID:        "develop",
		Status:         StatusCreated,
		Model:          "test-model",
		Budget:         Budget{MaxToolCalls: 100, MaxTokens: 100000},
		CreatedAt:      time.Now(),
	}
}

func toolNames(tools []tool.Tool) []string {
	names := make([]string, len(tools))
	for i, t := range tools {
		names[i] = t.Name()
	}
	return names
}

// eventCollector subscribes to the run's event bus topic and collects events.
// The collector goroutine drains the subscription channel until it is closed,
// ensuring no events are lost.
type eventCollector struct {
	events []Event
	mu     sync.Mutex
}

func collectEvents(bus *eventbus.Bus, topic string) (*eventCollector, func()) {
	sub := bus.Subscribe(topic, 256)
	c := &eventCollector{}
	var wg sync.WaitGroup
	wg.Go(func() {
		for raw := range sub.Ch {
			if ev, isEvent := raw.(Event); isEvent {
				c.mu.Lock()
				c.events = append(c.events, ev)
				c.mu.Unlock()
			}
		}
	})
	return c, func() {
		sub.Close()
		wg.Wait()
	}
}

func (c *eventCollector) Events() []Event {
	c.mu.Lock()
	defer c.mu.Unlock()
	result := make([]Event, len(c.events))
	copy(result, c.events)
	return result
}

func findEvent(events []Event, eventType EventType) *Event {
	for i := range events {
		if events[i].Type == eventType {
			return &events[i]
		}
	}
	return nil
}

func countEvents(events []Event, eventType EventType) int {
	n := 0
	for _, ev := range events {
		if ev.Type == eventType {
			n++
		}
	}
	return n
}

// --- Tests ---

func TestEngine_SimpleTextResponse(t *testing.T) {
	llm := &fakeLLM{calls: []fakeLLMCall{
		{
			response: "Hello, world!",
			tokens:   []string{"Hello", ", ", "world!"},
			usage:    &Usage{InputTokens: 10, OutputTokens: 5},
		},
	}}

	engine, bus, store := setupEngine()
	r := newTestRunForEngine()
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Hi")
	done()

	events := collector.Events()

	// Verify event sequence.
	assert.NotNil(t, findEvent(events, EventRunStarted))
	assert.NotNil(t, findEvent(events, EventPromptBuilt))
	assert.NotNil(t, findEvent(events, EventLLMRequestStart))
	assert.NotNil(t, findEvent(events, EventLLMStreamStart))
	assert.GreaterOrEqual(t, countEvents(events, EventLLMToken), 1)
	assert.NotNil(t, findEvent(events, EventLLMResponse))
	assert.NotNil(t, findEvent(events, EventRunCompleted))

	// Verify completion data.
	completed := findEvent(events, EventRunCompleted)
	require.NotNil(t, completed)
	data, ok := completed.Data.(CompletedData)
	require.True(t, ok)
	assert.Equal(t, "Hello, world!", data.FinalMessage)
	assert.Equal(t, 1, data.Iterations)
	assert.Equal(t, 0, data.ToolsCalled)

	// Verify status updated.
	got, err := store.Get(r.ID)
	require.NoError(t, err)
	assert.Equal(t, StatusCompleted, got.Status)
}

func TestEngine_SingleToolCall(t *testing.T) {
	echoTool := &fakeTool{name: "echo", output: "echoed: test"}

	llm := &fakeLLM{calls: []fakeLLMCall{
		{
			response: "Let me use a tool.",
			tokens:   []string{"Let me use a tool."},
			toolCalls: []ToolCall{
				{ID: "call1", Name: "echo", Input: json.RawMessage(`{"text":"test"}`)},
			},
			usage: &Usage{InputTokens: 10, OutputTokens: 5},
		},
		{
			response: "The tool said: echoed: test",
			tokens:   []string{"The tool said: echoed: test"},
			usage:    &Usage{InputTokens: 20, OutputTokens: 10},
		},
	}}

	engine, bus, store := setupEngine(echoTool)
	r := newTestRunForEngine()
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Test tool")
	done()

	events := collector.Events()
	assert.NotNil(t, findEvent(events, EventToolCallStart))
	assert.NotNil(t, findEvent(events, EventToolCallResult))
	assert.NotNil(t, findEvent(events, EventRunCompleted))

	completed := findEvent(events, EventRunCompleted)
	require.NotNil(t, completed)
	data, ok := completed.Data.(CompletedData)
	require.True(t, ok)
	assert.Equal(t, 1, data.ToolsCalled)
	assert.Equal(t, 2, data.Iterations)
}

func TestEngine_MultiIteration(t *testing.T) {
	tool1 := &fakeTool{name: "step1", output: "result1"}
	tool2 := &fakeTool{name: "step2", output: "result2"}

	llm := &fakeLLM{calls: []fakeLLMCall{
		{
			response:  "Using step1",
			tokens:    []string{"Using step1"},
			toolCalls: []ToolCall{{ID: "c1", Name: "step1", Input: json.RawMessage(`{}`)}},
			usage:     &Usage{InputTokens: 10, OutputTokens: 5},
		},
		{
			response:  "Using step2",
			tokens:    []string{"Using step2"},
			toolCalls: []ToolCall{{ID: "c2", Name: "step2", Input: json.RawMessage(`{}`)}},
			usage:     &Usage{InputTokens: 20, OutputTokens: 10},
		},
		{
			response: "All done.",
			tokens:   []string{"All done."},
			usage:    &Usage{InputTokens: 30, OutputTokens: 15},
		},
	}}

	engine, bus, store := setupEngine(tool1, tool2)
	r := newTestRunForEngine()
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Do both steps")
	done()

	events := collector.Events()
	assert.Equal(t, 2, countEvents(events, EventToolCallStart))
	assert.Equal(t, 2, countEvents(events, EventToolCallResult))
	assert.Equal(t, 3, countEvents(events, EventLLMRequestStart))

	completed := findEvent(events, EventRunCompleted)
	require.NotNil(t, completed)
	data, ok := completed.Data.(CompletedData)
	require.True(t, ok)
	assert.Equal(t, 2, data.ToolsCalled)
	assert.Equal(t, 3, data.Iterations)
}

func TestEngine_Cancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately.

	llm := &fakeLLM{calls: []fakeLLMCall{
		{response: "should not reach", tokens: []string{"nope"}},
	}}

	engine, bus, store := setupEngine()
	r := newTestRunForEngine()
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(ctx, llm, r, "Do something")
	done()

	events := collector.Events()
	assert.NotNil(t, findEvent(events, EventRunCancelled))

	got, err := store.Get(r.ID)
	require.NoError(t, err)
	assert.Equal(t, StatusCancelled, got.Status)
}

func TestEngine_BudgetExceeded_ToolCalls(t *testing.T) {
	llm := &fakeLLM{calls: []fakeLLMCall{
		{
			response: "first call",
			tokens:   []string{"first call"},
			toolCalls: []ToolCall{
				{ID: "c1", Name: "echo", Input: json.RawMessage(`{}`)},
			},
			usage: &Usage{InputTokens: 10, OutputTokens: 5},
		},
	}}

	echoTool := &fakeTool{name: "echo", output: "ok"}
	engine, bus, store := setupEngine(echoTool)
	r := newTestRunForEngine()
	r.Budget = Budget{MaxToolCalls: 1} // Exceeded after first tool batch.
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Test budget")
	done()

	events := collector.Events()
	cancelled := findEvent(events, EventRunCancelled)
	assert.NotNil(t, cancelled)

	got, err := store.Get(r.ID)
	require.NoError(t, err)
	assert.Equal(t, StatusCancelled, got.Status)
}

func TestEngine_BudgetExceeded_Tokens(t *testing.T) {
	// LLM returns a text-only response (no tool calls) whose token usage
	// exceeds MaxTokens. The run should be cancelled, not completed.
	llm := &fakeLLM{calls: []fakeLLMCall{
		{
			response: "verbose response",
			tokens:   []string{"verbose response"},
			usage:    &Usage{InputTokens: 50, OutputTokens: 60}, // 110 total > 100 limit
		},
	}}

	engine, bus, store := setupEngine()
	r := newTestRunForEngine()
	r.Budget = Budget{MaxTokens: 100} // Exceeded after first LLM call.
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Test token budget")
	done()

	events := collector.Events()
	cancelled := findEvent(events, EventRunCancelled)
	require.NotNil(t, cancelled)
	data, ok := cancelled.Data.(CancelledData)
	require.True(t, ok)
	assert.Contains(t, data.Reason, "budget exceeded")
}

func TestEngine_ToolError(t *testing.T) {
	failTool := &fakeTool{
		name: "fail",
		err:  errors.New("tool exploded"),
	}

	llm := &fakeLLM{calls: []fakeLLMCall{
		{
			response: "Calling fail tool",
			tokens:   []string{"Calling fail tool"},
			toolCalls: []ToolCall{
				{ID: "c1", Name: "fail", Input: json.RawMessage(`{}`)},
			},
			usage: &Usage{InputTokens: 10, OutputTokens: 5},
		},
		{
			response: "Tool failed, here's the recovery.",
			tokens:   []string{"Tool failed, here's the recovery."},
			usage:    &Usage{InputTokens: 20, OutputTokens: 10},
		},
	}}

	engine, bus, store := setupEngine(failTool)
	r := newTestRunForEngine()
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Try failing tool")
	done()

	events := collector.Events()

	// Tool error should be reported but run should continue.
	result := findEvent(events, EventToolCallResult)
	require.NotNil(t, result)
	resultData, ok := result.Data.(ToolResultData)
	require.True(t, ok)
	assert.Equal(t, "tool exploded", resultData.ErrMsg)

	// Run should complete (LLM handles the error).
	assert.NotNil(t, findEvent(events, EventRunCompleted))
}

func TestEngine_StopAfterTool(t *testing.T) {
	suggestTool := &fakeTool{name: "suggestedResponse", output: "suggestion"}

	llm := &fakeLLM{calls: []fakeLLMCall{
		{
			response: "Here's a suggestion.",
			tokens:   []string{"Here's a suggestion."},
			toolCalls: []ToolCall{
				{ID: "c1", Name: "suggestedResponse", Input: json.RawMessage(`{}`)},
			},
			usage: &Usage{InputTokens: 10, OutputTokens: 5},
		},
	}}

	engine, bus, store := setupEngineWithStopAfter(
		[]string{"suggestedResponse"},
		suggestTool,
	)
	r := newTestRunForEngine()
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Suggest something")
	done()

	events := collector.Events()
	// Should complete after the tool, NOT loop for another LLM call.
	assert.NotNil(t, findEvent(events, EventRunCompleted))
	assert.Equal(t, 1, countEvents(events, EventLLMRequestStart))
}

func TestEngine_UnknownAgent(t *testing.T) {
	llm := &fakeLLM{}
	engine, bus, store := setupEngine()
	r := newTestRunForEngine()
	r.AgentID = "nonexistent"
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Hi")
	done()

	events := collector.Events()
	failed := findEvent(events, EventRunFailed)
	require.NotNil(t, failed)
	data, ok := failed.Data.(FailedData)
	require.True(t, ok)
	assert.Contains(t, data.Error, "unknown agent")
}

func TestEngine_LLMError(t *testing.T) {
	llm := &fakeLLM{calls: []fakeLLMCall{
		{err: errors.New("API rate limit exceeded")},
	}}

	engine, bus, store := setupEngine()
	r := newTestRunForEngine()
	require.NoError(t, store.Create(r))

	collector, done := collectEvents(bus, r.Topic())
	engine.Execute(context.Background(), llm, r, "Hi")
	done()

	events := collector.Events()
	failed := findEvent(events, EventRunFailed)
	require.NotNil(t, failed)
	data, ok := failed.Data.(FailedData)
	require.True(t, ok)
	assert.Contains(t, data.Error, "API rate limit exceeded")
}

func TestEngine_EventBusToolStream(t *testing.T) {
	bus := eventbus.New()
	sub := bus.Subscribe("run:test", 32)
	defer sub.Close()

	stream := &eventBusToolStream{
		bus:   bus,
		topic: "run:test",
		name:  "myTool",
		id:    "call1",
	}

	stream.Write("chunk1")
	stream.Write("chunk2")
	stream.WriteError("errchunk")
	stream.SetMetadata("key", "value") // no-op but shouldn't panic

	assert.Equal(t, "chunk1chunk2errchunk", stream.FullOutput())

	// Verify events were published.
	var received []Event
	for range 3 {
		select {
		case raw := <-sub.Ch:
			if ev, ok := raw.(Event); ok {
				received = append(received, ev)
			}
		case <-time.After(100 * time.Millisecond):
			t.Fatal("timed out waiting for event")
		}
	}

	assert.Len(t, received, 3)
	for _, ev := range received {
		assert.Equal(t, EventToolOutput, ev.Type)
		data, ok := ev.Data.(ToolOutputData)
		require.True(t, ok)
		assert.Equal(t, "myTool", data.Name)
		assert.Equal(t, "call1", data.ID)
	}
}

func TestEngine_BudgetStartedAtInitialized(t *testing.T) {
	llm := &fakeLLM{calls: []fakeLLMCall{
		{response: "done", tokens: []string{"done"}, usage: &Usage{}},
	}}

	engine, _, store := setupEngine()
	r := newTestRunForEngine()
	r.Budget.MaxDuration = 1 * time.Hour
	require.NoError(t, store.Create(r))

	assert.True(t, r.Budget.StartedAt.IsZero())
	engine.Execute(context.Background(), llm, r, "Hi")
	assert.False(t, r.Budget.StartedAt.IsZero())
}
