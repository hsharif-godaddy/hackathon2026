package run

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunStatus(t *testing.T) {
	assert.Equal(t, StatusCreated, Status("created"))
	assert.Equal(t, StatusQueued, Status("queued"))
	assert.Equal(t, StatusRunning, Status("running"))
	assert.Equal(t, StatusCompleted, Status("completed"))
	assert.Equal(t, StatusCancelled, Status("cancelled"))
	assert.Equal(t, StatusFailed, Status("failed"))
}

func TestEventTypeValues(t *testing.T) {
	assert.Equal(t, EventRunStarted, EventType("run.started"))
	assert.Equal(t, EventRunCompleted, EventType("run.completed"))
	assert.Equal(t, EventRunCancelled, EventType("run.cancelled"))
	assert.Equal(t, EventRunFailed, EventType("run.failed"))
	assert.Equal(t, EventLLMToken, EventType("llm.token"))
	assert.Equal(t, EventLLMStreamStart, EventType("llm.stream.start"))
	assert.Equal(t, EventLLMRequestStart, EventType("llm.request.start"))
	assert.Equal(t, EventLLMResponse, EventType("llm.response"))
	assert.Equal(t, EventLLMStall, EventType("llm.stall"))
	assert.Equal(t, EventLLMLoopIter, EventType("llm.loop_iteration"))
	assert.Equal(t, EventPromptBuilt, EventType("prompt.built"))
	assert.Equal(t, EventToolCallStart, EventType("tool.call.start"))
	assert.Equal(t, EventToolOutput, EventType("tool.output"))
	assert.Equal(t, EventToolCallResult, EventType("tool.call.result"))
	assert.Equal(t, EventBudgetWarning, EventType("budget.warning"))
}

func TestNewEvent(t *testing.T) {
	ev := NewEvent(EventLLMToken, TokenData{Text: "hello"})
	assert.Equal(t, EventLLMToken, ev.Type)
	assert.NotEmpty(t, ev.ID)
	assert.False(t, ev.Timestamp.IsZero())
	assert.Zero(t, ev.Sequence, "Sequence should be zero — assigned by store layer")
	data, ok := ev.Data.(TokenData)
	require.True(t, ok)
	assert.Equal(t, "hello", data.Text)
}

func TestNewEventIDsAreUnique(t *testing.T) {
	ev1 := NewEvent(EventLLMToken, TokenData{Text: "a"})
	ev2 := NewEvent(EventLLMToken, TokenData{Text: "b"})
	assert.NotEqual(t, ev1.ID, ev2.ID)
}

func TestNewEventIDHasPrefix(t *testing.T) {
	ev := NewEvent(EventRunStarted, nil)
	assert.True(t, strings.HasPrefix(ev.ID, "evt_"), "ID should start with evt_ prefix, got: %s", ev.ID)
}

func TestRunTopic(t *testing.T) {
	r := &Run{ID: "run_abc"}
	assert.Equal(t, "run:run_abc", r.Topic())
}

func TestBudgetCheckPasses(t *testing.T) {
	b := &Budget{MaxToolCalls: 5}
	b.ToolCallsUsed = 4
	assert.NoError(t, b.Check())
}

func TestBudgetCheckToolCallsExceeded(t *testing.T) {
	b := &Budget{MaxToolCalls: 5}
	b.ToolCallsUsed = 5
	assert.ErrorIs(t, b.Check(), ErrBudgetExceeded)
}

func TestBudgetCheckTokensExceeded(t *testing.T) {
	b := &Budget{MaxTokens: 1000}
	b.TokensUsed = 1000
	assert.ErrorIs(t, b.Check(), ErrBudgetExceeded)
}

func TestBudgetCheckDurationExceeded(t *testing.T) {
	b := &Budget{
		MaxDuration: 1 * time.Millisecond,
		StartedAt:   time.Now().Add(-1 * time.Second),
	}
	assert.ErrorIs(t, b.Check(), ErrBudgetExceeded)
}

func TestBudgetCheckZeroLimitsAlwaysPass(t *testing.T) {
	b := &Budget{}
	b.TokensUsed = 999999
	b.ToolCallsUsed = 999999
	assert.NoError(t, b.Check())
}

func TestBudgetCheckDurationSkippedWhenStartedAtZero(t *testing.T) {
	b := &Budget{MaxDuration: 1 * time.Nanosecond}
	// StartedAt is zero — duration check should be skipped, not enforced.
	assert.NoError(t, b.Check())
}
