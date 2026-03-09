package run

import (
	"errors"
	"fmt"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/id"
)

// ErrBudgetExceeded is returned by Budget.Check when any limit is reached.
var ErrBudgetExceeded = errors.New("budget exceeded")

// Status represents the lifecycle state of a run.
type Status string

const (
	StatusCreated   Status = "created"
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusCancelled Status = "cancelled"
	StatusFailed    Status = "failed"
)

// EventType identifies what happened in a run event.
type EventType string

const (
	EventRunStarted      EventType = "run.started"
	EventPromptBuilt     EventType = "prompt.built"
	EventLLMRequestStart EventType = "llm.request.start"
	EventLLMStreamStart  EventType = "llm.stream.start"
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

// Event is the fundamental unit of the run's event log.
type Event struct {
	ID        string
	Sequence  int64 // Assigned by the store layer when appended, not by NewEvent.
	Timestamp time.Time
	Type      EventType
	Data      any
}

// NewEvent creates an event with a unique ID and current timestamp.
// Sequence is left at zero — it is assigned by the RunStore on append.
func NewEvent(eventType EventType, data any) Event {
	return Event{
		ID:        id.New("evt"),
		Timestamp: time.Now(),
		Type:      eventType,
		Data:      data,
	}
}

// Event data types.

// StartedData is emitted when a run begins execution.
type StartedData struct {
	AgentID string
	AppID   string
}

// PromptBuiltData is emitted after the system prompt is composed.
type PromptBuiltData struct {
	TokenCount int
}

// TokenData is emitted for each streamed LLM token.
type TokenData struct {
	Text string
}

// LLMResponseData is emitted when an LLM call completes with usage stats.
type LLMResponseData struct {
	TokensIn  int
	TokensOut int
	CacheRead int
	Iteration int
}

// ToolStartData is emitted when a tool call begins.
type ToolStartData struct {
	Name string
	ID   string
}

// ToolOutputData is emitted for incremental tool output chunks.
type ToolOutputData struct {
	Name  string
	ID    string
	Chunk string
}

// ToolResultData is emitted when a tool call completes.
// ErrMsg is empty when the tool succeeded; set from err.Error() on failure.
type ToolResultData struct {
	Name     string
	ID       string
	Duration time.Duration
	ErrMsg   string
}

// CompletedData is emitted when a run finishes successfully.
type CompletedData struct {
	FinalMessage string
	Iterations   int
	ToolsCalled  int
}

// CancelledData is emitted when a run is cancelled (user, budget, or timeout).
type CancelledData struct {
	Reason string
}

// FailedData is emitted when a run fails with an unrecoverable error.
type FailedData struct {
	Error string
}

// Run represents a single agent turn.
type Run struct {
	ID             string
	AppID          string
	ConversationID string
	AgentID        string
	Status         Status
	Model          string
	Budget         Budget
	CreatedAt      time.Time
}

// Topic returns the event bus topic for this run's events.
func (r *Run) Topic() string {
	return "run:" + r.ID
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

// Check returns ErrBudgetExceeded if any configured limit has been reached.
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
