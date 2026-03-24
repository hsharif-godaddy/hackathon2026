package run

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/eventbus"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/prompt"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// LLMClient abstracts the LLM API for testability.
type LLMClient interface {
	// StreamMessage sends a message to the LLM and calls onEvent for each
	// streaming event. Returns the full text response, any tool calls
	// requested, usage stats, and an error if the request failed.
	StreamMessage(
		ctx context.Context,
		model string,
		system string,
		messages []Message,
		tools []tool.Tool,
		onEvent func(StreamEvent),
	) (string, []ToolCall, *Usage, error)
}

// StreamEvent is emitted by the LLM client during streaming.
type StreamEvent struct {
	Type string // "token", "tool_call_start", "response", "error"
	Text string
}

// ToolCall represents a tool invocation requested by the LLM.
type ToolCall struct {
	ID    string
	Name  string
	Input json.RawMessage
}

// Usage tracks token consumption for a single LLM call.
type Usage struct {
	InputTokens  int
	OutputTokens int
	CacheRead    int
}

// Message represents a conversation message sent to/from the LLM.
type Message struct {
	Role    string    // "user" or "assistant"
	Content []Content // content blocks
}

// Content is a single content block within a message.
type Content struct {
	Type      string          // "text", "tool_use", "tool_result"
	Text      string          // for "text" blocks
	ToolUseID string          // for "tool_use" and "tool_result" blocks
	ToolName  string          // for "tool_use" blocks
	Input     json.RawMessage // for "tool_use" blocks
	Content   string          // for "tool_result" blocks
	IsError   bool            // for "tool_result" blocks
}

// AgentConfig defines an agent's tools, prompt, model, and stop rules.
type AgentConfig struct {
	ID           string
	PromptConfig prompt.Config
	Tools        []string
	StopAfter    []string
	Model        string
}

// Engine orchestrates the agent loop: build prompt, call LLM, execute tools,
// repeat until the LLM returns a text-only response or a stop condition.
type Engine struct {
	eventBus     *eventbus.Bus
	store        *Store
	toolRegistry *tool.Registry
	promptLoader *prompt.Loader
	agentConfigs map[string]AgentConfig
}

// NewEngine creates a run engine with the given dependencies.
func NewEngine(
	bus *eventbus.Bus,
	store *Store,
	toolRegistry *tool.Registry,
	promptLoader *prompt.Loader,
	agentConfigs map[string]AgentConfig,
) *Engine {
	return &Engine{
		eventBus:     bus,
		store:        store,
		toolRegistry: toolRegistry,
		promptLoader: promptLoader,
		agentConfigs: agentConfigs,
	}
}

// Execute runs the agent loop for the given run and user message.
// It publishes events to the event bus and run store throughout execution.
// Execute blocks until the run completes, is cancelled, or fails.
func (e *Engine) Execute(
	ctx context.Context,
	llm LLMClient,
	r *Run,
	userMessage string,
) {
	runID := r.ID
	topic := r.Topic()
	e.emit(runID, topic, EventRunStarted, StartedData{
		AgentID: r.AgentID,
		AppID:   r.AppID,
	})

	_ = e.store.UpdateStatus(runID, StatusRunning)

	// Initialize budget start time for duration enforcement.
	if r.Budget.StartedAt.IsZero() {
		r.Budget.StartedAt = time.Now()
	}

	agentCfg, ok := e.agentConfigs[r.AgentID]
	if !ok {
		e.fail(runID, topic, fmt.Sprintf("unknown agent: %s", r.AgentID))
		return
	}

	systemPrompt, err := e.promptLoader.Compose(agentCfg.PromptConfig, prompt.Context{
		AppID: r.AppID,
	})
	if err != nil {
		e.fail(runID, topic, fmt.Sprintf("prompt build failed: %v", err))
		return
	}

	e.emit(runID, topic, EventPromptBuilt, PromptBuiltData{
		TokenCount: len(systemPrompt) / 4, // rough estimate
	})

	agentTools := e.toolRegistry.ForAgent(agentCfg.Tools)
	stopSet := toSet(agentCfg.StopAfter)

	messages := []Message{{
		Role:    "user",
		Content: []Content{{Type: "text", Text: userMessage}},
	}}

	var totalToolsCalled int

	for iteration := 0; ; iteration++ {
		if err := ctx.Err(); err != nil {
			e.cancel(runID, topic, "context cancelled")
			return
		}

		if err := r.Budget.Check(); err != nil {
			e.cancel(runID, topic, err.Error())
			return
		}

		e.emit(runID, topic, EventLLMLoopIter, nil)
		e.emit(runID, topic, EventLLMRequestStart, nil)

		var firstToken bool
		response, toolCalls, usage, llmErr := llm.StreamMessage(
			ctx,
			modelOrDefault(agentCfg.Model, r.Model),
			systemPrompt,
			messages,
			agentTools,
			func(ev StreamEvent) {
				if ev.Type == "token" {
					if !firstToken {
						firstToken = true
						e.emit(runID, topic, EventLLMStreamStart, nil)
					}
					e.emit(runID, topic, EventLLMToken, TokenData{Text: ev.Text})
				}
			},
		)

		if llmErr != nil {
			if ctx.Err() != nil {
				e.cancel(runID, topic, "context cancelled")
			} else {
				e.fail(runID, topic, llmErr.Error())
			}
			return
		}

		if usage != nil {
			r.Budget.TokensUsed += usage.InputTokens + usage.OutputTokens
		}

		e.emit(runID, topic, EventLLMResponse, LLMResponseData{
			TokensIn:  usageField(usage, "in"),
			TokensOut: usageField(usage, "out"),
			CacheRead: usageField(usage, "cache"),
			Iteration: iteration,
		})

		// Enforce budget after accounting for this LLM call's tokens.
		if err := r.Budget.Check(); err != nil {
			e.cancel(runID, topic, err.Error())
			return
		}

		if len(toolCalls) == 0 {
			e.complete(runID, topic, response, iteration+1, totalToolsCalled)
			return
		}

		// Execute tools in parallel.
		results := e.executeTools(ctx, runID, topic, toolCalls)
		totalToolsCalled += len(toolCalls)
		r.Budget.ToolCallsUsed += len(toolCalls)

		// Check cancellation after tool execution.
		if ctx.Err() != nil {
			e.cancel(runID, topic, "context cancelled")
			return
		}

		// Re-check budget after accounting for tools.
		if err := r.Budget.Check(); err != nil {
			e.cancel(runID, topic, err.Error())
			return
		}

		// Build assistant message with tool_use blocks.
		var assistantBlocks []Content
		if response != "" {
			assistantBlocks = append(assistantBlocks, Content{
				Type: "text",
				Text: response,
			})
		}
		for _, tc := range toolCalls {
			assistantBlocks = append(assistantBlocks, Content{
				Type:      "tool_use",
				ToolUseID: tc.ID,
				ToolName:  tc.Name,
				Input:     tc.Input,
			})
		}
		messages = append(messages, Message{
			Role:    "assistant",
			Content: assistantBlocks,
		})

		// Build user message with tool_result blocks.
		var resultBlocks []Content
		for i, tc := range toolCalls {
			resultBlocks = append(resultBlocks, Content{
				Type:      "tool_result",
				ToolUseID: tc.ID,
				Content:   results[i].Content,
				IsError:   results[i].IsError,
			})
		}
		messages = append(messages, Message{
			Role:    "user",
			Content: resultBlocks,
		})

		// Check stop-after tools.
		if shouldStop(toolCalls, stopSet) {
			e.complete(runID, topic, response, iteration+1, totalToolsCalled)
			return
		}
	}
}

// toolResult holds the output of a tool execution.
type toolResult struct {
	Content string
	IsError bool
}

func (e *Engine) executeTools(
	ctx context.Context,
	runID string,
	topic string,
	calls []ToolCall,
) []toolResult {
	results := make([]toolResult, len(calls))
	var wg sync.WaitGroup

	for i, tc := range calls {
		e.emit(runID, topic, EventToolCallStart, ToolStartData{
			Name: tc.Name,
			ID:   tc.ID,
		})

		wg.Add(1)
		go func(idx int, call ToolCall) {
			defer wg.Done()

			stream := &eventBusToolStream{
				bus:   e.eventBus,
				topic: topic,
				name:  call.Name,
				id:    call.ID,
			}

			start := time.Now()
			err := e.toolRegistry.Execute(ctx, call.Name, call.Input, stream)
			duration := time.Since(start)

			output := stream.FullOutput()

			var errMsg string
			if err != nil {
				errMsg = err.Error()
				if output == "" {
					output = errMsg
				}
				results[idx] = toolResult{Content: output, IsError: true}
			} else {
				results[idx] = toolResult{Content: output, IsError: false}
			}

			e.emit(runID, topic, EventToolCallResult, ToolResultData{
				Name:     call.Name,
				ID:       call.ID,
				Duration: duration,
				ErrMsg:   errMsg,
			})
		}(i, tc)
	}

	wg.Wait()
	return results
}

// eventBusToolStream implements tool.OutputStream by publishing EventToolOutput
// events to the event bus and accumulating full output.
type eventBusToolStream struct {
	bus   *eventbus.Bus
	topic string
	name  string
	id    string
	buf   strings.Builder
	mu    sync.Mutex
}

func (s *eventBusToolStream) Write(chunk string) {
	s.mu.Lock()
	s.buf.WriteString(chunk)
	s.mu.Unlock()

	s.bus.Publish(s.topic, NewEvent(EventToolOutput, ToolOutputData{
		Name:  s.name,
		ID:    s.id,
		Chunk: chunk,
	}))
}

func (s *eventBusToolStream) WriteError(chunk string) {
	s.Write(chunk)
}

func (s *eventBusToolStream) SetMetadata(_ string, _ any) {
	// Metadata is not published to the event bus.
}

// FullOutput returns the accumulated output, safe to call after Execute returns.
func (s *eventBusToolStream) FullOutput() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func (e *Engine) emit(runID, topic string, eventType EventType, data any) {
	ev := NewEvent(eventType, data)
	e.eventBus.Publish(topic, ev)
	_ = e.store.Append(runID, ev)
}

func (e *Engine) fail(runID, topic, errMsg string) {
	e.emit(runID, topic, EventRunFailed, FailedData{Error: errMsg})
	_ = e.store.UpdateStatus(runID, StatusFailed)
}

func (e *Engine) cancel(runID, topic, reason string) {
	e.emit(runID, topic, EventRunCancelled, CancelledData{Reason: reason})
	_ = e.store.UpdateStatus(runID, StatusCancelled)
}

func (e *Engine) complete(runID, topic, finalMsg string, iterations, toolsCalled int) {
	e.emit(runID, topic, EventRunCompleted, CompletedData{
		FinalMessage: finalMsg,
		Iterations:   iterations,
		ToolsCalled:  toolsCalled,
	})
	_ = e.store.UpdateStatus(runID, StatusCompleted)
}

func shouldStop(calls []ToolCall, stopSet map[string]bool) bool {
	for _, tc := range calls {
		if stopSet[tc.Name] {
			return true
		}
	}
	return false
}

func toSet(items []string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, item := range items {
		m[item] = true
	}
	return m
}

func modelOrDefault(agentModel, runModel string) string {
	if runModel != "" {
		return runModel
	}
	return agentModel
}

func usageField(u *Usage, field string) int {
	if u == nil {
		return 0
	}
	switch field {
	case "in":
		return u.InputTokens
	case "out":
		return u.OutputTokens
	case "cache":
		return u.CacheRead
	default:
		return 0
	}
}
